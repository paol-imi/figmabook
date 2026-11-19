# 03: Storybook integration

> Package: `@holotype/storybook` (Node + in-page). Consumers: `planner` ([04](04-variant-model.md)) and `capture` ([05](05-capture.md)).
> Governing decisions: D-05, D-11, D-12, D-14, D-24, D-26.
> Research: [docs/research](../research/) and the Storybook monorepo at `next`@0cdcdc9 (11.0.0-beta.3). Paths below are relative to `code/`.

This package is the only one that knows Storybook internals. Everything downstream sees a version-neutral `StorybookAdapter`.

Version landscape on 2026-11-18:

| Line | Version | Status | Holotype support (D-11) |
|---|---|---|---|
| latest | 10.6.7 | current stable | **primary, first-class**: all fixtures, dogfooding and gates |
| next | 11.0.0-beta.3 | beta | tracked from beta; first-class at GA |
| maintained | 9.1.21, 8.6.19 | maintenance releases | best-effort: code paths kept, CI smoke only |
| maintained | 7.6.24 | maintenance releases | not supported |

Primary stack: React + Vite (`@storybook/react-vite`) on SB 10 (D-26). Other renderers are best-effort and untested until the post-M5 renderer expansion.

`storybook-addon-pseudo-states`, `@storybook/addon-themes` and `@storybook/addon-mcp` ship in lock-step with core.

---

## 1. Responsibilities

1. **Discover**: locate the Storybook, detect its version and capabilities, and list components and stories.
2. **Describe**: per story, extract `parameters`, `argTypes`, `initialArgs`, `tags`, component identity and docgen, plus project `globalTypes` and themes.
3. **Drive**: render a given `(storyId, args, globals)` in a warm page, wait for a stable frame, and expose the root element(s) to the capture serializer.
4. **Access**: serve static builds, handle dev-server security headers and authenticated hosts.
5. **Enhance**: framework-specific hooks (React fiber, Vue, Angular, custom-elements manifest) that give component boundaries and names. These are enhancers only (G8).

It does **not** decide variants (that is `planner`) or serialize the DOM (that is `capture`).

---

## 2. Discovery

### 2.1 Locating the Storybook

`StorybookSource` (from config or CLI):

```ts
type StorybookSource =
  | { kind: 'static'; dir: string }                    // storybook-static/ → we serve it (§9.1)
  | { kind: 'url'; url: string; auth?: AuthConfig }    // dev server, Chromatic permalink, any host
```

Probe order for `url`:

1. `GET <url>/index.json`. A 200 with `{v, entries}` means SB ≥7.
2. `GET <url>/stories.json` (v3, SB 6/7 with `buildStoriesJson`). This is accepted only to *list*: SB 7.x and older are unsupported (D-11), so emit `SB_VERSION_UNSUPPORTED` if `project.json` reports <8.
3. `GET <url>/project.json`, which gives `storybookVersion`, `framework`, `renderer`, `builder`, `language`, `storybookPackages` (written by `utils/metadata.ts`). It is optional: dev servers may 404 it.
4. `GET <url>/iframe.html` must be 200, otherwise `SB_IFRAME_UNREACHABLE`.

If neither `index.json` nor `stories.json` loads (network error, non-200, or not JSON), emit `SB_INDEX_UNREACHABLE` (error, `data.fatal`): the run stops.

If `<url>` ends in `/index.html` or `/?path=…`, strip it to the root. If the URL has a `?path=/story/<id>` deep link, record `<id>` as the default selection for the UI.

### 2.2 Story index (`index.json`)

Shape (`core/src/types/modules/indexer.ts`):

```ts
interface StoryIndex { v: 4 | 5; entries: Record<string, IndexEntry> }
type IndexEntry =
  | { type: 'story'; subtype?: 'story' | 'test'; id: string; name: string; title: string;
      importPath: string; tags?: string[]; componentPath?: string; exportName?: string;
      parent?: string; parentName?: string }
  | { type: 'docs'; id: string; name: string; title: string; importPath: string;
      storiesImports: string[]; tags?: string[] }
```

- v5 (SB ≥8.1) only adds the automatic `dev`/`test` tags. v4 entries are treated the same, with `tags ?? []`. A v3 `stories.json` (SB 6/7, unsupported) is parsed only so `list` can name what is skipped: map `{kind, story, parameters.__id}` the way `transformStoryIndexV3toV4` in `manager-api/lib/stories.ts` does.
- **Filter.** Keep `type==='story' && subtype!=='test'`. Drop entries tagged `!figma`, or not tagged `figma` when `config.requireTag` is set. Apply `config.include`/`exclude` globs against `title` and `id` (keys in [16](16-config.md#storybook)). Docs entries are never captured.
- **Fingerprint.** `indexHash = sha256(canonicalJSON(filteredEntries))`. It goes into the cache key ([12](12-quality.md)) and into `bundle.manifest.source`.

### 2.3 Component manifest and docgen services (10.1+ / 11)

| SB | Artifact | Use |
|---|---|---|
| 10.1–10.2 | `manifests/components.json` (flag `experimentalComponentsManifest`) | component `id`, `name`, `description`, `summary`, `jsDocTags`, `import`, `stories[{id,name,snippet,description}]`, `reactDocgen.props` |
| 10.3+ | same, flag `features.componentsManifest` (default-on in 11 for React, Vue3, Svelte, Angular-Vite) | as above, plus `subcomponents` |
| 11 | `services/core/docgen/<componentId>.json`, referenced by `$ref` from the manifest (JSON Pointer `/components/<key>`) | **full `argTypes: StrictArgTypes`**, `description`, `jsDocTags`, `subcomponents`, `meta.docgen` ∈ `react-docgen \| react-docgen-typescript \| react-component-meta \| vue-component-meta \| angular-component-meta \| compodoc \| custom-elements-manifest \| svelte2tsx` |

Sources: `shared/open-service/services/docgen/{paths,types}.ts`, `types/modules/core-common.ts:473-513`, and the docs page `/docs/ai/manifests`.

The manifest schema is documented as "not yet stable… not a public API", so it is **optional input**. We parse it defensively against a loose TypeBox schema. Unknown shapes produce `SB_MANIFEST_UNPARSEABLE` (info), and we fall back to in-page docgen.

**Dev servers in 11 with `docgenServer`.** Manifest routes 404 (docs `/docs/ai/manifests`). Strategy, in order:

1. If `@storybook/addon-mcp` is present at `/mcp`, call `docs-show` per component.
2. Otherwise accept the reduced argTypes and emit `SB_DOCGEN_DEGRADED` (warn). The hint recommends capturing from a static build.

(verify, S-07)

### 2.4 Composition (refs)

- The built manager's `index.html` inlines `window['REFS'] = {…}` (`builder-manager/utils/template.ts:64`).
- `holotype list --refs` parses it and offers each ref as a separate `StorybookSource`. Sources stay separate and are never merged into one index.
- The ref's own `iframe.html` uses **un-prefixed** ids (the manager uses `refId_storyId`).
- Credentials:
  - `user:pass@host` in a ref URL becomes Basic auth.
  - A 401 with `{loginUrl}` produces `SB_REF_AUTH_REQUIRED`, which points to `holotype login` (§9.4).
- In SB 11, refs must publish `index.json`/`stories.json` (v2 and `setStories` were dropped).

---

## 3. Version detection and adapters

### 3.1 Detection

`project.json.storybookVersion` is authoritative. If it is absent, run this probe in the page after `iframe.html` loads:

```ts
const v = {
  hasPreview: !!window.__STORYBOOK_PREVIEW__,
  hasStoreValue: !!window.__STORYBOOK_PREVIEW__?.storyStoreValue,   // 8.0+
  hasReady: typeof window.__STORYBOOK_PREVIEW__?.ready === 'function', // 8.x+ (verify S-07)
  hasStoryFinished: !!window.__STORYBOOK_MODULE_CORE_EVENTS__?.STORY_FINISHED,
  hasArgTypesInfo: !!window.__STORYBOOK_MODULE_CORE_EVENTS__?.ARGTYPES_INFO_REQUEST, // 10.x
  globalsVersion: window.__STORYBOOK_PREVIEW__?.storyStoreValue?.userGlobals ? 2 : 1,
};
```

### 3.2 Adapter interface

```ts
interface SbCapabilities {
  version: string;                 // semver of core
  indexFormat: 'v3' | 'v4' | 'v5';
  storyFinishedEvent: boolean;     // STORY_FINISHED (≥8.x late; verify S-07)
  awaitsAnimations: boolean;       // ≥9.0 'completing' phase waits for animations (skipped with the D-24 UA)
  pauseAnimationsInTestRunner: boolean; // ≥9.1: pauses CSS animations instead of waiting (§5.5)
  docgenServer: boolean;           // 11 default for supported renderers
  componentsManifest: boolean;     // 10.1+
  argTypesInfoEvent: boolean;      // ARGTYPES_INFO_REQUEST/RESPONSE
  storyGlobals: boolean;           // story-level `globals` (8.3+)
  pseudoStatesGlobal: boolean;     // pseudo-states addon syncs `pseudo` global (≥9.x)
  framework?: string; renderer?: string; builder?: 'vite' | 'webpack5' | string;
}

interface StorybookAdapter {
  readonly caps: SbCapabilities;
  listStories(): Promise<IndexStory[]>;                          // filtered index
  describe(ids: string[]): Promise<Map<string, StoryMeta | SbError>>;
  describeProject(): Promise<ProjectMeta>;                       // globalTypes, initialGlobals, themes, parameters
  openDriver(page: Page): Promise<RenderDriver>;                 // §5
}
```

- Adapters (D-11): `adapter-v8` (10.x primary; 8.x/9.x best-effort via the same capability flags) and `adapter-v11` (adds docgen-service merge; first-class at 11 GA). There is no 7.x adapter.
- Capability flags, not version branches, drive behaviour inside the shared code.
- Unknown future major → use the newest adapter and emit `SB_VERSION_UNTESTED` (warn).

---

## 4. Metadata extraction <a id="metadata-extraction"></a>

### 4.1 Per-story `loadStory`

Open **one** page on `iframe.html?id=__holotype__&viewMode=story`. The bogus id gives a cheap "story missing" render while the preview initializes. Then:

```ts
await page.waitForFunction(() => (window as any).__STORYBOOK_PREVIEW__);
const out = await page.evaluate(async (ids: string[]) => {
  const p = (window as any).__STORYBOOK_PREVIEW__;
  await (p.ready?.() ?? p.storyStore?.initializationPromise);  // 8+; legacy fallback (verify S-07)
  const res: Record<string, unknown> = {};
  for (const id of ids) {
    try {
      const s = await p.loadStory({ storyId: id });
      res[id] = __holotype.safe({
        id: s.id, title: s.title, name: s.name, tags: s.tags,
        parameters: s.parameters, argTypes: s.argTypes, initialArgs: s.initialArgs,
        storyGlobals: s.storyGlobals ?? s.globals,
        component: __holotype.describeComponent(s.component), // §6
        subcomponents: Object.keys(s.subcomponents ?? {}),
        usesMount: !!s.usesMount, hasPlay: typeof s.playFunction === 'function',
      });
    } catch (e) { res[id] = { __error: String((e as Error)?.stack ?? e) }; }
  }
  return res;
}, ids);
```

- **Use per-id `loadStory`, not `extract()`** (`Preview.tsx:493-504`). `extract()` imports *every* CSF file, so one broken file fails the whole extraction. A per-id failure produces `SB_STORY_LOAD_FAILED` (error, story skipped). Work in batches of 50 ids per `evaluate`, so a hang loses only one batch. Timeout: 30s per batch, then `SB_METADATA_TIMEOUT`, and the batch is retried with a fresh page.
- **Preview boot.** If `__STORYBOOK_PREVIEW__` never appears, or `ready()` does not resolve within 30s, emit `SB_PREVIEW_INIT_TIMEOUT` (error) and stop metadata extraction for this source.
- **`__holotype.safe`** is a structured serializer. It is injected with the capture bundle ([05 §2](05-capture.md#injection)) and replaces each non-JSON value with a tagged marker:
  - functions → `{$fn: name}`
  - React elements (`$$typeof`) → `{$node: 'react', type: displayName}`
  - Vue VNodes (`__v_isVNode`) → `{$node: 'vue'}`
  - DOM nodes → `{$node: 'dom', tag}`
  - class instances → `{$obj: constructor.name}`
  - cycles → `{$cycle: true}`
  - `Date` → `{$date: iso}`
  - `undefined` → `{$undef: true}` (so "explicitly unset" is preserved)
  - `Symbol` → `{$sym: description}`
  - Max depth is 8 and max array length 200, recording `{$truncated: n}` past either limit.
- **Markers matter.** They let `planner` tell that `icon` is a ReactNode arg, which makes it a SLOT or INSTANCE_SWAP candidate ([04 §4](04-variant-model.md#classification)).
- **argTypes channel alternative (10.x).** `ARGTYPES_INFO_REQUEST` / `ARGTYPES_INFO_RESPONSE` (`Preview.tsx:371`) is used when `loadStory` is unavailable or broken.

### 4.2 SB 11 docgen merge

With `caps.docgenServer`, `loadStory().argTypes` holds only hand-written argTypes plus first-pass enhancers (`prepareStory.ts:265-278`). Merge them the way the UI does (`mergeServiceArgTypes` in `addons/docs/src/blocks/blocks/argTypesShared.ts`):

```ts
finalArgTypes = deepMerge(serviceArgTypes(componentId) /* from services/core/docgen */, story.argTypes)
// story-declared keys win; service-only keys are added with origin:'docgen-service'
```

- Each argType is annotated with `origin: 'story' | 'docgen-inline' | 'docgen-service' | 'inferred-from-args'`. The planner uses `origin` to weigh how reliable an enum is ([04 §4.2](04-variant-model.md#classification)).
- **Arg validation in 11.** URL args are validated only against declared argTypes plus `initialArgs` (`ArgsStore.ts:21-28`). Channel updates are not validated (§5.3), which is one more reason the channel path is primary.

### 4.3 Project metadata

From `preview.storyStoreValue.projectAnnotations`:

- `globalTypes` (with `toolbar.items`)
- `initialGlobals` (`globals` on <8.2)
- `parameters`, including `layout`, `holotype`, `chromatic`, `pseudo`, `themes` and `viewport.options`/`viewports`
- `tags`

Themes discovery is covered in §8.

### 4.4 Normalized output

```ts
interface StoryMeta {
  id: string; sid: string;                 // sid = id.split('--')[0]
  title: string; titlePath: string[];      // title.split('/')
  name: string; exportName?: string; importPath: string; componentPath?: string;
  tags: string[];
  parameters: SafeJson;                    // merged project<meta<story by Storybook already
  argTypes: Record<string, NormalizedArgType>;
  initialArgs: Record<string, SafeJson>;
  storyGlobals: Record<string, SafeJson>;
  component?: ComponentIdentity;           // §6
  hasPlay: boolean; usesMount: boolean;
}
interface NormalizedArgType {
  name: string; origin: 'story'|'docgen-inline'|'docgen-service'|'inferred-from-args';
  type?: { name: string; value?: unknown; required?: boolean; raw?: string };
  control?: { type: ControlType; labels?: Record<string,string>; min?: number; max?: number; step?: number } | false;
  options?: SafeJson[]; mapping?: Record<string, SafeJson>;
  if?: { arg?: string; global?: string; truthy?: boolean; exists?: boolean; eq?: unknown; neq?: unknown };
  table?: { category?: string; subcategory?: string; disable?: boolean; defaultValue?: { summary?: string } };
  description?: string;
}
type ControlType = 'boolean'|'text'|'number'|'range'|'color'|'date'|'object'|'file'
  |'select'|'multi-select'|'radio'|'inline-radio'|'check'|'inline-check';
```

**Control inference.** Reproduce `store/inferControls.ts`:

- `enum` → `radio` (≤5 values) or `select`
- `boolean` → `boolean`
- `string` → `text`
- `number` → `number`
- `array` → `object`
- `function`/`symbol` → no control

Apply it for argTypes that lack a control, so v8–v11 behave identically.

**Unknown args.** An arg named in config or `parameters.holotype` that has no argType after the merge (§4.2) is dropped. The planner emits `SB_ARG_UNKNOWN` (warn).

---

## 5. Render-loop driver <a id="render-loop-driver"></a><a id="render-loop"></a>

One `RenderDriver` wraps one Playwright `Page` that stays on `iframe.html` for its whole life. The worker pool is in [05 §1](05-capture.md#orchestration).

### 5.1 API

```ts
interface RenderRequest {
  storyId: string;
  args: Record<string, unknown>;     // FULL desired arg set (not a delta)
  globals?: Record<string, unknown>; // FULL desired globals (merged over initialGlobals)
  remount?: boolean;                 // force fresh component state
  viewport?: { width: number; height: number };
  settle?: SettleOptions;            // §5.5
}
interface RenderResult {
  ok: true; storyId: string; renderMs: number; phase: 'finished'|'rendered';
  rootHandles: ElementHandle[];      // §6
  portalHandles: ElementHandle[];
  warnings: Diagnostic[];
}
interface RenderDriver {
  render(req: RenderRequest): Promise<RenderResult | SbError>;
  reload(): Promise<void>;           // hard reset
  dispose(): Promise<void>;
}
```

### 5.2 Event set

The values are the string names from `core-events/index.ts`:

| Purpose | Events |
|---|---|
| select | emit `setCurrentStory {storyId, viewMode:'story'}`; observe `currentStoryWasSet`, `storyPrepared`, `storyChanged`/`storyUnchanged` |
| args | emit `updateStoryArgs {storyId, updatedArgs}`, `resetStoryArgs {storyId, argNames?}`; observe `storyArgsUpdated` |
| globals | emit `updateGlobals {globals}`; observe `globalsUpdated` |
| remount | emit `forceRemount {storyId}` |
| lifecycle | `storyRenderPhaseChanged {newPhase}`: `preparing → loading → beforeEach → rendering → playing → played → completing → completed → afterEach → finished`, plus `aborted`/`errored` (`render/StoryRender.ts`) |
| done | `storyFinished {storyId, status}` if `caps.storyFinishedEvent`, else `storyRendered` |
| errors | `storyErrored`, `storyThrewException`, `playFunctionThrewException`, `unhandledErrorsWhilePlaying`, `storyMissing` |

### 5.3 Algorithm

A single update per variant:

```ts
async function render(req) {
  const wantStory = req.storyId !== current.storyId;
  await page.evaluate(__holotype.sb.armWaiter, { storyId: req.storyId, timeoutMs: T.render });
  // armWaiter subscribes BEFORE emitting, resolves on done/error, records phase transitions.

  if (req.viewport && !eq(req.viewport, current.viewport)) await page.setViewportSize(req.viewport);
  if (wantStory) {
    emit('setCurrentStory', { storyId: req.storyId, viewMode: 'story' });
    await waitDone();                                  // renders with initialArgs
    current = { storyId: req.storyId, args: meta.initialArgs, globals: current.globals };
  }
  const gDelta = diffKeys(current.globals, req.globals);
  if (gDelta) { await armAndEmit('updateGlobals', { globals: req.globals }); }   // triggers rerender of all renders

  // Single args update: compute the full delta, explicitly unset removed keys.
  // ArgsStore.update merges and runs deleteUndefined → one render, no reset round-trip.
  const updatedArgs = { ...mapValues(current.args, () => undefined), ...req.args };
  if (!shallowEqual(current.args, req.args)) await armAndEmit('updateStoryArgs', { storyId: req.storyId, updatedArgs });

  if (req.remount || meta.usesMount) await armAndEmit('forceRemount', { storyId: req.storyId });
  await settle(req.settle);                             // §5.5
  return { rootHandles: await findRoots(), portalHandles: await findPortals(), ... };
}
```

Notes and edge cases:

- **Why one update instead of `reset` then `update`.** `resetStoryArgs` followed by `updateStoryArgs` costs two renders. A single `updateStoryArgs` with `undefined` for keys we want back at their initial value does not, *but* a key whose initial value is defined must be **set to its initial value**, not to `undefined`. So build `updatedArgs` as `{...initialArgs, ...req.args}` plus `undefined` for keys that exist in neither. (verify the `deleteUndefined` semantics per version, S-07)
- **In-page values.** `Channel.emit` calls local listeners synchronously with the original object (`channels/main.ts:62-82`), and `ArgsStore.update` does **no validation**. So args can carry any value, including JSX built in the page. Marker objects from `__holotype.safe` are rehydrated in-page by `__holotype.rehydrate`:
  - `{$mapKey}` → `argTypes[k].mapping[key]`
  - `{$fromStory: storyId, arg}` → that story's `initialArgs[arg]`

  This is how SLOT and INSTANCE_SWAP probes swap real nodes ([04 §4](04-variant-model.md#classification)).
- **Play functions.** A rerender does **not** re-run `play`; a remount does.
  - If `meta.hasPlay`, the default is to capture only the story's initial state, after `played`, and not to vary args on that story. The planner marks such stories `playLocked`.
  - `parameters.holotype.play: 'rerun'` forces a `forceRemount` per variant.
- **React state leaks.** Uncontrolled inputs and open popovers can leak between variants. The planner sets `remount: true` when a component's `parameters.holotype.remount !== false` and it contains form controls or portals (detected on its first capture).
- **Timeouts.** Defaults:
  - `T.render = 15s`, which raises `SB_RENDER_TIMEOUT`.
  - After two consecutive timeouts on a page, call `reload()`.
  - After three reloads, mark the story failed (`SB_STORY_UNRENDERABLE`).
- **Errors.** Any error event rejects with `SbError{code: 'SB_STORY_ERROR' | 'SB_PLAY_ERROR' | 'SB_STORY_MISSING', message, stack}`. Storybook's error overlay (`body.sb-show-errordisplay`) is checked as a backstop.
- **Console capture.** Page `console.error` and `pageerror` events within a render window become `SB_CONSOLE_ERROR` (info). This helps explain blank renders.

### 5.4 URL-args fallback path

Used when the preview API is unavailable (an exotic or older build), or when `--no-channel` is passed:

- Format: `iframe.html?id=<id>&viewMode=story&args=k:v;k2:!true&globals=theme:dark`. Encode with our port of `buildArgsParam` (`core/src/router/utils.ts`).
- Safe-list (`preview-api/modules/preview-web/parseArgsParam.ts`):
  - keys must match `/^[a-zA-Z0-9 _-]*$/`;
  - string values must match the same pattern, or be a number, hex color or rgb/hsl color.
  - Specials: `!true`, `!false`, `!null`, `!undefined`, `!date(ISO)`, `!hex(..)`, `!rgba(..)`, `!hsla(..)`.
  - Nested values: `obj.a:1`, `arr[0]:x`.
- Further filtering: args without an argType are dropped (`store/args.ts:76`), and values outside `options` are dropped (`validateOptions`).
- **Before navigating, the planner validates every arg set against these rules.** Anything that cannot be encoded produces `SB_URL_ARG_UNENCODABLE` and that variant is skipped. Free text in TEXT probes is restricted to `[A-Za-z0-9 _-]`.
- One navigation per variant is about 5–10× slower than the channel. The UI shows a "slow mode" badge.

### 5.5 Settle protocol <a id="settle-protocol"></a>

The goal is a deterministic frame. Run in order:

1. **Storybook done event**, as in §5.2. With the D-24 user agent (`StorybookTestRunner`), Storybook does **not** wait for animations: in the `completing` phase it calls `pauseAnimations()` instead of `waitForAnimations` (`render/animation-utils.ts`, `StoryRender.ts:386-392`). `pauseAnimations()` injects `animation-direction: reverse; animation-play-state: paused; transition: none` until story cleanup. This covers CSS animations and transitions only.
2. **Animations.** The capture engine therefore finishes finite Web Animations (`document.getAnimations().forEach(a => a.effect?.getTiming().iterations !== Infinity && a.finish())`), then requires two rAF-stable frames ([05 §1](05-capture.md#orchestration)). JS-driven animation (framer-motion, react-spring) is caught by the rAF-stable check and the injected CSS belt. On every version, as a belt, the capture bundle injects:

   ```css
   *,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
   transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}
   ```

   It also sets `emulateMedia({reducedMotion:'reduce'})`. Infinite animations (spinners) are frozen at t=0 by `Animation.pause()` with `currentTime=0` on every `document.getAnimations()`. The frozen state is recorded as `CAP_ANIMATION_FROZEN` (info).
3. **Fonts.** `await document.fonts.ready`, then check `document.fonts` for `status==='error'` or faces still `loading`. A failure becomes `FONT_LOAD_FAILED` (warn) with the face's src URL.
4. **Images:**
   - `<img>`: force `loading="eager"` and `decoding="sync"` on the root subtree, then `await Promise.all(imgs.map(i => i.decode().catch(()=>{})))`.
   - **CSS backgrounds**: scan `background-image`/`mask-image`/`border-image-source`/`list-style-image` over the root subtree, preload each `url()` with `new Image()`, then decode.
   - `<picture>`/`srcset`: rely on `currentSrc` after decode.
   - Lazy loaders based on IntersectionObserver: the viewport is set to at least the root size plus 200px before settling (§6.4).
5. **Network idle.** No in-flight requests for 300ms (tracked via CDP `Network.requestWillBeSent`/`loadingFinished`), capped at 5s. A long-poll or WebSocket is excluded from the count.
6. **Two rAFs**, then a microtask flush.
7. **Custom delay**: `parameters.holotype.delay` (ms), or `chromatic.delay` as a compat fallback.
8. **Stability check (optional, on by default for the first capture of each component).** Hash `root.getBoundingClientRect()` plus `document.body.innerHTML.length` twice, 100ms apart. If they differ, repeat up to 3 times, otherwise raise `CAP_UNSTABLE_RENDER` (warn).

`?freeze=finished` (`setupStoryFreezer.ts`) strips scripts and kills timers, so it is **not** used in the warm loop. It is used only as the single-shot fallback when the warm loop fails twice.

---

## 6. Root element, decorators, portals, layout

### 6.1 Story root <a id="root"></a>

- **Always use `viewMode=story`**. Docs mode applies different decorators and inline rendering.
- The root container is `#storybook-root` (SB ≥7), falling back to `#root`. `parameters.holotype.rootSelector` overrides it; it is evaluated relative to the document, and it pierces open shadow roots via `>>>`-style segments (`host >>> inner`). No match → `SB_ROOT_NOT_FOUND` (error, story skipped).
- The `body` layout class comes from `parameters.layout` (`WebView.ts:31-136`): `sb-main-padded`, `sb-main-centered`, `sb-main-fullscreen`, `none` (11). **We force `layout: 'fullscreen'`** for capture: we inject `body{padding:0!important}` and `#storybook-root{display:block}` with no centering. Padding from the `padded` layout is decorator chrome, not component. If a story *requires* centering for its own geometry (rare), `parameters.holotype.keepLayout: true` disables the override.

### 6.2 Decorator unwrapping

Decorators often wrap the component in providers or padding divs. Starting from the root container, descend while **all** of these hold:

```ts
function isTransparentWrapper(el: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === 'contents') return true;
  const kids = [...el.children].filter(c => getComputedStyle(c).display !== 'none' && !isScriptLike(c));
  if (kids.length !== 1 || hasNonWhitespaceText(el)) return false;
  return !hasPaint(cs)                  // no bg/border/shadow/outline/filter/opacity<1/transform
      && !clips(cs)                     // overflow visible, no clip-path/mask
      && sameRect(el, kids[0], 0.5);    // same border box ±0.5px
}
```

- `parameters.holotype.unwrap: false` disables this; `unwrap: n` sets a max depth.
- When there are multiple root children (fragments), the capture root is a **virtual group**: their union rect, recorded as `rootMode: 'multi'` in the Capture IR.
- Known wrappers are always transparent even with a box. They are matched by id/class: `[data-theme]` provider divs with no paint, `#root-inner`, and `.docs-story` outside docs. Themed wrappers that *paint* a background are reported as `SB_DECORATOR_PAINTS` (info). The background is **not** included in the component, but it is recorded as the "canvas background" for the documentation frame ([09](09-plugin.md)).

### 6.3 Portals and overlays <a id="portals-and-overlays"></a>

1. **Before** the render, snapshot `document.body.children` (identity set) and the ids of top-layer elements (`:popover-open`, `dialog[open]`).
2. **After** settle, look for new body children outside `#storybook-root`, elements with `[data-radix-portal]`, `[data-floating-ui-portal]`, `.MuiPopover-root`, `.cdk-overlay-container`, `[data-headlessui-portal]` or `[role=dialog]`, and newly top-layer elements.
3. `parameters.holotype.portal`:
   - `true`: include the auto-detected portals;
   - a CSS selector string: include exactly those;
   - `false`: ignore them.

   **Default `'auto'`**: include portals only when the root itself has zero size (modal-only stories), or the story is tagged `figma-portal`. When `'auto'` finds several candidate portal roots, their union is used and `SB_PORTAL_AMBIGUOUS` (warn) is emitted; a selector string fixes it.
4. With portals included, the capture root becomes a virtual frame: the union of root and portal rects. Alternatively, with `portal.frame: 'viewport'`, it is the full viewport (useful for modals with backdrops). Backdrops (`position:fixed; inset:0`) are kept as the bottom layer.
5. Viewport sizing for overlays: default 1280×800 (D-24); `parameters.holotype.viewport` overrides it.

### 6.4 Viewport adequacy

After settle:

- If `root.scrollWidth > innerWidth` or `scrollHeight > innerHeight`, grow the viewport to the root extent plus 200px (capped at 4096) and re-settle (`CAP_VIEWPORT_GROWN`, info).
- If the root contains `position:fixed` descendants, the viewport is *not* grown (it would change their geometry), and `CAP_FIXED_IN_ROOT` (info) is emitted.

---

## 7. Component grouping and identity

### 7.1 Grouping

- **Default.** One component, and so one Figma component set, per **sid** (the story-id prefix before `--`). This equals the manifest `components[id]` on 10.1+.
- **Split.** When `parameters.holotype.component` names a different component, stories move to that group. This lets one CSF file feed several Figma components, and several files feed one.
- **Subcomponents.** Each `subcomponents` entry becomes a separate component only if it has its own stories. Otherwise it is only a nested-instance candidate ([09](09-plugin.md)).
- **Shared `component`.** Several titles sharing the same `component` reference (detected in-page by object identity, §10) are reported as `SB_COMPONENT_MULTI_TITLE` (info). They are *not* merged automatically, to avoid surprise; `component:` in config merges them.

### 7.2 Identity

```ts
interface ComponentIdentity {
  sid: string;
  displayName: string;        // chain below
  description?: string;       // chain below
  importPath: string; componentPath?: string; exportName?: string;
  framework: 'react'|'vue'|'angular'|'svelte'|'web-components'|'html'|'preact'|'solid'|string;
  tagName?: string;           // web components
  docgenSource?: string;      // meta.docgen
}
```

- **Display name**, first hit wins:
  1. `parameters.holotype.name`
  2. `component.displayName`
  3. `component.__docgenInfo.displayName`
  4. manifest `name`
  5. the custom element tag in PascalCase
  6. the last `titlePath` segment
- **Description**, first hit wins:
  1. manifest `description` (or `summary`)
  2. `__docgenInfo.description`
  3. `parameters.docs.description.component`

  The story-level `parameters.docs.description.story` attaches per variant (shown in the doc frame).
- **Figma placement.** `titlePath[0]` → Section (D-22). Deeper segments become a `/`-joined prefix of the component set name, e.g. `Forms/Inputs/TextField` → Section "Forms", set "Inputs/TextField". Figma's asset panel groups by `/`.
- **Rename detection inputs** (used by [10](10-sync.md)): `importPath + exportName` of the first story, `componentPath`, and the display name.

---

## 8. Globals, themes and modes discovery <a id="globals-themes-and-modes-discovery"></a><a id="themes"></a>

Sources, merged in this order:

1. **`@storybook/addon-themes`.**
   - Listen for `storybook/themes/REGISTER_THEMES {themes, defaultTheme}` during the first render. The decorator emits it on render (`addons/themes/src/constants.ts`, `decorators/helpers.ts`).
   - The global key is `theme`, and the parameter `themes.themeOverride` pins a theme per story.
2. **`globalTypes`** with `toolbar.items`. Every global whose items are enumerable is a candidate mode dimension. Name heuristics `theme|mode|scheme|brand|density|appearance` mark **mode dimensions**. Others, such as `locale` and `direction`, are axes only if configured.
3. **`parameters.chromatic.modes`.** Each mode is a set of globals plus `viewport`. Read it as a fallback source of named modes; `{disable:true}` removes an inherited mode. Docs: https://www.chromatic.com/docs/modes
4. **`parameters.backgrounds`.** Never a mode. It is only the doc-frame canvas color.

Output:

```ts
interface ModeDimension { global: string; values: { value: unknown; label: string }[];
  default: unknown; source: 'addon-themes'|'globalTypes'|'chromatic'|'config' }
```

How dimensions become variable modes or axes is decided in [04 §7](04-variant-model.md#themes) and [08](08-tokens.md).

To iterate a mode: `updateGlobals({globals:{theme:'dark'}})`, then wait for `globalsUpdated` and the done event (`Preview.tsx:316-347` re-renders all renders), then settle.

---

## 9. Access modes <a id="access"></a>

### 9.1 Static build (reference target)

- The CLI embeds a static server: `sirv` behind `node:http`, bound to `127.0.0.1:<ephemeral>`. `file://` is never used, because it breaks ES modules in Vite builds.
- Required files: `index.json`, `iframe.html`, assets. Optional: `project.json`, `manifests/`, `services/`.
- `storybookBuildHash = sha256(index.json + sorted list of hashed asset filenames referenced by iframe.html)`. This is a cache-key input ([05 §10](05-capture.md#determinism)).
- Static builds send no CSP or host checks and accept postMessage from any origin.

### 9.2 Dev server <a id="dev-server"></a>

- Since 8.6.19, 9.1.21 and 10.6.2+, the dev server sends `Content-Security-Policy: frame-ancestors 'self' http://localhost:* http://127.0.0.1:*`. This does not affect Playwright top-level navigation to `iframe.html`.
- Host validation (`core-server/utils/getHostValidationMiddleware.ts`): non-localhost hostnames must be in `core.allowedHosts`. A 403 or 400 with a host message gives `SB_HOST_NOT_ALLOWED`, with the fix-it text "add `<host>` to `core.allowedHosts` in .storybook/main".
- There is no build hash. The cache key uses `indexHash` plus the per-story module hash where available (`importPath` mtime is not visible). In practice, dev-server captures always re-render, and the apply cache ([10](10-sync.md)) prevents redundant Figma writes.
- HMR during a capture run: if a `storyIndexInvalidated` or HMR reload is detected mid-run, abort the current component with `SB_HMR_DURING_CAPTURE` and retry once.
- Branch mode ([15](15-change-requests.md)) captures from the dev server. `storybook.dev` (`url`, `command`, `autoStart`) tells the CLI where it runs and how to start it; schema and defaults in [16](16-config.md#storybook).

### 9.3 Chromatic

- Permalinks: `https://<branch>--<appid>.chromatic.com` and `https://<commit>--<appid>.chromatic.com`. Branch names are truncated at 37 characters (https://www.chromatic.com/docs/permalinks).
- They behave like a static build.
- **Private projects** require a signed-in collaborator. Use `holotype login <url>` (§9.4) to obtain `storageState`. No Storybook-asset API token is documented (verify, S-07).

### 9.4 Authenticated hosts

```ts
type AuthConfig =
  | { kind: 'basic'; username: string; password: string /* from env/keychain, never config literal */ }
  | { kind: 'headers'; headers: Record<string, string> }          // e.g. Cloudflare Access service token
  | { kind: 'storageState'; path: string }                        // cookies + localStorage
  | { kind: 'cookies'; cookies: PlaywrightCookie[] };
```

- They map to Playwright `httpCredentials`, `extraHTTPHeaders` (scoped by a route handler to the Storybook origin only, so headers never go to third-party CDNs) and `storageState`.
- **`holotype login <url>`** opens a *headed* Chromium on `<url>`. The user signs in (SSO, Chromatic, VPN web portal) and presses Enter in the terminal. The CLI saves `storageState` to `.holotype/auth/<host>.json` (mode 0600, gitignored by `holotype init`).
- Credentials **never** enter the Capture IR, Scene IR, bundle or logs (D-23; [13](13-security-legal.md)). The redaction list applies to logs.
- Auth failure: a 401 or 403 on `index.json` gives `SB_AUTH_FAILED`; a redirect to a login HTML page (content-type `text/html` on `index.json`) gives `SB_AUTH_REDIRECT`.

### 9.5 In-Figma path (addon-only)

Rendering inside the plugin iframe is rejected (D-10; [02](02-architecture.md#topologies)). The addon's `postMessage` capture (§11) exists only for future experiments and is disabled by default.

---

## 10. Framework enhancers <a id="framework-enhancers"></a>

Enhancers run in-page during serialization ([05 §3](05-capture.md#walk)) and annotate DOM elements with `{componentName, componentRef?, props?}`. They are **optional and best-effort** (G8). The CSS-level capture never depends on them. Their uses:

- naming ([07](07-mapping.md)),
- component boundaries for nested-instance detection (D-21, [09](09-plugin.md)),
- props for mapping a nested instance to the variant it should be.

Enhancers ship for **React first** (D-26). The other rows are designed now but stay best-effort and untested until the post-M5 renderer expansion gives them fixtures.

| Framework | How |
|---|---|
| React (16.8–19) | Find the key `__reactFiber$*` (or `__reactInternalInstance$*` in old versions) on the element. Walk `.return` to the nearest fiber whose `type` is a function, class, `memo` or `forwardRef` (unwrap `type.type`/`type.render`). Name = `displayName ?? name`. Props = `memoizedProps`, through `__holotype.safe`. A host element belongs to a component's *outermost* host node only if it is the first host descendant of that fiber |
| Vue 3 | `el.__vueParentComponent`, giving `.type.name ?? .type.__name`, `.props` and `.subTree.el` (the component root el) |
| Angular (dev builds) | `window.ng?.getComponent(el)` → constructor name; `ng.getHostElement`. Production builds lack `ng`, so these degrade to tag names (`app-button` → "Button") |
| Svelte 5 | No stable public runtime hook. Use `svelte-meta` dev attributes if present, else nothing (verify, S-13) |
| Web Components | `customElements.get(tag)` → class name. The custom-elements manifest (if `setCustomElementsManifest` was called; `window.__STORYBOOK_CUSTOM_ELEMENTS_MANIFEST__`) gives the declared name and attributes |
| Solid/Preact/Qwik | Preact: `el.__k`/`_vnode` (verify). Others: nothing |

**Mapping a boundary to a Storybook component.**

- During metadata extraction, build an in-page `WeakMap<componentRef, sid>` from every loaded story's `component` (and `subcomponents`). This needs `loadStory` on at least one story per component, which we already do.
- When the walker meets a fiber whose `type` (or Vue `type`, or custom-element constructor) is in the map, the DOM element is tagged `data-holotype-cmp=<sid>`, and its safe props are recorded.
- This is exact identity, not name matching. Name-only matches are reported as `confidence: 'name'`.

(verify per framework, S-13)

---

## 11. Optional Storybook addon (`@holotype/storybook-addon`) <a id="addon"></a><a id="optional-storybook-addon-holotypestorybook-addon"></a>

Phase: **hardening** ([14](14-roadmap.md#hardening)). It is not required: a zero-install capture uses `page.addInitScript` with the same serializer bundle. Installing it adds:

1. **Typed parameters.** CSF type augmentation for `parameters.holotype` (schema in [04 §9](04-variant-model.md#schema)), like `PseudoTypes` in `addons/pseudo-states/src/types.ts`.
2. **Build-time manifest.** Through `experimental_manifests` (`core-server/utils/manifests/manifests.ts:133-140`), it writes `manifests/holotype.json` at `storybook build`. The file holds the per-story `parameters.holotype`, resolved tags and component identities. This lets the CLI plan without loading every CSF in a browser, which speeds up `holotype list`.
3. **Preview hook.** Through `previewAnnotations` and `definePreviewAddon` (10+), a `beforeAll` registers a channel request/response pair `holotype/capture` → `holotype/captured`. This allows capture from inside the preview, for future in-Figma or MCP experiments. It is disabled unless `parameters.holotype.channelCapture` is set.
4. **Manager panel "Holotype".**
   - Shows the planned variants and properties for the current story (calling the planner on the args/argTypes the manager already has).
   - Shows last sync status, read from the registry's `status.json` ([02 §5.3](02-architecture.md)) if a registry is configured.
   - Provides "Copy capture command" (`npx holotype capture --story <id>`).
5. **Lint.** A preset hook warns at dev time about stories whose args cannot be encoded for the URL fallback, and about argTypes missing `options`.

Compatibility: addon versions track Storybook majors (10.x first, 11.x at its GA). The 8.x and 9.x presets are published best-effort from the same source, behind a capability shim (D-11).

---

## 12. Version and framework test matrix <a id="version-and-framework-test-matrix"></a><a id="matrix"></a>

Fixture Storybooks live under `fixtures/` ([12](12-quality.md#fixtures)). Until M5 they are all React + Vite (D-26). CI runs this matrix nightly; PRs run the starred cells.

**Timing (D-11).** Until M-Loop ([14](14-roadmap.md#m-loop)): SB 10.x react-vite only (the owner's repo and `fixtures/ds-react`). SB 8/9 smoke and SB 11 tracking start in hardening (H-G). The table below is the hardening target.

| SB \ renderer | React (Vite) | Other renderers (React Webpack, Vue 3, Angular, Lit/WC, Svelte, HTML) |
|---|---|---|
| 10.6 (primary) | ★ | post-M5 |
| 11.0 (beta → GA) | ● until GA, then ★ | post-M5 |
| 9.1 | ○ smoke | – |
| 8.6 | ○ smoke | – |

Legend: ★ PR gate; ● nightly, full; ○ nightly, smoke; – not run; post-M5: added by the renderer expansion, best-effort and untested until then. 7.x and older are not run (unsupported, D-11).

Per cell, these checks run:

- discovery
- metadata, including the docgen-service merge on 11
- channel render loop (args, globals, remount)
- URL fallback
- settle determinism: 3 captures, identical Capture IR hash
- portal story
- theme iteration
- addon manifest (10+)

Also run each cell against the **dev server** once per night (CSP and host validation).

---

## 13. Diagnostics coined here

| Code | Severity | Meaning |
|---|---|---|
| `SB_VERSION_UNSUPPORTED` | error | SB <8 (D-11) |
| `SB_VERSION_UNTESTED` | warn | newer major than the newest adapter |
| `SB_INDEX_UNREACHABLE` | error | neither `index.json` nor `stories.json` loads; fatal for the run |
| `SB_IFRAME_UNREACHABLE` | error | `iframe.html` not 200 |
| `SB_PREVIEW_INIT_TIMEOUT` | error | preview never became ready |
| `SB_ARG_UNKNOWN` | warn | configured arg has no argType; dropped |
| `SB_ROOT_NOT_FOUND` | error | root selector matched nothing |
| `SB_PORTAL_AMBIGUOUS` | warn | several candidate portal roots; union used |
| `SB_MANIFEST_UNPARSEABLE` | info | components manifest shape unknown |
| `SB_DOCGEN_DEGRADED` | warn | SB 11 dev server without docgen service; argTypes reduced |
| `SB_REF_AUTH_REQUIRED` | warn | composed ref needs login |
| `SB_STORY_LOAD_FAILED` | error | `loadStory` threw (CSF import error) |
| `SB_METADATA_TIMEOUT` | error | metadata batch hung |
| `SB_RENDER_TIMEOUT` | error | no done event within `T.render` |
| `SB_STORY_UNRENDERABLE` | error | repeated failure after reloads |
| `SB_STORY_ERROR` / `SB_PLAY_ERROR` / `SB_STORY_MISSING` | error | Storybook error events |
| `SB_CONSOLE_ERROR` | info | console errors during render |
| `SB_URL_ARG_UNENCODABLE` | warn | variant skipped in URL-fallback mode |
| `SB_DECORATOR_PAINTS` | info | decorator paints a background, excluded from component |
| `SB_COMPONENT_MULTI_TITLE` | info | same component under several titles |
| `SB_HOST_NOT_ALLOWED` | error | dev server host validation |
| `SB_HMR_DURING_CAPTURE` | warn | dev server reloaded mid-run |
| `SB_AUTH_FAILED` / `SB_AUTH_REDIRECT` | error | auth problems |
| `FONT_LOAD_FAILED` | warn | web font failed in browser (also used by [05](05-capture.md)) |
| `CAP_ANIMATION_FROZEN` | info | infinite animation frozen at t=0 |
| `CAP_UNSTABLE_RENDER` | warn | root geometry kept changing |
| `CAP_VIEWPORT_GROWN` / `CAP_FIXED_IN_ROOT` | info | viewport adjustments |
