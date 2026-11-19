# 13 · Security, privacy, legal

Security goal: **a user's Storybook content and credentials never leave their machine or CI unless they explicitly choose a hosted service (G7).** No local listener, plugin or CI step may give a third party a way in.

Legal goal: ship under a name and license that cannot be taken down, using only sanctioned Figma APIs.

---

## 1. Assets and trust boundaries

| Asset | Where it lives | Sensitivity |
|---|---|---|
| Storybook content (DOM text, images, component names) | CLI memory, `.holotype/cache`, bundles, Figma file | Confidential (unreleased product UI) |
| Storybook credentials (cookies, basic auth, headers, SSO `storageState`) | `.holotype/auth/*`, env vars, CI secrets | Secret |
| Local-server session tokens | `~/.holotype/sessions.json`, plugin `clientStorage` | Secret |
| Registry tokens | CI secrets, plugin `clientStorage` | Secret |
| Figma document | Figma | Confidential (the user's) |
| Figma token for REST reads (DCR extraction, [15](15-change-requests.md); `holotype status`): a PAT locally, a plan access token in CI (§3) | OS keychain via `holotype login --figma`, or `FIGMA_TOKEN` env / CI secret | Secret (a PAT reads every file the user can see; a plan access token only its allow-listed files) |
| Submitted design requests in the Figma file (`request:*` shared plugin data, named version; D-48, D-49) | the branch file | Confidential; readable by anyone with file access (§2.5) |
| Design change requests (`dcr.json`, `prompt.md`, before/after PNGs) | `.holotype/requests/<id>/`, **committed** with the PR (D-37) | Confidential (unreleased UI, designer copy) |
| Our release artifacts (npm packages, plugin bundle) | npm, plugin zip (dev plugin), private org plugin; Figma Community only after M8 (D-39) | Integrity-critical |

```
 [Browser tab: any website] ──X──► [CLI server 127.0.0.1:47321] ◄── [Figma plugin UI (null origin)]
                                          │
                                          ▼ (Playwright)
                               [Storybook: localhost / intranet / Chromatic]
 [CI runner] ──► [Registry (HTTPS, CORS *)] ◄── [Figma plugin UI]
 [Hosted workers (P8+)] ──► [egress proxy] ──► [public internet only]
 [CLI `dcr`] ──(PAT, read-only)──► [api.figma.com]        [prompt.md] ──(user's choice)──► [user's AI agent / provider]
```

Each arrow that crosses a boundary has an authentication or authorization control, listed below.

## 2. Threat model

### 2.1 Local CLI server (topology A) <a id="local-server"></a>

| STRIDE | Threat | Control |
|---|---|---|
| **S**poofing | A malicious website the user is visiting calls `http://127.0.0.1:47321`. `ACAO: *` is mandatory because the plugin origin is `null`, so CORS alone does not stop reads | **Pairing token.** Every route except `/v1/health` and `/v1/pair/*` needs `Authorization: Bearer <256-bit token>`. The token comes only from the pairing flow, which needs a code shown in the user's terminal ([02 §4.2](02-architecture.md#protocol)). Session tokens never travel in URLs (except the one-time `pair/auto` token, valid 120 s). WS auth is the first message on `/v1/ws` ([02 §4](02-architecture.md#ws)) |
| S | DNS rebinding (`evil.com` re-resolved to 127.0.0.1) | **Host header allow-list:** `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` only. Anything else gets 421 and `NET_HOST_REJECTED` |
| S | Another local process or user on a multi-user machine | Bind to loopback only. Session file mode 0600. Pairing codes are shown only in the owning TTY. Documented: loopback offers no isolation between users of the same machine, so use topology B on shared hosts |
| **T**ampering | Attacker submits runs with crafted config (e.g. `storybook.url` pointing at internal services, which is SSRF via our Playwright) | `RunRequest.configOverrides` takes a **whitelist** of keys only (variants, states, themes, viewport). URLs, auth, paths and scripts can only come from the local config file or CLI flags. The run target is fixed when the server starts |
| T | Asset path traversal (`/v1/assets/../../etc`) | Assets are addressed by `^[0-9a-f]{64}$` only. Store paths are derived, never taken from user input |
| **R**epudiation | — | Local; the request log is at debug level |
| **I**nformation disclosure | Token leakage through logs, crash reports or the clipboard | Redactor on all log records (`authorization`, `cookie`, `set-cookie`, `*token*`, `password`). Tokens are never echoed. `/v1/session` doesn't return the token |
| I | Pairing brute-force (6-digit code) | 5 attempts, then the pairing ID is invalidated and the endpoint locked for 60 s. Codes expire after 120 s. Compared in constant time |
| **D**oS | A website floods the server | Per-IP plus global token bucket: 20 req/s unauthenticated, 200 req/s authenticated, with an unauthenticated body cap of 4 KB. The run queue is bounded at one active run per session |
| **E**levation | Serializer or addon code executing in the Storybook page gets Node privileges | The page runs in Chromium's sandbox. `page.exposeFunction` / bindings are **not** used. Data returns only through `evaluate` return values (JSON) and CDP |
| E | Untrusted Storybook (e.g. a third-party URL) runs code in the CLI's browser with the user's cookies | Each run uses a **fresh `BrowserContext`**, loaded only with the configured `storageState` for the configured origin. Chromium's sandbox stays enabled (no `--no-sandbox` locally). Downloads are disabled |

Legacy PNA preflights get `Access-Control-Allow-Private-Network: true`. That only helps clients that implement PNA, and LNA is a permission prompt rather than a CORS mechanism ([02 §3](02-architecture.md#lna)).

### 2.2 Figma plugin

| Threat | Control |
|---|---|
| Plugin fetches from unexpected hosts | Minimal `networkAccess.allowedDomains`: the loopback ports (D-25), the registry domain(s), and later the hosted API and telemetry endpoint. **Never `"*"`.** `reasoning` text explains each entry. `devAllowedDomains` is used only for development |
| Malicious bundle (crafted file or registry compromise) | The bundle is **data only**. The plugin never `eval`s bundle content. Schema validation (TypeBox) runs before applying. Integrity hashes are checked ([02 §5.1](02-architecture.md#protocol)). Size limits apply: ≤200 MB per bundle, ≤50k nodes per component, ≤5 MB per string, and a zip guard of 2 GB uncompressed with a compression ratio ≤100 (`APPLY_BUNDLE_REJECTED`). Text is inserted as `characters` and is never interpreted. SVG text is passed to `createNodeFromSvg`, which runs in Figma's own sandboxed parser; capture strips `<script>`, `<foreignObject>` and event attributes first |
| Plugin damages unrelated parts of the file | The reconciler touches only nodes carrying `holotype/nk` and their managed descendants (D-19). Unmanaged nodes are never modified ([10](10-sync.md)). Every apply is preceded by a plan preview ([09](09-plugin.md)) |
| Token theft from `clientStorage` | `clientStorage` is local to the user's machine and keyed to the plugin ID ([clientStorage](https://developers.figma.com/docs/plugins/api/figma-clientStorage/)). We store only the session or registry token and no Storybook credentials. A "Forget connections" button wipes it |
| Shared plugin data readable by any plugin | `setSharedPluginData('holotype', …)` is readable by every plugin and through REST `plugin_data=shared`. It must never contain secrets or Storybook URLs with credentials. Only ids, hashes, versions and story ids are stored. Identity stays in shared plugin data (a private-storage option was rejected: it breaks REST DCR reads and `holotype status`). Submitted design requests are also shared plugin data (§2.5) |

### 2.3 CI / GitHub Action

| Threat | Control |
|---|---|
| Fork PRs exfiltrate the registry token | The Action publishes only on `push` or `workflow_dispatch`. On `pull_request` from forks it runs capture and comment only, with no secrets. Docs show `pull_request_target` as unsafe |
| Compromised dependency in the capture toolchain | §4 supply chain. The Action is pinned by SHA in docs examples |
| Registry poisoning | Runs are immutable and content-addressed (integrity hashes). Pointer updates need the token. Optionally a `manifest.json` signature with Sigstore, verified by the plugin when the registry advertises `signed:true` (P7+, verify feasibility in the sandbox) |
| Bundles in public registries leak unreleased UI | `holotype publish` warns (`SEC_PUBLIC_REGISTRY`) when the target is publicly readable and the Storybook isn't public. The docs default to private registries |

### 2.4 Hosted renderer (P8+) <a id="hosted"></a>

A headless browser fetching user-supplied URLs is an SSRF tool by construction (see Rendertron's metadata exposure in the [Semgrep write-up](https://semgrep.dev//blog/2020/exploiting-dynamic-rendering-engines-to-take-control-of-web-apps)). Design:

1. **Isolation:**
   - One **ephemeral microVM per job** (Firecracker), or gVisor (`runsc`) on dedicated nodes.
   - Chromium's own sandbox stays on. The process runs as non-root with a seccomp profile and a read-only root filesystem (tmpfs for the profile).
   - Limits: 2 vCPU / 4 GB, 15 min wall clock, and a per-job page count cap.
2. **No ambient credentials:**
   - No cloud metadata service (IMDS disabled or firewalled).
   - Workers get a single-use signed upload URL and nothing else.
3. **Egress:**
   - All traffic goes through a deny-by-default proxy (Smokescreen / Envoy) that resolves DNS itself, **pins the IP**, and re-checks it on every redirect ([SSRF pinning](https://modpagespeed.com/blog/air-gapped-headless-fetch-ssrf-pinning/)).
   - Blocked ranges: RFC1918, 100.64/10, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10, and multicast.
   - Blocked schemes and features: `file:`, `chrome:`, `data:` navigation, and downloads. WebRTC is disabled with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
   - Only ports 80 and 443.
   - A blocked request emits `SEC_EGRESS_BLOCKED` (warn) in the run report.
4. **Secrets for private Storybooks:**
   - Per-job headers or cookies are submitted over TLS and encrypted with KMS (envelope encryption).
   - They are decrypted only inside the job VM, kept only in memory, never logged, and destroyed with the VM.
5. **Data:**
   - Bundles are stored per tenant prefix, encrypted at rest, and served by short-lived signed URLs (≤15 min).
   - **Default TTL 7 days** (configurable 1–30). Capture IR is not retained.
   - Deletion on request within 24 h. A published retention policy.
6. **Tenancy:** a per-tenant queue quota and a per-job budget, so one tenant cannot starve the others.
7. **Abuse:** URL allow/deny lists and rate limiting per account. The service refuses to render known non-Storybook targets: it requires `index.json` plus `iframe.html` with `__STORYBOOK_PREVIEW__`, which is checked before any capture (`SB_NOT_A_STORYBOOK`).

### 2.5 Design change requests <a id="dcr"></a>

The DCR turns a Figma file into instructions for an AI coding agent ([15](15-change-requests.md)). Anyone who can edit the branch file can put text in front of that agent.

| Threat | Control |
|---|---|
| **Prompt injection** through designer text: layer, frame or section names, text content, TEXT props, annotations (accessibility labels and alt text too), comments, variable names, prototype URLs | **D-38.** Designer strings appear only in fenced blocks, escaped table cells or escaped `jsx-sketch` snippets. They never appear in the Rules or Verify sections or in any instruction sentence. Titles are template-built from ids. The Rules section says designer text is data. Instruction-like text is flagged `DCR_NOTE_SUSPICIOUS` but never dropped, so nothing is hidden from reviewers. A golden `injection` fixture proves it ([12 §2.4](12-quality.md#dcr-fixtures), [15 §10.3](15-change-requests.md#security)) |
| Crafted DCR via `POST /v1/dcr`, `dcr import` or `dcr --pull` (a compromised plugin, another local client, or an edited file) | Session token required on `POST /v1/dcr`. TypeBox validation. Size caps (5 MB JSON, 20 MB assets). The CLI recomputes the **core** `dcrHash` ([15](15-change-requests.md#dcr-hash), D-50: without provenance and CLI-enriched fields) and the item ids on import, pull and `POST /v1/dcr`, and rejects a mismatch. It adds provenance itself, never taking file paths from the request. The request's branch must equal the CLI's current git branch, else `DCR_GIT_BRANCH_MISMATCH` |
| Path traversal through provenance (`SourceLoc.file`, `data-holotype-loc`) | Paths must be repo-relative, with no `..`, no absolute paths and no symlinks out of the repo. They are checked at capture and again before writing |
| Agent acting on links | `open-url` interaction targets are listed as text and never fetched by holotype. The contract tells the agent they are data |
| Approval spoofing | `branch:meta.approval` is a workflow gate, not a security control: anyone with edit access to the branch file can approve, and the submitter can approve their own request. It is bound to one `dcrHash`, so it can't approve later edits. The UI shows the approval time only; no identity is stored or shown. The PR review stays the real control (D-37) |
| Requests readable in the file | Submitted requests are stored in the file (`request:*` shared plugin data) and in a named version (D-48, D-49). Anyone with file access, any plugin, and REST `plugin_data=shared` can read them. They contain only what the DCR contains: no provenance, no repo paths beyond `repo`/`branch`, no identities. Archiving the branch keeps them; deleting the file removes them |

## 3. Secrets handling <a id="secrets"></a>

**Sources**, in precedence order:
1. CLI flags `--header` / `--basic-auth`. These are discouraged and emit `SEC_SECRET_ON_ARGV`, because process lists and shell history can expose them.
2. Environment variables `HOLOTYPE_SB_TOKEN` (bearer token), `HOLOTYPE_SB_HEADERS` (JSON), `HOLOTYPE_SB_BASIC` (`user:pass`), `HOLOTYPE_REGISTRY_TOKEN`.
3. `.holotype/auth/headers.json` and `.holotype/auth/storageState.json`. These are created by `holotype login --storybook <url>`, which opens a headed Chromium so the user can complete SSO; the storage state is saved afterwards. File mode is 0600, and `holotype init` adds `.holotype/` to `.gitignore`.

**Scoping:**
- Credentials are bound to an **origin**.
- Playwright `httpCredentials` and `extraHTTPHeaders` are installed through `context.route()` only for requests to that origin, so headers never go to CDNs or third-party font hosts.
- `storageState` is filtered to the target origin's cookies.

**Never in outputs:**
- The Capture IR serializer strips `input[type=password]` values entirely.
- `redaction.inputs: "all"` (default `"password"`) blanks every form value ([16](16-config.md#redaction)). Each blanking emits `SEC_SECRET_REDACTED` (info).
- URLs written into IR or Scene IR (story links, asset source URLs) go through `stripCredentials()`, which removes userinfo, `token|key|sig|signature|auth*` query params, and fragments.
- A CI test greps fixture bundles for known canary secrets.

**Text redaction mode:** `redaction.text: "mask"` replaces every text character with a width-preserving glyph in the same font. Capture keeps the geometry, but bundle text becomes `■`/`x`. This is for teams that share bundles with vendors.

**Config literal guard:** `SEC_SECRET_IN_CONFIG` ([02 §8](02-architecture.md)).

**Figma token (DCR, [15 §10.1](15-change-requests.md#security)):**
- **CI:** a **plan access token** (REST category; not user-bound; up to 1 year; resource allow-list restricted to the library and branch files; admin-managed).
- **Local:** a **personal access token** with `file_content:read` (+ `file_comments:read` only with `--with-comments`), max 90 days. `holotype doctor` warns 14 days before expiry (`NET_FIGMA_TOKEN_EXPIRING`). A missing token is `NET_FIGMA_TOKEN_MISSING`.
- The Enterprise REST duplicate fallback ([15 §2.1](15-change-requests.md)) needs a private OAuth app with `file_duplicate:write`. Otherwise OAuth comes later, if a hosted service ever needs it.
- Sources, in precedence order: `FIGMA_TOKEN` (CI secrets), then the OS keychain entry written by `holotype login --figma` (macOS Keychain, Windows Credential Manager, libsecret; a 0600 file under `~/.holotype/` only where no keychain exists). It is never accepted on argv (`SEC_SECRET_ON_ARGV`) and never read from the config (`SEC_SECRET_IN_CONFIG`).
- It is sent only to `api.figma.com` over HTTPS. It is redacted from logs and never written to DCR files, bundles, `branch:meta` or reports. `holotype login --figma --logout` deletes it, and `doctor` reports its age.
- The plugin needs no token: it reads the open file through the Plugin API.

### 3.1 What leaves the machine (DCR) <a id="dcr-egress"></a>

| Data | Goes to | When |
|---|---|---|
| Figma file JSON, comments | read **from** `api.figma.com` with the user's PAT (or a plan access token in CI) | `holotype dcr --pull` (REST path) |
| DCR from the plugin | written into the Figma file (`request:*`, named version; D-48, D-49); also the local CLI on loopback (`POST /v1/dcr`) when paired | Submit (always); *Send to Holotype on this computer* (paired only) |
| `dcr.json`, `prompt.md`, PNGs | the user's repo, committed with the PR | always (D-37) |
| The prompt, the referenced code, images | **the AI provider the user chose**, under the user's agreement with it | only when the user's agent reads it. holotype calls no model (D-35) |
| Anything | holotype maintainers | never |

The Submit screen and the docs say this plainly ([11 §6.15](11-ux.md#submit)). No designer identity is stored: comment and annotation authors and approvers are dropped (`DcrNote.author: never`).

## 4. Supply chain <a id="supply-chain"></a>

- **Dependencies:** `pnpm-lock.yaml` is committed. CI installs with `--frozen-lockfile`. Renovate batches updates weekly; Playwright is bumped manually ([02 §6.4](02-architecture.md#monorepo)).
- **Install scripts:** disallowed via `pnpm.onlyBuiltDependencies`, with an allowlist (esbuild, sharp).
- **Provenance:** npm packages are published from GitHub Actions with OIDC trusted publishing and `--provenance`. Releases are tagged and signed. The Action's `dist/` is built in CI and its hash is verified in the release workflow.
- **Plugin build reproducibility:**
  - Pinned toolchain, `SOURCE_DATE_EPOCH`, and sorted zip entries with fixed mtimes.
  - The build hash is published in the release notes. Anyone can rebuild the plugin from a tag and compare.
  - The plugin bundle contains no remote code loading (no CDN scripts), which Figma review also expects.
- **SBOM:** CycloneDX generated per release.
- **Secret scanning:** gitleaks in CI.
- **Third-party code ports:** tracked in `THIRD_PARTY_NOTICES.md` with the license, source commit and files touched (§6.3).

## 5. Privacy

- **Data flows in default mode:**
  - Storybook → user's machine → user's Figma file. Nothing reaches us.
  - In CI: Storybook → user's CI → user's registry → user's Figma file. Still nothing reaches us.
- **Privacy policy** is required for Community publishing (post-M8, D-39) whenever the plugin processes user data or sends data out of Figma ([developer terms](https://www.figma.com/developer-terms/), [review guidelines](https://help.figma.com/hc/en-us/articles/360039958914)). It covers:
  - the local, registry and hosted data paths;
  - opt-in telemetry (fields listed below);
  - retention (hosted);
  - subprocessors (hosted);
  - contact and incident notification. Figma requires prompt notice of security incidents.

### 5.1 Telemetry (D-23)
- **Off by default.** Turned on with:
  - a CLI prompt on first interactive run (default No);
  - `holotype telemetry enable|disable|status`;
  - a plugin settings toggle.
- **Not built before the public track** (§7.1). The rules below are the design for then.
- **Always disabled when** `DO_NOT_TRACK=1` is set or CI is detected (`ci-info`). There is no override.
- **Payload** (anonymous; random install id rotated yearly):
  - tool, Node, Chromium, Storybook and framework versions;
  - counts (components, variants, nodes), durations;
  - counts per diagnostic code;
  - fidelity score histogram buckets.
- **Never sent:** story ids or titles, text, URLs, hostnames, image data, file names, Figma file keys, or user names.
- **Transport:** HTTPS to our endpoint, which is listed in the plugin `allowedDomains` with reasoning. Batched, with a 2 s timeout, fire-and-forget. The schema is published in `docs/telemetry.md`.

## 6. Legal

### 6.1 Trademark and naming <a id="trademark"></a>
- Figma's brand guidelines prohibit "Figma" or "Fig" in product names, domains and social handles. The approved pattern is descriptive use: "‹Name›, a plugin for Figma Design" ([brand guidelines](https://www.figma.com/using-the-figma-brand/), [Community guidelines](https://help.figma.com/hc/en-us/articles/360038510573)).
- Figma enforces its marks (e.g. the "Dev Mode" cease-and-desist reported by [The Verge](https://hn.jakechampion.name/reader/https://www.theverge.com/news/649851/figma-dev-mode-trademark-loveable-dispute)).
- **Storybook** is also a trademark (the OpenJS/Chromatic ecosystem, verify the owner). Descriptive use ("for Storybook") is fine; "Storybook" should not be the leading word of the name.
- Naming rules for D-01:
  1. No "Figma", "Fig", "Storybook" or "Chromatic" in the name, npm scope, domain or handle.
  2. Pass a USPTO/EUIPO knockout search in class 9/42.
  3. npm scope, GitHub org and a `.dev` domain must all be available.
  4. The descriptive tagline may name both products.
- **Chosen name: Holotype** (D-01, user decision). npm `holotype` and the `@holotype` scope were free at selection time; GitHub org candidates `holotypehq` / `holotypedev`; the only other use found is a hobby pixel font. Before any public listing: formal USPTO/EUIPO search and domain registration.
- **Identifiers are final from day one:** package scope `@holotype/*`, CLI binary `holotype` (alias `holo`), config file `holotype.config.ts`, plugin data namespace `holotype` (D-19), Storybook key `parameters.holotype`. Because the name was chosen before any release, no namespace migration is needed; `SYNC_LEGACY_NAMESPACE` is kept in the catalog only for a future rename.

### 6.2 Our license (D-02)
- **MIT** for all packages in this repo (user decision). It is the most familiar license in the JS ecosystem (Storybook itself is MIT) and has the least friction for adoption. Trade-off vs Apache-2.0: MIT has no explicit patent grant; accepted. Third-party attributions go in `THIRD_PARTY_NOTICES.md`; Apache-2.0 dependencies that ship a `NOTICE` file have it reproduced there.
- No AGPL anywhere. Many enterprise legal teams ban it, and it would block embedding in internal tooling.
- **Future hosted service (if ever):** lives in a separate repo, either closed source or FSL-1.1-MIT. FSL allows every use except a competing service, and each version converts to MIT after 2 years ([fsl.software](https://fsl.software/)). The MIT core never depends on it.
- **Contributions:** DCO sign-off (`Signed-off-by`), not a CLA. That keeps contribution friction low; it is compatible with MIT and doesn't block a later hosted tier, because the hosted code lives elsewhere.

### 6.3 Third-party code we may borrow <a id="licensing"></a>

| Project | License (verify each at the commit used) | Policy |
|---|---|---|
| figitdesign/web-to-figma (`@figit/dom-to-figma`) | MIT (per research) | **May port** algorithms and code with attribution: keep the copyright notice in `THIRD_PARTY_NOTICES.md` and file headers. Prefer re-implementing from understanding plus our own tests |
| BuilderIO/html-to-figma | MIT (verify the license at `7fece25`) | May port small helpers with attribution. Its architecture is not reused |
| sergcen/html-to-figma | Inherits MIT (verify) | Same as BuilderIO |
| html2canvas | MIT (verify) | May port the pseudo-element `content` resolution with attribution |
| modern-screenshot | MIT (verify) | May port `<use>` embedding and default-style diffing with attribution |
| satori | **MPL-2.0 (verify)**. File-level copyleft: modified MPL files must stay MPL and be available | **Do not copy files.** Re-implement the `line-height: normal` metric formula from the OpenType spec, citing satori as reference. If a file is ever vendored, keep it as a separate MPL-licensed file, unmodified or with modifications published |
| Lynavo/web2ui | **AGPL-3.0** | **Never copy, never vendor, never port.** Study only, for ideas documented in public specs. Contributors who have read its source must implement the related features from our spec text, not from memory of its code |
| storybook (monorepo) | MIT | Reference only. We call public and runtime globals; we don't vendor source |
| storybook-addon-pseudo-states | MIT | Interop only (we read its `pseudo` global) |
| colorjs.io | MIT (verify) | Dependency |
| fontkit | MIT (verify) | Dependency |
| harfbuzzjs | MIT/"Old MIT" (verify) | Optional dependency |
| sharp / libvips | Apache-2.0 / LGPL-3.0 (libvips, dynamically linked prebuilt binaries; verify implications) | CLI-only dependency; never bundled into the plugin |
| fflate, @noble/hashes, TypeBox, Hono, c12, citty, consola | MIT | Dependencies |

CI runs `license-checker` against an allow-list: MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, MPL-2.0 (as an unmodified dependency only), and LGPL (via sharp only). Anything else fails the build (`SEC_LICENSE_DENIED`).

### 6.4 Independence from story.to.design
- **Allowed:** an independent implementation of similar functionality through the public Plugin API, from public DOM/CSS and public Storybook APIs. That is ordinary competition.
- **Not allowed:**
  - decompiling or inspecting their plugin bundle, agent binary or network protocol;
  - copying their docs text, UI, icons or trade dress;
  - using their trademarks except for factual comparison.
- **The s2d-compat reader** for `parameters.s2d.variantProperties` ([04](04-variant-model.md)) reads a configuration format from *users' own code*. It is implemented from their public documentation only. It is labelled "migration helper", and they are named only nominatively.
- Comparison claims in marketing must be factual, dated, and backed by reproducible fixtures ([12](12-quality.md)).
- Figma's developer terms reserve Figma's right to build competing features (§4e, [developer terms](https://www.figma.com/developer-terms/)). This is a business risk, not a legal one ([01 §6](01-landscape.md)).

### 6.5 Clipboard format: rejected <a id="clipboard"></a>
Some tools (html.to.design's paste flow, api.to.design, figit) write Figma's clipboard payload: base64 **fig-kiwi** binary inside `(figmeta)`/`(figma)` HTML comments, with no embedded schema ([Grida notes](https://grida.co/docs/wg/feat-fig/)). We don't, because:
1. **ToS.** Figma's terms bar reverse engineering its services (§2.2, [ToS](https://www.figma.com/tos/), [SSA](https://www.figma.com/ssa/)). Community review allows only official plugin APIs ([review guidelines](https://help.figma.com/hc/en-us/articles/360039958914)).
2. **Stability.** The roughly 194-definition reverse-engineered schema breaks without notice, and Figma staff have declined to support it ([forum](https://forum.figma.com/archive-21/inquiry-about-the-fig-file-format-35603)).
3. **Function.** Pasted content carries none of *our* plugin data, so there is no identity, no incremental sync and no override preservation (D-19). It defeats the product's core.

The approved alternatives are the Plugin API, and Figma's MCP `use_figma`, which runs Plugin API code (S-11).

## 7. Figma publishing <a id="publishing"></a>

Distribution is private (D-39), in three stages:

1. **Now: development plugin.** A release zip whose `manifest.json` the user and their boss import in the Figma desktop app (Plugins ▸ Development ▸ Import plugin from manifest). Any plan, no review, no listing. Install steps: [11 §2.0](11-ux.md#install).
2. **Once stable: private organization plugin** (below). The account has Organization/Enterprise features.
3. **After M8 only: Community listing**, after the D-01 trademark search (public track, §7.1). The requirements below apply only then.

**Stage 3: Community plugin requirements and review** ([publishing](https://developers.figma.com/docs/plugins/publishing), [review guidelines](https://help.figma.com/hc/en-us/articles/360039958914)):
- **Review:** the help center states up to about 2 weeks or 5–10 business days. Forum reports in 2026 mention longer waits. Plan 3 weeks of slack before launch dates.
- **Network:** every domain declared with `reasoning`. The listing shows them. HTTPS is expected. Figma's manifest docs say local-only needs belong in `devAllowedDomains`; loopback in `allowedDomains` is justified by `reasoning` (precedent: Cursor Talk to Figma MCP, [cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp); S-01 confirms). The reasoning text is the one in [09 §2](09-plugin.md).
- **Disclosure:** the listing must disclose that a CLI (a separate, free, open-source tool) is needed for topologies A/B/D. The required wording states that it only *serves data* and does not manipulate Figma. The rule against requiring "packages that manipulate Figma" doesn't apply, but it is stated explicitly to pre-empt review questions.
- **Performance:** plugins that degrade editor performance can be rejected. Time-slicing ([09](09-plugin.md)) is a review requirement as well as a UX one.
- **Not a workaround to Figma's paid features:** variables modes are plan-limited, so we respect the limits and degrade gracefully (S-12) and never emulate paid features.
- **Other listing requirements:**
  - privacy policy URL (§5);
  - security disclosure form (encouraged);
  - support contact;
  - a stable plugin `id`, never changed. A Community listing gets its own `id`; identity data is readable across ids because it is shared plugin data.

**Stage 2: private organization plugin** (Organization/Enterprise plans; the planned path, D-39):
- Not reviewed ([publishing](https://developers.figma.com/docs/plugins/publishing)). Published to the organization only; members run it without importing anything.
- It uses the same build and manifest `id` as the development plugin, so settings carry over (verify). The manifest `id` is fixed forever ([02](02-architecture.md)); only a Community listing gets a new one (above).
- Telemetry is off, and the registry domain may be customer-specific (enterprise registries).

<a id="public-track"></a>
### 7.1 Public track (post-M8)

Work that matters only for a public release. None of it is scheduled before M8 ([14](14-roadmap.md)).

| Item | Notes |
|---|---|
| Trademark search | formal USPTO/EUIPO search for Holotype (D-01, §6.1) |
| Repo rename | public GitHub org and repo |
| Community listing | its own plugin `id` (above); review requirements (stage 3) |
| Docs site | public docs and the CLI disclosure wording |
| Privacy policy | §5 |
| Migration guide | from the private org plugin to the Community plugin |
| Telemetry | not built before the public track (§5.1) |
| Business model | option 2 decision (§8) |

**Payments:** see §8. If used, set `permissions:["payments"]` and `figma.payments` with `status.type` `PAID|UNPAID|NOT_SUPPORTED` ([payments](https://developers.figma.com/docs/plugins/api/figma-payments/)). Purchases are verified server-side via the Payments REST API ([REST payments](https://developers.figma.com/docs/rest-api/payments)).

## 8. Business model options <a id="business"></a>

| Option | Revenue source | Fit | Notes |
|---|---|---|---|
| **1. Pure OSS** | none, or sponsorship | Adoption-first | Default for v1 |
| **2. Open core + hosted** (recommended later) | Hosted renderer (topology C) and a managed registry with history, PR previews, SSO and retention controls. Priced per project/Storybook or per render-minute | Strong. It targets the "no CI setup" segment that story.to.design serves today | Core stays MIT; hosted is closed or FSL-1.1-MIT (D-02) |
| **3. Enterprise support** | Annual support, private plugin builds, on-prem registry, SLAs | Medium | Low engineering cost |
| **4. Figma native payments** | `figma.payments`: 15% fee, $2 minimum, Stripe-supported countries ([selling](https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources)) | Weak for an OSS plugin. It also gates features in a way that is visible in source | Use only for in-Figma upsell into option 2, if at all |

**Recommendation:**
- Ship options 1 and 3 for v1.
- Decide on option 2 at M8 or later ([14](14-roadmap.md)), after README §9 Q6 is answered, based on design-partner demand; not before the public track (§7.1).
- Never gate local or CI features behind payment, because that contradicts G7 and invites forks.
- Sources disagree on whether plugin sellers need approval; recent staff forum replies say no (verify before any use of payments).
