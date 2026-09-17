---
title: Clean room
description: The one rule about where code here may come from.
---

Staffroom is Apache-2.0 and must stay that way.

**Do not read, copy, or port code from any noncommercially-licensed project,
including `agents-office`.** Not a function, not a file layout, not a comment.
If you have read such a project, you may still contribute — but describe what you
want in your own words and write it from the specification, not from memory of
their source.

This is not a formality. A single ported function makes the licence of everything
around it a question somebody has to answer with a lawyer, and the whole point of
this project is that a small business can use it without asking anybody.

## No Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` is proprietary and must never appear in any
`package.json` here. `pnpm lint` fails if it does. The agent loop is ours, in
`packages/core/src/runtime/`, and that is what makes the project forkable.

## What we do use

Anything under a permissive licence: MIT, BSD, Apache-2.0, ISC. If you are
unsure about a dependency, raise it in the pull request rather than after.
