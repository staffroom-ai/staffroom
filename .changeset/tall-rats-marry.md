---
"@staffroom/core": patch
"@staffroom/server": patch
---

Routines: work the office does without being asked.

`office/routines.yaml` holds them, and the scheduler ticks every thirty seconds
in the office's own timezone. That last part is the whole difficulty: 08:00 in
Melbourne is a different UTC instant in March than in July, and a routine that
drifts by an hour twice a year is a routine nobody trusts. Every fire time is
decided as a wall clock and then converted, with both sides of a daylight-saving
change pinned in the tests by date.

Three rules the scheduler is built on. Routines run one at a time, so two agents
do not write to the brain at eight in the morning; a task the owner types is
never blocked behind one. The mark moves before the work starts, so a crash
loses a run rather than repeating it — for something that emails a customer,
twice is the worse failure. And waking from sleep is noticed: a gap far longer
than a tick means the lid was down, and the office works out what was missed.

What it does about that is the owner's setting. `latest` runs once, titled
`Catch-up: <label>`; `all` runs one per missed fire, capped at seven; `skip`
moves on. Two limits are not settings, because neither has a defensible other
value: nothing older than a week is ever run, and coming back from a fortnight
away to fourteen queued runs is a mess rather than a catch-up.

`task.create` with a `schedule` becomes a routine, so "do it" and "do it every
morning" are one control rather than two concepts. A routine naming somebody who
is not in the office is refused while the owner is looking at the screen, not at
eight the next morning with nobody there to see it.

`Run` gains a `label`, so a catch-up can say so while the agent still receives
exactly the task that was written. `runs.sqlite` gains the incremental migration
path the spec always described: an older log is brought forward rather than
moved aside, because it is the owner's history of everything their office has
done.
