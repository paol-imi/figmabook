---
'@holotype/cli': minor
'@holotype/planner': minor
---

CLI v0: `holotype capture --storybook <dir|url> --story <id> --out <dir|file.holotype.zip> [--json]` plans each story as a one-variant component (`planner.planSingleStory`), captures it in headless Chromium, maps it to Scene IR and writes a deterministic bundle (`manifest.json` first, `components/<sid>.json`, `assets/<sha>`, `report.json`, sha256 `integrity`; STORE for images, DEFLATE for JSON). Exit codes follow 11 §3.2; `--json` prints a `RunReport`. A minimal config loader reads `holotype.config.{ts,mts,js,mjs,json}`, and `defineConfig` is exported from `@holotype/cli/config`.
