---
"@staffroom/server": patch
---

`npx staffroom doctor` reported the wrong version in its telemetry preview: a
second copy of the version string lived in the doctor, and neither the release
script nor the lint gate that exists to catch exactly this was looking at it.
Both now check every file in a package, not just its index.
