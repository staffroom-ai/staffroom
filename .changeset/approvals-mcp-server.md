---
"@staffroom/server": minor
"@staffroom/core": patch
---

"Approve and always allow" works from the office, not just from code, and the
connector strip now tells you the truth about your MCP servers.

A decision has to say what it is allowing: `approve_always` without a match is
refused with `MATCH_REQUIRED` and a hint saying to allow it for a specific
recipient instead. Guessing on the owner's behalf is how one permission becomes
every permission.

Each MCP server is one connector rather than one per tool, carrying the
connection's own health — starting, ok, down, denied, needs auth — and the reason
when there is one. That message goes through redaction, because a connection
failure can quote a URL with a token in it. A server that is down reads as down
even though the tools it used to offer are no longer registered at all.

`mcp.reconnect` brings a server back after you have fixed whatever was wrong,
without restarting the office. And `approvals.yaml` is watched: deleting a row
takes the permission back straight away.
