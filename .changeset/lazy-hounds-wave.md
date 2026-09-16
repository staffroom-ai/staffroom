---
"@staffroom/core": patch
"@staffroom/templates": patch
---

A new office is no longer an empty room.

The studio template ships one run that already happened — the copywriter reading
four notes and writing the autumn retainer email that revises the first draft —
and it is written into the run log the first time the office opens. The office
now opens showing one thing filed, and the brain graph opens with real arrows on
it rather than a filing cabinet nobody has ever read.

Three rules keep it from being a lie. It is marked `sample: true`, like the
template's notes, so it can be cleared out when the owner goes live. It is only
ever written into an empty run log, so it can never add history to an office that
has a past of its own. And its events are stamped at the run's own time rather
than now: the note is dated March in its own front matter, and a card saying it
was filed a moment ago would be a small lie about when work happened.

`RunStore.append` takes an optional timestamp for this, which is also what
replaying recorded history needs.
