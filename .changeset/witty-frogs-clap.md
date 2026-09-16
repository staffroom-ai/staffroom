---
"@staffroom/core": patch
"@staffroom/server": patch
"@staffroom/web": patch
---

The brain reaches the browser: the graph, live note changes, warnings, uploads.

`brain.graph.get` answers the tab that asked and nobody else — it is a whole
snapshot of the brain, and sending it to every tab because one person opened a
panel would be sending it to tabs looking at something else.

A note written or deleted in Obsidian now shows up without a reload. The office
pushes a delta rather than a new graph, because this comes from a file watcher
and a snapshot per keystroke is not a design.

`brain.warning` is pushed for the first time. Front matter that would not parse
says so and says the note was indexed anyway, so nobody thinks their writing was
thrown away. A pinned set over budget names the notes the agent did not get to
see: the pinned notes are the only context every agent gets without asking, so
one falling out silently is an agent working without something the owner
believed it had.

`POST /api/brain/upload` takes a `.md`, `.txt` or `.pdf` into `brain/inbox/`,
where notes are indexed at half weight and never pinned. It is the one route
that writes a file the owner did not type, so the filename is not checked but
thrown away and rebuilt: a multipart filename is attacker-chosen text about to
become a path. An upload never lands on a name already taken.
