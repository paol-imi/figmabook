# Install the Holotype plugin (Figma desktop app, macOS)

You need only the Figma desktop app. No terminal, no Node.js, no developer tools.
Holotype is installed as a _development plugin_ until it is published to your
organization ([11 §2.0](../../docs/plan/11-ux.md#install)).

## What you need

- The **Figma desktop app** for macOS, signed in. The browser version of Figma does not run
  development plugins reliably, so use the app (download it from figma.com/downloads).
- The file **`holotype-plugin-<version>.zip`**, for example `holotype-plugin-0.1.0.zip`, from
  whoever sent you Holotype.
- Edit access to a Figma Design file (your own drafts are fine).

## Install (once)

1. **Unzip.** In Finder, double-click `holotype-plugin-<version>.zip`. A folder named
   `holotype-plugin-<version>` appears next to it (usually in **Downloads**).
2. **Give it a permanent home.** Drag that folder into **Documents**, then rename it to
   **`Holotype plugin`** (click the name once, wait, then type). Figma loads the plugin from
   this folder every time you run it, so don't move or delete it later.
3. **Open Figma.** Start the Figma desktop app and open any Figma Design file, or create one:
   **Drafts ▸ + ▸ Design file**.
4. **Import.** In the file, click the **Figma menu** (the Figma logo at the top left), then
   choose **Plugins ▸ Development ▸ Import plugin from manifest…**
   - Same command, other ways: right-click an empty spot on the canvas and choose
     **Plugins ▸ Development ▸ Import plugin from manifest…**, or press **⌘ /** and type
     `Import plugin from manifest`.
5. **Pick the manifest.** In the window that opens, go to **Documents ▸ Holotype plugin**,
   select **`manifest.json`**, and click **Open**. Holotype now appears under
   **Plugins ▸ Development**.

## Run

- **Figma menu ▸ Plugins ▸ Development ▸ Holotype**, or press **⌘ /**, type `Holotype`, and press
  **Return**.
- A window titled **Holotype** opens with four tabs: **Library**, **Import file**, **Report** and
  **Settings**. It follows Figma's light or dark theme.
- Keyboard: **Tab** moves into the tabs, **← →** switch tabs, **Home / End** jump to the first
  or last tab.

## Update to a new version

You don't import again. Figma reads the plugin from your folder on every run.

1. Unzip the new `holotype-plugin-<version>.zip` (step 1 above).
2. Open the new folder. Select **`manifest.json`** and the **`build`** folder inside it
   (**⌘-click** both).
3. Drag them into **Documents ▸ Holotype plugin**. When Finder asks, choose **Replace**.
4. Close the Holotype window if it is open, then run the plugin again. **Settings ▸ About** shows
   the new version.

Your settings and the data Holotype stored in your Figma files are kept.

## If something goes wrong

| What you see                                                          | What to do                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| There is no **Development** item under **Plugins**                    | You are in the browser, or in a FigJam or Slides file. Open a Figma **Design** file in the desktop app.                                          |
| Figma says the manifest is invalid, or nothing happens after **Open** | You picked a file other than `manifest.json`, or the `build` folder is missing next to it. Unzip again and repeat steps 2–5.                     |
| Holotype is missing from **Plugins ▸ Development** after an update    | The folder was moved or renamed. Put it back at **Documents ▸ Holotype plugin**, or import `manifest.json` again from its new place.             |
| The window says **"Holotype didn't start"**                           | Close the plugin window and run it again. If it keeps happening, send the plugin version from **Settings ▸ About** to whoever sent you Holotype. |

To remove the plugin: **Figma menu ▸ Plugins ▸ Manage plugins…**, find **Holotype** under
**Development**, and remove it. Then you can delete the `Holotype plugin` folder.

---

## For maintainers

- Build the zip with `pnpm -F @holotype/plugin build && pnpm -F @holotype/plugin run pack`
  (`run` is needed: a bare `pnpm pack` is pnpm's own tarball command). It writes
  `packages/plugin/dist/holotype-plugin-<version>.zip` with `manifest.json`, `build/main.js` and
  `build/ui.js` at its root, byte-for-byte reproducible.
- **The manifest `id` is a placeholder (`"holotype"`).** Before the first release, create the
  plugin once in Figma to get its real id, and put it in `package.json` → `figma-plugin.id`.
  The id is fixed forever afterwards: `clientStorage` and plugin data are keyed by it
  ([02 §6.4](../../docs/plan/02-architecture.md)). `pack` warns while the placeholder is in use.
