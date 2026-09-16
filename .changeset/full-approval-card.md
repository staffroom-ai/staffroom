---
"@staffroom/web": minor
"@staffroom/core": patch
---

The approval card offers all three answers: approve once, approve and always
allow, or decline. "Always allow" opens a confirm step first, because a
permission written without being read is not a permission anybody gave.

The confirm proposes what to allow from the call's own destination fields — `to`,
`cc`, `channel`, `url` and the rest — prefilled and editable. A list of one
destination is treated as that destination, which is how most MCP tools send. A
call with several different destinations is left for you to fill in rather than
widened on your behalf: turning one address at a domain into `*@domain` would be
inventing a permission nobody asked for.

A tool with nothing that looks like a destination cannot be always-allowed by
accident; it takes a deliberate tick. The sentence you confirm names the person,
what the tool does, the tool's real name, and where it is allowed to go.

An MCP tool's card carries the line saying Staffroom cannot see what that server
will do, and a tool that changed since you allowed it says so in amber above the
buttons. `S` then Enter opens the confirm — never sends.
