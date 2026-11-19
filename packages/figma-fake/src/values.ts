import { figmaError } from './errors';

/**
 * Value validation and normalisation for paints, effects and other structured properties.
 *
 * Figma returns structured values (paints, effects, constraints, guides, …) as read-only
 * objects: "Like many of our array properties, … creates a new, read-only array every time"
 * (typings:10645-10650) and https://developers.figma.com/docs/plugins/editing-properties
 * ("you need to make a copy, change it, then assign it back"). Mutating one throws a
 * `TypeError` in strict-mode code. The fake deep-freezes every value it stores, so the same
 * mutation throws the same class here.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(Reflect.get(value, key));
  }
  return value;
}

const BLEND_MODES: ReadonlySet<string> = new Set<BlendMode>([
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
]);

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODES.has(value);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Figma validates structured values strictly: unknown keys are rejected (typings:4732-4940). */
function checkKeys(api: string, value: object, allowed: readonly string[]): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0)
    throw figmaError(api, `Unrecognized key(s) in object: ${extra.map((k) => `'${k}'`).join(', ')}`);
}

function checkUnit(api: string, name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw figmaError(api, `Expected "${name}" to be a number between 0 and 1`);
  }
}

/** `RGB` has exactly r, g, b in [0, 1] (typings:3954-3960); an `a` key is rejected. */
function checkRgb(api: string, color: unknown, withAlpha: boolean): void {
  if (!isObject(color)) throw figmaError(api, 'Expected "color" to be an object');
  const channels = withAlpha ? ['r', 'g', 'b', 'a'] : ['r', 'g', 'b'];
  checkKeys(api, color, [...channels, 'sourceColor']);
  for (const channel of channels) checkUnit(api, `color.${channel}`, Reflect.get(color, channel));
}

const PAINT_COMMON = ['type', 'visible', 'opacity', 'blendMode'] as const;
const PAINT_KEYS: Readonly<Record<Paint['type'], readonly string[]>> = {
  SOLID: [...PAINT_COMMON, 'color', 'boundVariables'],
  GRADIENT_LINEAR: [...PAINT_COMMON, 'gradientTransform', 'gradientStops'],
  GRADIENT_RADIAL: [...PAINT_COMMON, 'gradientTransform', 'gradientStops'],
  GRADIENT_ANGULAR: [...PAINT_COMMON, 'gradientTransform', 'gradientStops'],
  GRADIENT_DIAMOND: [...PAINT_COMMON, 'gradientTransform', 'gradientStops'],
  IMAGE: [...PAINT_COMMON, 'scaleMode', 'imageHash', 'imageTransform', 'scalingFactor', 'rotation', 'filters'],
  VIDEO: [...PAINT_COMMON, 'scaleMode', 'videoHash', 'videoTransform', 'scalingFactor', 'rotation', 'filters'],
  PATTERN: [...PAINT_COMMON, 'sourceNodeId', 'tileType', 'scalingFactor', 'spacing', 'horizontalAlignment'],
  SHADER: [...PAINT_COMMON, 'id', 'properties', 'propertyMetadata'],
};

function isPaintType(value: unknown): value is Paint['type'] {
  return typeof value === 'string' && Object.hasOwn(PAINT_KEYS, value);
}

/**
 * Validates and normalises one paint the way Figma stores it: `visible`, `opacity` and
 * `blendMode` filled with their defaults (true, 1, NORMAL), and `boundVariables: {}` on solid
 * paints, so a read-back paint has every field (typings:4732-4806).
 */
function normalizePaint(api: string, paint: Paint): Paint {
  if (!isObject(paint) || !isPaintType(paint.type)) {
    throw figmaError(api, `Invalid paint type: expected one of ${Object.keys(PAINT_KEYS).join(', ')}`);
  }
  checkKeys(api, paint, PAINT_KEYS[paint.type]);
  if (paint.opacity !== undefined) checkUnit(api, 'opacity', paint.opacity);
  if (paint.blendMode !== undefined && !isBlendMode(paint.blendMode)) {
    throw figmaError(api, `Invalid blend mode "${String(paint.blendMode)}"`);
  }
  const common = {
    visible: paint.visible ?? true,
    opacity: paint.opacity ?? 1,
    blendMode: paint.blendMode ?? 'NORMAL',
  };
  switch (paint.type) {
    case 'SOLID': {
      checkRgb(api, paint.color, false);
      const color: RGB = { r: paint.color.r, g: paint.color.g, b: paint.color.b };
      return { type: 'SOLID', ...common, color, boundVariables: { ...(paint.boundVariables ?? {}) } };
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      if (!Array.isArray(paint.gradientStops) || paint.gradientStops.length === 0) {
        throw figmaError(api, 'Expected "gradientStops" to be a non-empty array');
      }
      for (const stop of paint.gradientStops) checkRgb(api, stop.color, true);
      return { ...paint, ...common };
    case 'IMAGE':
      if (paint.imageHash !== null && typeof paint.imageHash !== 'string') {
        throw figmaError(api, 'Expected "imageHash" to be a string or null');
      }
      return { ...paint, ...common };
    case 'PATTERN':
      // Pattern paints can only be set through setFillsAsync / setStrokesAsync (typings:8712, 8800).
      throw figmaError(api, 'Pattern paints must be set with setFillsAsync or setStrokesAsync');
    default:
      return { ...paint, ...common };
  }
}

/** Validates a paint array and returns a frozen, normalised copy. */
export function normalizePaints(api: string, value: unknown): readonly Paint[] {
  if (!Array.isArray(value)) throw figmaError(api, 'Expected an array of paints');
  const paints: Paint[] = value.map((paint: Paint) => normalizePaint(api, paint));
  return deepFreeze(paints);
}

const EFFECT_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  DROP_SHADOW: ['color', 'offset', 'radius', 'visible', 'blendMode'],
  INNER_SHADOW: ['color', 'offset', 'radius', 'visible', 'blendMode'],
  LAYER_BLUR: ['radius', 'visible'],
  BACKGROUND_BLUR: ['radius', 'visible'],
  NOISE: ['color', 'visible', 'blendMode', 'noiseSize', 'density', 'noiseType'],
  TEXTURE: ['visible', 'noiseSize', 'radius', 'clipToShape'],
  GLASS: ['visible', 'lightIntensity', 'lightAngle', 'refraction', 'depth', 'dispersion', 'radius'],
  SHADER: ['visible', 'id'],
};

/**
 * Validates an effect array: required fields per type (typings:4351-4689; `visible` and
 * `blendMode` are not optional on shadows), shadow colours as RGBA, non-negative radii.
 */
export function normalizeEffects(api: string, value: unknown): readonly Effect[] {
  if (!Array.isArray(value)) throw figmaError(api, 'Expected an array of effects');
  const effects: Effect[] = value.map((effect: Effect) => {
    if (!isObject(effect) || typeof effect.type !== 'string' || !Object.hasOwn(EFFECT_REQUIRED, effect.type)) {
      throw figmaError(api, 'Invalid effect type');
    }
    for (const key of EFFECT_REQUIRED[effect.type] ?? []) {
      if (!(key in effect)) throw figmaError(api, `Required value missing: "${key}"`);
    }
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      checkRgb(api, effect.color, true);
      if (effect.radius < 0) throw figmaError(api, 'Expected "radius" to be >= 0');
      if (!isBlendMode(effect.blendMode)) throw figmaError(api, `Invalid blend mode "${String(effect.blendMode)}"`);
    }
    return { ...effect };
  });
  return deepFreeze(effects);
}

const CONSTRAINT_TYPES: ReadonlySet<string> = new Set<ConstraintType>(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

/** `Constraints` is `{ horizontal, vertical }`, each a `ConstraintType` (typings:4690-4700). */
export function normalizeConstraints(api: string, value: Constraints): Constraints {
  if (!isObject(value)) throw figmaError(api, 'Expected "constraints" to be an object');
  checkKeys(api, value, ['horizontal', 'vertical']);
  if (!CONSTRAINT_TYPES.has(value.horizontal) || !CONSTRAINT_TYPES.has(value.vertical)) {
    throw figmaError(api, 'Invalid constraint type');
  }
  return deepFreeze({ horizontal: value.horizontal, vertical: value.vertical });
}

/** Checks a finite number, optionally with a minimum (inclusive). */
export function checkNumber(api: string, name: string, value: unknown, min?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw figmaError(api, `Expected "${name}" to be a number`);
  if (min !== undefined && value < min) throw figmaError(api, `Expected "${name}" to have value >= ${min}`);
  return value;
}

/** Checks a member of a string enum. */
export function checkEnum<T extends string>(api: string, name: string, value: unknown, allowed: readonly T[]): T {
  const match = allowed.find((option) => option === value);
  if (match === undefined) {
    throw figmaError(api, `Invalid value for "${name}": expected one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
  }
  return match;
}

export function checkBoolean(api: string, name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw figmaError(api, `Expected "${name}" to be a boolean`);
  return value;
}

export function checkString(api: string, name: string, value: unknown): string {
  if (typeof value !== 'string') throw figmaError(api, `Expected "${name}" to be a string`);
  return value;
}

/** A frozen copy of an array of plain values (guides, dash patterns, layout grids, …). */
export function frozenCopy<T>(value: readonly T[]): readonly T[] {
  return deepFreeze(structuredClone([...value]));
}
