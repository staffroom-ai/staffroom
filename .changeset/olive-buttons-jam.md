---
"@staffroom/core": minor
---

Append-only run log over SQLite. Every event is redacted before it reaches disk,
streaming chunks are batched for the disk but delivered to the office immediately,
and the run's status is maintained in the same transaction as the event that
changed it.
