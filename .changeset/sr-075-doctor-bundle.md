---
"@staffroom/core": minor
"@staffroom/server": minor
"staffroom": minor
---

More from `npx staffroom doctor`, and a support bundle that is safe to send.

Six new checks: one line per MCP server and whether its secrets resolved, whether
web search will actually work, standing permissions nobody has used in a month,
links pointing at notes that are not there, and how much runs unattended.

And `brain.secrets`: a note containing something shaped like an API key or a card
number. Every agent reads your notes and a pinned one goes into every prompt, so
a key written into a note is a key sent to a model provider. Notes in
`brain/_private/` are skipped, because that is where such a note belongs.

`npx staffroom doctor --bundle` writes a zip with the config, the doctor report
and the log, with every value from your `.env` replaced by the name it came from,
in every file. The `.env` itself is never included. It exists so nobody zips the
folder by hand, because the hand-made version is the one with the keys in it.
