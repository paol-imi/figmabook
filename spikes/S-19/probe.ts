/**
 * The CDP half of S-19 (Node, Playwright): style sheet headers from `CSS.styleSheetAdded`, owner
 * `data-vite-dev-id` attributes, inline source maps, Capture IR nodes → DOM node ids, matched and
 * computed styles. The pure resolver (`./resolver`) does the rest. B-45 folds this into the capture
 * orchestrator's CDP session (05 §2.3).
 */
import type { CaptureDoc, CNode } from '@holotype/ir';
import type { CDPSession, Page } from 'playwright';
import type { ComputedStyle, MatchedStyles, StyleSheetHeader } from './resolver/cdp.ts';
import { decodeDataUrl, isSourceMap, type SheetInput } from './resolver/sheets.ts';

/** A captured node located in the live DOM. */
export interface LocatedNode {
  readonly node: CNode;
  /** The element whose styles apply: the node itself, or a text node's container. */
  readonly element: CNode;
  readonly kind: 'element' | 'text';
  readonly nodeId: number;
}

export interface NodeLocation {
  readonly located: readonly LocatedNode[];
  /** Element ids of the Capture IR with no matching DOM element. */
  readonly unmatched: readonly string[];
}

interface DomFact {
  readonly tag: string;
  readonly classes: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const ROOT_QUERY = '#storybook-root, #storybook-root *';
const RECT_TOLERANCE = 0.05;

/** Elements of the capture tree in depth-first order, each with its parent element. */
function elementsInOrder(root: CNode): { node: CNode; parent: CNode | undefined }[] {
  const out: { node: CNode; parent: CNode | undefined }[] = [];
  const visit = (node: CNode, parent: CNode | undefined) => {
    out.push({ node, parent });
    for (const child of node.children) visit(child, node.type === 'text' || node.type === 'pseudo' ? parent : node);
  };
  visit(root, undefined);
  return out;
}

function sameElement(node: CNode, fact: DomFact): boolean {
  if (node.source.tag !== fact.tag) return false;
  const classes = node.source.classes ?? [];
  if (classes.length !== Math.min(fact.classes.length, 16) || classes.some((c, i) => c !== fact.classes[i])) {
    return false;
  }
  const box = node.borderBox;
  return (
    Math.abs(box.x - fact.x) <= RECT_TOLERANCE &&
    Math.abs(box.y - fact.y) <= RECT_TOLERANCE &&
    Math.abs(box.w - fact.w) <= RECT_TOLERANCE &&
    Math.abs(box.h - fact.h) <= RECT_TOLERANCE
  );
}

export class ProvenanceProbe {
  readonly #headers = new Map<string, StyleSheetHeader>();
  readonly #inputs = new Map<string, Promise<SheetInput>>();

  private readonly page: Page;
  private readonly cdp: CDPSession;

  private constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
    cdp.on('CSS.styleSheetAdded', ({ header }) => {
      this.#headers.set(header.styleSheetId, header);
    });
    cdp.on('CSS.styleSheetRemoved', ({ styleSheetId }) => {
      this.#headers.delete(styleSheetId);
      this.#inputs.delete(styleSheetId);
    });
  }

  /** Opens a CDP session on `page` and enables `DOM` and `CSS` (call before the first navigation). */
  static async attach(page: Page): Promise<ProvenanceProbe> {
    const cdp = await page.context().newCDPSession(page);
    const probe = new ProvenanceProbe(page, cdp);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    return probe;
  }

  /** Headers seen since `CSS.enable`, minus removed ones. */
  headers(): StyleSheetHeader[] {
    return [...this.#headers.values()];
  }

  async #devId(header: StyleSheetHeader): Promise<string | undefined> {
    if (header.ownerNode === undefined) return undefined;
    try {
      const { node } = await this.cdp.send('DOM.describeNode', { backendNodeId: header.ownerNode });
      const attributes = node.attributes ?? [];
      const at = attributes.indexOf('data-vite-dev-id');
      return at >= 0 && at % 2 === 0 ? attributes[at + 1] : undefined;
    } catch {
      return undefined;
    }
  }

  async #sourceMap(header: StyleSheetHeader): Promise<unknown> {
    const url = header.sourceMapURL;
    if (url === undefined || url === '') return undefined;
    if (url.startsWith('data:')) return decodeDataUrl(url);
    // A linked map: only from the loopback server the story came from (BUILD §3.1 rule 8).
    try {
      const resolved = new URL(url, header.sourceURL || this.page.url());
      if (resolved.hostname !== '127.0.0.1') return undefined;
      const response = await fetch(resolved);
      return response.ok ? ((await response.json()) as unknown) : undefined;
    } catch {
      return undefined;
    }
  }

  async #input(header: StyleSheetHeader): Promise<SheetInput> {
    const [devId, map] = await Promise.all([this.#devId(header), this.#sourceMap(header)]);
    return {
      header,
      ...(devId === undefined ? {} : { devId }),
      ...(isSourceMap(map) ? { sourceMap: map } : {}),
    };
  }

  /** Sheet inputs for the resolver, cached per `styleSheetId`. */
  async sheetInputs(): Promise<SheetInput[]> {
    return Promise.all(
      this.headers().map((header) => {
        let input = this.#inputs.get(header.styleSheetId);
        if (input === undefined) {
          input = this.#input(header);
          this.#inputs.set(header.styleSheetId, input);
        }
        return input;
      }),
    );
  }

  /**
   * Finds each captured node in the live DOM: element nodes match DOM elements under
   * `#storybook-root` in document order by tag, classes and border box; text nodes take their
   * container element. Light DOM only (shadow roots: hardening).
   */
  async locate(doc: CaptureDoc): Promise<NodeLocation> {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: ROOT_QUERY });
    const facts = await this.page.evaluate((query) => {
      return [...document.querySelectorAll(query)].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.localName,
          classes: [...element.classList],
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          w: rect.width,
          h: rect.height,
        };
      });
    }, ROOT_QUERY);
    if (facts.length !== nodeIds.length) throw new Error('S-19: the DOM changed while locating captured nodes.');
    const byElement = new Map<string, number>();
    const unmatched: string[] = [];
    const located: LocatedNode[] = [];
    let cursor = 0;
    for (const { node, parent } of elementsInOrder(doc.root)) {
      if (node.type === 'pseudo') continue;
      if (node.type === 'text') {
        const nodeId = parent === undefined ? undefined : byElement.get(parent.id);
        if (parent !== undefined && nodeId !== undefined) located.push({ node, element: parent, kind: 'text', nodeId });
        continue;
      }
      let found = -1;
      for (let i = cursor; i < facts.length; i++) {
        const fact = facts[i];
        if (fact !== undefined && sameElement(node, fact)) {
          found = i;
          break;
        }
      }
      const nodeId = found < 0 ? undefined : nodeIds[found];
      if (nodeId === undefined) {
        unmatched.push(node.id);
        continue;
      }
      cursor = found + 1;
      byElement.set(node.id, nodeId);
      located.push({ node, element: node, kind: 'element', nodeId });
    }
    return { located, unmatched };
  }

  /** The node id of the first element matching `selector` in the current document. */
  async nodeIdFor(selector: string): Promise<number> {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId === 0) throw new Error(`S-19: no element matches "${selector}".`);
    return nodeId;
  }

  async matched(nodeId: number): Promise<MatchedStyles> {
    return this.cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  }

  async computed(nodeId: number): Promise<ComputedStyle> {
    const { computedStyle } = await this.cdp.send('CSS.getComputedStyleForNode', { nodeId });
    return Object.fromEntries(computedStyle.map((entry) => [entry.name, entry.value]));
  }

  async detach(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}
