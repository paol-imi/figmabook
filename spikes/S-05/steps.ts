/** S-05 · Border model: an automatic run, then a designer's hands-on check of A vs B. */
import { errorMessage } from '../_shared/json.ts';
import { comparePixels, type PixelScore, type Rgba } from '../_shared/pixels.ts';
import { type SpikeDefinition, type StepIO, taskClient } from '../_shared/spike.ts';
import { CASES, expectedChildOffset } from './cases.ts';
import type { BuiltCase, Model, s05Tasks } from './plugin.ts';
import refsJson from './refs.json';
import type { RefsFile } from './refs.ts';

const refs = refsJson as RefsFile;

export type Decoded = { data: Rgba; width: number; height: number };
export type Decoder = (png: Uint8Array) => Promise<Decoded>;

/** Decodes a PNG in the UI iframe with an off-screen canvas. */
export const canvasDecoder: Decoder = async (png) => {
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas in this window.');
  context.drawImage(bitmap, 0, 0);
  return {
    data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
    width: bitmap.width,
    height: bitmap.height,
  };
};

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type ScoredCase = {
  caseId: string;
  model: Model;
  technique: string;
  childError: number | null;
  child: { x: number; y: number } | null;
  pixels: PixelScore | null;
  error: string | null;
};

export async function scoreCases(
  built: readonly BuiltCase[],
  decode: Decoder,
  references: RefsFile = refs,
): Promise<ScoredCase[]> {
  const scored: ScoredCase[] = [];
  for (const entry of built) {
    const ref = references.cases[entry.caseId];
    const testCase = CASES.find((candidate) => candidate.id === entry.caseId);
    const expected = testCase ? expectedChildOffset(testCase) : null;
    const target = ref?.child ?? expected;
    const childError =
      entry.child && target ? Math.max(Math.abs(entry.child.x - target.x), Math.abs(entry.child.y - target.y)) : null;
    let pixels: PixelScore | null = null;
    let error = entry.error;
    if (entry.png && ref) {
      try {
        pixels = comparePixels(await decode(entry.png), await decode(base64ToBytes(ref.png)));
      } catch (decodeError) {
        error = `pixel compare: ${errorMessage(decodeError)}`;
      }
    }
    scored.push({
      caseId: entry.caseId,
      model: entry.model,
      technique: entry.technique,
      childError,
      child: entry.child,
      pixels,
      error,
    });
  }
  return scored;
}

/** Direct answers for "keep D-16 (model A) or flip to B". */
export function summarize(scored: readonly ScoredCase[]) {
  const byModel = (model: Model) => scored.filter((entry) => entry.model === model);
  const stats = (model: Model) => {
    const rows = byModel(model);
    const errors = rows.map((row) => row.childError).filter((value): value is number => value !== null);
    const diffs = rows.map((row) => row.pixels?.diffRatio).filter((value): value is number => value !== undefined);
    return {
      maxChildError: errors.length > 0 ? Math.max(...errors) : null,
      casesWithChildError: rows.filter((row) => (row.childError ?? 0) > 0.5).map((row) => row.caseId),
      meanDiffRatio:
        diffs.length > 0 ? Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10_000) / 10_000 : null,
      failed: rows.filter((row) => row.error !== null).map((row) => row.caseId),
    };
  };
  const A = stats('A');
  const B = stats('B');
  const score = (s: typeof A) => (s.maxChildError ?? 99) * 10 + (s.meanDiffRatio ?? 1);
  const favours = Math.abs(score(A) - score(B)) < 0.001 ? 'tie' : score(A) < score(B) ? 'A' : 'B';
  const perSide = (model: Model) =>
    scored.find((row) => row.model === model && row.caseId === 'per-side-widths-1-2-3-4-al');
  return {
    modelA: A,
    modelB: B,
    measuredFavours: favours,
    perSideWidthsInAutoLayout: { A: perSide('A')?.childError ?? null, B: perSide('B')?.childError ?? null },
    dashedCss: refs.cases['dashed-2px-al']?.dash ?? null,
  };
}

async function runAutomatic(io: StepIO) {
  const call = taskClient<typeof s05Tasks>(io);
  const dashes: Record<string, { dash: number; gap: number }> = {};
  for (const [id, ref] of Object.entries(refs.cases))
    if (ref.dash) dashes[id] = { dash: ref.dash.dash, gap: ref.dash.gap };
  const { built } = await call('S-05/build', { dashes });
  io.progress('Comparing with the browser pictures…');
  const scored = await scoreCases(built, canvasDecoder);
  return { results: { answers: summarize(scored), renderer: refs.renderer, cases: scored } };
}

async function runDesigner(io: StepIO) {
  await io.ask({
    kind: 'continue',
    lines: [
      'On the page "S-05 Border model", scroll to the frames labelled A and B.',
      'Select A and set its stroke width to 3. Do the same for B.',
      'Then click Continue.',
    ],
  });
  const edit = await taskClient<typeof s05Tasks>(io)('S-05/read-edit', null);
  const opinion = await io.ask({
    kind: 'choice',
    lines: ['Which one behaved the way you expected?'],
    choices: [
      { id: 'A', label: 'A felt right' },
      { id: 'B', label: 'B felt right' },
      { id: 'both', label: 'Both fine' },
    ],
    note: { label: 'One sentence why (optional)' },
  });
  const edited = (side: typeof edit.A) => side !== null && side.strokeWeight === 3;
  return {
    notes:
      edited(edit.A) && edited(edit.B)
        ? []
        : ['A or B still has its old stroke width. That is fine if you chose not to edit it.'],
    results: { answers: { designerChoice: opinion.choice, reason: opinion.note.trim().slice(0, 300) }, edit },
  };
}

export const s05: SpikeDefinition = {
  id: 'S-05',
  title: 'Border model',
  question: 'Keep D-16 (inside stroke, padding + border, strokes not in layout) or flip it?',
  userTime: '10 min',
  steps: [
    {
      id: 'run',
      label: 'Run',
      where: 'the file "Spikes Scratch"',
      before: ['Builds 24 small boxes on a new page and compares them with browser pictures.'],
      after: ['Paste the results in the chat. Then run "Designer check".'],
      run: runAutomatic,
    },
    {
      id: 'designer',
      label: 'Designer check',
      where: 'the file "Spikes Scratch", after Run',
      before: ['You will edit two frames by hand and tell us which one felt right.'],
      after: ['Paste the results in the chat.'],
      run: runDesigner,
    },
  ],
};
