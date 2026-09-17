---
title: WebSocket protocol
description: What the browser and the office say to each other.
---

The office serves one WebSocket at `/ws`. Everything the browser knows comes
through it; there is no second channel.

## Connecting

The URL carries a token, printed when the office starts. A connection without it
is closed immediately, and so is one whose `Origin` is not the office's own — the
office has no accounts, so the token and the origin check are what stand between
it and anything else running on your machine.

The browser sends `hello` with the token and protocol version. The office answers
`welcome` with the version, the platform, the editors it found, and a full
[OfficeState](/docs/reference/office-state/).

## From the browser

`task.create` · `task.cancel` · `chat.send` · `approval.decide` · `agent.rename` ·
`provider.set_key` · `routine.upsert` · `routine.delete` · `routine.run_now` ·
`brain.search` · `brain.graph.get` · `runs.replay` · `mcp.reconnect` ·
`mcp.oauth.begin` · `tools.assign` · `note.reveal` · `demo.speed` ·
`demo.samples` · `doctor.run` · `approvals.revoke` · `models.list` ·
`agents.set_default_model` · `ping`

Each carries a `reqId`, and the answer carries it back.

## From the office

`welcome` · `ack` · `error` · `state` · `event` · `replay` · `config.error` ·
`config.reloaded` · `tools.reloaded` · `brain.graph` · `brain.note.indexed` ·
`brain.note.removed` · `brain.warning` · `doctor.result` · `models.result`

`state` is coalesced; run events are not, because a run that finished before its
first snapshot arrived would be a run nobody saw happen.

## Keys never travel

`provider.set_key` goes one way. The office writes it to `office/.env` and
answers `{ stored: true }` — never the key.
