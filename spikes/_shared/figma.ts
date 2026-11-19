/**
 * Helpers for spike main tasks. They take the Plugin API as a parameter (never the `figma`
 * global), so every spike can dry-run against a fake.
 */
import { errorMessage, round3 } from './json.ts';

/** Shared plugin data namespace of the kit. Distinct from the product's `holotype`. */
export const NS = 'holotype_spikes';

export const INTER_REGULAR: FontName = { family: 'Inter', style: 'Regular' };
export const INTER_BOLD: FontName = { family: 'Inter', style: 'Bold' };

export function rgb(hex: string): RGB {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
  const [, r = '00', g = '00', b = '00'] = match;
  return { r: Number.parseInt(r, 16) / 255, g: Number.parseInt(g, 16) / 255, b: Number.parseInt(b, 16) / 255 };
}

export function solid(hex: string, opacity = 1): SolidPaint {
  return { type: 'SOLID', color: rgb(hex), opacity };
}

function hexByte(channel: number): string {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function hexOf(color: RGB | RGBA): string {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

/** A short, comparable description of a paint list: `#rrggbb@opacity` per visible solid. */
export function paintsSignature(paints: readonly Paint[] | PluginAPI['mixed'] | undefined): string {
  if (!Array.isArray(paints)) return typeof paints === 'symbol' ? 'mixed' : 'none';
  if (paints.length === 0) return 'none';
  return paints
    .map((paint: Paint) =>
      paint.type === 'SOLID' ? `${hexOf(paint.color)}@${round3(paint.opacity ?? 1)}` : paint.type.toLowerCase(),
    )
    .join(',');
}

/** A short description of an effect list: `type:color:x,y:radius` per effect. */
export function effectsSignature(effects: readonly Effect[] | undefined): string {
  if (!effects || effects.length === 0) return 'none';
  return effects
    .map((effect) =>
      effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
        ? `${effect.type.toLowerCase()}:${hexOf(effect.color)}:${round3(effect.offset.x)},${round3(effect.offset.y)}:${round3(effect.radius)}`
        : effect.type.toLowerCase(),
    )
    .join(',');
}

export function dropShadow(hex: string, x: number, y: number, radius: number): DropShadowEffect {
  return {
    type: 'DROP_SHADOW',
    color: { ...rgb(hex), a: 0.5 },
    offset: { x, y },
    radius,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL',
  };
}

export type ProbeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Runs one probe; a throw becomes `{ ok: false, error }` (the error text is the evidence). */
export async function probe<T>(fn: () => T | Promise<T>): Promise<ProbeResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Finds the kit's page by name or creates it, loads it and makes it current. */
export async function usePage(figma: PluginAPI, name: string): Promise<PageNode> {
  const existing = figma.root.children.find((page) => page.name === name);
  const page = existing ?? figma.createPage();
  page.name = name;
  await page.loadAsync();
  await figma.setCurrentPageAsync(page);
  return page;
}

/** Finds a kit page by name and loads it, or returns `undefined`. */
export async function findPage(figma: PluginAPI, name: string): Promise<PageNode | undefined> {
  const page = figma.root.children.find((candidate) => candidate.name === name);
  if (page) await page.loadAsync();
  return page;
}

export function setRole(node: BaseNode, role: string): void {
  node.setSharedPluginData(NS, 'role', role);
}

export function roleOf(node: BaseNode): string {
  return node.getSharedPluginData(NS, 'role');
}

/** Finds a descendant (or the node itself) by its kit role, falling back to its name. */
export function findByRole(root: SceneNode | PageNode, role: string, name?: string): SceneNode | undefined {
  if ('type' in root && root.type !== 'PAGE' && roleOf(root) === role) return root;
  if (!('findOne' in root)) return undefined;
  return (
    root.findOne((node) => roleOf(node) === role) ??
    (name ? (root.findOne((node) => node.name === name) ?? undefined) : undefined)
  );
}

/** Places nodes left to right in rows, so a spike page stays readable. */
export function layoutGrid(
  nodes: readonly SceneNode[],
  options: { x: number; y: number; columns: number; gap: number },
): void {
  let rowHeight = 0;
  let x = options.x;
  let y = options.y;
  nodes.forEach((node, index) => {
    if (index > 0 && index % options.columns === 0) {
      x = options.x;
      y += rowHeight + options.gap;
      rowHeight = 0;
    }
    node.x = x;
    node.y = y;
    x += node.width + options.gap;
    rowHeight = Math.max(rowHeight, node.height);
  });
}

/** Creates a text node with Inter Regular (loads the font first). */
export async function createLabel(figma: PluginAPI, characters: string, size = 12): Promise<TextNode> {
  await figma.loadFontAsync(INTER_REGULAR);
  const text = figma.createText();
  text.fontName = INTER_REGULAR;
  text.fontSize = size;
  text.characters = characters;
  return text;
}

/**
 * Short, stable fingerprint of a string (FNV-1a 32-bit, hex). Used to compare file keys
 * across steps without putting the key itself in the results.
 */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
