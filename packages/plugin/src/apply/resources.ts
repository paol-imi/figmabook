/*
 * Read-only preparation of one component before its first write (09 §5.1 slice scope): every
 * font is resolved and loaded, every image created once per sha256, every SVG asset decoded.
 * Node writers then run synchronously from the prepared maps. Results are cached for the whole
 * session, so an asset is pulled from the UI at most once (09 §3.2).
 */
import type { SceneComponent, SceneFontRequest, SceneNode } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { FigmaPort } from '../port';
import { FontResolver, fontRequestKey } from './fonts';
import { paintAssets } from './paints';
import { utf8Decode } from './utf8';

export interface AssetBytes {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** Fetches one asset of the bundle (from the UI, 09 §3.3). */
export type LoadAsset = (sha256: string) => Promise<AssetBytes>;

/** What the node writers read: everything resolved, nothing async. */
export interface Resources {
  /** The loaded font for a request; resolved during `prepare`. */
  font(request: SceneFontRequest): FontName;
  /** The Figma image hash of an asset, or `null` when Figma refused it. */
  imageHash(sha256: string): string | null;
  /** The SVG text of an asset, or `null` when it could not be read. */
  svg(sha256: string): string | null;
}

export type ResourcePort = Pick<FigmaPort, 'createImage' | 'listAvailableFontsAsync' | 'loadFontAsync'>;

interface Needs {
  readonly fonts: Map<string, { request: SceneFontRequest; nodeKey: string }>;
  readonly images: Set<string>;
  readonly svgs: Set<string>;
}

/** The fonts and assets a node subtree needs, including instance fallback subtrees. */
function collect(node: SceneNode, needs: Needs): void {
  for (const sha of [...paintAssets(node.fills), ...paintAssets(node.strokes?.paints)]) needs.images.add(sha);
  for (const range of node.text?.ranges ?? []) {
    const key = fontRequestKey(range.font);
    if (!needs.fonts.has(key)) needs.fonts.set(key, { request: range.font, nodeKey: node.nk });
    for (const sha of paintAssets(range.fills)) needs.images.add(sha);
  }
  if (node.svg) needs.svgs.add(node.svg.asset.sha);
  if (node.instance?.fallback) collect(node.instance.fallback, needs);
  for (const child of node.children ?? []) collect(child, needs);
}

export class ResourceCache {
  readonly #port: ResourcePort;
  readonly #loadAsset: LoadAsset;
  readonly #emit: (diagnostic: Diagnostic) => void;
  readonly #fonts: FontResolver;
  readonly #fontNames = new Map<string, FontName>();
  readonly #images = new Map<string, string | null>();
  readonly #svgs = new Map<string, string | null>();

  constructor(port: ResourcePort, loadAsset: LoadAsset, emit: (diagnostic: Diagnostic) => void) {
    this.#port = port;
    this.#loadAsset = loadAsset;
    this.#emit = emit;
    this.#fonts = new FontResolver(port, emit);
  }

  /** Resolves everything `scene` needs. Throws only when no font at all can be loaded. */
  async prepare(scene: SceneComponent): Promise<Resources> {
    const needs: Needs = { fonts: new Map(), images: new Set(), svgs: new Set() };
    for (const variant of scene.variants) collect(variant.root, needs);
    for (const [key, { request, nodeKey }] of needs.fonts) {
      if (!this.#fontNames.has(key)) {
        this.#fontNames.set(key, await this.#fonts.resolve(request, { sid: scene.sid, nodeKey }));
      }
    }
    for (const sha of needs.images)
      if (!this.#images.has(sha)) this.#images.set(sha, await this.#image(sha, scene.sid));
    for (const sha of needs.svgs) if (!this.#svgs.has(sha)) this.#svgs.set(sha, await this.#svg(sha));
    return {
      font: (request) => {
        const font = this.#fontNames.get(fontRequestKey(request));
        if (font === undefined) throw new Error(`Font ${request.family} was not prepared.`);
        return font;
      },
      imageHash: (sha) => this.#images.get(sha) ?? null,
      svg: (sha) => this.#svgs.get(sha) ?? null,
    };
  }

  async #image(sha: string, sid: string): Promise<string | null> {
    try {
      const { bytes } = await this.#loadAsset(sha);
      return this.#port.createImage(bytes).hash;
    } catch (error) {
      this.#emit(
        createDiagnostic(diagnostic('APPLY_IMAGE_REJECTED'), undefined, {
          sid,
          value: sha,
          fallback: 'the image fill was left out',
          data: { reason: error instanceof Error ? error.message : String(error) },
        }),
      );
      return null;
    }
  }

  async #svg(sha: string): Promise<string | null> {
    try {
      const { bytes } = await this.#loadAsset(sha);
      return bytes.length === 0 ? null : utf8Decode(bytes);
    } catch {
      return null; // reported as SVG_IMPORT_FAILED at the node that needs it
    }
  }
}
