import type { HolotypeConfig, MapperSettings } from '@holotype/ir';
import { DEFAULT_MAPPER_SETTINGS } from '@holotype/mapper';

/**
 * Project-wide mapper settings from the config (16 §8–§10, §13): built-in defaults, then the
 * `mapper`, `layout`, `naming` and `figma.grid` namespaces, `tokens.bindByValue`, and the
 * text mode (`defaults.textMode`, else `layout.textWrap`, D-17). Per-component overrides
 * (`components[sid]`) come with the planner (B-50).
 */
export function resolveMapperSettings(config: HolotypeConfig): MapperSettings {
  const d = DEFAULT_MAPPER_SETTINGS;
  const { mapper = {}, layout = {}, naming = {} } = config;
  return {
    mapper: { ...d.mapper, ...mapper, alignment: { ...d.mapper.alignment, ...mapper.alignment } },
    layout: { ...d.layout, ...layout, probing: { ...d.layout.probing, ...layout.probing } },
    naming: { ...d.naming, ...naming },
    grid: { ...d.grid, ...config.figma?.grid },
    textMode: config.defaults?.textMode ?? layout.textWrap ?? d.textMode,
    bindByValue: config.tokens?.bindByValue ?? d.bindByValue,
  };
}
