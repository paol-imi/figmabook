import { canonicalDcr, type DesignChangeRequest, dcrCore, serializeDcr, sortDcr } from '@holotype/dcr';

/*
 * How produced and expected requests are compared (12 §2.4). The bytes of `dcr.json` are
 * `serializeDcr` (canonical JSON in canonical order); the committed golden is the same
 * document pretty-printed, so it is compared after re-serializing. `header.generated` is
 * omitted in tests.
 */

/** The request without `header.generated` (the only clock-dependent field, outside the core). */
export function withoutGenerated(request: DesignChangeRequest): DesignChangeRequest {
  const { generated: _generated, ...header } = request.header;
  return { ...request, header };
}

/** The canonical bytes of a request as `dcr.json` holds them, `header.generated` omitted. */
export function requestBytes(request: DesignChangeRequest): string {
  return serializeDcr(withoutGenerated(request));
}

/** The canonical bytes of the core only: what the plugin alone produces (no CLI provenance). */
export function coreBytes(request: DesignChangeRequest): string {
  return canonicalDcr(dcrCore(sortDcr(request)));
}

/** The text written to `expected/dcr.json`: the canonical document, pretty-printed. */
export function formatGolden(request: DesignChangeRequest): string {
  return `${JSON.stringify(JSON.parse(serializeDcr(request)), null, 2)}\n`;
}

/** The placeholder `expected/prompt.md` of a case whose prompt is not rendered yet. */
export function pendingPrompt(name: string, reason = 'B-67 renderPrompt'): string {
  return [
    `<!-- holotype:pending ${reason} -->`,
    `# ${name}: prompt golden pending`,
    '',
    'This file becomes the expected `prompt.md` of the case once `renderPrompt` exists (B-67).',
    'Until then the case runner skips the prompt check. Replace this whole file with the golden.',
    '',
  ].join('\n');
}
