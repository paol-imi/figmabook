/**
 * `pnpm -F @holotype/spikes s19:record`: records the CDP facts of `components-button--primary` on
 * the ds-react dev server into `S-19/test/fixtures/button-primary.json`, so the resolver's unit
 * tests run on real Chromium + Vite data without a browser. Absolute paths become `/repo/`.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { REPO_ROOT, startDevServer } from './dev-server.ts';
import { ProvenanceProbe } from './probe.ts';
import type { CssRule, CssStyle, MatchedStyles } from './resolver/cdp.ts';
import { MAPPED_LONGHANDS } from './resolver/longhands.ts';
import { varRefs } from './resolver/var-refs.ts';

const STORY = 'components-button--primary';
/** The nodes recorded: the button and its label span (the label's text inherits the font). */
const NODES = { button: '#storybook-root > button', label: '#storybook-root > button > span' } as const;

/** Computed properties the resolver and `relevantFields` read. */
const COMPUTED = new Set<string>([
  ...MAPPED_LONGHANDS,
  'display',
  ...['top', 'right', 'bottom', 'left'].map((side) => `border-${side}-style`),
]);

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

/**
 * Keeps the fixture small without changing any answer: drops the custom properties that no
 * recorded declaration reaches (the token sheet declares ~120), the longhands CDP expanded in
 * ancestors' author rules (the resolver reads ranged declarations there) and ancestors'
 * user-agent rules (no mapped property inherits from them in this story).
 */
function prune(nodes: readonly MatchedStyles[]): void {
  const styles: CssStyle[] = [];
  for (const matched of nodes) {
    for (const match of matched.matchedCSSRules ?? []) styles.push(match.rule.style);
    for (const entry of matched.inherited ?? [])
      for (const match of entry.matchedCSSRules) styles.push(match.rule.style);
  }
  const reached = new Set<string>();
  const pending: string[] = [];
  const visit = (value: string) => {
    for (const ref of varRefs(value)) {
      if (!reached.has(ref.name)) {
        reached.add(ref.name);
        pending.push(ref.name);
      }
      if (ref.fallback !== undefined) visit(ref.fallback);
    }
  };
  for (const style of styles) for (const p of style.cssProperties) if (!p.name.startsWith('--')) visit(p.value);
  while (pending.length > 0) {
    const name = pending.pop();
    for (const style of styles) for (const p of style.cssProperties) if (p.name === name) visit(p.value);
  }
  const keep = (rule: CssRule) => {
    const style = rule.style as Mutable<CssStyle>;
    style.cssProperties = style.cssProperties.filter((p) => !p.name.startsWith('--') || reached.has(p.name));
  };
  for (const matched of nodes) {
    for (const match of matched.matchedCSSRules ?? []) keep(match.rule);
    for (const entry of (matched.inherited ?? []) as Mutable<NonNullable<MatchedStyles['inherited']>[number]>[]) {
      entry.matchedCSSRules = entry.matchedCSSRules.filter((m) => m.rule.origin !== 'user-agent');
      for (const match of entry.matchedCSSRules) {
        keep(match.rule);
        const style = match.rule.style as Mutable<CssStyle>;
        if (style.cssProperties.some((p) => p.range !== undefined)) {
          style.cssProperties = style.cssProperties.filter((p) => p.range !== undefined);
        }
      }
    }
  }
}

const server = await startDevServer();
const browser = await chromium.launch(
  process.env.HOLOTYPE_CHROMIUM_PATH ? { executablePath: process.env.HOLOTYPE_CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage();
  const probe = await ProvenanceProbe.attach(page);
  await page.goto(new URL(`iframe.html?id=${STORY}&viewMode=story`, server.url).href);
  await page.waitForSelector(NODES.label);
  await page.evaluate(() => document.fonts.ready);
  const nodes: Record<string, { matched: MatchedStyles; computed: Record<string, string> }> = {};
  for (const [name, selector] of Object.entries(NODES)) {
    const nodeId = await probe.nodeIdFor(selector);
    const computed = Object.entries(await probe.computed(nodeId)).filter(([property]) => COMPUTED.has(property));
    // Only the members the resolver reads (no pseudo-elements, @font-face, keyframes).
    const { inlineStyle, attributesStyle, matchedCSSRules, inherited } = await probe.matched(nodeId);
    const matched: MatchedStyles = {
      ...(inlineStyle === undefined ? {} : { inlineStyle }),
      ...(attributesStyle === undefined ? {} : { attributesStyle }),
      ...(matchedCSSRules === undefined ? {} : { matchedCSSRules }),
      ...(inherited === undefined ? {} : { inherited }),
    };
    nodes[name] = { matched, computed: Object.fromEntries(computed) };
  }
  prune(Object.values(nodes).map((node) => node.matched));
  const sheets = await probe.sheetInputs();
  const fixture = {
    story: STORY,
    note: 'Recorded by spikes/S-19/record.ts (pruned, see prune()); absolute paths replaced by /repo/.',
    repoRoot: '/repo/',
    // The map is kept parsed in `sourceMap`; the header's data URL would hide absolute paths in base64.
    sheets: sheets
      .filter((s) => s.header.origin !== 'user-agent')
      .map((s) =>
        s.header.sourceMapURL?.startsWith('data:') === true
          ? { ...s, header: { ...s.header, sourceMapURL: 'data:application/json;base64,e30=' } }
          : s,
      ),
    nodes,
  };
  const json = JSON.stringify(fixture, null, 2).replaceAll(REPO_ROOT, '/repo/');
  const file = fileURLToPath(new URL('./test/fixtures/button-primary.json', import.meta.url));
  await writeFile(file, `${json}\n`);
  console.log(`wrote ${file}`);
} finally {
  await browser.close();
  await server.close();
}
