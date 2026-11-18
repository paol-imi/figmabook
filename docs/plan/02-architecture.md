# 02 · System architecture

This chapter describes:
- how the pieces fit together;
- the deployment topologies;
- the CLI↔plugin protocol;
- the bundle, registry and cache layouts;
- the monorepo and the tech stack.

What crosses the wire is defined in [06](06-ir.md). The plugin internals are in [09](09-plugin.md).

---

## 1. Pipeline and data flow

```
 ┌───────────────┐   index.json, project.json,        ┌──────────────┐
 │  Storybook    │   manifests/components.json,       │  storybook   │  StorybookModel
 │ (static build │──────────────────────────────────► │   adapter    │──────────────┐
 │  or dev srv)  │   iframe.html + preview channel    └──────────────┘              │
 └───────────────┘◄──────────────────────────────────────────┐                     ▼
                                                             │             ┌──────────────┐
                                                             │             │   planner    │ VariantPlan
                                                             │             │ (matrix, arg │ (per sid)
                                                             │             │ classification│
                                                             │             └──────┬───────┘
                                                  render requests                │  experiments
                                                             │                   ▼  (classification renders)
                                                      ┌──────┴───────┐    ┌──────────────┐
                                                      │   capture    │◄───┤ job scheduler │
                                                      │ (pool, CDP,  │    └──────────────┘
                                                      │ serializer)  │ CaptureDoc per variant
                                                      └──────┬───────┘
                                                             ▼
                              cache  ◄────────────── content-addressed store (.figmabook/cache)
                                                             ▼
                                                      ┌──────────────┐  SceneComponent per sid
                                                      │    mapper    │  + tokens + diagnostics
                                                      │ (pure; uses  │
                                                      │  layout-sim) │
                                                      └──────┬───────┘
                                                             ▼
                                         ┌─────────────── bundle writer ───────────────┐
                                         │ dir / .figmabook.zip / registry / local srv │
                                         └──────────────────────┬──────────────────────┘
                                                                ▼
                                                       Figma plugin (09)
```

### 1.1 Stage contracts

| Stage | Input | Output | Pure? | Cached by |
|---|---|---|---|---|
| storybook adapter ([03](03-storybook.md)) | Storybook base URL or dir, auth | `StorybookModel` {index, components, argTypes, globals, docgen, version} | no (I/O) | `sbFingerprint` |
| planner ([04](04-variant-model.md)) | `StorybookModel`, resolved config | `VariantPlan` per `sid` (axes, properties, variant list, classification experiments) | yes, *except* classification, which requests renders | plan hash |
| capture ([05](05-capture.md)) | `RenderRequest` (storyId, args, globals, state, viewport, probes) | `CaptureDoc` (Capture IR) + assets | no | `captureKey` (§6.2) |
| mapper ([07](07-mapping.md), [08](08-tokens.md)) | all `CaptureDoc`s of a `sid` + `VariantPlan` + token catalog | `SceneComponent` (Scene IR) + `TokenSet` + diagnostics | **yes** | `mapKey` = H(mapper version, captureKeys, plan hash, config subset) |
| bundle writer | Scene IR set | bundle (dir/zip/stream) | yes | — |
| plugin ([09](09-plugin.md), [10](10-sync.md)) | bundle stream | Figma document mutations + `ApplyReport` | no | `irh`/`ah` in plugin data |

### 1.2 Invariants
1. **Mapper purity (D-08).** The same inputs and mapper version give byte-identical Scene IR. The mapper reads no clock, environment or random source. All ids derive from hashes.
2. **Capture never decides Figma structure.** It records facts. Re-running the mapper on cached Capture IR re-infers without a browser. This is how inference upgrades ship cheaply.
3. **The plugin never infers CSS (D-09).** It reconciles, verifies and falls back using data in the Scene IR.
4. **Per-component isolation.** A failure in one `sid` (`CAP_*`, `LAYOUT_*` errors) yields a bundle entry with `status:"failed"` plus diagnostics, never a failed run. The CLI exit code reflects the configured `--fail-on` severity ([11](11-ux.md)).

### 1.3 Job model (CLI)

```ts
type JobId = string;            // ulid
interface RunContext { runId: string; config: ResolvedConfig; sb: StorybookModel; cache: Cache; log: Logger; signal: AbortSignal }
interface CaptureJob { id: JobId; sid: string; vk: string; request: RenderRequest; priority: number; attempts: number }
```

- **Scheduling:**
  - Jobs are grouped by `storyId`, so one page serves many arg sets through the channel loop ([03](03-storybook.md)).
  - Pages are distributed over a `BrowserContext` pool of size `min(cpus, 8)` (configurable).
  - Priority: (a) components the user selected in the plugin, (b) classification experiments, because they gate the plan, (c) the rest.
- **Retries:**
  - 2 attempts on `CAP_RENDER_TIMEOUT` / `SB_STORY_ERRORED`.
  - The second attempt uses a fresh page navigation (`goto`) instead of the channel loop.
- **Cancellation:**
  - A single `AbortController` per run, and one per component subtree.
  - Cancelling a component drains its queued jobs. In-flight pages finish their current render and are returned to the pool.

---

## 2. Topologies <a id="topologies"></a>

| | Topology | Phase | Who renders | How the plugin gets data | Network needs in manifest |
|---|---|---|---|---|---|
| **A** | Local CLI server: `figmabook serve` | MVP (P3) | user's machine | HTTP + WS on loopback | `http://127.0.0.1:47321`–`47323`, `ws://` same (D-25) |
| **B** | Bundle-file import | MVP (P1) | user's machine or CI | File API in UI (drag and drop / picker) | none |
| **D** | CI + registry: GitHub Action | P7 | CI runner | HTTPS GET from registry | registry domain(s) |
| **C** | Hosted renderer | P8+ | our sandboxed workers | HTTPS from our API | `https://api.<brand>.dev` |
| **E** | Render inside plugin iframe | **rejected** | — | — | — |

### 2.1 (A) Local CLI server
- Binds to `127.0.0.1` only (never `0.0.0.0`, never `::`). Port list `47321, 47322, 47323` (D-25). It takes the first free one and prints it.
- Hardening (pairing token, Host check, CORS, rate limits) is in [13](13-security-legal.md#local-server).
- **Best for:** iterative work against a dev server, and private or SSO Storybooks. The CLI reuses the user's `storageState` ([03](03-storybook.md#access)).
- **Weak points:**
  - Chrome Local Network Access (§3).
  - Corporate endpoint software sometimes blocks loopback listeners.
  - The user must keep a terminal open.

### 2.2 (B) Bundle-file import
- `figmabook export` writes `./figmabook-out/<runId>/` and `<runId>.figmabook.zip` (§5).
- In the plugin UI, the user drops the zip or a directory (`webkitdirectory`). The UI unzips in a Web Worker with `fflate` and streams components to main (§4.4).
- Always available. It is the fallback for every topology failure. It needs zero network, so it suits air-gapped and enterprise users.

### 2.3 (D) CI + registry
- The Action runs `build-storybook`, then `figmabook export --static storybook-static`, then publishes the bundle to a **registry** (§5.3).
- In the plugin, "Connect registry" takes a URL and a token. A public registry needs no token. A private one uses a bearer token stored in `clientStorage`. CORS needs `ACAO: *` plus `Access-Control-Allow-Headers: authorization`.
- **Hosts (decision for P7):**
  - Our first-party registry domain (e.g. `registry.<brand>.dev`). It acts as a proxy for S3/GCS/GitHub Releases, so we don't need `"*"` in the manifest.
  - `https://*.github.io` for GitHub Pages registries. Pages sends `ACAO: *` (verify, S-01).
  - We do not list `raw.githubusercontent.com` unless S-01 confirms its CORS behaviour, and we never list `"*"`. A wildcard shows the "unrestricted" label and causes review friction ([network-access label](https://help.figma.com/hc/en-us/articles/360039958914)).
- The Action posts a PR comment and annotations: diagnostics summary, fidelity deltas, and changed components ([11](11-ux.md)).

### 2.4 (C) Hosted renderer (later)
- API → queue (Postgres + pg-boss) → ephemeral sandboxed workers running the same `capture` + `mapper` → object storage with signed URLs → the plugin pulls over HTTPS.
- Scope: public Storybooks and public Chromatic permalinks. Private ones take per-job secrets.
- Security design is in [13](13-security-legal.md#hosted). Monetisation is in [13](13-security-legal.md#business).

### 2.5 (E) In-iframe rendering: rejected
The plugin UI iframe has a `null` origin ([network requests](https://developers.figma.com/docs/plugins/making-network-requests/)). That rules this out:
1. A framed Storybook is cross-origin, so its DOM is unreadable.
2. Dev servers send `frame-ancestors` CSP (8.6.19+, 9.1.21+, 10.6.2+), and 11 blocks remote embedding.
3. Third-party cookies are blocked, which breaks SSO and Chromatic auth.
4. Fetching and inlining into `srcdoc` would need every host in `allowedDomains`, plus CORS for module scripts and fonts.
5. The viewport and DPR would be bound to the plugin window.

The only workable variant needs our addon *installed in the target Storybook*, posting serialized DOM to `window.parent`. That is a niche path we don't build in v1. The addon keeps the hook ([03](03-storybook.md#addon)).

---

## 3. Chrome Local Network Access (LNA) <a id="lna"></a>

**Facts:**
- Since Chrome 142, a public origin requesting loopback or private IPs needs a user permission ([Chrome LNA](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)). Chrome 145 renamed it "Apps on device".
- A cross-origin iframe gets the permission only if the embedder delegates it with `allow="local-network; loopback-network"`. Figma controls the plugin iframe ([Figma LNA help](https://help.figma.com/hc/en-us/articles/34458998159511-Local-network-access-in-Figma), [forum](https://forum.figma.com/ask-the-community-7/chrome-local-network-access-policy-will-make-plugins-published-within-the-organization-unavailable-46262)).
- There is precedent for a published plugin using localhost: Cursor Talk to Figma declares `ws://localhost:3055` ([manifest](https://github.com/grab/cursor-talk-to-figma-mcp)).

**What we assume until S-01 answers:**

| Client | Expected loopback behaviour | Status |
|---|---|---|
| Figma desktop (Electron) | Works; no LNA prompt | verify, S-01 |
| Figma in Chrome ≥145 | Works only if Figma delegates the permission *and* the user allows "Apps on device"; otherwise blocked | verify, S-01 |
| Figma in Safari / Firefox | Unknown; treat as possibly blocked | verify, S-01 |
| Edge/Arc/Brave (Chromium) | Same as Chrome | verify, S-01 |

**UX consequences** (screens are in [11](11-ux.md)):
1. The desktop app is the documented primary client for topology A.
2. Connection probe sequence:
   1. `fetch GET /v1/health` with a 1.5 s timeout.
   2. Classify the error:
      - `TypeError` + CSP message → `NET_DOMAIN_NOT_ALLOWED` (a manifest bug, so it's ours);
      - opaque network error in a browser client → `NET_LOOPBACK_BLOCKED`;
      - connection refused or timeout in desktop → `NET_SERVER_UNREACHABLE`.
   3. Show the specific remedy:
      - "start `figmabook serve`";
      - "allow Apps on device";
      - "use the desktop app";
      - **"import a bundle file instead"**. This is always shown as a one-click alternative.
3. WebSocket and HTTP are probed separately. If WS fails but HTTP works (some proxies), fall back to **HTTP long-poll** (`GET /v1/events?after=<seq>`).

---

## 4. Protocols <a id="protocol"></a>

### 4.1 CLI local server: HTTP API (`/v1`)

Every response carries `Access-Control-Allow-Origin: *` and `Vary: Origin`.

**Preflight:**
- `OPTIONS` answers `Access-Control-Allow-Methods: GET,POST,DELETE`.
- It also sends `Access-Control-Allow-Headers: authorization,content-type,x-figmabook-client`.
- It sends `Access-Control-Allow-Private-Network: true` (the legacy PNA preflight) and `Access-Control-Max-Age: 600`.

**Authentication:** every route except `/v1/health` and `/v1/pair/*` requires `Authorization: Bearer <sessionToken>`.

| Method | Path | Purpose | Body / query | Response |
|---|---|---|---|---|
| GET | `/v1/health` | liveness, no auth | — | `{ ok:true, server:"figmabook", version, protocol:[1] }` |
| POST | `/v1/pair/start` | begin pairing | `{ clientName, clientNonce }` | `{ pairingId, expiresAt }`. The CLI prints a 6-digit code |
| POST | `/v1/pair/confirm` | finish pairing | `{ pairingId, code, clientNonce }` | `{ sessionToken, expiresAt }` |
| GET | `/v1/session` | capabilities | — | `Hello` (§4.3) |
| GET | `/v1/storybook` | Storybook model summary | — | `{ sbVersion, framework, components: ComponentSummary[] }` |
| GET | `/v1/components/:sid/plan` | variant plan preview | `?config=` overrides | `VariantPlanSummary` |
| POST | `/v1/runs` | start capture+map | `RunRequest` | `{ runId }` (202) |
| GET | `/v1/runs/:runId` | run status | — | `RunStatus` |
| DELETE | `/v1/runs/:runId` | cancel run | — | 204 |
| DELETE | `/v1/runs/:runId/components/:sid` | cancel one component | — | 204 |
| GET | `/v1/runs/:runId/components/:sid` | full Scene IR (gzip) | `?chunk=<n>` | `SceneComponent` or chunk |
| GET | `/v1/assets/:sha256` | asset bytes | — | bytes; `Cache-Control: immutable` |
| POST | `/v1/assets/have` | dedupe | `{ hashes[] }` | `{ missing[] }` (the plugin's known `imageHash` map is consulted first) |
| GET | `/v1/events` | long-poll fallback | `?after=<seq>&wait=25` | `ServerEvent[]` |
| WS | `/v1/ws` | event stream | subprotocol `figmabook.v1` + token as first message | `ServerEvent` / `ClientMessage` |
| POST | `/v1/fidelity` | upload Figma exports for scoring | multipart: `{runId, vk}` + PNG | `FidelityResult` |
| POST | `/v1/apply-report` | plugin reports results back (node ids, read-back deltas, Figma component keys) | `ApplyReport` | 204. Feeds Code Connect (P7) and the CLI report |

### 4.2 Pairing handshake

```
Plugin UI                               CLI server                       Terminal
   │ GET /v1/health ──────────────────────►│                                 │
   │◄───────────── {ok, version, protocol} │                                 │
   │ POST /v1/pair/start {clientNonce} ───►│── prints "Pairing code 482 913" ►│
   │  (UI shows code entry field)          │   (valid 120 s, 5 attempts)     │
   │ POST /v1/pair/confirm {code} ────────►│ constant-time compare           │
   │◄────── {sessionToken (256-bit), exp}  │ token bound to clientNonce      │
   │ clientStorage.set('fb.session.<port>')│                                 │
   │ GET /v1/session (Bearer) ────────────►│                                 │
   │◄──────────────────────────── Hello    │                                 │
```

- **Session lifetime:** 30-day sliding window. `figmabook serve --revoke` invalidates all sessions. The token file lives at `~/.figmabook/sessions.json` with mode 0600.
- **Brute force:** 5 failed confirms lock pairing for 60 s ([13](13-security-legal.md#local-server)).
- **No-code mode:** `figmabook serve --pair-url` prints a one-time URL, `http://127.0.0.1:47321/v1/pair/auto?t=<one-time>`. The user pastes it into the plugin to skip typing the code. This is useful for screen readers and remote desktops.

### 4.3 Version and capability negotiation

```ts
interface Hello {
  server: { name: "figmabook"; version: string /* semver */ };
  protocol: number[];                   // supported protocol majors, e.g. [1]
  ir: { scene: string[]; capture: string[] };   // supported IR semver ranges, e.g. ["^1.0.0"]
  capabilities: Capability[];
  storybook?: { url: string; version: string; framework: string; builder: "vite"|"webpack"|"rsbuild"|"unknown" };
}
type Capability =
  | "runs" | "cancel" | "resume" | "fidelity" | "apply-report"
  | "events-ws" | "events-longpoll" | "assets-dedupe" | "plan-preview";
```

- The plugin sends `x-figmabook-client: plugin/<version>; protocol=1; scene=^1.0.0`.
- **Mismatch rules:**
  - No common protocol major gives `NET_PROTOCOL_MISMATCH`, with an "update CLI" or "update plugin" hint depending on which side is older.
  - Scene IR major mismatch: the plugin carries migrations for the previous major ([06](06-ir.md#versioning)). Otherwise `APPLY_IR_UNSUPPORTED`.
  - Unknown capabilities are ignored, and a missing capability greys out its feature in the UI.

### 4.4 Event stream and message types

```ts
// server → client
type ServerEvent = { seq: number; runId?: string } & (
  | { type: "run.started"; plan: { components: { sid: string; variants: number }[] } }
  | { type: "component.progress"; sid: string; phase: "plan"|"classify"|"capture"|"map"; done: number; total: number }
  | { type: "component.ready"; sid: string; sceneHash: string; bytes: number; chunks: number; assets: string[] }
  | { type: "component.failed"; sid: string; diagnostics: Diagnostic[] }
  | { type: "run.finished"; summary: RunSummary }
  | { type: "run.cancelled" }
  | { type: "log"; level: "debug"|"info"|"warn"|"error"; msg: string }
  | { type: "storybook.changed"; sbFingerprint: string; changedSids: string[] }   // dev-server HMR / rebuild
);
// client → server (over WS; HTTP equivalents exist)
type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "ack"; seq: number }                         // enables resume
  | { type: "subscribe"; runId: string; fromSeq?: number }
  | { type: "cancel"; runId: string; sid?: string };

interface RunRequest {
  components: string[] | "all";
  configOverrides?: Partial<UserConfig>;          // only whitelisted keys (variants/states/themes/viewport)
  baseline?: Record<string, string>;              // sid -> sceneHash already applied in this file → server may skip
  priority?: string[];                            // sids to do first
}
```

**Streaming:**
- The plugin fetches each component when `component.ready` arrives, in chunks of ≤1 MB (`?chunk=n`).
- The main thread gets one component at a time over `postMessage` ([09](09-plugin.md)). Assets are fetched lazily by hash, deduped against `figma.root` shared plugin data `imageMap` (`sha256 → imageHash`).

**Resume:**
- Events are kept in a ring buffer (10,000 entries, or for the run's lifetime). Each run has an append-only event log at `.figmabook/runs/<runId>/events.ndjson`.
- On reconnect the client sends `subscribe {fromSeq}`, and the server replays from there. If `fromSeq` was evicted, the server sends a `run.snapshot` with the current state of every component.
- Runs persist on disk, so a restarted CLI can serve finished runs (`GET /v1/runs/:runId` works after a restart).

**Skip:** if `baseline[sid] === sceneHash`, the server marks the component `unchanged`, and the plugin does no work. This backs the zero-writes no-op target (README §4).

### 4.5 Plugin main ↔ UI protocol (overview)
The full message set is in [09](09-plugin.md).

```ts
type UiToMain =
  | { t: "index.request" }                                        // read identity index of current file
  | { t: "plan.compute"; component: SceneComponentChunked }      // read-only apply plan
  | { t: "apply.begin"; applyId: string; policy: ConflictPolicies }
  | { t: "apply.component"; applyId: string; chunk: SceneChunk }   // streamed, ≤1 MB
  | { t: "asset.bytes"; sha256: string; bytes: Uint8Array }
  | { t: "apply.cancel"; applyId: string }
  | { t: "fidelity.export"; vks: string[]; scale: 2 };
type MainToUi =
  | { t: "index.result"; managed: ManagedIndexSummary }
  | { t: "plan.result"; plan: ApplyPlanSummary }
  | { t: "asset.need"; sha256: string[] }
  | { t: "apply.progress"; applyId: string; sid: string; done: number; total: number }
  | { t: "apply.done"; applyId: string; report: ApplyReport }
  | { t: "fidelity.png"; vk: string; bytes: Uint8Array }
  | { t: "error"; diagnostic: Diagnostic };
```

- **All network I/O stays in the UI iframe.** Main-thread `fetch` is limited (it only offers `text()`, `json()` and `arrayBuffer()`) ([global fetch](https://developers.figma.com/docs/plugins/api/properties/global-fetch/)).
- **Main applies with time-slicing** (12–16 ms slices). It sends `apply.progress` after each variant and checks for cancellation between variants.

---

## 5. On-disk formats

### 5.1 Bundle (directory form)

```
figmabook-out/<runId>/
  manifest.json                 # BundleManifest (06)
  components/
    components-button.json      # SceneComponent (one sid per file; gzip optional: .json.gz)
    components-card.json
  assets/
    3f/3fa1…c9.png              # sha256-addressed, 2-char fan-out; PNG/JPEG/GIF only (rasterized at capture)
    a9/a9e0…11.svg              # normalized SVG text (styles inlined)
  tokens.json                   # TokenSet (08)
  report.json                   # RunReport: diagnostics, fidelity (if computed), timings
  report.html                   # human report (11)
  capture/                      # OPTIONAL (--include-capture): CaptureDoc per vk, for debugging / re-mapping
```

```ts
interface BundleManifest {
  $schema: "https://<brand>.dev/schema/bundle/v1.json";
  bundleVersion: "1.0.0";
  runId: string; createdAt: string;            // createdAt excluded from hashes
  generator: { name: "figmabook"; version: string; chromium: string; playwright: string; mapper: string };
  storybook: { url?: string; version: string; framework: string; sbFingerprint: string };
  irVersions: { scene: string; capture?: string };
  components: { sid: string; title: string; file: string; sceneHash: string; status: "ok"|"partial"|"failed"; variants: number }[];
  assets: { sha256: string; mime: string; bytes: number; width?: number; height?: number }[];
  tokens?: { file: "tokens.json"; hash: string };
  integrity: { algo: "sha256"; files: Record<string, string> };   // path -> sha256
}
```

- **Zip form:** `<runId>.figmabook.zip` holds the same tree.
  - Stored with `STORE` for assets that are already compressed, and `DEFLATE` for JSON.
  - `manifest.json` is written **first**, so streaming readers can plan early.
- **Size guardrail:** a warning at 200 MB (`PLAN_BUNDLE_LARGE`). Above that, the plugin streams entries from the zip without materialising the whole archive (fflate streaming unzip).
- **Integrity:** the plugin verifies sha256 of each file against `integrity` before applying. A mismatch gives `APPLY_BUNDLE_CORRUPT` and the file is rejected.

### 5.2 Determinism
- Canonical JSON throughout ([06](06-ir.md#hashing)): sorted keys, no insignificant whitespace, numbers rounded to 1/1000 px.
- The same Storybook build, config and tool versions give identical `sceneHash` values. CI uses this to detect "no design change" and skip publishing.

### 5.3 Registry layout (topology D)

```
<registry-root>/<project>/
  latest.json                   # { runId, createdAt, git: {sha, ref}, manifestUrl, sbFingerprint }
  channels/<branch>.json        # same shape; e.g. channels/main.json, channels/feature-x.json
  runs/<runId>/                 # immutable bundle directory (5.1), or <runId>.figmabook.zip
  index.json                    # last 50 runs: [{ runId, createdAt, git, changedSids }]
```

- Runs are **immutable**: `Cache-Control: public, max-age=31536000, immutable`. Pointers (`latest.json`, `channels/*`) use `max-age=60`.
- **CORS:** `Access-Control-Allow-Origin: *`. For private registries, also `Access-Control-Allow-Headers: authorization`.
- **Publishing:** `figmabook publish --to <url|s3://|gh-pages>` is an uploader with pluggable backends. The Action defaults to a `gh-pages` branch or an artifact plus our proxy.
- **Plugin behaviour:**
  - Polls the channel pointer when opened and on demand.
  - Shows "Outdated (N components changed)" by comparing `sceneHash` with the file registry.

### 5.4 Local workspace `.figmabook/` (gitignored by `figmabook init`)

```
.figmabook/
  cache/
    capture/<captureKey[0:2]>/<captureKey>.json.gz    # CaptureDoc
    assets/<sha[0:2]>/<sha>                           # raw fetched/rasterized assets
    map/<mapKey>.json.gz                              # SceneComponent
    meta/sb-<sbFingerprint>.json                      # StorybookModel snapshot
  runs/<runId>/events.ndjson | status.json | bundle → ../../figmabook-out/<runId>
  auth/storageState.json        # 0600; Playwright storage state for private Storybooks (13)
  auth/headers.json             # 0600; extra headers; never copied into bundles
  logs/<date>.ndjson
```

#### Cache keys
```
sbFingerprint = H( index.json bytes ∥ sorted hashed-asset names in iframe.html ∥ project.json )
                 // dev server: H(index.json ∥ server start time) — capture cache disabled by default in dev
captureKey    = H( captureEngineVersion ∥ captureIR major ∥ chromiumVersion ∥ sbFingerprint
                   ∥ storyId ∥ canonical(args) ∥ canonical(globals) ∥ state ∥ viewport ∥ dpr ∥ probes ∥ captureConfigSubset )
mapKey        = H( mapperVersion ∥ sceneIR major ∥ sorted(captureKeys) ∥ planHash ∥ mapperConfigSubset ∥ tokenCatalogHash )
```

- `H` is sha256 truncated to 32 hex characters.
- **Eviction:** LRU, capped at 2 GB (configurable). Clear with `figmabook cache prune|clear`.
- **Remote cache:** the same keys over HTTP (`--remote-cache <url>`, Turbo-style PUT/GET) for CI.

---

## 6. Monorepo <a id="monorepo"></a>

```
figmabook/
  packages/
    ir/                 # TypeBox schemas: capture.ts, scene.ts, bundle.ts, tokens.ts, diagnostics.ts; migrations/; canonical.ts; hash.ts
    shared/             # Diagnostic codes registry, Result<T,E>, logger interface, small utils (no deps)
    layout-sim/         # Figma auto-layout + grid model: simulate(spec, children) → rects; text line model hooks
    storybook/          # adapter: discover(), loadMeta(), docgen merge, globals/themes, render-loop driver (page side + node side)
    capture/            # browser pool, CDP session helpers, serializer (src/page/* → built IIFE string), stabilizer, probes, states
    planner/            # matrix builder, budgets, pairwise, classification experiments, config resolution per sid
    mapper/             # layout inference, sizing, text, paints, effects, borders, simplification, naming, alignment, token binding
    plugin/             # src/main/* (reconciler, applier, figma-port.ts, identity, verify), src/ui/* (Preact), manifest via package.json
    figma-fake/         # FigmaPort in-memory implementation + snapshot serializer; uses layout-sim for geometry
    cli/                # bin/figmabook; commands/*; server/* (Hono + ws); bundle/* (writer, zip, publish backends); config/*
    storybook-addon/    # preset.ts, preview.ts (beforeAll hooks), manager.tsx (panel), types.ts (parameters.figmabook typing)
    action/             # action.yml + dist (ncc bundle of cli entry)
  tools/
    fidelity/           # scoring: pixelmatch, ssim.js, box-delta; HTML dashboard; ratchet thresholds
    harness/            # nightly real-Figma runner orchestration (S-11 / macOS desktop)
  fixtures/
    react-sb/  vue-sb/  lit-sb/  # golden libraries (12), each a Storybook project built in CI
  docs/                 # plan/, research/, later the docs site source
```

### 6.1 Package responsibilities and public API

| Package | Public API (entry exports) | Must not depend on |
|---|---|---|
| `ir` | `CaptureDoc`, `SceneComponent`, `BundleManifest`, `TokenSet` types + TypeBox schemas; `validate*()`; `migrateScene()`; `canonicalJSON()`; `hash()` | anything but `@sinclair/typebox` |
| `shared` | `Diagnostic`, `DiagCode` registry, `defineDiagnostic()`, `Result`, `Logger` (interface only) | anything |
| `layout-sim` | `simulateAutoLayout(spec, children)`, `simulateGrid(spec, children)`, `measureHug()` | Node APIs, DOM, `figma` |
| `storybook` | `connectStorybook(opts) → StorybookSource`, `StorybookModel`, `RenderDriver` | `mapper`, `plugin` |
| `capture` | `createCapturer(opts) → Capturer` with `capture(req): Promise<CaptureDoc>`, `close()`; `serializerSource` (string) | `mapper`, `plugin` |
| `planner` | `planComponent(model, sid, config, classify: ClassifyFn) → VariantPlan` | `capture` (receives `ClassifyFn` by injection), `plugin` |
| `mapper` | `mapComponent(input: MapInput) → SceneComponent`, `mapTokens()`, `MapperOptions` | **Node built-ins, DOM, `figma`, Playwright** |
| `plugin` | none (an application); internal `FigmaPort` interface exported for `figma-fake` | Node built-ins; may bundle only `ir`, `shared`, `layout-sim` (+ Preact in UI) |
| `figma-fake` | `createFakeFigma() → FigmaPort & { snapshot(): FakeTree }` | `plugin` runtime code (only the `FigmaPort` type) |
| `cli` | `figmabook` binary; programmatic `run(config)`, `serve(opts)`, `exportBundle()` | `plugin` |
| `storybook-addon` | preset (`previewAnnotations`, `experimental_manifests`), `FigmabookParameters` type | `cli`, `capture` (the serializer is consumed as a built string) |

### 6.2 Dependency rules
These are enforced with `dependency-cruiser` in CI.

| Package | May import |
|---|---|
| `shared` | — |
| `ir` | `shared` |
| `layout-sim` | `ir`, `shared` |
| `mapper` | `layout-sim`, `ir`, `shared` |
| `storybook` | `ir`, `shared` |
| `capture` | `storybook` (page-side driver), `ir`, `shared` |
| `planner` | `storybook` (types), `ir`, `shared` |
| `plugin` | `layout-sim`, `ir`, `shared` (nothing else is bundled) |
| `figma-fake` | `layout-sim`, `ir`, `shared`, `plugin` (type-only `FigmaPort`) |
| `cli` | everything except `plugin` and `figma-fake` |
| `storybook-addon` | `ir` (types), `shared`, the built serializer string from `capture` |

- **Leaf order:** `shared` → `ir` → `layout-sim`. `shared` has no dependencies. `ir` imports `shared` for diagnostic types.
- **Browser-safe set:** `mapper`, `layout-sim`, `ir` and `shared` must be **isomorphic**. They pass:
  - an ESLint/Biome restricted-imports rule (no `node:*`, `fs`, `path`, `process`, `Buffer`);
  - a CI build that bundles them for the `es2022` browser target.
- **Hashing must be pure JS.** Figma's main thread has no WebCrypto (verify, S-06), so `ir/hash.ts` ships a pure-JS sha256 (`@noble/hashes`), used on every side.
- **Plugin bundle budget:**
  - main ≤ 400 KB minified;
  - UI ≤ 600 KB (Preact, fflate, UI kit).
- **The serializer** (`capture/src/page/**`) runs in the page:
  - It cannot import anything outside its folder, plus `ir` *types*.
  - It is built as one IIFE string by esbuild and injected with `page.addInitScript` / `evaluate`.
  - The storybook-addon reuses the same string (D-08, [05](05-capture.md)).

### 6.3 Tech stack

| Concern | Choice | Version policy | Rationale |
|---|---|---|---|
| Language | TypeScript strict, ESM | 5.9.x; evaluate the TS 7 native compiler for type-check speed only | D-03; SB 11 docgen also wants TS ≥5.9 |
| Runtime | Node | engines `>=20.19`, CI matrix 20/22/24, develop on 24 LTS | D-03 |
| Package manager | pnpm | 10.x, `packageManager` field pinned | Workspaces, strict hoisting |
| Task runner | Turborepo | 2.x | Caching; same model as Tokens Studio ([repo](https://github.com/tokens-studio/figma-plugin)) |
| Versioning | changesets | — | Independent package versions, changelogs |
| Schemas | `@sinclair/typebox` | pinned minor | D-07: JSON Schema native, small in the sandbox |
| Browser automation | `playwright-core` + pinned Chromium | exact pin; bumped deliberately in its own PR with a fidelity ratchet run | D-05; the Chromium version is in `captureKey` |
| Plugin toolkit | `create-figma-plugin` (`@create-figma-plugin/build`, `/ui`, `/utilities`) | pinned | D-06: esbuild, Preact, Figma-like UI kit ([docs](https://yuanqing.github.io/create-figma-plugin/)) |
| Figma typings | `@figma/plugin-typings` | **1.142.0** pinned; upgrades reviewed against changelog | Grid, slots, variable fonts, `sourceColor` |
| HTTP server | Hono (+ `@hono/node-server`) + `ws` | — | Small, typed, Web-standard Request/Response |
| Config loading | `c12` (uses `jiti`) | — | `figmabook.config.{ts,mjs,json}`, env overlays, `defineConfig()` |
| CLI framework | `citty` | — | unjs family, consistent with c12 |
| Zip | `fflate` | — | Browser and Node, streaming |
| Hashing | `@noble/hashes` (sha256) | — | Pure JS, isomorphic |
| Color | `colorjs.io` | — | Gamut mapping oklch/P3 → sRGB ([07](07-mapping.md)) |
| Fonts (icon fonts, metrics) | `fontkit` (+ `harfbuzzjs` when shaping is needed) | — | Glyph outlines, ligatures (S-09) |
| Image ops | `sharp` (CLI only) | — | Rasterize WebP/AVIF/SVG-as-img to PNG, downscale to ≤4096 |
| Image diff | `pixelmatch`, `ssim.js`, `pngjs` | — | Fidelity ([12](12-quality.md)) |
| Tests | Vitest (unit, snapshot), Playwright test (capture e2e) | — | D-04 |
| Lint/format | Biome + `dependency-cruiser` | — | D-04 + boundary rules |
| Node bundling | tsup | — | D-04 |
| Action bundling | `@vercel/ncc` | — | Single-file action |
| Logging | own `Logger` interface; CLI impl writes NDJSON + pretty TTY (`consola`) | — | §8 |

### 6.4 Build and release

**CI (GitHub Actions)**, on every PR:
1. `pnpm i --frozen-lockfile`.
2. `turbo run lint typecheck test build`.
3. dependency-cruiser.
4. Fixture Storybooks built and captured, with Capture IR and Scene IR snapshot diffs.
5. Plugin bundle size check.

Nightly: the real-Figma fidelity harness ([12](12-quality.md)).

**npm release:**
- changesets opens a release PR. On merge, publish with `npm publish --provenance` (OIDC trusted publishing) ([13](13-security-legal.md#supply-chain)).

**Plugin release:**
1. `pnpm --filter plugin build` produces `manifest.json`, `build/main.js` and `build/ui.js`, then a reproducible zip with fixed mtimes.
2. Upload the artifact.
3. A manual Figma publish step (there is no publish API).
4. Tag `plugin@x.y.z`.

The manifest `id` is fixed forever, because `clientStorage` and plugin data are keyed by it.

**Playwright/Chromium pinning:**
- `capture` declares an exact `playwright-core` version. `figmabook doctor` checks the browser and installs it with `figmabook install-browser` (wrapping `playwright install chromium`).
- In environments with a preinstalled browser, `--chromium-path` is allowed, with a `CAP_CHROMIUM_MISMATCH` warning when the version differs from the pin, because fidelity is not guaranteed.

**Compatibility promise:**
- The plugin accepts Scene IR of the current and previous major.
- The CLI refuses to publish a bundle the current Community plugin can't read: `figmabook export --check-plugin-compat`.

### 6.5 Compatibility matrix (targets)

| | SB 7.6 | SB 8.x | SB 9.x | SB 10.x | SB 11.x |
|---|---|---|---|---|---|
| Support level (D-11) | best-effort | ✅ | ✅ | ✅ | ✅ by GA |
| Discovery | `index.json` v4 / `stories.json` v3 | index v5 (8.1+) | v5 | v5 | v5 + manifests |
| Metadata | `preview.storyStore` (verify, S-07) | `__STORYBOOK_PREVIEW__.loadStory` | same | same + `ARGTYPES_INFO_*` | same + **server docgen** (`manifests/components.json`, `services/core/docgen/*`) |
| Done signal | `storyRendered` | `storyRendered` (8.x) / `storyFinished` | `storyFinished` + awaits animations | same | same |
| Builders | webpack5, vite | webpack5, vite | vite, webpack5 | vite, webpack5, rsbuild (verify) | same |

| Renderer | Framework enhancer (names, boundaries, D-21) | Docgen source |
|---|---|---|
| React (incl. Next.js) | fiber `__reactFiber$*` → `type` | react-docgen / react-docgen-typescript / react-component-meta (11) |
| Vue 3 (incl. Nuxt) | `__vueParentComponent` | vue-docgen-api / vue-component-meta |
| Angular | `ng.getComponent(el)` (dev builds only) | Compodoc |
| Svelte 5 | best-effort (verify, S-13) | svelte2tsx (11) |
| Web Components / Lit / Stencil | custom element tag + CEM | custom-elements.json |
| HTML | none | none |

**Figma clients:**

| Client | Support | Notes |
|---|---|---|
| Desktop (macOS, Windows) | primary, all topologies | dev-plugin import works only in desktop ([help](https://help.figma.com/hc/en-us/articles/360042786733)) |
| Browser (Chrome/Edge) | B always; A subject to LNA; D/C fine | S-01 |
| Browser (Safari/Firefox) | B, D, C; A unknown | S-01 |

---

## 7. Isomorphism and sandbox constraints

| Constraint | Where | Rule |
|---|---|---|
| No `setTimeout` guarantee, no DOM in Figma main | `plugin/main`, and any package it bundles | Use promise yields (`await Promise.resolve()` plus the UI round-trip ping for real yields) (verify, S-06) |
| No WebCrypto in main (verify) | `ir/hash` | pure-JS sha256 |
| No `Buffer` | isomorphic packages | `Uint8Array` + `TextEncoder` |
| `structuredClone` subset over `postMessage` | plugin main↔UI | Plain objects, arrays and `Uint8Array` only; no class instances, no `Map` in messages |
| Float determinism | mapper | Round geometry to 1/1000 px *before* hashing; never hash floats coming straight from DOMRect |
| Page realm | serializer | No closures over Node values; all config passed as JSON to `evaluate`; `instanceof` checks use the element's own realm (`el.ownerDocument.defaultView.CSSKeywordValue`) |

---

## 8. Configuration loading

- `c12.loadConfig({ name: "figmabook", defaults, dotenv: true })` reads:
  - `figmabook.config.{ts,mts,js,mjs,json}`;
  - `.figmabookrc`;
  - the `figmabook` key in `package.json`;
  - env overlays `$env.ci`.
- TypeScript configs are executed through `jiti`.
- `defineConfig()` is exported from `figmabook/config`, which re-exports the `cli` config types. The full schema lives in [11](11-ux.md#config).
- **Validation:** the resolved config is checked against a TypeBox schema. Unknown keys produce `PLAN_CONFIG_UNKNOWN_KEY` (warning), invalid values `PLAN_CONFIG_INVALID` (error, exit 2).
- **Merge semantics** (precedence in README §7):
  - objects deep-merge, arrays replace;
  - `null` explicitly unsets;
  - per-`sid` overrides go under `components["components-button"]`, and glob keys (`"components-forms-*"`) are allowed.
- **Secrets** are never read from the config file. Only env (`FIGMABOOK_SB_TOKEN`, `FIGMABOOK_REGISTRY_TOKEN`) or `.figmabook/auth/*` are used ([13](13-security-legal.md#secrets)). A config that contains `password`/`token`-like literal values produces `SEC_SECRET_IN_CONFIG` (error).

---

## 9. Error handling

1. **Typed results inside the library:**
   - `Result<T, Diagnostic[]>` for expected failures, such as an unsupported CSS feature or a font not found.
   - Exceptions are for programmer errors and infrastructure failures only.
2. **Diagnostics are data, not logs.**
   - Every fallback, approximation or skip emits a `Diagnostic` with a registered code ([12](12-quality.md#diagnostics)).
   - Codes are defined once in `shared/diagnostics.ts` via `defineDiagnostic({code, severity, docsSlug, template})`. A CI test fails if any code is used but not registered.
3. **Severity semantics:**
   - `info`: an approximation with no visible effect.
   - `warn`: a visible approximation or fallback.
   - `error`: the node, variant or component was not produced as requested.
   - `fatal`: the run aborted.
4. **Boundaries:**

   | Failure | Effect |
   |---|---|
   | page crash, render timeout, story error | the variant fails; the component continues with the remaining variants and is `partial` |
   | mapper exception (a bug) | the component fails with `APPLY_INTERNAL`-class info and a stack in `report.json` |
   | Storybook unreachable | `SB_UNREACHABLE` is fatal for the run |

5. **Exit codes (CLI):**
   - `0` ok;
   - `1` diagnostics at or above `--fail-on` (default `error`);
   - `2` config or usage error;
   - `3` Storybook unreachable or auth failure;
   - `4` internal error.
6. **Plugin:** errors never leave a half-built component visible. See the transactional rules in [09](09-plugin.md):
   - build a new variant off-canvas, then swap it in;
   - in-place updates are idempotent.

## 10. Logging

- **CLI:**
  - Structured NDJSON is written to `.figmabook/logs/` with fields `{ts, level, runId, sid?, vk?, msg, data?}`.
  - Pretty TTY output goes through consola (spinners or progress bars per component).
  - `--log-level` takes `silent|error|warn|info|debug|trace`; `trace` also dumps CDP traffic for one `--trace-story`.
- **Server:** request log at `debug` level. Authorization headers are **never** logged; a redactor runs over every log record (`authorization`, `cookie`, `set-cookie`, `x-*-token`, `password`) ([13](13-security-legal.md#secrets)).
- **Plugin:**
  - Ring buffer of the last 2,000 log lines in UI memory, with a "Copy debug log" button.
  - Nothing is persisted beyond `clientStorage` settings.
  - No remote logging unless telemetry opt-in (D-23).
