---
"staffroom": patch
"@staffroom/templates": patch
---

Three things a new office got wrong on its first run. A brand-new office no
longer warns that your keys could end up in a commit — its own `.gitignore` was
missing SQLite's `-wal` and `-shm` files. A mistyped command says which word it
did not know instead of "too many arguments for 'start'". And pointing `--office`
at a folder that already has your files in it no longer claims there is nothing
there.
