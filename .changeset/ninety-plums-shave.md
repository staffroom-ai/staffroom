---
"@staffroom/server": patch
"@staffroom/web": patch
---

Say when, beside the task bar.

"Do it" and "do it every weekday at eight" are the same sentence with a time
attached, so they are the same control: a calendar button in the task bar opens
four choices and a time, the button changes from Send to Schedule, and what was
chosen is written out in full beside it. An icon alone would say there is
something about time here and nothing about what was picked.

The picker offers only cadences the office will actually fire. `cron` is in the
routine schema and the scheduler refuses it, so it is not on the menu — and a
cron routine already in someone's file is listed saying plainly that this
version will not run it, rather than sitting there looking scheduled.

Routines are listed in Settings and in the list view, with pause, run now and
delete. Unattended work is the part of this product that happens while nobody is
looking, so it is stoppable from wherever the owner happens to be. Delete asks
first; it is the one thing here that cannot be undone from this screen.

`routine.upsert` now merges onto a routine that already exists, which is what
the word means and what makes Pause possible: the browser is sent a routine's
label and cadence, never its task or its agent, so it cannot send a whole one
back.
