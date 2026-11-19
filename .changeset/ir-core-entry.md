---
'@holotype/ir': minor
---

New lean entry `@holotype/ir/core`: document versions (`*_VERSION`, `SUPPORTED_*_MAJORS`, `parseMajor`, `checkVersion`), canonical JSON, hashing (`sha256Hex`, `h16`, `hash`, `fnv1a64`) and the `ah` normalizer, without any TypeBox schema or validator. The Figma plugin main thread imports it so its bundle stays small.
