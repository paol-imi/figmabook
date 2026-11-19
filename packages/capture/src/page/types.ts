/*
 * The page ↔ Node contract of the serializer (05 §2), and the collector interface every fact
 * collector implements. Page code may import only this folder and `@holotype/ir` types.
 */
import type { CComputed, CNode, CPaintOrder, CText, CTextStyle, Rect } from '@holotype/ir';
import type { ColorReadback } from './color';

/** Bumped when the page ↔ Node contract changes. */
export const SERIALIZER_PROTOCOL = 2;

/**
 * Diagnostic codes the page emits. Node turns them into catalog diagnostics (12 §6.2); the
 * Node side checks at compile time that each one is registered.
 */
export type PageDiagnosticCode =
  | 'CAP_CSS_UNSUPPORTED'
  | 'CAP_PSEUDO_UNMEASURED'
  | 'CAP_SR_ONLY_SKIPPED'
  | 'PAINT_COLOR_READBACK';

/** A diagnostic as the page reports it: plain data, rendered to a full one in Node. */
export interface PageDiagnostic {
  readonly code: PageDiagnosticCode;
  /** The capture node id (`c<n>`) it concerns. */
  readonly nodeId?: string;
  readonly property?: string;
  readonly value?: string;
  readonly fallback?: string;
  readonly data?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

/** Options of one `serialize()` call. */
export interface SerializeOptions {
  /** `parameters.holotype.exclude`: CSS selectors whose elements are not captured. */
  readonly exclude?: readonly string[];
}

/** What `serialize()` returns: the node tree plus the facts shared across nodes. */
export interface PageCapture {
  readonly protocol: number;
  readonly root: CNode;
  /**
   * Text styles keyed by a page-local id (`s<n>`, first use first). Node re-keys them by
   * content hash (06 §2: "key = hash of style").
   */
  readonly textStyles: Readonly<Record<string, CTextStyle>>;
  readonly diagnostics: readonly PageDiagnostic[];
  /** Milliseconds the walk took, measured in the page. */
  readonly serializeMs: number;
}

/** What a collector writes for an element; finalized into a `CNode` once all collectors ran. */
export interface ElementDraft {
  readonly id: string;
  borderBox?: Rect;
  paint?: CPaintOrder;
  readonly computed: Partial<CComputed>;
}

/** What a collector writes for a text block; finalized into a `type: 'text'` `CNode`. */
export interface TextDraft {
  readonly id: string;
  borderBox?: Rect;
  paint?: CPaintOrder;
  text?: CText;
}

/**
 * One run of inline content: consecutive text nodes, `<br>`s and plain inline elements of
 * one block container (05 §4.1). A flex or grid container's text nodes are one block each.
 */
export interface TextBlock {
  /** The element whose inline formatting context holds the text. */
  readonly container: Element;
  readonly containerStyle: CSSStyleDeclaration;
  /** In composed order; inline elements are flattened to their text and `<br>`s. */
  readonly items: readonly TextItem[];
  /** The inline elements flattened into this block, outermost first. */
  readonly inlines: readonly StyledElement[];
}

export interface StyledElement {
  readonly element: Element;
  readonly style: CSSStyleDeclaration;
}

export type TextItem =
  | {
      readonly kind: 'text';
      readonly node: Text;
      /** The element the text node belongs to (its parent, or the container). */
      readonly owner: Element;
      readonly style: CSSStyleDeclaration;
    }
  | { readonly kind: 'break'; readonly node: Element; readonly style: CSSStyleDeclaration };

/** Shared state of one `serialize()` call. */
export interface CollectContext {
  readonly doc: Document;
  /** The capture root of this call. */
  readonly root: Element;
  readonly readback: ColorReadback;
  report(diagnostic: PageDiagnostic): void;
  /** Interns a text style and returns its page-local id. */
  internTextStyle(style: CTextStyle): string;
  /** A per-call cache, keyed by collector. */
  memo<T>(key: string, compute: () => T): T;
}

export interface ElementInput {
  readonly element: Element;
  readonly style: CSSStyleDeclaration;
  /** The parent element's computed style; `null` for the capture root. */
  readonly parentStyle: CSSStyleDeclaration | null;
  /** Walk-order index, also the `paint.domIndex`. */
  readonly index: number;
}

export interface TextInput {
  readonly block: TextBlock;
  readonly index: number;
}

/**
 * A fact collector (05 §3). Registered in `collectors/index.ts`, one import per collector,
 * and run in registry order for every captured element and text block.
 */
export interface Collector {
  readonly name: string;
  element?(input: ElementInput, draft: ElementDraft, context: CollectContext): void;
  text?(input: TextInput, draft: TextDraft, context: CollectContext): void;
}
