---
title: Setting up
description: Getting the repository running.
---

Node 22 or newer and pnpm 10.

```bash
git clone https://github.com/staffroom-ai/staffroom
cd staffroom
pnpm install
pnpm build
pnpm test
```

Then run a development office:

```bash
pnpm dev:init
pnpm dev
```

## Before you push

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Commits need a DCO sign-off — `git commit -s`. A hook checks it.

Changes that affect a published package need a changeset:

```bash
pnpm changeset
```

## The reference docs are generated

If you add or change a config key, run `pnpm docs:gen` and commit the result. CI
fails otherwise, because documentation that is wrong about its own settings is
worse than none.
