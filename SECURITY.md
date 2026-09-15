# Security policy

## Supported versions

The latest `0.x` release. While we are below 1.0 there are no backports.

## Reporting a vulnerability

Email **security@staffroom.so**, or use GitHub's private vulnerability reporting on
this repository. Please do not open a public issue.

You will get an acknowledgement within **48 hours** and either a fix or a written
plan within **14 days**. There is no bounty. You will be credited in the advisory
unless you ask us not to.

## Scope

In scope: the `staffroom` and `@staffroom/*` packages in this repository.

Out of scope: third-party MCP servers, the models themselves, and tools written by
users in their own `office/tools/` folder. We will still want to hear about those,
but they are not ours to fix.

## What counts as a vulnerability

1. A way for an agent to call a non-local `write` tool without an approval.
2. A network listener beyond localhost by default.
3. A way to reach the WebSocket or a POST route from another origin, or without the
   session token.
4. A secret from `.env` or `config.yaml` appearing in `runs.sqlite`, a WebSocket
   frame, a log line, or an export.
5. A way to read a file outside `brain/` through the file routes.
6. A test fixture containing a real API key.

Prompt injection through a brain note or a tool result is a known and documented
risk, not a vulnerability by itself. A way for injected text to reach a `write` tool
without an approval is very much a vulnerability, and we want to hear about it.
