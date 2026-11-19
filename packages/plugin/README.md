# @holotype/plugin

The Holotype Figma plugin ([09](../../docs/plan/09-plugin.md)). Built with create-figma-plugin
(D-06): a sandboxed main thread that owns the document, and a Preact UI iframe.
Install steps for designers: [INSTALL.md](INSTALL.md).

## Scripts

| Command                                              | Does                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm -F @holotype/plugin build`                     | `manifest.json`, `build/main.js`, `build/ui.js`, then the size check                 |
| `pnpm size` (root) / `pnpm -F @holotype/plugin size` | bundle budgets: main ≤ 400 KB, UI ≤ 600 KB (D-04)                                    |
| `pnpm -F @holotype/plugin run pack`                  | reproducible `dist/holotype-plugin-<version>.zip` for import as a development plugin |
| `pnpm -F @holotype/plugin test` / `test:ui`          | all unit tests / the UI tests only                                                   |

The manifest is the `figma-plugin` field of `package.json` (09 §2). Its `id` is the placeholder
`"holotype"` until Figma issues the real one; see INSTALL.md, "For maintainers".

## Layout

| Path              | Contents                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `src/main.ts`     | entry of the main thread; the only module that touches `figma` (09 §4)                                 |
| `src/protocol.ts` | the main ↔ UI message union and its runtime validators (09 §3.2)                                       |
| `src/channel.ts`  | typed, session-scoped channels over `figma.ui` and the iframe `window`                                 |
| `src/host.ts`     | main side of a session: handshake, IR version gate, cancel flag, ping/pong yield                       |
| `src/port.ts`     | `FigmaPort`, the applier's view of the Plugin API (owned by B-06)                                      |
| `src/apply/`      | the applier (09 §5–§6): session, pull loop, resources, per-node writers; `FigmaPort` only, no `figma`  |
| `src/ui/`         | Preact UI: `App`, `components/` (Tabs, Button, state views), `screens/`, `import/`, `messages/en.json` |

## Public API

`src/protocol.ts`

- Types: `UiToMain`, `MainToUi` (and their `*Body` / `*Type` forms), `Envelope`, `MessageOf`, `BodyOf`,
  `UnitRef`, `TransferUnit`, `Stage`, `BundleSource`, `ApplyOptions`, `ApplySummary`, `RegistrySummary`.
- `PROTOCOL_VERSION` (1), `MAX_PART_BYTES` (1 MB), `MAX_DIAGNOSTICS_PER_MESSAGE` (200), `STAGES`,
  `BUNDLE_SOURCES`, `UI_TO_MAIN_TYPES`, `MAIN_TO_UI_TYPES`.
- `parseUiToMain(value)`, `parseMainToUi(value)`: the message, or `undefined` when malformed, from
  another protocol version, or without a session.
- `diagnosticBatches(items)`: `diagnostics` bodies of at most 200 items.

`src/channel.ts`

- `createMainChannel(transport)`: binds to the session of the latest `hello`.
- `createUiChannel(transport, sessionId)`, `createSessionId()`.
- `figmaUiTransport(figma.ui)`, `windowTransport(window)`.
- `Channel.send(body)`, `.on(t, handler)`, `.next(t, { signal, where })`, `.close()`; `ChannelError`.

`src/host.ts`

- `startHost({ channel, pluginVersion, irMajors, fileKey, registry?, openSession? })` → `Host`
  with `cancelRequested`, `uiRoundTrip(signal?)` and `dispose()`. A bundle whose Scene IR major is
  not supported is answered with `error` `APPLY_IR_VERSION_UNSUPPORTED`.

`src/apply/` (slice applier, B-14: absolute layout, one frame per variant on page "Components")

- `runImportSession({ message, host, channel, port, now, yieldToEditor, createId })`: one session on
  main: pulls each component and asset from the UI, applies them, streams `progress` (≤ every
  100 ms), `diagnostics` and `done` (with the `ApplyReport`). `parseComponent`, `createApplyId`.
- `applyBundle(options)` → `{ summary, report }`: the protocol-free core (page, placement, undo per
  component or `single`, cancel between variants, per-component failure, selection, `notify`).
  `applyComponent`, `variantFrameName`, `notifyMessage`.
- `createPuller(channel)` → `{ component(sid), asset(sha256) }` (09 §3.3 reassembly).
- `ResourceCache` (fonts, images and SVGs prepared once per session), `FontResolver`,
  `styleWeight`, `rankStyles`, `nearestStyle`, `fontRequestKey`.
- `writeNode`, `WRITERS` and `orderedWriters()` (`write/index.ts`: one line per writer, append only;
  writers run in 09 §6 step order), `NodeWriter`, `WriteContext`, `WriteTarget`.
- `writeIdentity`, `writeProvisionalKey`, `identityVersion`, `variantArgs`, `IDENTITY_NAMESPACE`,
  `APPLIER_EPOCH`; `ensureComponentsPage`, `COMPONENTS_PAGE`; `variantGrid`, `nextComponentTop`,
  `contentBottom`; `readbackDelta`; `toPaint(s)`, `toEffect(s)`; `createSlicer`, `NO_SLICING`;
  `utf8Decode`; `SUPPORTED_FEATURES`, `unsupportedFeatures` (`features.ts`).

What the slice applier writes, and what it falls back on:

| Scene IR                                     | Written as                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| variant root (`component`), `frame`, `group` | frame (component sets are B-57)                                                     |
| `rectangle`, `image`, `ellipse`, `vector`    | rectangle, ellipse, vector with `vectorPaths`                                       |
| `text`                                       | text: base font, characters, range styles, paragraph settings, sizing last          |
| `svg`                                        | `createNodeFromSvg`, unwrapped when asked; else an empty frame, `SVG_IMPORT_FAILED` |
| `instance`                                   | its fallback subtree as frames, `APPLY_INSTANCE_TARGET_MISSING` (B-142)             |
| `layout` (auto layout)                       | absolute, from `fallback` boxes, `APPLY_LAYOUT_FALLBACK` (B-56)                     |
| missing font                                 | the request's fallback family (else Inter) at the nearest weight, `FONT_MISSING`    |
| image Figma refuses                          | fill left out, `APPLY_IMAGE_REJECTED`                                               |
| `bind`, `propRefs`, `slot`                   | not written: bundles that need them declare a feature, which the import refuses     |

`src/ui/import/`

- `readBundle(fileName, zip, { limits?, unzip? })` → `Result<LoadedBundle, Diagnostic>`: unzip
  within 06 §8 limits (`APPLY_BUNDLE_REJECTED`), manifest kind, versions
  (`APPLY_IR_VERSION_UNSUPPORTED`), schema, features (`APPLY_UNSUPPORTED_FEATURE`), integrity and
  Scene IR validation (`APPLY_BUNDLE_CORRUPT`).
- `unzipBundle`, `fflateUnzip` (Web Workers, synchronous fallback), `BUNDLE_LIMITS`.
- `serveBundle(channel, bundle, maxPartBytes?)`, `splitUtf8(text, maxBytes)`.
- `useImport(channel)` → `{ state, importFile, reset }`; `ImportScreen` (empty, loading, error,
  success).

`src/ui/`

- `App`, `TABS`; `Tabs`, `Button`, `EmptyState`, `LoadingState`, `ErrorState`, `SuccessState`.
- `reduceRun(state, message)` folds `progress` / `diagnostics` / `done` / `error` into a `RunState`.
- `useHandshake`, `useRun`, `usePong`.
- `formatMessage(message, args, locale)` (ICU subset: arguments and `plural`), `createTranslator`, `t`.

## UI conventions

- Every string comes from `src/ui/messages/en.json` through `t()` (11 §6.13). Copy follows 11 §6.12:
  no "IR", "Scene", `nk` in user-facing text.
- Colors come only from Figma's theme variables (`--figma-color-*`, `themeColors: true`), with
  light-theme fallbacks, so both themes keep Figma's contrast.
- Every flow has empty, loading, error and success states (BUILD §3.2); status is never shown by
  color alone, focus rings are always visible, and motion respects `prefers-reduced-motion`.
