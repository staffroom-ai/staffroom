---
"@staffroom/core": patch
"@staffroom/server": patch
"@staffroom/templates": patch
"staffroom": patch
---

Fixes the version every package reports about itself.

0.2.0 shipped reporting 0.1.1 from `npx staffroom --version`, from `/health` and
in the welcome frame. Changesets bumps package.json and knows nothing about a
constant in the source, so the two had drifted apart during the release itself.
The constants are now synced as part of `changeset version`, inside the Version
pull request, rather than left for a lint gate to catch after the fact.
