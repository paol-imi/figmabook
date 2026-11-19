# @holotype/docs

The Holotype documentation site, built with [VitePress](https://vitepress.dev) and deployed to GitHub Pages. Everything in `docs/` is public: it is the site's source. Internal notes (the plan, research, spike reports) live in [`internal/`](../internal/README.md), outside the site root, and are never published. This README is for contributors; it is not a page of the site.

## Run it locally

From the repository root:

```sh
pnpm install
pnpm -F @holotype/docs dev       # dev server with hot reload, http://localhost:5173/figmabook/
pnpm -F @holotype/docs build     # static site in docs/.vitepress/dist; fails on dead links
pnpm -F @holotype/docs preview   # serve the built site, http://localhost:4173/figmabook/
```

`pnpm build` at the root builds the site too, through Turborepo (cached on the files in `docs/`, the generated diagnostics pages included).

## Content

| Path | Page |
|---|---|
| `index.md` | Home |
| `guide/` | How it works, Concepts, Getting started |
| `reference/cli.md`, `exit-codes.md`, `configuration.md` | CLI reference, written from plan chapters 11 and 16 |
| `reference/diagnostics/` | One page per diagnostic code (see below) |
| `diagnostics/` | Generated diagnostics pages (`pnpm diag:gen`); read by `reference/diagnostics/`, not pages themselves |
| `roadmap.md` | Stages and milestones, from plan chapter 14 |

Rules for content:

- Plain, user-facing English. Short sentences.
- Holotype is pre-release. Say clearly what is planned and what exists today. Do not promise dates.
- "Figma" describes the integration. It is never part of the product name.
- `internal/` (plan, research, spike reports) is **not** published, and the repository is private. Do not link to it or name its files on a page.
- Markdown here is excluded from Biome, because Biome's Markdown formatter rewrites VitePress frontmatter.

### Diagnostics pages

`tools/diag-gen` (`pnpm diag:gen`) is the only generator of the diagnostics pages; it writes them to `docs/diagnostics/`, and `pnpm diag:check` fails when they drift from the catalog. The site does not copy them, and `srcExclude` keeps VitePress from rendering that folder as raw pages. `reference/diagnostics/[code].paths.ts` reads them at build time and serves each one as a page; `.vitepress/lib/diagnostics.ts` adapts them: the generator's banner comment is dropped, the index becomes `/reference/diagnostics/`, and links into `internal/` become plain text, keeping the link text (with `HOLOTYPE_SITE_PLAN_LINKS=repo` they point at the repository). The generator names a design-notes chapter by its title, never by file name, so the plain text gives nothing internal away. The sidebar lists the codes by area, read from the generated index.

After `pnpm diag:gen`, restart `pnpm -F @holotype/docs dev` to see the new pages.

## Build settings

| Variable | Default | Effect |
|---|---|---|
| `HOLOTYPE_SITE_BASE` | `/figmabook/` | URL path the site is served under. Use `/` for a custom domain. A repository rename only changes this value. |
| `HOLOTYPE_REPO_URL` | from `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY` in Actions, else the `origin` remote | Repository the site links to when `HOLOTYPE_SITE_PLAN_LINKS=repo`. With none, the site has no repository links. |
| `HOLOTYPE_SITE_PLAN_LINKS` | `text` | Whether the site links to the repository at all. `text`: no repository links. Links into `internal/` (from the diagnostics pages) are shown as plain text, and the header has no GitHub icon, because the repository is private and the links would be dead for readers. `repo`: links into `internal/` point at the repository, the nav gets a "Design docs" item and the header the GitHub icon. Set `repo` only once the repository is public. Any other value fails the build. |

Local search is built in. Light and dark mode follow the system and can be switched in the header. Edit links are off.

## Deploying to GitHub Pages

### What the workflow does

`.github/workflows/pages.yml` runs on pushes to `main` that touch `docs/` (the site and its generated diagnostics pages), the lockfile or the workflow, and when started by hand (**Actions ▸ Pages ▸ Run workflow**):

1. It installs only the site's dependencies and asks the GitHub API whether Pages is enabled with **GitHub Actions** as its source.
2. It builds the site. When Pages is enabled, the base path comes from the Pages settings (`actions/configure-pages`), so a custom domain or a renamed repository needs no change here.
3. When Pages is enabled, it uploads the site (`actions/upload-pages-artifact`) and deploys it (`actions/deploy-pages`) to the `github-pages` environment. When it is not, the deploy job is skipped with a notice (a warning on a manual run), and the run still passes. If the API cannot be read at all, the run fails rather than skip deploys silently.

On pull requests the workflow only builds the site, which also catches dead links. The CI gate builds it too, as part of `pnpm build`.

### Set it up (repository owner, once)

1. **Check the plan.** Pages for a **private** repository needs GitHub Pro, Team or Enterprise; GitHub Free covers public repositories only ([GitHub's plans][plans]).
2. **Merge the workflow to `main`.** Push runs and the **Run workflow** button only exist once `.github/workflows/pages.yml` is on the default branch ([workflow_dispatch][dispatch]).
3. **Turn Pages on.** Open the repository's **Settings**, then **Pages** (in the "Code, planning, and automation" section of the sidebar). Under **Build and deployment**, under **Source**, select **GitHub Actions** ([publishing source][source]). Ignore the workflow templates GitHub suggests: this repository has its own.
4. **Deploy.** Run **Actions ▸ Pages ▸ Run workflow** on `main`, or push a change to the site. The first deployment creates the `github-pages` environment if it does not exist yet ([publishing source][source]).
5. **Open the site.** It is served at `https://<owner>.github.io/<repository>/` ([project sites][about]). **Settings ▸ Pages** shows the link (**Visit site**) and the run that last deployed it.

### Deploying from another branch (optional)

Pages deploys go through the `github-pages` environment, and GitHub recommends that only the default branch may deploy to it ([publishing source][source]). Expect that rule: a run from any other branch then fails in the deploy job, "not allowed to deploy to github-pages due to environment protection rules". To allow another branch, open **Settings ▸ Environments ▸ github-pages**, and under **Deployment branches and tags** keep **Selected branches and tags** and click **Add deployment branch or tag rule** for that branch ([environments][environments]). Then start the workflow on that branch (**Run workflow ▸ Use workflow from**). The workflow file itself must still be on `main`.

### Custom domain (optional)

1. Optionally verify the domain first, so nobody else can take it over ([verifying a domain][verify]).
2. In **Settings ▸ Pages**, under **Custom domain**, type the domain (for example `docs.example.com`) and click **Save**. No `CNAME` file is needed: with a GitHub Actions workflow, GitHub ignores it ([custom domain][domain]).
3. At your DNS provider, add a `CNAME` record from that subdomain to `<owner>.github.io` (without the repository name). An apex domain (`example.com`) uses `A`/`AAAA` records instead; see [custom domain][domain].
4. Run the workflow again. `actions/configure-pages` now reports an empty base path, so the site is built for `/` with no change to the repository.
5. Once the certificate is ready (it can take up to 24 hours), select **Enforce HTTPS**.

### Who can see it

> [!WARNING]
> **Published Pages are public.** A GitHub Pages site is public on the internet, even when the repository is private ([publishing source][source]). Anyone with the URL can read it. The only exception is an organization on GitHub Enterprise Cloud, which can make a site private under **Settings ▸ Pages ▸ GitHub Pages visibility** ([visibility][visibility]). Publish only what may be public: never internal plans, research or competitor analysis. That is why internal notes live outside the site root, in `internal/`, and why the site renders links into it as plain text, with no link to the repository, unless `HOLOTYPE_SITE_PLAN_LINKS=repo` is set.

[plans]: https://docs.github.com/en/get-started/learning-about-github/githubs-plans
[dispatch]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch
[source]: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
[about]: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
[environments]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
[verify]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages
[domain]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
[visibility]: https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site
