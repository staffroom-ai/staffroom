---
"staffroom": minor
"@staffroom/core": patch
---

`npx staffroom setup` exists. Two doctor checks and the `NO_MODEL_CONFIGURED`
error have been telling people to run it, and it was not there. It asks for your
model keys, checks each one with a one-token request, picks the default model
from what your provider actually offers, and asks about web search and telemetry.
`--non-interactive` takes the same answers as flags.
