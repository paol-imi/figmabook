/**
 * S-17 main thread: writes the markers a step owns (plus one small visible edit, so the
 * branch has something to update and merge), then reads every marker back.
 */
import { createLabel, fingerprint, NS, solid, usePage } from '../_shared/figma.ts';
import { errorMessage } from '../_shared/json.ts';
import type { MainContext } from '../_shared/spike.ts';
import { EDIT_KEY, MARKERS, type MarkerRead, makeChunk, type Readout, type StepId } from './markers.ts';

export const PAGE_NAME = 'S-17 Branch markers';
export const COMPONENT_NAME = 'S-17 Marker';
const MAIN_EDIT_NAME = 'S-17 Main edit';

function findComponent(page: PageNode): ComponentNode | undefined {
  const found = page.findOne((node) => node.type === 'COMPONENT' && node.name === COMPONENT_NAME);
  return found?.type === 'COMPONENT' ? found : undefined;
}

/** Plugin API members whose name mentions branches: evidence for "can a plugin create a branch?". */
export function branchApis(api: object): string[] {
  const candidates = [
    'createBranch',
    'createBranchAsync',
    'branch',
    'branches',
    'getBranchesAsync',
    'isBranch',
    'mainFileKey',
  ];
  const names = new Set<string>();
  for (const name of candidates) if (name in api) names.add(name);
  for (const name of Object.keys(api)) if (/branch/i.test(name)) names.add(name);
  return [...names].sort();
}

async function createComponent(figma: PluginAPI, page: PageNode): Promise<ComponentNode> {
  const component = figma.createComponent();
  component.name = COMPONENT_NAME;
  component.resize(160, 48);
  component.fills = [solid('#e0e7ff')];
  const label = await createLabel(figma, 'S-17 marker component');
  component.appendChild(label);
  label.x = 8;
  label.y = 16;
  page.appendChild(component);
  return component;
}

function write(node: BaseNode, key: string, value: string, wrote: string[], where: string): void {
  node.setSharedPluginData(NS, key, value);
  wrote.push(`${where}:${key}`);
}

async function writeStep(figma: PluginAPI, step: StepId, page: PageNode, wrote: string[]): Promise<void> {
  let component = findComponent(page);
  if (step === 'step1' && !component) component = await createComponent(figma, page);
  if (!component) throw new Error(`The component "${COMPONENT_NAME}" is missing. Run Step 1 in the main file first.`);

  for (const marker of MARKERS.filter((entry) => entry.writtenIn === step)) {
    const host = marker.on === 'root' ? figma.root : component;
    write(host, marker.key, marker.value === 'chunk' ? makeChunk() : marker.value, wrote, marker.on);
  }
  if (step === 'step1') write(component, EDIT_KEY, 'main', wrote, 'component');
  if (step === 'step2') {
    write(component, EDIT_KEY, 'branch', wrote, 'component');
    component.fills = [solid('#fde68a')];
    wrote.push('component:fill');
  }
  if (step === 'step3') {
    const existing = page.findOne((node) => node.name === MAIN_EDIT_NAME);
    const frame = existing && existing.type === 'FRAME' ? existing : figma.createFrame();
    frame.name = MAIN_EDIT_NAME;
    frame.resize(160, 48);
    frame.y = 80;
    frame.fills = [solid('#bbf7d0')];
    if (!existing) page.appendChild(frame);
    wrote.push('frame:main-edit');
  }
}

function readMarkers(figma: PluginAPI, component: ComponentNode | undefined): MarkerRead[] {
  const chunk = makeChunk();
  const chunkPrint = fingerprint(chunk);
  return MARKERS.map((marker) => {
    const host = marker.on === 'root' ? figma.root : component;
    const raw = host ? host.getSharedPluginData(NS, marker.key) : '';
    if (raw === '') return { key: marker.key, on: marker.on, present: false, value: null };
    const value =
      marker.value === 'chunk'
        ? raw.length === chunk.length && fingerprint(raw) === chunkPrint
          ? 'intact'
          : `damaged:${raw.length}`
        : raw.slice(0, 40);
    return { key: marker.key, on: marker.on, present: true, value };
  });
}

/** Writes this step's markers (steps 1–3), then reads all markers. Steps 4 and 5 only read. */
async function runStep({ figma, progress }: MainContext, input: { step: StepId }): Promise<Readout> {
  const errors: string[] = [];
  const wrote: string[] = [];
  progress('Opening the S-17 page…');
  const page = await usePage(figma, PAGE_NAME);
  if (input.step === 'step1' || input.step === 'step2' || input.step === 'step3') {
    progress('Writing markers…');
    try {
      await writeStep(figma, input.step, page, wrote);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  progress('Reading markers…');
  const component = findComponent(page);
  const key = figma.fileKey;
  return {
    step: input.step,
    componentFound: component !== undefined,
    markers: readMarkers(figma, component),
    edit: component ? component.getSharedPluginData(NS, EDIT_KEY) || null : null,
    fileKeyFingerprint: typeof key === 'string' && key.length > 0 ? fingerprint(key) : null,
    wrote,
    errors,
  };
}

async function apis({ figma }: MainContext, _input: null) {
  return { branchApis: branchApis(figma) };
}

export const s17Tasks = {
  'S-17/step': runStep,
  'S-17/apis': apis,
};
