---
title: Contributing a template
description: An office for your trade, as a folder of YAML and markdown.
---

A template is a folder under `packages/templates/<id>/`:

```
agents.yaml       who works there
config.yaml       version 2, providers empty
brain/            notes that make the office make sense on day one
demo-runs/        recorded transcripts, including generic.jsonl
sample-run.json   one finished run, so "Latest results" is not empty
```

## The rules

- Every note carries `sample: true`, so an owner can clear the lot in one click.
- No agent names a tool that is not registered, or the office will not open.
- `config.yaml` ships at the current version, or every new office migrates itself
  on its first boot and meets a backup folder before doing anything.
- `providers: {}` — a template ships no keys and assumes none.
- Four to six agents. More is a directory, not a team somebody can hold in mind.

`packages/templates/src/templates.test.ts` checks all of this for every template
in the folder, so a new one is covered the moment it is added.

## What makes a good one

Write the brain as though the business is real: a voice note, a price list, two
or three customers, the processes somebody would actually follow. The template is
the first thing anybody sees, and an office full of `lorem ipsum` teaches nobody
what the thing is for.
