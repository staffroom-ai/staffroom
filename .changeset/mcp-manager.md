---
"@staffroom/core": minor
---

Staffroom connects to MCP servers. An office can now use anything that speaks the
protocol — Notion, a database, your own server — and those tools appear to the
agents alongside the built-in ones.

Three rules shape the implementation, because this is the one place the product
runs and trusts software it did not write:

A server that will not start never stops the office opening. It is shown as
unavailable with the reason, and the staff carry on without it. Starting is fire
and forget, so a server on the far side of a slow network cannot hold the office
closed.

Every MCP tool is `egress: true`, whatever the server claims, because calling one
sends the agent's input off this machine. `readOnlyHint` lowers a tool to read
scope; anything else needs the owner's approval.

A server can change its tools underneath you, so each one's fingerprint is
recorded and a change is reported rather than absorbed — added, removed and
changed, by name.

Spawned servers get a minimal environment (PATH, HOME, TMPDIR) rather than the
office's own, which would hand every key in it to somebody else's program. A
server named in `mcp.deny` is never started at all. One whose `$TOKEN` never
resolved says which variable to set instead of retrying forever.

The approval card for an MCP tool says plainly that Staffroom cannot see what the
server will do with the fields, and reduces an HTTP endpoint to its origin —
a path or query on an MCP URL often carries a tenant or a token, and an approval
card is the wrong place to print one.
