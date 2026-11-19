# Getting started

::: danger Coming with the first release
There is nothing to install yet. No package is published and the plugin is not distributed. The steps below are the **planned** setup, so you can see what to expect. They will change before the first release.
:::

## What you will need

- A Storybook 10 project. React with Vite is the first supported stack. Other renderers are planned, because Holotype works on the rendered DOM.
- Node.js 22.12 or newer (Node.js 24 LTS recommended), for the CLI.
- The Figma desktop app, for the plugin.
- For branch files: a Figma plan with branching. Without one, a duplicated file works as a fallback.
- For change requests: an AI coding agent of your choice.

## Planned: install the plugin

Distribution is private at first, as a Figma development plugin. A designer needs only the Figma desktop app: no Node.js, no terminal.

1. Get `holotype-plugin-<version>.zip` from a release.
2. Open it. It contains one folder, `Holotype Plugin`. Move that folder to your Documents folder.
3. In the Figma desktop app, open the main menu and choose **Plugins ▸ Development ▸ Import plugin from manifest…**. Pick `Holotype Plugin/manifest.json`.
4. Run **Plugins ▸ Development ▸ Holotype**.

To update, replace the `Holotype Plugin` folder with the new one. You do not need to import it again. Settings and file data are kept.

Later, a private organization plugin is planned: an admin publishes it to the organization, and members run it from **Resources ▸ Plugins** with automatic updates.

## Planned: set up the CLI

The CLI is planned as the npm package `@holotype/cli`, with the binary `holotype` (alias `holo`). Setup will start with:

```sh
npx @holotype/cli@latest init
```

`init` is planned to:

1. detect Storybook: its version, framework and addons;
2. check that the dev server answers on port 6006, or offer to run `storybook build`;
3. download the pinned Chromium it renders with (about 170 MB);
4. add `@holotype/cli` as a devDependency and a `holotype` script to `package.json`;
5. write `holotype.config.ts` (see [Configuration](/reference/configuration));
6. add these lines to `.gitignore`, so local data stays out of git while change requests and branch links are committed:

   ```txt
   .holotype/*
   !.holotype/requests/
   !.holotype/branches/
   ```

7. print a `holotype doctor` summary of the environment.

## Planned: first import

The first supported flow uses files only. It needs no server and no pairing between the CLI and the plugin.

1. Run `pnpm holotype capture`. It renders, captures and maps your stories, then writes `.holotype/out/<runId>.holotype.zip` and an HTML report.
2. In Figma, run the plugin and choose **Import file**. Pick the `.holotype.zip`.
3. Check the fonts step: map missing fonts or accept a substitute.
4. Review the preview of what will be created, then apply.
5. Read the report: warnings, with links to their [diagnostics](/reference/diagnostics/).

The target is less than five minutes from `init` to the first component in Figma, on a typical React and Vite Storybook (not counting the Chromium download).

## Then

- To try the design-to-code loop, read [How it works](./how-it-works).
- To follow progress, see the [Roadmap](/roadmap).
