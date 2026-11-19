/**
 * S-02 main tasks:
 *   build  (library, step 1)  19 subject sets + 13 overridden instances each (same file)
 *   place  (consumer, step 2) the same 247 instances from the published library
 *   mutate (library, step 3)  one mutation per subject set
 *   read   (steps 3 and 4)    signatures of every overridden layer, on instance and main
 */
import { layoutGrid, probe, usePage } from '../_shared/figma.ts';
import { errorMessage } from '../_shared/json.ts';
import type { MainContext } from '../_shared/spike.ts';
import { buildBadge, buildIcons, buildSubject, type IconName, type SharedParts } from './fixture.ts';
import {
  type CellReading,
  type CellRecord,
  MUTATIONS,
  type MutationId,
  type MutationStatus,
  OVERRIDES,
} from './model.ts';
import { applyMutation } from './mutations.ts';
import { applyOverride, type OverrideTargets, readSignature, type Suffixes } from './overrides.ts';

export const LIBRARY_PAGE = 'S-02 Override matrix';
export const CONSUMER_PAGE = 'S-02 Consumer instances';

export type NodeRef = { id: string; key: string };
export type SharedInfo = { icons: Record<IconName, NodeRef>; collectionId: string };
export type SubjectInfo = {
  mutation: MutationId;
  setId: string;
  variantA: NodeRef;
  variableId: string;
  suffix: Suffixes;
};

async function placeRow(
  figma: PluginAPI,
  page: PageNode,
  mutation: MutationId,
  main: ComponentNode,
  suffix: Suffixes,
  targets: OverrideTargets,
  origin: { x: number; y: number },
): Promise<CellRecord[]> {
  const records: CellRecord[] = [];
  const instances: InstanceNode[] = [];
  for (const column of OVERRIDES) {
    const instance = main.createInstance();
    instance.name = `${mutation} ${column.id} ${column.label}`;
    page.appendChild(instance);
    instances.push(instance);
    const baseline = await readSignature(figma, column.key, instance, suffix);
    const result = await probe(() => applyOverride(figma, column.key, instance, suffix, targets));
    const applied = result.ok ? await readSignature(figma, column.key, instance, suffix) : null;
    records.push({
      mutation,
      override: column.id,
      instanceId: instance.id,
      baseline,
      applied,
      applyError: result.ok ? null : result.error,
    });
  }
  layoutGrid(instances, { x: origin.x, y: origin.y, columns: OVERRIDES.length, gap: 24 });
  return records;
}

async function build({ figma, progress }: MainContext, _input: null) {
  progress('Building shared parts…');
  const page = await usePage(figma, LIBRARY_PAGE);
  const icons = await buildIcons(figma, page);
  const badgeNeutral = await buildBadge(figma, page);
  const collection = figma.variables.createVariableCollection('S-02 Box colors');
  const parts: SharedParts = { icons, badgeNeutral, collection };
  const subjects: SubjectInfo[] = [];
  const records: CellRecord[] = [];
  let y = 0;
  for (const [row, mutation] of MUTATIONS.entries()) {
    progress(`Building set ${row + 1} of ${MUTATIONS.length} (${mutation.id})…`);
    const subject = await buildSubject(figma, mutation.id, parts, page);
    subject.set.x = 0;
    subject.set.y = y;
    records.push(
      ...(await placeRow(
        figma,
        page,
        mutation.id,
        subject.variantA,
        subject.suffix,
        { iconB: icons.B.id },
        { x: subject.set.width + 80, y },
      )),
    );
    subjects.push({
      mutation: mutation.id,
      setId: subject.set.id,
      variantA: { id: subject.variantA.id, key: subject.variantA.key },
      variableId: subject.variable.id,
      suffix: subject.suffix,
    });
    y += subject.set.height + 80;
  }
  const ref = (node: ComponentNode): NodeRef => ({ id: node.id, key: node.key });
  const shared: SharedInfo = {
    icons: { A: ref(icons.A), B: ref(icons.B), C: ref(icons.C) },
    collectionId: collection.id,
  };
  return { shared, subjects, records };
}

async function place({ figma, progress }: MainContext, input: { shared: SharedInfo; subjects: SubjectInfo[] }) {
  const page = await usePage(figma, CONSUMER_PAGE);
  const iconB = await probe(() => figma.importComponentByKeyAsync(input.shared.icons.B.key));
  if (!iconB.ok) {
    throw new Error(
      `Could not import the library components (${iconB.error}). Publish "Spikes Library" and turn it on in this file (Assets ▸ Libraries).`,
    );
  }
  const records: CellRecord[] = [];
  const importErrors: { mutation: MutationId; error: string }[] = [];
  for (const [row, subject] of input.subjects.entries()) {
    progress(`Placing row ${row + 1} of ${input.subjects.length} (${subject.mutation})…`);
    const main = await probe(() => figma.importComponentByKeyAsync(subject.variantA.key));
    if (!main.ok) {
      importErrors.push({ mutation: subject.mutation, error: main.error });
      continue;
    }
    records.push(
      ...(await placeRow(
        figma,
        page,
        subject.mutation,
        main.value,
        subject.suffix,
        { iconB: iconB.value.id },
        { x: 0, y: row * 400 },
      )),
    );
  }
  return { records, importErrors };
}

async function mutate({ figma, progress }: MainContext, input: { shared: SharedInfo; subjects: SubjectInfo[] }) {
  const page = await usePage(figma, LIBRARY_PAGE);
  const icon = async (name: IconName) => {
    const node = await figma.getNodeByIdAsync(input.shared.icons[name].id);
    if (node?.type !== 'COMPONENT') throw new Error(`Icon ${name} is missing. Run Step 1 again in "Spikes Library".`);
    return node;
  };
  const icons = { A: await icon('A'), B: await icon('B'), C: await icon('C') };
  const status: Partial<Record<MutationId, MutationStatus>> = {};
  for (const subject of input.subjects) {
    progress(`Mutation ${subject.mutation}…`);
    const set = await figma.getNodeByIdAsync(subject.setId);
    const variantA = await figma.getNodeByIdAsync(subject.variantA.id);
    const variable = await figma.variables.getVariableByIdAsync(subject.variableId);
    if (set?.type !== 'COMPONENT_SET' || variantA?.type !== 'COMPONENT' || !variable) {
      status[subject.mutation] = {
        applied: false,
        notes: [],
        error: 'Subject set not found in this file. Is this "Spikes Library"?',
      };
      continue;
    }
    status[subject.mutation] = await applyMutation(figma, subject.mutation, { set, variantA, variable, icons, page });
  }
  return { status };
}

async function read({ figma, progress }: MainContext, input: { records: CellRecord[]; subjects: SubjectInfo[] }) {
  const readings: CellReading[] = [];
  const suffixes = new Map(input.subjects.map((subject) => [subject.mutation, subject.suffix]));
  for (const [index, record] of input.records.entries()) {
    if (index % 13 === 0) progress(`Reading row ${Math.floor(index / 13) + 1} of ${MUTATIONS.length}…`);
    const column = OVERRIDES.find((entry) => entry.id === record.override);
    const suffix = suffixes.get(record.mutation);
    if (!column || !suffix) continue;
    try {
      const instance = await figma.getNodeByIdAsync(record.instanceId);
      if (instance?.type !== 'INSTANCE') {
        readings.push({
          mutation: record.mutation,
          override: record.override,
          now: null,
          mainNow: null,
          error: 'instance not found',
        });
        continue;
      }
      const main = await instance.getMainComponentAsync();
      readings.push({
        mutation: record.mutation,
        override: record.override,
        now: await readSignature(figma, column.key, instance, suffix),
        mainNow: main ? await readSignature(figma, column.key, main, suffix) : null,
        error: null,
      });
    } catch (error) {
      readings.push({
        mutation: record.mutation,
        override: record.override,
        now: null,
        mainNow: null,
        error: errorMessage(error),
      });
    }
  }
  return { readings };
}

export const s02Tasks = {
  'S-02/build': build,
  'S-02/place': place,
  'S-02/mutate': mutate,
  'S-02/read': read,
};
