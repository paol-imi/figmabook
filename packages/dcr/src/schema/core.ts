import { canonicalJSON, h16, type IrDiagnostic } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { DesignChangeRequest } from './dcr';
import type { DcrChange, DcrItem, DcrTarget } from './item';
import { cloneJson, sortDcr } from './order';

/*
 * Ids and the core hash (15 §4.9, D-35, D-50). The plugin and the CLI compute the same core
 * from the same snapshot and config; the CLI then attaches provenance, which is outside
 * the core, and checks on import that the hash still matches.
 */

/** A request before its hash and id are computed: what the extractor builds. */
export type DcrDraft = Omit<DesignChangeRequest, 'id' | 'dcrHash'> &
  Partial<Pick<DesignChangeRequest, 'id' | 'dcrHash'>>;

/** The part of a request that `dcrHash` covers. */
export type DcrCore = Omit<DesignChangeRequest, 'id' | 'dcrHash'>;

/** Canonical JSON of DCR data. Numbers are already normalized; `ratio` keeps 1e-3 and 1e-4 steps exact. */
export function canonicalDcr(value: unknown): string {
  return canonicalJSON(value, { numKind: 'ratio' });
}

/** The stable identity of an item target: the target without `code`, and without `figmaNodeId` when a key names it. */
export type DcrItemIdentity = Omit<DcrTarget, 'code' | 'figmaNodeId'> & { readonly figmaNodeId?: string };

export interface DcrItemIdInput {
  /** Item kind, e.g. `component.modified` or `variant.added` (15 §4.4). */
  readonly kind: string;
  readonly target: DcrItemIdentity;
  /** Paths of the changed fields, e.g. `layout.paddingLeft`. Order and duplicates do not matter. */
  readonly fields: readonly string[];
}

/**
 * Stable item id: `h16(kind ∥ target ∥ sorted field paths)` (15 §4.9). The parts are joined
 * as canonical JSON, so no two different inputs share a preimage. The same change gets the
 * same id across re-extractions, which lets verify and follow-up requests track items.
 */
export function dcrItemId({ kind, target, fields }: DcrItemIdInput): string {
  return h16(canonicalDcr([kind, target, [...new Set(fields)].sort()]));
}

/** Kinds with one item per used `(sid, vk)`, whatever node the first occurrence is (15 §4.13). */
const PER_VARIANT_KINDS: ReadonlySet<string> = new Set(['instance.outdated', 'instance.deprecated']);

/**
 * The identity of an item's target. `code` is CLI-added, so it never feeds an id.
 * `figmaNodeId` counts only when no Holotype key names the thing: it is dropped when the
 * target has an `nk` or a `key`, and for `instance.outdated`/`instance.deprecated` (named by
 * `sid` + `vk`). A duplicated variant, an added layer or an instance has nothing else, while
 * a managed node keeps its id even if Figma gives it a new node id.
 */
export function itemIdentity(kind: string, target: DcrTarget): DcrItemIdentity {
  const { code: _code, figmaNodeId, ...keys } = target;
  const named = keys.nk !== undefined || keys.key !== undefined || PER_VARIANT_KINDS.has(kind);
  return named ? keys : { ...keys, figmaNodeId };
}

/** The id an item must carry: from its kind, target and the field paths of its changes. */
export function computeItemId(
  item: Pick<DcrItem, 'kind' | 'target'> & { readonly changes?: readonly DcrChange[] },
): string {
  return dcrItemId({
    kind: item.kind,
    target: itemIdentity(item.kind, item.target),
    fields: (item.changes ?? []).map((change) => change.field),
  });
}

/**
 * Diagnostics that only the CLI's provenance step raises or clears. They describe the
 * provenance attached afterwards, so, like the provenance itself, they are outside the core.
 */
export const CLI_ENRICHMENT_CODES: ReadonlySet<string> = new Set([
  'DCR_PROVENANCE_MISSING',
  'DCR_PROVENANCE_MINIFIED',
  'DCR_PROVENANCE_NO_SOURCEMAP',
  'DCR_PROVENANCE_STALE',
  'DCR_CONFIG_DRIFT',
]);

const coreDiagnostics = (diagnostics: readonly IrDiagnostic[]) =>
  diagnostics.filter((d) => !CLI_ENRICHMENT_CODES.has(d.code));

/**
 * The core of a request (15 §4.9 "Hash", D-50): the request without `id` and `dcrHash`,
 * `header.generated`, `header.figma.fileVersion`, `header.headCommit`, and everything the
 * CLI attaches from provenance: `target.code`, `nearest[].code`, and on each change
 * `origin`, `css`, `reach` and `varDefinition`, plus the provenance diagnostics
 * ({@link CLI_ENRICHMENT_CODES}). Asset bytes are never in a request (only role ids are).
 * Pure; the input is not changed.
 */
export function dcrCore(dcr: DcrDraft): DcrCore {
  const { id: _id, dcrHash: _hash, ...rest } = cloneJson(dcr);
  const { generated: _generated, headCommit: _head, figma, ...header } = rest.header;
  const { fileVersion: _version, ...figmaCore } = figma;
  return {
    ...rest,
    header: { ...header, figma: figmaCore },
    items: rest.items.map(coreItem),
    diagnostics: coreDiagnostics(rest.diagnostics),
  };
}

function coreItem(item: DcrItem): DcrItem {
  const { code: _code, ...target } = item.target;
  const out = { ...item, target } as DcrItem;
  if (out.diagnostics) {
    const kept = coreDiagnostics(out.diagnostics);
    // An item whose only diagnostics were provenance ones has the core of one that had none.
    if (kept.length > 0) out.diagnostics = kept;
    else delete out.diagnostics;
  }
  if ('changes' in out && out.changes) {
    out.changes = out.changes.map(({ origin: _o, css: _c, reach: _r, varDefinition: _v, ...change }) => change);
  }
  if (out.kind === 'component.new' && out.nearest) out.nearest = out.nearest.map(({ code: _c, ...n }) => n);
  return out;
}

/** `dcrHash = h16(canonical(core))`, over the canonical order (`sortDcr`). */
export function computeDcrHash(dcr: DcrDraft): string {
  return h16(canonicalDcr(dcrCore(sortDcr(dcr))));
}

export interface DcrIdInput {
  readonly repo: string;
  readonly branch: string;
  readonly fileKey: string;
  readonly dcrHash: string;
}

/** Request id: `h16(repo ∥ branch ∥ fileKey ∥ dcrHash)` (15 §6), joined as canonical JSON. */
export function dcrId({ repo, branch, fileKey, dcrHash }: DcrIdInput): string {
  return h16(canonicalDcr([repo, branch, fileKey, dcrHash]));
}

/** Sorts a draft and stamps its `dcrHash` and `id`: the last step of extraction. */
export function sealDcr(draft: DcrDraft): DesignChangeRequest {
  const sorted = sortDcr(draft);
  const dcrHash = computeDcrHash(sorted);
  const { repo, branch, figma } = sorted.header;
  return { ...sorted, dcrHash, id: dcrId({ repo, branch, fileKey: figma.fileKey, dcrHash }) };
}

/** The bytes of `dcr.json`: canonical JSON in canonical order. */
export function serializeDcr(dcr: DesignChangeRequest): string {
  return canonicalDcr(sortDcr(dcr));
}

/**
 * Recomputes `dcrHash` and `id` (CLI import and pull, 15 §4.9). A mismatch means the core
 * changed after extraction, or plugin and CLI disagree: `DCR_SNAPSHOT_PARITY` with both
 * hashes. The caller rejects the request (raise the severity to `error` when it does).
 */
export function checkDcrHash(dcr: DesignChangeRequest): Diagnostic | undefined {
  const dcrHash = computeDcrHash(dcr);
  const { repo, branch, figma } = dcr.header;
  const id = dcrId({ repo, branch, fileKey: figma.fileKey, dcrHash });
  if (dcrHash === dcr.dcrHash && id === dcr.id) return undefined;
  const field = dcrHash === dcr.dcrHash ? 'id' : 'dcrHash';
  return createDiagnostic(diagnostic('DCR_SNAPSHOT_PARITY'), undefined, {
    property: field,
    value: field === 'id' ? dcr.id : dcr.dcrHash,
    data: { field, stored: field === 'id' ? dcr.id : dcr.dcrHash, computed: field === 'id' ? id : dcrHash },
  });
}
