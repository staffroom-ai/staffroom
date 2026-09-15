---
"@staffroom/core": minor
---

Config loading, model resolution and secret redaction. `agents.yaml` and
`config.yaml` now parse, validate and report problems the way an owner can act on,
edits keep the owner's comments, and every agent resolves to a model through a
documented four-step chain.
