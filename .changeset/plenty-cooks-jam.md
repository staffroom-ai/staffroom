---
"@staffroom/core": patch
"@staffroom/server": patch
"@staffroom/web": patch
---

The brain, as a picture you can open with G.

A force layout drawn in SVG, written out rather than pulled in: the graph is a
business's notes, not a social network, so a general-purpose library would be
several times the size of the thing it lays out. It is also deterministic — the
same brain draws the same picture every time it opens, because an owner learns
the shape of their own notes and a picture that rearranges itself is one they
stop reading.

Colour says who wrote a note, a ring says a deliverable is waiting on them,
template filler is dimmed and a note nobody wrote is an outline. None of it is
carried by colour alone: every node is a real element carrying a sentence saying
who wrote it, what state it is in and whether it exists, so the picture can be
read with a keyboard and a screen reader. Tab follows the folders the owner
made, not wherever the physics settled.

Notes can be dropped onto the office or chosen with a button, and the new node
appears without a reload. A file the brain cannot use is refused in the browser,
so nobody waits for a round trip to be told. There is a table twin of the whole
thing for narrow windows and for anybody the picture does not serve.

A note with a revision before it says which draft it is and offers to show what
changed, line by line. "Open in editor" appears only when Obsidian, VS Code or
Typora is actually installed — on a Mac a `.md` with nothing installed opens in
TextEdit, which rewrites the file as RTF on save and destroys the front matter,
and a button that quietly corrupts the owner's notes is worse than no button.
