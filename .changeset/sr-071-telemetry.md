---
"@staffroom/core": minor
"@staffroom/server": minor
---

Optional, checkable telemetry, and a once-a-day update check that shares its
switch.

Both off unless `telemetry.enabled` is true in `office/config.yaml`, both off in
demo mode whatever the file says, and both off when `STAFFROOM_TELEMETRY=0`.
`STAFFROOM_NO_UPDATE_CHECK=1` turns the registry check off on its own.

`npx staffroom doctor` prints the exact payload that would be sent — including
when telemetry is off, because the question people want answered before turning
it on is what it would say about them. It is two events, counts only, with no
free-text field anywhere in the shape for a task, a note, an agent's name or an
error message to travel in.

The install id is a random UUID in `office/.staffroom/telemetry-id`. Delete the
file and the next one is different: it is not derived from anything about your
machine, so deleting it actually means something.
