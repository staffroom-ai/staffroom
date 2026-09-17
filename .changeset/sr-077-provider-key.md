---
"@staffroom/core": patch
---

A key pasted into Settings now actually configures the provider. It was written
to `office/.env` and nothing else, and the office builds its providers from
`config.yaml` — which ships empty — so the key was saved somewhere nothing read
it and the office stayed in demo mode. Settings also says how to make a saved
key take effect.
