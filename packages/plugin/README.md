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
