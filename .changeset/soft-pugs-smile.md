---
"@staffroom/core": patch
"@staffroom/server": patch
"@staffroom/web": patch
---

Tell the owner what happened to a tool file they just saved.

One `tools.reloaded` message now carries three pieces of news, and a file can be
more than one of them at once: it would not compile and here is the line the
compiler blamed; its author left `scope` out, so it will ask for approval on
every call; and nobody may use it yet, with everyone who could be given it.

`tools.assign` takes the whole card's answer — a tool and a set of people — in
one message instead of one per person, reports any name that did not take rather
than quietly doing three of four, and announces `agents.yaml` itself so other
tabs update even when the office is not watching the folder.

Assigning a tool or renaming someone now takes effect in the office that is
running. Both wrote the file and left the roster in memory as it was read at
boot, so a tool handed out from the card did not reach the agent, and the next
state still showed the old row, until a restart.

The who-may-use-it checkboxes were 13 pixels square and unnamed. They are now
rows you can hit, each carrying the person's name for a screen reader.
