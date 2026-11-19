/** S-12 · Variables: step 1 in the library file, step 2 in the consumer file. */
import { type SpikeDefinition, taskClient } from '../_shared/spike.ts';
import type { StoredKeys, s12Tasks } from './plugin.ts';

const KEYS_KEY = 'keys';

type Step1 = Awaited<ReturnType<(typeof s12Tasks)['S-12/step1']>>;

/** The direct answers of step 1 (14 S-12, BUILD B-29). */
export function step1Answers(raw: Step1, plan: string) {
  const bound = raw.bindings.filter((row) => row.ok && row.bound).map((row) => row.field);
  const failed = raw.bindings
    .filter((row) => !(row.ok && row.bound))
    .map((row) => (row.error ? `${row.field}: ${row.error}` : `${row.field}: not bound on read-back`));
  return {
    plan,
    bindableFields: { bound, failed, total: raw.bindings.length },
    modeLimit: raw.modeLimit.modeLimit,
    modeLimitRefusal: raw.modeLimit.refusal,
    explicitModes:
      raw.explicitMode.ok && 'resolvedChanged' in raw.explicitMode ? raw.explicitMode.resolvedChanged : false,
    codeSyntaxWeb: {
      set: raw.codeSyntax.filter((row) => row.error === null).length,
      readBackMatches: raw.codeSyntax.filter((row) => row.readBack === row.set).length,
      total: raw.codeSyntax.length,
    },
    aliasAcrossCollections: raw.alias.ok && raw.alias.crossCollection,
    documentationLinksOnSets: raw.documentationLinks.set.ok,
    textStyleBinding: raw.bindings.filter((row) => row.kind === 'text-style').every((row) => row.ok && row.bound),
    gradientStopBinding: raw.bindings.find((row) => row.kind === 'gradient-stop')?.bound ?? false,
  };
}

export const s12: SpikeDefinition = {
  id: 'S-12',
  title: 'Variables',
  question:
    'Which fields can be bound to variables, how many modes are allowed, does codeSyntax.WEB matching work, and can a consumer import library variables by key?',
  userTime: '20 min',
  steps: [
    {
      id: 'step1',
      label: 'Step 1',
      where: 'the file "Spikes Library"',
      before: ['Creates two variable collections and test layers on a new page.'],
      after: [
        'Paste the results in the chat.',
        'Then publish the library with the variables: Assets ▸ Libraries ▸ Publish.',
        'Optional: on a Starter or Professional account, run Step 1 there too and paste.',
      ],
      run: async (io) => {
        const call = taskClient<typeof s12Tasks>(io);
        const plan = await io.ask({
          kind: 'choice',
          lines: ['Which Figma plan is this file in?', 'You can see it in the file’s team or organization name.'],
          choices: [
            { id: 'starter', label: 'Starter (free)' },
            { id: 'professional', label: 'Professional' },
            { id: 'organization', label: 'Organization' },
            { id: 'enterprise', label: 'Enterprise' },
            { id: 'unsure', label: 'Not sure' },
          ],
        });
        const raw = await call('S-12/step1', null);
        await io.state.set(KEYS_KEY, raw.keys);
        return { results: { answers: step1Answers(raw, plan.choice), details: raw } };
      },
    },
    {
      id: 'step2',
      label: 'Step 2',
      where: 'the file "Spikes Consumer"',
      before: [
        'First publish "Spikes Library" (Step 1 tells you how).',
        'Then, in this file: Assets ▸ Libraries ▸ turn on "Spikes Library".',
      ],
      after: ['Paste the results in the chat.'],
      run: async (io) => {
        const keys = await io.state.get<StoredKeys>(KEYS_KEY);
        if (!keys) throw new Error('Run Step 1 in "Spikes Library" first (on this computer).');
        const raw = await taskClient<typeof s12Tasks>(io)('S-12/step2', { keys });
        const importedOk = raw.imports.filter((entry) => entry.ok);
        const notes =
          raw.library.ourCollectionsFound === 0
            ? [
                'The library variables were not found. Publish "Spikes Library" and turn it on in this file, then run Step 2 again.',
              ]
            : [];
        return {
          notes,
          results: {
            answers: {
              libraryCollectionsListed: raw.library.ourCollectionsFound > 0,
              libraryVariableHasCodeSyntax: raw.library.libraryVariableHasCodeSyntax,
              importVariableByKey: {
                ok: importedOk.length,
                total: raw.imports.length,
                maxMs: Math.max(0, ...importedOk.map((e) => e.ms)),
              },
              codeSyntaxWebMatching: raw.matching,
              aliasAcrossCollectionsAfterImport: raw.aliasAfterImport.isAlias && raw.aliasAfterImport.targetReadable,
              explicitModeWithLibraryCollection: raw.explicitModeWithLibraryCollection,
              bindImportedVariable: raw.bindImported,
            },
            details: raw,
          },
        };
      },
    },
  ],
};
