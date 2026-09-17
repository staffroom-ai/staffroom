---
title: Install
description: From nothing to a running office, including if you have never opened a terminal.
---

## If you have never opened Terminal

Install Node from [nodejs.org](https://nodejs.org) — press the green LTS button,
open the download, click through. Then open Terminal (Cmd+Space, type Terminal)
and paste:

```bash
npx staffroom
```

The first time, Terminal asks `Ok to proceed?` Press `y` then Return.

It makes an office folder, opens your browser, and starts working straight away
with recorded work, so you can see what it does before connecting anything.

**Keep the Terminal window open. Closing it stops the office.**

## Docker

```bash
docker run -d --name staffroom \
  -p 127.0.0.1:4242:4242 \
  -v $PWD/office:/office \
  -e ANTHROPIC_API_KEY \
  ghcr.io/staffroom-ai/staffroom:latest
```

The port is bound to `127.0.0.1` on purpose: the office has no accounts, and
anybody who can reach it is a member of staff. Inside the container it listens on
all interfaces, which is normal — what the outside world can reach is whatever
you published it to, so keep the `127.0.0.1:` on the `-p`.

Your office lives on the host, in `./office`, which is the whole point of the
mount: the container is disposable and your notes are not.

Without `-v` it still runs — it makes an office inside the container and comes up
in demo mode, which is a quick way to look at it, and everything is gone when the
container is. Tags are `:latest` and the exact version, for example `:0.2.0`.

See [Your office folder](/docs/office/office-folder/).

## From source

Node 22 or newer and pnpm 10.

```bash
git clone https://github.com/staffroom-ai/staffroom
cd staffroom
pnpm install
pnpm build
pnpm --filter staffroom exec node dist/index.js init --template studio --dir ./office
pnpm --filter staffroom exec node dist/index.js start --office ./office --open
```

## Updating

```bash
npx staffroom@latest
```

An office made by an older version is brought forward when it opens, and a copy
of each file as it was is kept in `.staffroom/backups/`. To see what would change
first:

```bash
npx staffroom migrate --dry-run
```
