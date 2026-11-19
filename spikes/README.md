# Holotype Spikes

A small Figma plugin that runs a few experiments ("spikes") in your Figma desktop app and gives you a block of text to paste back into the chat. The answers decide how Holotype is built.

- It is a **separate development plugin**. It is not the Holotype plugin and does not change it.
- It only creates test pages, layers, components and variables in the files you run it in. Use the empty test files below, not real work files.
- The text you paste back contains **no names, emails or file names**. It has the spike results, the Figma plugin API version and whether you used the desktop app on macOS or Windows. When a spike needs to compare files, it stores a short fingerprint of the file key, never the key itself.

---

## 1. One-time setup (about 5 minutes)

You need the **Figma desktop app** on your Mac. Development plugins do not run in the browser.

1. **Download the kit.** Open the link from the chat and download `holotype-spikes.zip`.
2. **Unzip it.** In Finder, open Downloads and double-click `holotype-spikes.zip`. A folder named `holotype-spikes` appears.
3. **Move the folder somewhere it can stay**, for example your Documents folder. Figma remembers where it is. If you move it later, do step 6 again.
4. **Create the test files.** In Figma, create new design files with exactly these names (File ▸ New design file, then click the file name to rename it):
   - **Spikes Scratch**
   - **Spikes Library**
   - **Spikes Consumer**

   Put **Spikes Library** and **Spikes Consumer** in the same team, so the consumer can use the library.
5. **Open any of the files** (for example Spikes Scratch).
6. **Import the plugin.** Click the Figma menu at the top left (the Figma logo), then **Plugins ▸ Development ▸ Import plugin from manifest…**. In the window that opens, go into the `holotype-spikes` folder and pick **manifest.json**.

That's it. You do not need to import again unless you move the folder.

## 2. Running a spike

1. Open the file the step asks for (each step says "Run in: …").
2. Figma menu ▸ **Plugins ▸ Development ▸ Holotype Spikes**. (You can also right-click the canvas ▸ Plugins ▸ Development ▸ Holotype Spikes.)
3. Click the spike, then the step's **Run** button.
4. If a blue **Your turn** box appears, do what it says (for example "change the stroke width to 3"), then click the button in the box.
5. Wait for **Done**. Click **Copy results** and paste into the chat.
   - Big results come in parts: click **Copy part 1 of 3**, paste, then part 2, and so on.
   - If copying does not work, click in the text box under the buttons, press **Cmd+A**, then **Cmd+C**, and paste.
   - Or click **Save results file**. The file goes to your Downloads folder; attach it in the chat.
6. If you see **Failed**, click **Copy error report** and paste it anyway. Failures are useful results too.

Multi-step spikes remember their progress on this computer, so you can close Figma between steps. Run all steps of one spike **on the same computer**. The plugin shows a green **Done** next to steps that already ran; **Show last result** copies them again. **Start over** forgets a spike's saved steps.

## 3. Updating the kit

When I send a new version: move the old `holotype-spikes` folder to the Bin, then unzip the new zip **in the same place** (so the folder has the same name and location). No new import is needed. The kit version is shown at the top right of the plugin window.

## 4. The spikes

Run them in this order if you can. Times are rough.

### S-02 · Override preservation (about 40 minutes, needs library publishing)

Checks which edits to a main component keep the changes people made on its instances, in the same file and through a library update.

1. In **Spikes Library**, run **Step 1 (build)**. It builds 19 test component sets and 247 instances on a new page (a minute or two).
2. Publish the library: open the **Assets** panel, click the **Libraries** icon (book), then **Publish…** and confirm.
3. Open **Spikes Consumer**. In **Assets ▸ Libraries**, turn on **Spikes Library**. Run **Step 2 (place instances)**.
4. Back in **Spikes Library**, run **Step 3 (mutate)**. Copy results and paste. Then publish again.
5. In **Spikes Consumer**, accept the update (a notice **Updates available** appears at the bottom right; click **Review** ▸ **Update all**). Run **Step 4 (read)**. Paste.

### S-05 · Border model (about 10 minutes, ideally a designer)

Checks whether Holotype should keep its way of turning CSS borders into Figma strokes.

1. In **Spikes Scratch**, run **Run**. Paste the results.
2. Run **Designer check**. When asked, scroll down the "S-05 Border model" page to the frames labelled **A** and **B**. Select A and set its stroke width to 3, then the same for B. Click **Continue**, choose which one behaved as you expected, and add one sentence why. Paste.

### S-06 · Plugin environment (about 2 minutes)

Checks what the plugin can do inside Figma: timers, encryption functions, running generated code, background workers, unzipping files, how big messages can be, reading the file key, and downloading a file. You only click and answer one question; the plugin does the rest.

1. In a new empty design file (Spikes Scratch is fine), run **Step 1 (quick checks)**. Figma may pause for a few seconds.
2. The plugin tries to download a small file named `holotype-s06-download-test.txt`. Answer whether a download appeared. Paste.

### S-12 · Variables (about 20 minutes, needs library publishing)

Checks which layer properties can use variables, how many modes your plan allows, and whether another file can find the library variables.

1. In **Spikes Library**, run **Step 1**. It asks which Figma plan the file is in. Paste the results.
2. Publish the library with its variables (Assets ▸ Libraries ▸ Publish…).
3. In **Spikes Consumer**, make sure **Spikes Library** is turned on (Assets ▸ Libraries), then run **Step 2**. Paste.
4. Optional: if you also have a Starter or Professional account, run Step 1 in a file there and paste.

### S-16 · Instance properties → args (about 10 minutes)

Checks whether a component instance's settings can be turned back into code arguments and rebuilt into the same instance.

1. In **Spikes Scratch**, run **Run**. Paste.

### S-17 · Branches and plugin data (about 20 minutes, needs an Organization account)

Checks whether Figma branches keep the hidden data Holotype stores in a file. Branches need an Organization or Enterprise plan.

1. In **Spikes Library**, run **Step 1**.
2. File menu (the file name at the top) ▸ **Create branch…**, name it `spike-s17`. In the branch, run **Step 2**.
3. Go back to the main file (Spikes Library) and run **Step 3**.
4. Open the branch again. When Figma offers **Update from main**, accept it. Then run **Step 4**.
5. In the branch, click **Review and merge** ▸ **Merge**. Open the main file and run **Step 5**. Copy results and paste: this one block has all five steps.

## 5. If something goes wrong

| What you see                                                                | What to do                                                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| No **Development** item under Plugins                                       | Use the Figma desktop app, not the browser.                                                                     |
| "Holotype Spikes" is missing, or Figma says it cannot find the plugin files | The folder was moved or renamed. Do setup step 6 again.                                                         |
| "Could not import the library components" / "variables were not found"      | Publish **Spikes Library**, then turn it on in **Spikes Consumer** (Assets ▸ Libraries) and run the step again. |
| "Run Step 1 … first"                                                        | Run the earlier steps of that spike on this computer first.                                                     |
| "The library update does not seem to be accepted yet"                       | In Spikes Consumer, click **Update all** in the updates notice, then run Step 4 again.                          |
| Figma seems frozen                                                          | Wait up to two minutes. Large steps lock Figma while they build. If it never comes back, tell me in the chat.   |
| Anything else                                                               | Click **Copy error report** and paste it in the chat.                                                           |

---

## For developers

The kit is the `@holotype/spikes` workspace package (BUILD B-08, §9).

```sh
pnpm -F @holotype/spikes build     # → dist/holotype-spikes.zip (+ -<version>.zip), runner/build/*
pnpm -F @holotype/spikes test      # unit tests, UI tests and dry runs of every spike
pnpm -F @holotype/spikes test:e2e  # Chromium checks: S-05 reference data, S-19 provenance on the ds-react dev server
pnpm -F @holotype/spikes refs      # regenerate S-05/refs.json with headless Chromium
pnpm build && pnpm -F @holotype/spikes s19   # S-19 coverage run → S-19/results/summary.json (internal/spikes/S-19.md)
pnpm -F @holotype/spikes s19:record          # re-record S-19/test/fixtures/button-primary.json from the dev server
```

To try a local build without the zip, import `spikes/runner/manifest.json` in Figma desktop.

| Path       | Contents                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `runner/`  | the plugin: manifest, main host, UI (Preact), build scripts, tests and the dry-run Plugin API                                 |
| `_shared/` | the spike contract (`spike.ts`), result envelope, Figma and pixel helpers, schemas                                            |
| `S-xx/`    | one spike: `plugin.ts` (main tasks), `steps.ts` (UI steps), pure model files, `schema.ts` (answers), `test/`                  |
| `S-19/`    | container-only, not in the kit: the CSS provenance resolver (`resolver/`, reused by B-45), the CDP probe and the coverage run |

How it works: the UI runs each step as an async function. It calls named main tasks (`S-xx/<task>`) over `postMessage`, asks the user with `io.ask`, keeps multi-step state in `figma.clientStorage`, and returns JSON. The runner wraps it in the envelope `{ format, spike, kitVersion, step, status, env: { apiVersion, editorType, client, os }, results }`, where `results.answers` answers the spike's questions directly. Every task receives the Plugin API as a parameter, so `pnpm test` runs every step against a dry-run API (`runner/test/support/dry-run-figma.ts`); members that `@holotype/figma-fake` does not implement yet are served and listed by that recording model.

The manifest id `holotype-spikes-dev` is a placeholder for a development plugin and is never the product plugin's id.
