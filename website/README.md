# @holotype/website

The Holotype documentation site, built with [VitePress](https://vitepress.dev) and deployed to GitHub Pages. This README is for contributors; it is not a page of the site.

## Run it locally

From the repository root:

```sh
pnpm install
pnpm -F @holotype/website dev       # dev server with hot reload, http://localhost:5173/figmabook/
pnpm -F @holotype/website build     # static site in website/.vitepress/dist; fails on dead links
pnpm -F @holotype/website preview   # serve the built site, http://localhost:4173/figmabook/
```

`pnpm build` at the root builds the site too, through Turborepo (cached on the site's files and `docs/diagnostics/`).

## Content

| Path | Page |
|---|---|
| `index.md` | Home |
| `guide/` | How it works, Concepts, Getting started |
| `reference/cli.md`, `exit-codes.md`, `configuration.md` | CLI reference, written from plan chapters 11 and 16 |
| `reference/diagnostics/` | One page per diagnostic code (see below) |
| `roadmap.md` | Stages and milestones, from plan chapter 14 |

Rules for content:

- Plain, user-facing English. Short sentences.
- Holotype is pre-release. Say clearly what is planned and what exists today. Do not promise dates.
- "Figma" describes the integration. It is never part of the product name.
- `docs/plan/` and `docs/research/` are internal and are **not** published. Link to the repository instead (the site's "Design docs" link).
- Markdown here is excluded from Biome, because Biome's Markdown formatter rewrites VitePress frontmatter.

### Diagnostics pages

`tools/diag-gen` (`pnpm diag:gen`) is the only generator of the diagnostics pages; it writes them to `docs/diagnostics/`. The site does not copy them. `reference/diagnostics/[code].paths.ts` reads them at build time and serves each one as a page; `.vitepress/lib/diagnostics.ts` adapts their links (the index becomes `/reference/diagnostics/`, links into `docs/plan/` point at the repository). The sidebar lists the codes by area, read from the generated index.

After `pnpm diag:gen`, restart `pnpm -F @holotype/website dev` to see the new pages.

## Build settings

| Variable | Default | Effect |
|---|---|---|
| `HOLOTYPE_SITE_BASE` | `/figmabook/` | URL path the site is served under. Use `/` for a custom domain. A repository rename only changes this value. |
| `HOLOTYPE_REPO_URL` | from `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY` in Actions, else the `origin` remote | Repository that "Design docs" and the diagnostics source links point at. With none, the site has no repository links. |

Local search is built in. Light and dark mode follow the system and can be switched in the header. Edit links are off.

## Deployment

`.github/workflows/pages.yml` runs on pushes to `main` that touch the site, `docs/diagnostics/`, the lockfile or the workflow, and on manual dispatch:

1. It installs only the site's dependencies and checks whether GitHub Pages is enabled with GitHub Actions as its source.
2. It builds the site. When Pages is enabled, the base path comes from the Pages settings (`actions/configure-pages`), so a custom domain or a renamed repository needs no change here.
3. When Pages is enabled, it uploads the site (`actions/upload-pages-artifact`) and deploys it (`actions/deploy-pages`). Otherwise it skips the deploy job and leaves a notice; nothing fails.

On pull requests the same workflow only builds the site, which also catches dead links. The CI gate builds it too, as part of `pnpm build`.

## Enable GitHub Pages

The workflow is inert until the repository owner turns Pages on:

1. Check the plan: GitHub Pages for a **private** repository needs GitHub Pro, Team, Enterprise Cloud or Enterprise Server.
2. Open the repository **Settings ▸ Pages**.
3. Under **Build and deployment ▸ Source**, choose **GitHub Actions**.
4. Run the **Pages** workflow once (Actions ▸ Pages ▸ Run workflow), or push a change to the site.

The site is then served at `https://<owner>.github.io/<repository>/`. For a custom domain, set it in the same settings page; the next build picks up the new base path.

> [!WARNING]
> **Published Pages are public.** A GitHub Pages site is public on the internet, even when the repository is private. Anyone with the URL can read it. The only exception is GitHub Enterprise Cloud, where an organization can publish Pages privately (access control under Settings ▸ Pages ▸ Visibility). Publish only what may be public: never internal plans, research or competitor analysis.
