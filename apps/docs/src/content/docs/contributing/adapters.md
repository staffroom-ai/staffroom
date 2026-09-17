---
title: Writing a provider adapter
description: Adding a model provider, in about 150 lines.
---

An adapter implements `ProviderAdapter` from `@staffroom/core`: a streaming
`run`, a `listModels`, and a `capabilities`. The office does the rest.

```
packages/core/src/providers/<name>.ts
packages/core/src/providers/fixtures/<name>/*.json
```

## The seven fixtures

Every adapter passes the same conformance suite, recorded against the real
provider once and replayed with no network after that:

plain text · one tool call · parallel tool calls · a forced tool · a refusal ·
a rate limit · a context-too-long error.

Record them with `STAFFROOM_RECORD=1` against the real provider, then commit the
JSON. `pnpm --filter @staffroom/core test providers` runs them offline.

## Mapping errors

The office shows the owner one of its own messages, not the provider's. Map the
provider's failures onto `RunErrorCode`: `AUTH_FAILED` for 401, `RATE_LIMITED`
for 429 with `retry-after`, `PROVIDER_UNAVAILABLE` for 5xx and network,
`MODEL_NOT_FOUND` for 404, `CONTEXT_TOO_LONG` for the context error.

A provider failure that reached the owner as a raw stack trace would be a
failure they cannot act on. See [Errors](/docs/reference/errors/).

## Keeping it small

Under 150 lines excluding fixtures. If it needs more than that, the thing it
needs probably belongs in the loop rather than the adapter.
