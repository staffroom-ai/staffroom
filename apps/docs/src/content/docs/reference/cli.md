---
title: CLI
description: Every command, and what it does.
---

Every command takes `--office <dir>`. Without it the office is found in this
order: `--office`, `STAFFROOM_OFFICE`, `./office`, then `~/.staffroom/current-office`.

## `npx staffroom`

Starts the office and opens a browser. With no office anywhere it makes one first.

| Flag | What it does |
|---|---|
| `--office <dir>` | Which office folder to open |
| `--port <n>` | Default 4242 |
| `--host <addr>` | Beyond `127.0.0.1` prints a warning; the office has no accounts |
| `--open` / `--no-open` | Open a browser, or do not |
| `--no-watch` | Do not watch files, and run no routines |
| `--demo` | Force demo mode even with a provider configured |

## `npx staffroom init`

Makes a new office folder.

`--template <id>` · `--dir <dir>` · `--tools` to copy the five example tools.

## `npx staffroom doctor`

Checks Node, the office folder, config, providers, models, tools, the index and
the port, and says what to do about anything wrong.

`--json` prints the result verbatim · `--fix` applies what is safe to apply.

## `npx staffroom migrate`

Brings an office's files up to date after an update. Happens at boot anyway; this
is for looking first.

`--dry-run` says what would change and writes nothing.

## `npx staffroom brain`

`import <path>` brings in a folder of notes or an Obsidian vault.
`--move` · `--area <area>` · `--include-tools`.

`reindex` reads every note again from the files.

## `npx staffroom tools`

`add <name> --for <agent>` copies one of the shipped examples and gives it to
somebody.

## `npx staffroom demo`

The same as `start --demo`.
