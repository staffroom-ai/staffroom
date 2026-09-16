---
"@staffroom/core": minor
"staffroom": minor
---

Bring an existing folder of notes into the brain, and rebuild the index when it
is wrong.

`staffroom brain import <path>` copies markdown in, fills in any front matter it
is missing, and rewrites wiki-links so they still point at the right note now
that it lives somewhere else. Obsidian vaults are recognised. Only the pictures
something actually refers to come too. A `tools/` folder is left behind unless
you ask for it, because those files run on your machine.

`staffroom brain reindex` reads every note again from scratch. It works when the
index has been deleted, which is the point: the index is a cache of the files
and never the other way round.
