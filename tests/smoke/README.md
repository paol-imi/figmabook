# L0 smoke: CLI → bundle → plugin (demo D1)

BUILD B-15. The first end-to-end check: a Storybook story becomes frames and text in Figma.

## In the container

`pnpm test:smoke` (root; this package's part is `pnpm -F @holotype/smoke test:smoke`):

1. builds the CLI and the plugin (Turborepo, cached); the plugin build ends with its bundle
   size check (`build/main.js` ≤ 400 KB, `build/ui.js` ≤ 600 KB, D-04);
2. builds the `fixtures/ds-react` Storybook into a temp folder, or uses
   `HOLOTYPE_STORYBOOK_STATIC` when set;
3. runs the built `holotype capture` with `micro-flex--row` and `components-badge--default`
   into `tests/smoke/dist/smoke.holotype.zip` (`SOURCE_DATE_EPOCH` fixed, so the bytes are
   the same on every run, which the test checks);
4. reads the zip with the plugin's UI import code (`readBundle`: unzip limits, manifest,
   versions, features, integrity, Scene IR schema), then applies it with the plugin's
   main-thread import session over the real UI ↔ main protocol, against `figma-fake`;
5. compares the fake document, its operation log and the notification with
   `test/__snapshots__/d1.fake.json`.

The snapshot changes when the capture, the mapper, the applier or the fake changes: review the
diff, then run `pnpm -F @holotype/smoke test:smoke -u`.

## Files for the user

`pnpm -F @holotype/smoke run demo` writes the two files of demo D1 to `tests/smoke/dist/`:

| File                            | What it is                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `holotype-plugin-<version>.zip` | the development plugin: `manifest.json` and `build/` (`pnpm -F @holotype/plugin run pack`) |
| `smoke.holotype.zip`            | the bundle: `micro-flex--row` and `components-badge--default`                              |

## User steps (send as written)

1. Download `holotype-plugin-<version>.zip` and `smoke.holotype.zip` from the link I send. Unzip the plugin to a folder that stays put.
2. In the Figma desktop app, open a new design file.
3. Menu **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `manifest.json` in that folder.
4. Run **Plugins ▸ Development ▸ Holotype**. Open **Import file** and drop `smoke.holotype.zip`.
5. Reply "smoke OK" if you see a row of three boxes and a badge. Otherwise copy the plugin's message and paste it here.

Acceptance: CI green, and the user replies "smoke OK" (demo D1, the 14 M0 smoke criterion).
