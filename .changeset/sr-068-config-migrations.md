---
"@staffroom/core": minor
"@staffroom/server": minor
"staffroom": minor
---

Bring an office's files forward when Staffroom learns a new setting.

An office made with an older version now opens, rather than printing an
instruction. `config.yaml` goes to version 2, which writes
`approvals.whitelist_days` out explicitly — it arrived with "Approve and always
allow" and until now has been a 90-day default nobody could see, which is the
wrong way round for a setting that decides how long an agent may send email
unattended.

Your file is edited, not rewritten, so comments and ordering survive, and a copy
of it as it was is kept at `.staffroom/backups/config.yaml.v1.bak` before
anything is written. Running twice does nothing the second time.

`npx staffroom migrate --dry-run` says what would change and writes nothing.
A file written by a newer Staffroom than you have is refused with the one thing
that helps, rather than opened on settings this build does not understand.
