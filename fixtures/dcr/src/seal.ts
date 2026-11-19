import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  checkDcrIntegrity,
  computeItemId,
  type DcrItemKind,
  type DesignChangeRequest,
  type FigmaSnapshot,
  sealDcr,
  validateDcr,
} from '@holotype/dcr';
import { canonicalJSON } from '@holotype/ir';
import { CASE_FILES, type CaseInput, caseDir, loadCaseInput } from './case.ts';
import { baselineGroupsOf, checkCaseInput, checkExpected } from './check.ts';
import { appliedHashOf, configHash, readBranchMeta, readRegistry, snapshotHash } from './derived.ts';
import { formatGolden, pendingPrompt } from './expected.ts';

/*
 * `pnpm -F @holotype/fixture-dcr seal <case…>`: fills in what a case derives from its own
 * content, so authors edit meaning, not hashes.
 *
 * Inputs: `branch:meta.dcrConfig` and `configHash` from config.json; each managed node's
 * `ah` from its baseline groups (the hash as applied, so an edit shows as a sub-hash
 * mismatch, 10 §9.1).
 *
 * Expected request (a draft is fine: placeholder ids are any 16-hex strings): the header's
 * derived fields, every item id (`computeItemId`) with every reference to an old id
 * rewritten (questions, summary, new-component refs, asset role ids), the summary counts,
 * then `sealDcr` (canonical order, `dcrHash`, request id). The result must validate and pass
 * `checkDcrIntegrity`. A missing `expected/prompt.md` gets the pending placeholder.
 */

const canonicalString = (value: unknown): string => canonicalJSON(value, { numKind: 'ratio' });

/** The snapshot with `branch:meta` and every managed `ah` derived from config and baselines. */
export function sealInput(input: CaseInput): FigmaSnapshot {
  const meta = readBranchMeta(input.branch);
  const branchMeta = { ...meta, dcrConfig: input.config, configHash: configHash(input.config) };
  const nodes = Object.fromEntries(
    Object.entries(input.branch.nodes).map(([id, node]) => {
      const groups = node.data.ah === undefined ? undefined : baselineGroupsOf(input.branch, input.baseline, node);
      return [id, groups === undefined ? node : { ...node, data: { ...node.data, ah: appliedHashOf(groups) } }];
    }),
  );
  return {
    ...input.branch,
    nodes,
    rootData: { ...input.branch.rootData, 'branch:meta': canonicalString(branchMeta) },
  };
}

/** Rewrites every string equal to an old id, or starting with `<old id>:` (asset role ids). */
function remapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') {
    const direct = ids.get(value);
    if (direct !== undefined) return direct as T;
    const colon = value.indexOf(':');
    const prefixed = colon === 16 ? ids.get(value.slice(0, colon)) : undefined;
    return (prefixed === undefined ? value : `${prefixed}${value.slice(colon)}`) as T;
  }
  if (Array.isArray(value)) return value.map((item) => remapIds(item, ids)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapIds(item, ids)])) as T;
}

/** Seals an expected request draft against its (sealed) inputs. */
export function sealExpected(input: CaseInput, draft: DesignChangeRequest): DesignChangeRequest {
  const meta = readBranchMeta(input.branch);
  const registry = readRegistry(input.branch);
  const ids = new Map(draft.items.map((item) => [item.id, computeItemId(item)]));
  const remapped = remapIds(draft, ids);
  const counts: Partial<Record<DcrItemKind, number>> = {};
  for (const item of remapped.items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const { generated: _generated, ...header } = remapped.header;
  return sealDcr({
    ...remapped,
    header: {
      ...header,
      repo: meta.repo,
      branch: meta.branch,
      baseCommit: meta.baseCommit,
      scope: input.branch.scope,
      figma: {
        ...header.figma,
        fileKey: input.branch.fileKey,
        kind: meta.kind,
        snapshotHash: snapshotHash(input.branch),
      },
      baseline: {
        ...header.baseline,
        fp: meta.baselineFp,
        storybookVersion: registry.storybook.version,
        framework: registry.storybook.framework,
      },
      extractor: { ...header.extractor, configHash: meta.configHash },
    },
    summary: { ...remapped.summary, counts, questions: remapped.questions.length },
  });
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Seals one case in place. Returns the files it rewrote. Throws when the result is invalid. */
export function sealCase(name: string, root?: URL): string[] {
  const dir = caseDir(name, root);
  const written: string[] = [];
  const write = (file: string, text: string) => {
    const url = new URL(file, dir);
    if (existsSync(url) && readFileSync(url, 'utf8') === text) return;
    mkdirSync(new URL('./', url), { recursive: true });
    writeFileSync(url, text);
    written.push(file);
  };

  const raw = loadCaseInput(dir);
  const branch = sealInput(raw);
  if (canonicalString(branch) !== canonicalString(raw.branch)) write(CASE_FILES.branch, json(branch));
  const input: CaseInput = { ...raw, branch };
  const inputIssues = checkCaseInput(input);
  if (inputIssues.length > 0) throw new Error(`${name}: the inputs are inconsistent:\n  ${inputIssues.join('\n  ')}`);

  const draft = validateDcr(JSON.parse(readFileSync(new URL(CASE_FILES.dcr, dir), 'utf8')));
  if (!draft.ok) {
    throw new Error(
      `${name}: ${CASE_FILES.dcr} is invalid:\n  ${draft.error.map((i) => `${i.path} ${i.message}`).join('\n  ')}`,
    );
  }
  const sealed = sealExpected(input, draft.value);
  const issues = [...checkDcrIntegrity(sealed).map((i) => `${i.path} ${i.message}`), ...checkExpected(input, sealed)];
  if (issues.length > 0) throw new Error(`${name}: the sealed request is inconsistent:\n  ${issues.join('\n  ')}`);
  const before = readFileSync(new URL(CASE_FILES.dcr, dir), 'utf8');
  if (canonicalString(JSON.parse(before)) !== canonicalString(sealed)) write(CASE_FILES.dcr, formatGolden(sealed));
  if (!existsSync(new URL(CASE_FILES.prompt, dir))) write(CASE_FILES.prompt, pendingPrompt(name));
  return written;
}
