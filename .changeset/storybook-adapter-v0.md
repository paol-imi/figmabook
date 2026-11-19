---
'@holotype/storybook': minor
---

Storybook adapter v0: `connectStorybook()` discovers a static build or a URL (index v4/v5, `project.json`, capabilities, version gate), `listStories()` applies the `figma` / `!figma` tag filter and `include` / `exclude` globs, and `openDriver(page).render()` renders stories through `iframe.html` URLs and waits for `storyFinished` (or `storyRendered`), fonts and two animation frames.
