---
"@staffroom/core": patch
---

The brain as a graph: what is written down, what links to what, who has read it.

`buildGraph(index, runs)` assembles rather than stores. Notes and links come from
the index, which is a cache of the files; who read what and who wrote what come
from the run log, which is a record of what happened. Neither half is kept inside
the other, so neither can go stale against the files or quietly rewrite history.

A link to a note nobody wrote becomes a `missing` node rather than disappearing.
An owner who wrote `[[pricing]]` and never made the note should see the gap where
they expected a note, not a picture that agrees with itself. The same goes for a
revision whose original was deleted, and for deleting a note that other notes
link to: `noteRemovedDelta` hands back the arrows that now need redrawing at a
hole.

`read` edges are off by default — every agent read is one, and a busy office
produces thousands, which would bury the links the owner actually wrote.

`brainRevisions` returns a chain oldest-first from any note in it, and stops
rather than spinning on a loop: front matter is the owner's to write and nothing
stops them typing one.
