import type { MapperSettings } from '@holotype/ir';

/**
 * The defaults of 16 §3 as resolved `MapperSettings`. The CLI resolves the real settings
 * per component (16 precedence); these serve callers without a config, such as tests.
 */
export const DEFAULT_MAPPER_SETTINGS: MapperSettings = deepFreeze({
  mapper: {
    keepInvisible: true,
    borderModel: 'padding-plus-border',
    allowSpacers: false,
    exactBorders: false,
    exactRadii: false,
    preferFrames: false,
    alignment: { maxPlaceholdersRatio: 0.5 },
    colorProfile: 'auto',
    nativeControls: 'synthesize',
  },
  layout: {
    autoLayout: 'verified',
    tolerancePx: 0.6,
    margins: 'normalize',
    textWrap: 'reflow',
    probing: { enabled: false, widths: [0.75, 1, 1.25] },
  },
  naming: {
    layers: ['data-holotype-name', 'data-figma-name', 'data-testid', 'component', 'aria', 'semantic', 'class'],
    stripClassPatterns: ['/^css-[a-z0-9]+$/', '/^sc-/', '/^[a-z]+:[\\w-]+$/'],
    iconSlug: 'role',
  },
  grid: { maxColumns: 8, gap: 24, padding: 32 },
  textMode: 'reflow',
  bindByValue: false,
});

/** Why a settings value cannot be meant, or `undefined` when the settings are usable. */
export function settingsProblem(settings: MapperSettings): string | undefined {
  const { tolerancePx } = settings.layout;
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) {
    return `layout.tolerancePx must be a finite number ≥ 0, got ${tolerancePx}`;
  }
  const ratio = settings.mapper.alignment.maxPlaceholdersRatio;
  if (!(ratio >= 0 && ratio <= 1)) {
    return `mapper.alignment.maxPlaceholdersRatio must be between 0 and 1, got ${ratio}`;
  }
  const { maxColumns, gap, padding } = settings.grid;
  if (!Number.isInteger(maxColumns) || maxColumns < 1) {
    return `figma.grid.maxColumns must be an integer ≥ 1, got ${maxColumns}`;
  }
  if (!Number.isFinite(gap) || !Number.isFinite(padding) || padding < 0) {
    return `figma.grid.gap and figma.grid.padding must be finite (padding ≥ 0), got ${gap} and ${padding}`;
  }
  return undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
