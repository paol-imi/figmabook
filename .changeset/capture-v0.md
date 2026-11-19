---
'@holotype/capture': minor
---

Capture engine v0: `createCapturer()` runs one Chromium with the D-24 environment (frozen `Date`, seeded `Math.random`, reduced motion, DPR 2, 1280×800, pinned flags) and a worker pool with component affinity and crash recovery. `capture()` renders through the Storybook driver, serializes the page with the collector registry (element rects, background color, borders, radii, opacity, text runs with line boxes) and returns a validated, canonical `CaptureDoc` with its `captureHash` and a root screenshot.
