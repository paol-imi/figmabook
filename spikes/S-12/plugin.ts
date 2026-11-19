/**
 * S-12 main thread. Step 1 (library file): collections, the mode limit, `codeSyntax.WEB`,
 * aliases across collections, explicit modes, every binding of 08 §8, `documentationLinks`
 * on sets. Step 2 (consumer file): library listing, `importVariableByKeyAsync`, WEB matching.
 */
import {
  createLabel,
  dropShadow,
  hexOf,
  INTER_BOLD,
  INTER_REGULAR,
  probe,
  rgb,
  solid,
  usePage,
} from '../_shared/figma.ts';
import { errorMessage, round3 } from '../_shared/json.ts';
import type { MainContext } from '../_shared/spike.ts';
import { BINDINGS, type BindingSpec, normalizeWeb, TOKENS, type TokenSpec, webSyntax } from './fields.ts';

export const PAGE_NAME = 'S-12 Variables';
export const COLLECTION_NAMES = { primitives: 'S-12 Primitives', tokens: 'S-12 Tokens' } as const;
const MODE_PROBE_MAX = 50;

type Vars = ReadonlyMap<string, Variable>;

/** Adds modes to a throwaway collection until Figma refuses (or 50), then removes it. */
async function probeModeLimit(figma: PluginAPI) {
  const collection = figma.variables.createVariableCollection('S-12 Mode limit probe');
  let refusal: string | null = null;
  for (let i = 2; i <= MODE_PROBE_MAX; i++) {
    try {
      collection.addMode(`Mode ${i}`);
    } catch (error) {
      refusal = errorMessage(error);
      break;
    }
  }
  const modes = collection.modes.length;
  collection.remove();
  return {
    modeLimit: refusal === null ? null : modes,
    reachedProbeMax: refusal === null,
    modesCreated: modes,
    refusal,
  };
}

function colorValue(value: string, vars: Vars, figma: PluginAPI): VariableValue {
  if (value.startsWith('alias:')) {
    const target = vars.get(value.slice('alias:'.length));
    if (!target) throw new Error(`S-12: alias target ${value} is not created yet.`);
    return figma.variables.createVariableAlias(target);
  }
  return { ...rgb(value), a: 1 };
}

function tokenValue(spec: TokenSpec, raw: string | number | boolean, vars: Vars, figma: PluginAPI): VariableValue {
  if (spec.type === 'COLOR' && typeof raw === 'string') return colorValue(raw, vars, figma);
  return raw;
}

async function createTokens(figma: PluginAPI) {
  const primitives = figma.variables.createVariableCollection(COLLECTION_NAMES.primitives);
  const tokens = figma.variables.createVariableCollection(COLLECTION_NAMES.tokens);
  const darkMode = await probe(() => tokens.addMode('Dark'));
  const darkModeId = darkMode.ok ? darkMode.value : null;
  const vars = new Map<string, Variable>();
  const codeSyntax: { name: string; set: string; readBack: string | null; error: string | null }[] = [];
  for (const spec of TOKENS) {
    const collection = spec.collection === 'primitives' ? primitives : tokens;
    const variable = figma.variables.createVariable(spec.name, collection, spec.type);
    variable.setValueForMode(collection.defaultModeId, tokenValue(spec, spec.value, vars, figma));
    if (darkModeId && collection === tokens) {
      variable.setValueForMode(darkModeId, tokenValue(spec, spec.dark ?? spec.value, vars, figma));
    }
    const web = webSyntax(spec.name);
    const set = await probe(() => variable.setVariableCodeSyntax('WEB', web));
    codeSyntax.push({
      name: spec.name,
      set: web,
      readBack: variable.codeSyntax.WEB ?? null,
      error: set.ok ? null : set.error,
    });
    vars.set(spec.name, variable);
  }
  return { primitives, tokens, darkModeId, darkModeError: darkMode.ok ? null : darkMode.error, vars, codeSyntax };
}

type Targets = { frame: FrameNode; wrap: FrameNode; grid: FrameNode; text: TextNode; style: TextStyle };

async function freshTarget(
  figma: PluginAPI,
  spec: BindingSpec,
  page: PageNode,
  index: number,
): Promise<Targets[BindingSpec['target']]> {
  if (spec.target === 'style') {
    const style = figma.createTextStyle();
    style.name = `S-12/${spec.field}`;
    await figma.loadFontAsync(INTER_REGULAR);
    style.fontName = INTER_REGULAR;
    return style;
  }
  if (spec.target === 'text') {
    const text = await createLabel(figma, 'Binding test', 12);
    text.name = spec.field;
    page.appendChild(text);
    text.x = (index % 8) * 140;
    text.y = 200 + Math.floor(index / 8) * 80;
    return text;
  }
  const frame = figma.createFrame();
  frame.name = spec.field;
  frame.resize(120, 60);
  frame.fills = [solid('#ffffff')];
  frame.strokes = [solid('#94a3b8')];
  frame.effects = [dropShadow('#000000', 0, 1, 2)];
  if (spec.target === 'grid') {
    frame.layoutMode = 'GRID';
  } else {
    frame.layoutMode = 'HORIZONTAL';
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
    if (spec.target === 'wrap') frame.layoutWrap = 'WRAP';
  }
  page.appendChild(frame);
  frame.x = (index % 8) * 140;
  frame.y = 200 + Math.floor(index / 8) * 80;
  return frame;
}

function aliasId(alias: unknown): string | null {
  return typeof alias === 'object' && alias !== null && 'id' in alias && typeof alias.id === 'string' ? alias.id : null;
}

/** Binds one field and reads the binding back. */
async function bindOne(
  figma: PluginAPI,
  spec: BindingSpec,
  variable: Variable,
  target: Targets[BindingSpec['target']],
) {
  const sub = spec.field.split('.')[1] ?? spec.field;
  switch (spec.kind) {
    case 'node': {
      const node = target as FrameNode | TextNode;
      node.setBoundVariable(spec.field as VariableBindableNodeField, variable);
      const bound = aliasId(node.boundVariables?.[spec.field as VariableBindableNodeField]) === variable.id;
      const value = (node as unknown as Record<string, unknown>)[spec.field];
      return {
        bound,
        value:
          typeof value === 'number'
            ? round3(value)
            : typeof value === 'boolean' || typeof value === 'string'
              ? value
              : null,
      };
    }
    case 'text-range': {
      const text = target as TextNode;
      if (spec.field === 'fontStyle' || spec.field === 'fontWeight' || spec.field === 'fontFamily')
        await figma.loadFontAsync(INTER_BOLD);
      text.setRangeBoundVariable(0, text.characters.length, spec.field as VariableBindableTextField, variable);
      const read = text.getRangeBoundVariable(0, text.characters.length, spec.field as VariableBindableTextField);
      return { bound: aliasId(read) === variable.id, value: null };
    }
    case 'fill':
    case 'stroke': {
      const node = target as FrameNode;
      const paint = figma.variables.setBoundVariableForPaint(solid('#000000'), 'color', variable);
      if (spec.kind === 'fill') node.fills = [paint];
      else node.strokes = [paint];
      const list = (spec.kind === 'fill' ? node.fills : node.strokes) as readonly Paint[];
      const first = list[0];
      const bound = first?.type === 'SOLID' && aliasId(first.boundVariables?.color) === variable.id;
      return { bound, value: first?.type === 'SOLID' ? hexOf(first.color) : null };
    }
    case 'text-range-fill': {
      const text = target as TextNode;
      text.setRangeFills(0, text.characters.length, [
        figma.variables.setBoundVariableForPaint(solid('#000000'), 'color', variable),
      ]);
      const fills = text.getRangeFills(0, text.characters.length);
      const first = Array.isArray(fills) ? (fills[0] as Paint | undefined) : undefined;
      return { bound: first?.type === 'SOLID' && aliasId(first.boundVariables?.color) === variable.id, value: null };
    }
    case 'gradient-stop': {
      const node = target as FrameNode;
      const alias = figma.variables.createVariableAlias(variable);
      node.fills = [
        {
          type: 'GRADIENT_LINEAR',
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
          gradientStops: [
            { position: 0, color: { ...rgb('#000000'), a: 1 }, boundVariables: { color: alias } },
            { position: 1, color: { ...rgb('#ffffff'), a: 1 } },
          ],
        },
      ];
      const first = (node.fills as readonly Paint[])[0];
      const stop = first?.type === 'GRADIENT_LINEAR' ? first.gradientStops[0] : undefined;
      return { bound: aliasId(stop?.boundVariables?.color) === variable.id, value: stop ? hexOf(stop.color) : null };
    }
    case 'effect': {
      const node = target as FrameNode;
      const effect = figma.variables.setBoundVariableForEffect(
        dropShadow('#000000', 0, 1, 2),
        sub as VariableBindableEffectField,
        variable,
      );
      node.effects = [effect];
      const read = node.effects[0];
      const aliases =
        read && 'boundVariables' in read
          ? (read.boundVariables as Partial<Record<VariableBindableEffectField, VariableAlias>> | undefined)
          : undefined;
      const bound = aliasId(aliases?.[sub as VariableBindableEffectField]) === variable.id;
      return { bound, value: null };
    }
    case 'text-style': {
      const style = target as TextStyle;
      style.setBoundVariable(sub as VariableBindableTextField, variable);
      return { bound: aliasId(style.boundVariables?.[sub as VariableBindableTextField]) === variable.id, value: null };
    }
  }
}

async function bindAll(figma: PluginAPI, vars: Vars, page: PageNode, progress: (message: string) => void) {
  const rows: {
    field: string;
    kind: string;
    token: string;
    ok: boolean;
    bound: boolean;
    value: string | number | boolean | null;
    error: string | null;
  }[] = [];
  for (const [index, spec] of BINDINGS.entries()) {
    progress(`Binding ${spec.field}…`);
    const variable = vars.get(spec.token);
    const result = await probe(async () => {
      if (!variable) throw new Error(`Token ${spec.token} was not created.`);
      return bindOne(figma, spec, variable, await freshTarget(figma, spec, page, index));
    });
    rows.push(
      result.ok
        ? {
            field: spec.field,
            kind: spec.kind,
            token: spec.token,
            ok: true,
            bound: result.value.bound,
            value: result.value.value,
            error: null,
          }
        : {
            field: spec.field,
            kind: spec.kind,
            token: spec.token,
            ok: false,
            bound: false,
            value: null,
            error: result.error,
          },
    );
  }
  return rows;
}

async function explicitModeCheck(
  figma: PluginAPI,
  tokens: VariableCollection,
  darkModeId: string | null,
  vars: Vars,
  page: PageNode,
) {
  const brand = vars.get('color/brand');
  if (!darkModeId || !brand) return { ok: false, error: 'no second mode (the mode limit may be 1 on this plan)' };
  const frame = figma.createFrame();
  frame.name = 'Explicit mode (Dark)';
  frame.resize(120, 60);
  page.appendChild(frame);
  frame.y = 100;
  frame.fills = [figma.variables.setBoundVariableForPaint(solid('#000000'), 'color', brand)];
  const before = brand.resolveForConsumer(frame).value;
  const set = await probe(() => frame.setExplicitVariableModeForCollection(tokens, darkModeId));
  const after = brand.resolveForConsumer(frame).value;
  const hex = (value: VariableValue) =>
    typeof value === 'object' && value !== null && 'r' in value ? hexOf(value) : String(value);
  return {
    ok: set.ok,
    error: set.ok ? null : set.error,
    explicitModeStored: frame.explicitVariableModes[tokens.id] === darkModeId,
    resolvedBefore: hex(before),
    resolvedAfter: hex(after),
    resolvedChanged: hex(before) !== hex(after),
  };
}

function aliasCheck(vars: Vars) {
  const brand = vars.get('color/brand');
  const target = vars.get('blue/500');
  if (!brand || !target) return { ok: false, crossCollection: false };
  const value = Object.values(brand.valuesByMode)[0];
  const id = aliasId(value);
  return { ok: id === target.id, crossCollection: brand.variableCollectionId !== target.variableCollectionId };
}

async function documentationLinksCheck(figma: PluginAPI, page: PageNode) {
  const a = figma.createComponent();
  a.name = 'State=A';
  const b = figma.createComponent();
  b.name = 'State=B';
  const set = figma.combineAsVariants([a, b], page);
  set.name = 'S-12 Docs links set';
  set.y = -120;
  const uri = 'https://example.com/holotype-spike-docs';
  const onSet = await probe(() => {
    set.documentationLinks = [{ uri }];
    return set.documentationLinks.map((link) => link.uri);
  });
  const single = figma.createComponent();
  single.name = 'S-12 Docs links component';
  page.appendChild(single);
  single.y = -120;
  single.x = 240;
  const onComponent = await probe(() => {
    single.documentationLinks = [{ uri }];
    return single.documentationLinks.map((link) => link.uri);
  });
  return {
    set: onSet.ok ? { ok: onSet.value.includes(uri), error: null } : { ok: false, error: onSet.error },
    component: onComponent.ok
      ? { ok: onComponent.value.includes(uri), error: null }
      : { ok: false, error: onComponent.error },
  };
}

async function step1({ figma, progress }: MainContext, _input: null) {
  progress('Opening the S-12 page…');
  const page = await usePage(figma, PAGE_NAME);
  progress('Finding the mode limit…');
  const modeLimit = await probeModeLimit(figma);
  progress('Creating variables…');
  const created = await createTokens(figma);
  const bindings = await bindAll(figma, created.vars, page, progress);
  progress('Checking explicit modes…');
  const explicitMode = await explicitModeCheck(figma, created.tokens, created.darkModeId, created.vars, page);
  const documentationLinks = await documentationLinksCheck(figma, page);
  return {
    modeLimit,
    darkModeError: created.darkModeError,
    codeSyntax: created.codeSyntax,
    alias: aliasCheck(created.vars),
    explicitMode,
    bindings,
    documentationLinks,
    keys: {
      collections: [
        { name: created.primitives.name, key: created.primitives.key },
        { name: created.tokens.name, key: created.tokens.key },
      ],
      variables: TOKENS.map((spec) => ({
        name: spec.name,
        key: created.vars.get(spec.name)?.key ?? '',
        web: webSyntax(spec.name),
      })),
    },
  };
}

export type StoredKeys = Awaited<ReturnType<typeof step1>>['keys'];

async function step2({ figma, progress }: MainContext, input: { keys: StoredKeys }) {
  progress('Listing library variable collections…');
  const listing = await probe(() => figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync());
  const available = listing.ok ? listing.value : [];
  const ourNames = new Set<string>(Object.values(COLLECTION_NAMES));
  const ours = available.filter((collection) => ourNames.has(collection.name));
  const listed: { name: string; key: string; resolvedType: string; hasCodeSyntaxField: boolean }[] = [];
  for (const collection of ours) {
    const variables = await probe(() => figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key));
    if (variables.ok) {
      for (const variable of variables.value) {
        listed.push({
          name: variable.name,
          key: variable.key,
          resolvedType: variable.resolvedType,
          hasCodeSyntaxField: 'codeSyntax' in variable,
        });
      }
    }
  }

  progress('Importing variables by key…');
  const imported = new Map<string, Variable>();
  const imports: { name: string; ok: boolean; ms: number; web: string | null; error: string | null }[] = [];
  for (const entry of input.keys.variables) {
    const started = Date.now();
    const result = await probe(() => figma.variables.importVariableByKeyAsync(entry.key));
    const ms = Date.now() - started;
    if (result.ok) {
      imported.set(entry.name, result.value);
      imports.push({ name: entry.name, ok: true, ms, web: result.value.codeSyntax.WEB ?? null, error: null });
    } else imports.push({ name: entry.name, ok: false, ms, web: null, error: result.error });
  }

  // D-18 matching: CSS custom property name → imported variable by codeSyntax.WEB.
  const byWeb = new Map<string, string>();
  for (const [name, variable] of imported)
    if (variable.codeSyntax.WEB) byWeb.set(normalizeWeb(variable.codeSyntax.WEB), name);
  const matches = input.keys.variables.map((entry) => ({
    css: normalizeWeb(entry.web),
    matched: byWeb.get(normalizeWeb(entry.web)) === entry.name,
  }));

  progress('Checking aliases, modes and bindings…');
  const brand = imported.get('color/brand');
  const brandAlias = brand ? aliasId(Object.values(brand.valuesByMode)[0]) : null;
  const aliasTarget = brandAlias ? await probe(() => figma.variables.getVariableByIdAsync(brandAlias)) : null;
  const page = await usePage(figma, `${PAGE_NAME} (consumer)`);
  const frame = figma.createFrame();
  frame.name = 'Library variable binding';
  frame.resize(120, 60);
  frame.layoutMode = 'HORIZONTAL';
  page.appendChild(frame);
  const space = imported.get('space/4');
  const bindFill = await probe(() => {
    if (!brand) throw new Error('color/brand was not imported');
    frame.fills = [figma.variables.setBoundVariableForPaint(solid('#000000'), 'color', brand)];
    const first = (frame.fills as readonly Paint[])[0];
    return first?.type === 'SOLID' && aliasId(first.boundVariables?.color) === brand.id;
  });
  const bindPadding = await probe(() => {
    if (!space) throw new Error('space/4 was not imported');
    frame.setBoundVariable('paddingLeft', space);
    return aliasId(frame.boundVariables?.paddingLeft) === space.id && frame.paddingLeft === 16;
  });
  const explicitMode = await probe(async () => {
    if (!brand) throw new Error('color/brand was not imported');
    const collection = await figma.variables.getVariableCollectionByIdAsync(brand.variableCollectionId);
    if (!collection) throw new Error('The library collection of color/brand could not be read.');
    const dark = collection.modes.find((mode) => mode.name === 'Dark');
    if (!dark) throw new Error('The library collection has no "Dark" mode.');
    const before = JSON.stringify(brand.resolveForConsumer(frame).value);
    frame.setExplicitVariableModeForCollection(collection, dark.modeId);
    return {
      remoteCollection: collection.remote,
      changed: before !== JSON.stringify(brand.resolveForConsumer(frame).value),
    };
  });

  return {
    library: {
      listingOk: listing.ok,
      listingError: listing.ok ? null : listing.error,
      collectionsVisible: available.length,
      ourCollectionsFound: ours.length,
      variablesListed: listed.length,
      libraryVariableHasCodeSyntax: listed.some((entry) => entry.hasCodeSyntaxField),
    },
    imports,
    matching: {
      matched: matches.filter((entry) => entry.matched).length,
      total: matches.length,
      unmatched: matches.filter((m) => !m.matched).map((m) => m.css),
    },
    aliasAfterImport: {
      isAlias: brandAlias !== null,
      targetReadable: aliasTarget?.ok === true && aliasTarget.value !== null,
      targetRemote: aliasTarget?.ok === true ? (aliasTarget.value?.remote ?? null) : null,
    },
    bindImported: {
      fill: bindFill.ok ? bindFill.value : bindFill.error,
      padding: bindPadding.ok ? bindPadding.value : bindPadding.error,
    },
    explicitModeWithLibraryCollection: explicitMode.ok ? explicitMode.value : { error: explicitMode.error },
  };
}

export const s12Tasks = { 'S-12/step1': step1, 'S-12/step2': step2 };
