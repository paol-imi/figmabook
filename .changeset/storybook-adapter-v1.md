---
'@holotype/storybook': minor
'@holotype/capture': minor
'@holotype/shared': patch
---

Storybook adapter v1 (B-40): `openDriver()` now gives the channel render loop on one long-lived `iframe.html` page (args preset before `setCurrentStory`, full-set `updateStoryArgs`, globals over `initialGlobals`, remount after an error, fresh document after a timeout, adoption of a preview that reloads itself with `SB_HMR_DURING_CAPTURE`, the stricter stability check, decorator unwrapping, one retry on a fresh document and `SB_STORY_UNRENDERABLE`), with the URL path as fallback or with `mode: 'url'`. `RenderDriver.dispose()` is bounded. New `describe(page, ids)` reads story metadata (args, initialArgs, normalized argTypes, tags, validated `parameters.holotype` with the config precedence, `CodeRef` from the index and the SB 10 components manifest). Storybook majors other than 10 warn `SB_VERSION_UNTESTED`. The capturer renders through the channel by default (`renderMode: 'url'` opts out) and takes `unwrap`; `PLAN_PARAM_UNKNOWN_KEY` gets a message template.
