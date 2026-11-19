/**
 * Dry-run Plugin API for the spike kit (BUILD §9.1 "Dry run"). Members `@holotype/figma-fake`
 * implements are taken from it; everything else is served by this small recording model, and
 * every member it serves is listed by `unsupported()` (the "recording proxy"). As figma-fake
 * grows (B-06, B-54), members move from this model to it.
 *
 * The model is loose on purpose: it keeps a real tree, plugin data, components, instances,
 * component properties and variables, and enforces a few Figma rules that catch spike bugs
 * (unloaded fonts, appending into an instance, empty `combineAsVariants`).
 */
import { createFakeFigma } from '@holotype/figma-fake';

type Fields = Record<string, unknown>;
type PropDef = { type: ComponentPropertyType; defaultValue: unknown; preferredValues?: unknown };

const CONTAINERS = new Set([
  'DOCUMENT',
  'PAGE',
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'GROUP',
  'BOOLEAN_OPERATION',
  'SECTION',
]);
/** A valid 1×1 transparent PNG. */
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

const fontKey = (font: FontName) => `${font.family}|${font.style}`;

export interface DryRunOptions {
  /** Highest number of modes per collection; `addMode` beyond it throws like Figma's plan limit. */
  readonly modeLimit?: number;
  readonly fileKey?: string;
}

export interface DryRun {
  readonly figma: PluginAPI;
  /** Plugin API members the dry run served without figma-fake, sorted (`figma.x`, `NODE.y`). */
  unsupported(): string[];
}

// biome-ignore lint/suspicious/noExplicitAny: the loose model is untyped by design; it is cast to PluginAPI once.
type Loose = any;

export function createDryRunFigma(options: DryRunOptions = {}): DryRun {
  const base = createFakeFigma();
  const unsupported = new Set<string>();
  const nodes = new Map<string, Loose>();
  const loadedFonts = new Set<string>();
  const storage = new Map<string, unknown>();
  const collections: Loose[] = [];
  const variables: Loose[] = [];
  const modeLimit = options.modeLimit ?? 4;
  let counter = 1;
  const nextId = () => `${counter++}:1`;
  /** While true, writes skip Figma's rules (internal copies, property propagation). */
  let internal = false;
  const internally = <T>(fn: () => T): T => {
    const before = internal;
    internal = true;
    try {
      return fn();
    } finally {
      internal = before;
    }
  };
  const NOT_OVERRIDES = new Set([
    'parent',
    'x',
    'y',
    'main',
    'instanceProps',
    'charSizes',
    'overridden',
    'insideInstanceOf',
    'removed',
  ]);

  const KNOWN = new Set([
    'id',
    'type',
    'name',
    'parent',
    'removed',
    'children',
    'x',
    'y',
    'width',
    'height',
    'visible',
    'opacity',
    'fills',
    'strokes',
    'effects',
    'strokeWeight',
    'strokeAlign',
    'characters',
    'fontName',
    'fontSize',
    'layoutMode',
    'boundVariables',
    'key',
    'componentPropertyReferences',
    'documentationLinks',
    'explicitVariableModes',
    'then',
    'toJSON',
  ]);

  function isInsideInstance(node: Loose): boolean {
    for (let current = node; current; current = current.parent) if (current.type === 'INSTANCE') return true;
    return false;
  }

  function detach(node: Loose): void {
    const parent = node.parent;
    if (parent?.children) {
      const index = parent.children.indexOf(node);
      if (index >= 0) parent.children.splice(index, 1);
    }
    node.parent = null;
  }

  function checkFont(node: Loose): void {
    if (!loadedFonts.has(fontKey(node.fontName))) {
      throw new Error(
        `in set_characters: Cannot write to node with unloaded font "${node.fontName.family} ${node.fontName.style}"`,
      );
    }
  }

  function resolveValue(variable: Loose, modeId?: string): unknown {
    const collection = collections.find((entry) => entry.id === variable.variableCollectionId);
    const value = variable.valuesByMode[modeId ?? collection?.defaultModeId];
    if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
      const target = variables.find((entry) => entry.id === value.id);
      return target ? resolveValue(target) : null;
    }
    return value;
  }

  function wrap(target: Loose): Loose {
    return new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === 'symbol') return Reflect.get(object, key, receiver);
        if (key === 'componentProperties') return componentProperties(receiver);
        if (key === 'variantProperties') return variantProperties(receiver);
        if (key === 'componentPropertyDefinitions') return componentPropertyDefinitions(receiver);
        if (key === 'defaultVariant') return object.children?.[0];
        if (key === 'overrides') return overridesOf(receiver);
        if (!(key in object)) {
          if (!KNOWN.has(key)) unsupported.add(`${object.type}.${key}`);
          return undefined;
        }
        return Reflect.get(object, key, receiver);
      },
      set(object, key, value, receiver) {
        if (typeof key === 'string' && object.type === 'TEXT') {
          if (key === 'characters') {
            if (!internal) checkFont(object);
            object.charSizes = Array.from({ length: String(value).length }, () => object.fontSize);
          }
          if (key === 'fontSize') {
            if (!internal) checkFont(object);
            object.charSizes = object.charSizes.map(() => value);
          }
        }
        if (typeof key === 'string' && !internal && object.insideInstanceOf && !NOT_OVERRIDES.has(key))
          object.overridden.add(key);
        return Reflect.set(object, key, value, receiver);
      },
    });
  }

  function variantValues(name: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const part of name.split(',')) {
      const [axis, value] = part.split('=').map((piece) => piece.trim());
      if (axis && value !== undefined) values[axis] = value;
    }
    return values;
  }

  function ownerOf(main: Loose): Loose {
    return main?.parent?.type === 'COMPONENT_SET' ? main.parent : main;
  }

  function variantProperties(node: Loose): Record<string, string> | null {
    if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') return variantValues(node.name);
    if (node.type === 'INSTANCE' && node.main?.parent?.type === 'COMPONENT_SET') return variantValues(node.main.name);
    return null;
  }

  function componentPropertyDefinitions(node: Loose): Record<string, Fields> {
    if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') {
      throw new Error(
        'in get_componentPropertyDefinitions: Can only get definitions of a component set or non-variant component',
      );
    }
    const defs: Record<string, Fields> = {};
    if (node.type === 'COMPONENT_SET') {
      const axes = new Map<string, string[]>();
      for (const child of node.children) {
        for (const [axis, value] of Object.entries(variantValues(child.name))) {
          const list = axes.get(axis) ?? [];
          if (!list.includes(value)) list.push(value);
          axes.set(axis, list);
        }
      }
      for (const [axis, values] of axes)
        defs[axis] = { type: 'VARIANT', defaultValue: values[0], variantOptions: values };
    }
    for (const [name, def] of Object.entries(node.propDefs ?? {}) as Array<[string, PropDef]>) defs[name] = { ...def };
    return defs;
  }

  function componentProperties(node: Loose): Record<string, Fields> | undefined {
    if (node.type !== 'INSTANCE') return undefined;
    const owner = ownerOf(node.main);
    const props: Record<string, Fields> = {};
    for (const [axis, value] of Object.entries(variantProperties(node) ?? {})) props[axis] = { type: 'VARIANT', value };
    for (const [name, def] of Object.entries(owner?.propDefs ?? {}) as Array<[string, PropDef]>) {
      props[name] = { type: def.type, value: name in node.instanceProps ? node.instanceProps[name] : def.defaultValue };
    }
    return props;
  }

  function overridesOf(node: Loose): Array<{ id: string; overriddenFields: string[] }> | undefined {
    if (node.type !== 'INSTANCE') return undefined;
    const result: Array<{ id: string; overriddenFields: string[] }> = [];
    const visit = (current: Loose) => {
      if (current.overridden?.size) result.push({ id: current.id, overriddenFields: [...current.overridden].sort() });
      for (const child of current.children ?? []) visit(child);
    };
    visit(node);
    return result;
  }

  function descendants(node: Loose): Loose[] {
    const out: Loose[] = [];
    const visit = (current: Loose) => {
      for (const child of current.children ?? []) {
        out.push(child);
        visit(child);
      }
    };
    visit(node);
    return out;
  }

  /** Deep copy of a subtree; `idFor` names the copies (`I<inst>;<id>` inside instances). */
  function copyTree(source: Loose, idFor: (original: Loose) => string, instanceOf: Loose | null): Loose {
    return internally(() => copyTreeRaw(source, idFor, instanceOf));
  }

  function copyTreeRaw(source: Loose, idFor: (original: Loose) => string, instanceOf: Loose | null): Loose {
    const copy = createNode(source.type, idFor(source));
    for (const [key, value] of Object.entries(source)) {
      if (['id', 'parent', 'children', 'pluginData', 'overridden', 'insideInstanceOf', 'instanceProps'].includes(key))
        continue;
      copy[key] = Array.isArray(value) ? [...value] : value;
    }
    copy.pluginData = new Map(source.pluginData);
    copy.overridden.clear();
    if (instanceOf) Reflect.set(copy, 'insideInstanceOf', instanceOf);
    for (const child of source.children ?? []) {
      const childCopy = copyTreeRaw(child, idFor, instanceOf);
      childCopy.parent = copy;
      copy.children.push(childCopy);
    }
    return copy;
  }

  function fillInstance(instance: Loose, main: Loose): void {
    internally(() => fillInstanceRaw(instance, main));
  }

  function fillInstanceRaw(instance: Loose, main: Loose): void {
    for (const child of instance.children) child.parent = null;
    instance.children.length = 0;
    instance.main = main;
    for (const child of main.children ?? []) {
      const copy = copyTree(child, (original) => `I${instance.id};${original.id.replace(/^I[^;]*;/, '')}`, instance);
      copy.parent = instance;
      instance.children.push(copy);
    }
    instance.width = main.width;
    instance.height = main.height;
  }

  function createNode(type: string, id = nextId()): Loose {
    const target: Fields = {
      id,
      type,
      name: type.charAt(0) + type.slice(1).toLowerCase(),
      parent: null,
      removed: false,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: true,
      opacity: 1,
      fills: [],
      strokes: [],
      effects: [],
      strokeWeight: 1,
      boundVariables: {},
      explicitVariableModes: {},
      componentPropertyReferences: null,
      pluginData: new Map<string, string>(),
      overridden: new Set<string>(),
      instanceProps: {},
    };
    if (CONTAINERS.has(type)) target.children = [];
    if (type === 'TEXT')
      Object.assign(target, {
        characters: '',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        charSizes: [],
      });
    if (type === 'COMPONENT') target.key = `key-${id.replace(':', '-')}`;
    if (type === 'COMPONENT_SET') Object.assign(target, { key: `setkey-${id.replace(':', '-')}`, propDefs: {} });
    if (type === 'COMPONENT') target.propDefs = {};
    Object.assign(target, nodeMethods());
    const node = wrap(target);
    nodes.set(id, node);
    return node;
  }

  function nodeMethods(): Fields {
    return {
      remove(this: Loose) {
        detach(this);
        this.removed = true;
        nodes.delete(this.id);
      },
      appendChild(this: Loose, child: Loose) {
        if (isInsideInstance(this))
          throw new Error('in appendChild: Cannot move node. New parent is an instance or is inside of an instance');
        detach(child);
        child.parent = this;
        this.children.push(child);
      },
      insertChild(this: Loose, index: number, child: Loose) {
        if (isInsideInstance(this))
          throw new Error('in insertChild: Cannot move node. New parent is an instance or is inside of an instance');
        detach(child);
        child.parent = this;
        this.children.splice(Math.min(index, this.children.length), 0, child);
      },
      findAll(this: Loose, callback?: (node: Loose) => boolean) {
        return descendants(this).filter((node) => (callback ? callback(node) : true));
      },
      findOne(this: Loose, callback: (node: Loose) => boolean) {
        return descendants(this).find(callback) ?? null;
      },
      findChildren(this: Loose, callback?: (node: Loose) => boolean) {
        return this.children.filter((node: Loose) => (callback ? callback(node) : true));
      },
      findAllWithCriteria(
        this: Loose,
        criteria: { types?: string[]; sharedPluginData?: { namespace: string; keys?: string[] } },
      ) {
        return descendants(this).filter((node) => {
          if (criteria.types && !criteria.types.includes(node.type)) return false;
          const data = criteria.sharedPluginData;
          if (data) return (data.keys ?? []).some((key) => node.pluginData.has(`${data.namespace}:${key}`));
          return true;
        });
      },
      getSharedPluginData(this: Loose, namespace: string, key: string) {
        return this.pluginData.get(`${namespace}:${key}`) ?? '';
      },
      setSharedPluginData(this: Loose, namespace: string, key: string, value: string) {
        if (value.length > 100_000) throw new Error('in setSharedPluginData: value is larger than 100 kB');
        if (value === '') this.pluginData.delete(`${namespace}:${key}`);
        else this.pluginData.set(`${namespace}:${key}`, value);
      },
      getSharedPluginDataKeys(this: Loose, namespace: string) {
        return [...this.pluginData.keys()]
          .filter((key: string) => key.startsWith(`${namespace}:`))
          .map((key: string) => key.slice(namespace.length + 1));
      },
      resize(this: Loose, width: number, height: number) {
        // Lines are the exception: their height is 0.
        if (width < 0.01 || (height < 0.01 && !(this.type === 'LINE' && height === 0))) {
          throw new Error('in resize: Expected width and height to be >= 0.01');
        }
        this.width = width;
        this.height = height;
      },
      resizeWithoutConstraints(this: Loose, width: number, height: number) {
        this.width = width;
        this.height = height;
      },
      clone(this: Loose) {
        const copy = copyTree(this, () => nextId(), null);
        if (this.parent) {
          copy.parent = this.parent;
          this.parent.children.push(copy);
        }
        return copy;
      },
      async exportAsync() {
        return PNG_1X1.slice();
      },
      setBoundVariable(this: Loose, field: string, variable: Loose) {
        this.boundVariables = {
          ...this.boundVariables,
          [field]: variable ? { type: 'VARIABLE_ALIAS', id: variable.id } : undefined,
        };
        if (variable) {
          const value = resolveValue(variable);
          if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') this[field] = value;
        }
      },
      setExplicitVariableModeForCollection(this: Loose, collection: Loose, modeId: string) {
        this.explicitVariableModes = { ...this.explicitVariableModes, [collection.id]: modeId };
      },
      setRangeFontSize(this: Loose, start: number, end: number, size: number) {
        checkFont(this);
        for (let i = start; i < end; i++) this.charSizes[i] = size;
      },
      setRangeFills(this: Loose, _start: number, _end: number, fills: unknown[]) {
        this.rangeFills = fills;
      },
      getRangeFills(this: Loose) {
        return this.rangeFills ?? this.fills;
      },
      setRangeBoundVariable(this: Loose, _start: number, _end: number, field: string, variable: Loose) {
        this.rangeBound = { ...(this.rangeBound ?? {}), [field]: { type: 'VARIABLE_ALIAS', id: variable.id } };
      },
      getRangeBoundVariable(this: Loose, _start: number, _end: number, field: string) {
        return this.rangeBound?.[field] ?? null;
      },
      getStyledTextSegments(this: Loose) {
        const segments: Fields[] = [];
        this.charSizes.forEach((size: number, index: number) => {
          const last = segments[segments.length - 1];
          if (last && last.fontSize === size) last.end = index + 1;
          else segments.push({ start: index, end: index + 1, fontSize: size });
        });
        return segments.map((segment) => ({
          ...segment,
          characters: this.characters.slice(segment.start as number, segment.end as number),
        }));
      },
      createInstance(this: Loose) {
        const instance = createNode('INSTANCE');
        fillInstance(instance, this);
        internally(() => {
          instance.name = this.name;
          instance.insideInstanceOf = instance;
        });
        api.currentPage.appendChild(instance);
        return instance;
      },
      async getMainComponentAsync(this: Loose) {
        return this.main ?? null;
      },
      swapComponent(this: Loose, component: Loose) {
        fillInstance(this, component);
      },
      setProperties(this: Loose, values: Record<string, unknown>) {
        const owner = ownerOf(this.main);
        for (const [name, value] of Object.entries(values)) {
          if (!name.includes('#')) {
            const wanted = { ...variantProperties(this), [name]: String(value) };
            const match = owner?.children?.find(
              (child: Loose) => JSON.stringify(variantValues(child.name)) === JSON.stringify(wanted),
            );
            if (!match) throw new Error(`in setProperties: Could not find a variant with ${name}=${String(value)}`);
            fillInstance(this, match);
            continue;
          }
          const def = owner?.propDefs?.[name];
          if (!def) throw new Error(`in setProperties: Property "${name}" not found`);
          this.instanceProps = { ...this.instanceProps, [name]: value };
          internally(() => {
            for (const node of descendants(this)) {
              const refs = node.componentPropertyReferences ?? {};
              if (refs.characters === name) node.characters = String(value);
              if (refs.visible === name) node.visible = Boolean(value);
              if (refs.mainComponent === name) {
                const target = nodes.get(String(value));
                if (target) fillInstance(node, target);
              }
            }
          });
        }
      },
      addComponentProperty(
        this: Loose,
        name: string,
        type: ComponentPropertyType,
        defaultValue: unknown,
        options?: Fields,
      ) {
        if (type === 'VARIANT') {
          for (const child of this.children ?? []) child.name = `${child.name}, ${name}=${String(defaultValue)}`;
          return name;
        }
        const key = `${name}#${counter++}:0`;
        this.propDefs = {
          ...this.propDefs,
          [key]: {
            type,
            defaultValue,
            ...(options?.preferredValues ? { preferredValues: options.preferredValues } : {}),
          },
        };
        return key;
      },
      editComponentProperty(this: Loose, key: string, change: { name?: string; defaultValue?: unknown }) {
        if (!key.includes('#')) {
          if (change.name) {
            for (const child of this.children ?? []) {
              child.name = child.name
                .split(',')
                .map((part: string) =>
                  part.trim().startsWith(`${key}=`) ? part.replace(`${key}=`, `${change.name}=`) : part,
                )
                .join(',');
            }
          }
          return change.name ?? key;
        }
        const def = this.propDefs[key];
        if (!def) throw new Error(`in editComponentProperty: Property "${key}" not found`);
        const nextKey = change.name ? `${change.name}#${key.split('#')[1]}` : key;
        const { [key]: _old, ...rest } = this.propDefs;
        this.propDefs = {
          ...rest,
          [nextKey]: { ...def, ...(change.defaultValue !== undefined ? { defaultValue: change.defaultValue } : {}) },
        };
        for (const node of descendants(this)) {
          const refs = node.componentPropertyReferences;
          if (!refs) continue;
          const updated: Fields = {};
          for (const [field, name] of Object.entries(refs)) updated[field] = name === key ? nextKey : name;
          node.componentPropertyReferences = updated;
        }
        return nextKey;
      },
      async loadAsync() {},
    };
  }

  function created(type: string): Loose {
    const node = createNode(type);
    api.currentPage.appendChild(node);
    return node;
  }

  function createCollection(name: string): Loose {
    const id = `VariableCollectionId:${counter++}:1`;
    const collection: Loose = {
      id,
      name,
      key: `collkey-${counter}`,
      remote: false,
      modes: [{ modeId: `${counter++}:0`, name: 'Mode 1' }],
      get defaultModeId() {
        return collection.modes[0].modeId;
      },
      get variableIds() {
        return variables.filter((variable) => variable.variableCollectionId === id).map((variable) => variable.id);
      },
      addMode(modeName: string) {
        if (collection.modes.length >= modeLimit) throw new Error(`in addMode: Limited to ${modeLimit} modes only`);
        const modeId = `${counter++}:0`;
        collection.modes = [...collection.modes, { modeId, name: modeName }];
        return modeId;
      },
      removeMode(modeId: string) {
        collection.modes = collection.modes.filter((mode: Loose) => mode.modeId !== modeId);
      },
      remove() {
        collections.splice(collections.indexOf(collection), 1);
      },
    };
    collections.push(collection);
    return collection;
  }

  function createVariable(name: string, collection: Loose, resolvedType: string): Loose {
    const variable: Loose = {
      id: `VariableID:${counter++}:1`,
      key: `varkey-${counter}`,
      name,
      resolvedType,
      remote: false,
      variableCollectionId: collection.id,
      valuesByMode: {},
      codeSyntax: {},
      scopes: ['ALL_SCOPES'],
      setValueForMode(modeId: string, value: unknown) {
        variable.valuesByMode = { ...variable.valuesByMode, [modeId]: value };
      },
      setVariableCodeSyntax(platform: string, value: string) {
        variable.codeSyntax = { ...variable.codeSyntax, [platform]: value };
      },
      resolveForConsumer(node: Loose) {
        return { value: resolveValue(variable, node.explicitVariableModes?.[collection.id]), resolvedType };
      },
    };
    variables.push(variable);
    return variable;
  }

  const doc = createNode('DOCUMENT', '0:0');
  const firstPage = createNode('PAGE', '0:1');
  firstPage.name = 'Page 1';
  doc.children.push(firstPage);
  firstPage.parent = doc;

  const api: Loose = {
    apiVersion: '1.0.0',
    editorType: 'figma',
    mode: 'default',
    fileKey: options.fileKey ?? 'DryRunFileKey00000001',
    mixed: base.mixed,
    root: doc,
    currentPage: firstPage,
    notify: base.notify,
    commitUndo: base.commitUndo,
    viewport: { scrollAndZoomIntoView() {} },
    async setCurrentPageAsync(page: Loose) {
      api.currentPage = page;
    },
    async loadAllPagesAsync() {},
    async loadFontAsync(font: FontName) {
      loadedFonts.add(fontKey(font));
    },
    createPage() {
      const page = createNode('PAGE');
      doc.appendChild(page);
      return page;
    },
    createFrame: () => created('FRAME'),
    createComponent: () => created('COMPONENT'),
    createRectangle: () => created('RECTANGLE'),
    createEllipse: () => created('ELLIPSE'),
    createStar: () => created('STAR'),
    createPolygon: () => created('POLYGON'),
    createLine: () => created('LINE'),
    createVector: () => created('VECTOR'),
    createSection: () => created('SECTION'),
    createText: () => created('TEXT'),
    createTextStyle() {
      const style: Loose = {
        id: `S:${counter++}`,
        type: 'TEXT',
        name: 'Text style',
        boundVariables: {},
        setBoundVariable(field: string, variable: Loose) {
          style.boundVariables = { ...style.boundVariables, [field]: { type: 'VARIABLE_ALIAS', id: variable.id } };
        },
      };
      return style;
    },
    combineAsVariants(components: Loose[], parent: Loose) {
      if (components.length === 0)
        throw new Error('in combineAsVariants: Grouped nodes must be in the same page as the parent');
      const set = createNode('COMPONENT_SET');
      for (const component of components) set.appendChild(component);
      parent.appendChild(set);
      return set;
    },
    group(children: Loose[], parent: Loose) {
      const group = createNode('GROUP');
      parent.appendChild(group);
      for (const child of children) group.appendChild(child);
      return group;
    },
    union(children: Loose[], parent: Loose) {
      const union = createNode('BOOLEAN_OPERATION');
      parent.appendChild(union);
      for (const child of children) union.appendChild(child);
      return union;
    },
    async getNodeByIdAsync(id: string) {
      return id === doc.id ? doc : (nodes.get(id) ?? null);
    },
    async importComponentByKeyAsync(key: string) {
      const found = [...nodes.values()].find((node) => node.type === 'COMPONENT' && node.key === key);
      if (!found) throw new Error(`in importComponentByKeyAsync: Component with key ${key} not found`);
      return found;
    },
    variables: {
      createVariableCollection: createCollection,
      createVariable,
      createVariableAlias: (variable: Loose) => ({ type: 'VARIABLE_ALIAS', id: variable.id }),
      setBoundVariableForPaint: (paint: Loose, field: string, variable: Loose) => ({
        ...paint,
        boundVariables: { ...(paint.boundVariables ?? {}), [field]: { type: 'VARIABLE_ALIAS', id: variable.id } },
      }),
      setBoundVariableForEffect: (effect: Loose, field: string, variable: Loose) => ({
        ...effect,
        boundVariables: { ...(effect.boundVariables ?? {}), [field]: { type: 'VARIABLE_ALIAS', id: variable.id } },
      }),
      async getVariableByIdAsync(id: string) {
        return variables.find((variable) => variable.id === id) ?? null;
      },
      async getVariableCollectionByIdAsync(id: string) {
        return collections.find((collection) => collection.id === id) ?? null;
      },
      async getLocalVariablesAsync() {
        return [...variables];
      },
      async getLocalVariableCollectionsAsync() {
        return [...collections];
      },
      async importVariableByKeyAsync(key: string) {
        const found = variables.find((variable) => variable.key === key);
        if (!found) throw new Error(`in importVariableByKeyAsync: Variable with key ${key} not found`);
        return found;
      },
    },
    teamLibrary: {
      async getAvailableLibraryVariableCollectionsAsync() {
        return collections.map((collection) => ({
          name: collection.name,
          key: collection.key,
          libraryName: 'Spikes Library',
        }));
      },
      async getVariablesInLibraryCollectionAsync(key: string) {
        const collection = collections.find((entry) => entry.key === key);
        return variables
          .filter((variable) => variable.variableCollectionId === collection?.id)
          .map((variable) => ({ name: variable.name, key: variable.key, resolvedType: variable.resolvedType }));
      },
    },
    clientStorage: {
      async getAsync(key: string) {
        return structuredClone(storage.get(key));
      },
      async setAsync(key: string, value: unknown) {
        storage.set(key, structuredClone(value));
      },
      async deleteAsync(key: string) {
        storage.delete(key);
      },
      async keysAsync() {
        return [...storage.keys()];
      },
    },
  };

  const served = new Set(Object.keys(api).filter((key) => !['mixed', 'notify', 'commitUndo'].includes(key)));
  const figma = new Proxy(api, {
    get(object, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(object, key, receiver);
      if (served.has(key)) unsupported.add(`figma.${key}`);
      else if (!(key in object)) unsupported.add(`figma.${key}`);
      return Reflect.get(object, key, receiver);
    },
  }) as PluginAPI;

  return { figma, unsupported: () => [...unsupported].sort() };
}
