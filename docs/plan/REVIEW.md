# Plan review, November 2026

> Record of the four-lens review of the Holotype plan (README and chapters 01–15) and of the build plan's gap list (BUILD.md §11). It lists what was found, what was decided, and where each fix lands. The edits themselves are applied chapter by chapter; this file does not change any decision on its own: the binding text is README §5 (D-46…D-58).

## 1. Method

Four independent reviewers read the plan, each through one lens. A consolidator then checked every finding against the cited lines, dropped false positives, merged duplicates across reviews, and grouped the fixes by target file.

| Lens | IDs | Question asked | How it was checked |
|---|---|---|---|
| A. Technical correctness | TA-01…TA-30 | Are API names and behaviours right? | Against the pinned packages (`@figma/plugin-typings@1.142.0`, `storybook@10.6.7`, `devtools-protocol`, `@create-figma-plugin/*@4.0.3`) and current vendor docs |
| B. Cross-chapter consistency | CB-01…CB-80 | Do chapters define the same contract the same way? | Full reads plus scripted checks of diagnostic codes, config keys, commands and types |
| C. Product and scope | PC-01…PC-32 | Does the roadmap reach the owner's real loop soon, and is the positioning current? | Roadmap arithmetic, competitor research (Nov 2026) |
| D. End-to-end UX | UD-01…UD-60 | Can a designer and a developer actually walk each journey? | Journeys J1–J5 walked step by step (install, first sync, branch file, agent, verify) |
| Build gaps | BD-01…BD-25 | What did the build plan have to decide because the plan was inconsistent? | BUILD.md §11, rows 1–25 |

Severity scale (lenses A–D): **blocker** = code cannot be written against the plan; **major** = a binding decision is violated, a load-bearing gap, or a user-visible contradiction; **minor** = local inconsistency; **nit** = wording. Build gaps are unrated.

## 2. Counts

| Lens | Blocker | Major | Minor | Nit | Total | Accepted | Rejected |
|---|---|---|---|---|---|---|---|
| A. Technical | 0 | 6 | 16 | 8 | 30 | 29 | 1 |
| B. Consistency | 6 | 37 | 28 | 9 | 80 | 80 | 0 |
| C. Product | 2 | 16 | 11 | 3 | 32 | 32 | 0 |
| D. UX | 2 | 27 | 27 | 4 | 60 | 60 | 0 |
| Build gaps | – | – | – | – | 25 | 25 | 0 |
| **All** | **10** | **86** | **82** | **24** | **227** | **226** | **1** |

"Accepted" includes findings merged into a duplicate and findings whose proposed fix was replaced by a coordinator resolution (§5). Four accepted findings had one sub-item rejected (§5).

The main duplicate clusters, each fixed once:

| Topic | Findings |
|---|---|
| Config schema has no owner; keys conflict | CB-19…CB-27, CB-23, UD-48, BD-07 |
| Two `BundleManifest`, tokens and Capture IR shapes | CB-01, CB-02, CB-03, BD-10, BD-11 |
| DCR hash cannot match plugin ↔ CLI | CB-05, UD-12 |
| Pairing, WS auth, probe, session key | CB-11…CB-13, TA-10, TA-11, TA-25, UD-06, UD-46, BD-14 |
| Cross-machine hand-off and frozen version | PC-11, UD-02, TA-21, UD-15, UD-37 |
| Merge vs archive of Figma branches | PC-10, UD-25, UD-26 |
| Verify ships too late | PC-02, CB-35, UD-21, PC-23, PC-27 |
| Roadmap order and staffing | PC-01, PC-03, PC-04, PC-12…PC-17, BD-01 |
| `figma.fileKey` needs `enablePrivatePluginApi` | TA-01, UD-11, BD-08 |
| Branch-mismatch error code | CB-62, UD-10 |
| Four-state screen specs and usability cadence (D-40) | CB-38, UD-27, UD-54 |
| `ah`, `irh`, rounding | CB-07, CB-08, CB-09, BD-13, BD-16, BD-17 |
| Command and exit-code drift | CB-16, CB-17, CB-18, UD-47, BD-15 |
| File-creation API claim outdated | TA-03, PC-24 |
| Lock / Unmanage / Fork naming | CB-46, UD-29 |

## 3. Top issues and their resolutions

1. **The first real use of the loop came too late** (PC-01, PC-02, PC-03, PC-04, CB-35, UD-21, BD-01). The owner first touched the DCR around week 33 and `holotype verify` around week 50. **Resolution:** D-46, a Loop slice (L0–L5) reaching M-Loop at about week 16–20 with tokens-lite, Phase 4a and verify v1; fidelity and breadth move to a hardening track.
2. **No owner for `holotype.config.ts`** (CB-19…CB-27). Five chapters defined overlapping, contradictory keys. **Resolution:** D-51, a new chapter [16](16-config.md) with every key, type, default and owner, plus a removed-keys table.
3. **Incompatible core contracts** (CB-01…CB-04, CB-29, BD-09…BD-11). Two manifests, two tokens documents, two Capture IR vocabularies, two main↔UI message sets. **Resolution:** D-52 names one owner per contract (06 schemas and hashes, 02 wire protocol, 09 plugin messages, 11 CLI surface, 12 diagnostics, 15 DCR IR, 16 config).
4. **DCR hash and approvals could never match** (CB-05, UD-12). Provenance was added after hashing, and the plugin could not read the repo config. **Resolution:** D-50, a hash over the DCR core with provenance outside it, and the resolved `dcr` config carried in the bundle and `branch:meta`.
5. **The designer and the developer were assumed to share one computer** (UD-02, PC-11, UD-04, UD-05). **Resolution:** D-48 and D-49: Submit saves a named Figma version and writes the request into the file; "Notify developer", `holotype dcr --pull` and `holotype dcr import`.
6. **Merging Figma branches would corrupt the library** (PC-10, UD-25, UD-26). **Resolution:** D-47, never merge; archive the branch; a maintainer re-syncs the library from code and publishes.
7. **Technical errors in the plugin plan** (TA-01, TA-02, TA-06, TA-09, TA-15). `figma.fileKey` without `enablePrivatePluginApi`, a wrong SLOT binding, an unwritable `openTypeFeatures`, a wrong UI build path, and preflight imports that write. **Resolution:** corrected in 09, 07 and 08; D-06 and D-53 amended.
8. **Capture determinism and provenance assumptions were false** (TA-04, TA-05, TA-23). `clock.install` lets time flow; Vite's `css.devSourcemap` is off by default; the test-runner UA pauses animations instead of waiting. **Resolution:** `clock.setFixedTime`, forced dev source maps with `data-vite-dev-id`, explicit finishing of Web Animations; D-24 and D-36 amended.
9. **`.gitignore` silently dropped every committed DCR** (UD-01). **Resolution:** `.holotype/*` with re-includes, an `init` self-check and a `doctor` check.
10. **No measure of the real outcome** (PC-05, PC-29, PC-07, PC-08). Every metric measured fidelity, and 01 missed current design → agent → code competitors. **Resolution:** D-54 adds agent-eval metrics and a bake-off against Figma MCP + Code Connect; 01 gains a "design → code for agents" section.
11. **Verify compared different renderers** (UD-23, UD-17). Browser renders were compared with Figma exports, and regressions in untouched variants passed. **Resolution:** D-55, verify decides in Scene space, visual similarity is advisory, and non-target variants are checked for regressions.

## 4. Coordinator resolutions, as decisions

| R | Decision | README |
|---|---|---|
| R1 | Roadmap re-sequenced around a Loop slice: a thin real loop (branch → design → DCR → AI → verify) on a React + Vite + SB10 repo at about week 16–20. It contains minimal capture → mapper → plugin apply (identity keys, hashes, idempotent in-place apply; Phase 4 split into 4a now and 4b later), a tokens subset, the branch baseline, DCR kinds `component.modified`, `variant.added`, `property.*`, `component.new` and `screen` usage, `prompt.md`, and `holotype verify` v1. Fidelity hardening, approval, the screens-repo split, a11y and `instance.*` come after. Estimates assume one owner plus AI agents; Figma-in-the-loop steps are the human bottleneck | D-46 |
| R2 | A Figma branch is never merged into the library. After implementation the branch is archived; the library changes only by re-sync from code (open the library, Re-sync, Publish); CI has no Figma write path | D-47 |
| R3 | Submit saves a named Figma version; the DCR records its id; the CLI reads the request at that version | D-48 |
| R4 | Cross-machine hand-off: Submit writes the request into the file; an unpaired plugin defaults to "Notify developer"; the developer runs `holotype dcr --pull <figma-url>`, or `holotype dcr import <zip>` with a downloaded request | D-49 |
| R5 | `dcrHash` excludes provenance and every CLI-enriched field; plugin and CLI compute identical hashes from the same snapshot; approval binds to that hash; both sides read the repo's `dcr` config from the bundle / `branch:meta` | D-50 |
| R6 | A new chapter, 16-config.md, owns the complete `holotype.config.ts` schema; all config-key conflicts are resolved there | D-51 |
| R7 | Canonical px rounding 1/1000; `ah` is FNV-1a-64 (7 group sub-hashes); one `irh` formula (06); 06 owns the IR and document schemas, 02 owns the protocol, others link | D-52 |
| R8 | Node ≥22.12; the manifest sets `enablePrivatePluginApi: true`; branch identity uses `figma.fileKey`, falling back to a `fileId` in root `branch:meta` | D-53 |
| R9 | Technical corrections from lens A are accepted unless clearly wrong (one was: TA-19) | D-24, D-06, D-36 amended; chapter fixes |
| R10 | Agent-eval metrics (first-pass verify rate on a DCR corpus) and a bake-off against Figma MCP + Code Connect; 01 updated with current competitors | D-54 |

Further decisions from the review: **D-55** (verify v1 semantics), **D-56** (reviewer answers, agent decisions, cumulative requests with a `LATEST` pointer), **D-57** (default DCR scope `changed`, provisional), **D-58** (local transport and pairing, topology A in hardening). Amended: D-03, D-06, D-10, D-11, D-19, D-22, D-24, D-31, D-32, D-35, D-36, D-37, D-40, D-41, D-43, D-44, D-45.

Where BUILD.md had made a choice, the plan follows it unless that choice contradicts R1–R10. Two choices replace a reviewer's proposal: `report.json` stays the 06 `BundleReport` (BD-12, not CB-41's `RunReport`), and the capture cache key is owned by 02 (BD-18, not CB-39's 05). BUILD.md itself gets consistency fixes for R2–R5 and R8 (Node version, dev source maps, DCR core hash, `fileId`, Submit version and request-in-file, branch-mismatch code).

## 5. Rejected findings and sub-items

| ID | Decision | Reason |
|---|---|---|
| TA-19 | rejected | False positive. The pinned typings declare `setTimeout`/`setInterval` as plugin-main globals, and Figma's own `saveVersionHistoryAsync` example uses `setTimeout` in main. S-06 step 1 still confirms it |
| CB-23, sub-item `themes.themeOverride` | sub-item rejected | It is Storybook addon-themes' story parameter, not a Holotype config key |
| PC-32, sub-item "close Q6" | sub-item rejected | Q6 (hosted tier) is the user's decision; it is deferred to the public track, not closed |
| UD-35, sub-item `figma.currentUser` | sub-item rejected | Needs an extra manifest permission and an identity surface the plan avoids; approvals show the time only |
| UD-43, sub-item WebP | sub-item rejected | Request assets stay PNG; `holotype dcr prune` is accepted |

Proposals replaced by a resolution (the findings themselves are accepted): CB-19 (11 as config owner → 16), CB-35 option (b) (no verify until Phase 7 → verify v1 in the slice), CB-39 (05 owns the cache key → 02), CB-41 (`RunReport` as `report.json` → `BundleReport`), CB-69 (`*.github.io` in the manifest → no registry domains until the registry ships), PC-18 (Code Connect generator early → hand-written mappings for the bake-off), TA-10 (WS ticket → token as the first WS message, as 02 already specified).

## 6. Accepted findings → target files

Targets: chapter numbers, `16` = new 16-config.md, `README`, `BUILD` = BUILD.md (consistency fixes only). Severity is the reviewer's; build gaps are "gap".

| ID | Sev | Target files |
|---|---|---|
| TA-01 | major | 09, README |
| TA-02 | major | 09, 14 |
| TA-03 | major | 01, 13, 14, 15, README |
| TA-04 | major | 05, 12, 16, README |
| TA-05 | major | 05, 12, 14, 15, 16, BUILD, README |
| TA-06 | major | 07, 09, 12, 14 |
| TA-07 | minor | 09 |
| TA-08 | minor | 09, 14, 15 |
| TA-09 | minor | 09, 14, BUILD, README |
| TA-10 | minor | 02, 09, 13 |
| TA-11 | minor | 02, 09, 11 |
| TA-12 | minor | 10, 12, 13, 14 |
| TA-13 | minor | README |
| TA-14 | minor | 08, 16 |
| TA-15 | minor | 08, 09 |
| TA-16 | minor | 05, 07, 08, 09, 16 |
| TA-17 | nit | 06 |
| TA-18 | minor | 09 |
| TA-20 | minor | 09, 11 |
| TA-21 | minor | 09, 15 |
| TA-22 | nit | 09 |
| TA-23 | minor | 03, 05, 16, README |
| TA-24 | nit | 09, 13 |
| TA-25 | nit | 02, 14 |
| TA-26 | nit | 10, 15 |
| TA-27 | nit | 08 |
| TA-28 | nit | 06, README |
| TA-29 | minor | 09 |
| TA-30 | minor | 07, 09, 12 |
| CB-01 | blocker | 02, 06, 09 |
| CB-02 | blocker | 02, 06, 08, 09 |
| CB-03 | blocker | 05, 06 |
| CB-04 | blocker | 02, 09 |
| CB-05 | blocker | 13, 15, README |
| CB-06 | major | 06, 09, 10 |
| CB-07 | major | 06, 10 |
| CB-08 | major | 10, README |
| CB-09 | major | 06, 12 |
| CB-10 | major | 09 |
| CB-11 | major | 02, 09, 11 |
| CB-12 | major | 02, 09 |
| CB-13 | major | 02, 09, 11 |
| CB-14 | major | 02, 11 |
| CB-15 | major | 02, 06 |
| CB-16 | major | 02, 11 |
| CB-17 | major | 02, 11 |
| CB-18 | major | 02, 04, 11, README |
| CB-19 | blocker | 04, 08, 11, 16 |
| CB-20 | major | 04, 11, 16 |
| CB-21 | major | 04, 11, 16 |
| CB-22 | major | 04 |
| CB-23 | major | 03, 04, 05, 07, 10, 12, 16 |
| CB-24 | major | 06, 08, 11, 16 |
| CB-25 | major | 08, 11, 16 |
| CB-26 | major | 04, 16 |
| CB-27 | major | 09, 11, 16 |
| CB-28 | major | 04, 06, 16 |
| CB-29 | major | 06, 09 |
| CB-30 | major | 07 |
| CB-31 | major | 06, 07, 09, 11, 16 |
| CB-32 | major | 09, 11 |
| CB-33 | major | 02 |
| CB-34 | major | 11, 14, README |
| CB-35 | major | 14, 15 |
| CB-36 | major | 10, 13, 16, README |
| CB-37 | major | 02, 09, 14 |
| CB-38 | major | 11, 12, README |
| CB-39 | major | 02, 05, 06 |
| CB-40 | major | 02, 06, 13 |
| CB-41 | major | 02, 06, 12, README |
| CB-42 | major | 06, 09 |
| CB-43 | major | 04, 07, 09, README |
| CB-44 | minor | 02, 12 |
| CB-45 | minor | 10 |
| CB-46 | minor | 10, 11, 12 |
| CB-47 | minor | 09 |
| CB-48 | minor | 09 |
| CB-49 | minor | 06, 07, 16 |
| CB-50 | minor | 02, 06, 09, 10, 11, README |
| CB-51 | minor | 13 |
| CB-52 | minor | 12, 13 |
| CB-53 | minor | 02, 11, 12, 13, 16 |
| CB-54 | minor | README |
| CB-55 | minor | 02, 10, 13 |
| CB-56 | minor | 02, 05, 09, 10, 14, 15 |
| CB-57 | minor | 10, 14 |
| CB-58 | minor | 12, 14 |
| CB-59 | minor | 14 |
| CB-60 | minor | 01 |
| CB-61 | minor | 13 |
| CB-62 | minor | 02, 12, 15, BUILD |
| CB-63 | minor | 06, 10 |
| CB-64 | minor | 06, 10 |
| CB-65 | minor | 15 |
| CB-66 | minor | 15, README |
| CB-67 | minor | 03, 04, 05, 07, 08, 10, 12, 13 |
| CB-68 | minor | 02, 04, 07 |
| CB-69 | minor | 02, 09 |
| CB-70 | minor | 09, 15 |
| CB-71 | minor | 09, 14, 15 |
| CB-72 | nit | README |
| CB-73 | nit | 12 |
| CB-74 | nit | 02, 03, 05 |
| CB-75 | nit | 10 |
| CB-76 | nit | 11, 15, 16 |
| CB-77 | nit | 02, 03 |
| CB-78 | nit | README |
| CB-79 | nit | 01 |
| CB-80 | nit | 09, 11 |
| PC-01 | blocker | 14, README |
| PC-02 | blocker | 14, 15, README |
| PC-03 | major | 08, 14 |
| PC-04 | major | 10, 14 |
| PC-05 | major | 12, README |
| PC-06 | major | 01, README |
| PC-07 | major | 01, 14 |
| PC-08 | major | 01 |
| PC-09 | major | 01, 14, 15 |
| PC-10 | major | 10, 15 |
| PC-11 | major | 09, 15 |
| PC-12 | major | 14 |
| PC-13 | major | 14, 15, README |
| PC-14 | major | 12, 14, README |
| PC-15 | major | 14 |
| PC-16 | major | 14 |
| PC-17 | minor | 14 |
| PC-18 | minor | 14 |
| PC-19 | minor | 03, 14, README |
| PC-20 | minor | 14 |
| PC-21 | major | 11, 14, 15 |
| PC-22 | minor | 11, 15, README |
| PC-23 | minor | 14, 15, README |
| PC-24 | minor | 01, 14, 15 |
| PC-25 | minor | 01 |
| PC-26 | nit | 01 |
| PC-27 | minor | 14 |
| PC-28 | minor | 15 |
| PC-29 | major | 01, 12, 14 |
| PC-30 | minor | 14, 15 |
| PC-31 | nit | 13, 14, README |
| PC-32 | nit | 13, README |
| UD-01 | blocker | 02, 12 |
| UD-02 | blocker | 09, 11, 15 |
| UD-03 | major | 02, 11 |
| UD-04 | major | 11, 12 |
| UD-05 | major | 09, 11 |
| UD-06 | major | 02, 11 |
| UD-07 | major | 02, 11 |
| UD-08 | major | 11, 16 |
| UD-09 | major | 02, 11, README |
| UD-10 | major | 02, 11, 12, 13, 15, BUILD |
| UD-11 | major | 09, 15 |
| UD-12 | major | 15, 16 |
| UD-13 | major | 09, 11 |
| UD-14 | major | 09, 11, 15 |
| UD-15 | major | 11, 15 |
| UD-16 | major | 11, 15 |
| UD-17 | major | 15 |
| UD-18 | major | 15 |
| UD-19 | major | 15 |
| UD-20 | major | 15, README |
| UD-21 | major | 14, 15 |
| UD-22 | major | 11, 15 |
| UD-23 | major | 10, 11, 15 |
| UD-24 | major | 10, 14, 15 |
| UD-25 | major | 10, 11, 15 |
| UD-26 | major | 10, 11, 15 |
| UD-27 | major | 11 |
| UD-28 | major | 10, 11 |
| UD-29 | major | 10, 11, README |
| UD-30 | minor | 11, 15 |
| UD-31 | minor | 09, 11 |
| UD-32 | minor | 11, 15 |
| UD-33 | minor | 11, 15 |
| UD-34 | minor | 09, 10, 15 |
| UD-35 | minor | 11, 13 |
| UD-36 | minor | 15 |
| UD-37 | minor | 11, 15 |
| UD-38 | minor | 15 |
| UD-39 | minor | 15 |
| UD-40 | minor | 15, 16 |
| UD-41 | minor | 02, 11, 15 |
| UD-42 | minor | 11 |
| UD-43 | minor | 02, 11, 15 |
| UD-44 | minor | 09, 11 |
| UD-45 | minor | 02, 09, 11 |
| UD-46 | minor | 02, 11 |
| UD-47 | minor | 02, 11, 12 |
| UD-48 | minor | 11, 16 |
| UD-49 | minor | 09, 11, README |
| UD-50 | minor | 09, 11 |
| UD-51 | minor | 09, 11 |
| UD-52 | minor | 09, 13 |
| UD-53 | minor | 11 |
| UD-54 | minor | 12, 14, README |
| UD-55 | minor | 11, 12, 15 |
| UD-56 | minor | 09, 11, 12, 13 |
| UD-57 | nit | 11, 15 |
| UD-58 | nit | 10, 11, 15 |
| UD-59 | nit | 09, 11 |
| UD-60 | nit | 03 |
| BD-01 | gap | 14, BUILD |
| BD-02 | gap | 02, 12 |
| BD-03 | gap | 02 |
| BD-04 | gap | 02, 09 |
| BD-05 | gap | 02, 06, 10, README |
| BD-06 | gap | 02, 06, 07, README |
| BD-07 | gap | 04, 16 |
| BD-08 | gap | 09 |
| BD-09 | gap | 09 |
| BD-10 | gap | 05 |
| BD-11 | gap | 02, 06 |
| BD-12 | gap | 02, 06, 12 |
| BD-13 | gap | 12 |
| BD-14 | gap | 02, 09 |
| BD-15 | gap | 02, 11 |
| BD-16 | gap | 06, 10, README |
| BD-17 | gap | 06, 10 |
| BD-18 | gap | 02, 05 |
| BD-19 | gap | 14, 15, README |
| BD-20 | gap | 14, 15 |
| BD-21 | gap | 02, 14 |
| BD-22 | gap | 12 |
| BD-23 | gap | 14 |
| BD-24 | gap | 02, 14 |
| BD-25 | gap | 02, 11, 15, BUILD, README |
