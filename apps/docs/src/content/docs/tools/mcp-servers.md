---
title: MCP servers
description: Connecting somebody else's tools, and what the office can and cannot see about them.
---

```yaml
mcp:
  servers:
    notion:
      command: npx
      args: ["-y", "@notionhq/notion-mcp-server"]
      env: { NOTION_TOKEN: $NOTION_TOKEN }
    gmail:
      url: https://mcp.example.com/gmail
      auth: oauth
  deny: [stripe]
  departments:
    notion: [marketing]
```

Save the file and the connector appears on the strip within fifteen seconds. No
restart.

## What the office can see

The tool names, their descriptions and their input schemas. That is all an MCP
server tells it.

## What it cannot

What the server will actually do with those fields. So every MCP tool is treated
as `write` and `egress` whatever the server says about itself, and its approval
card carries the line that the office cannot see what the server will do.

## deny

A server in `mcp.deny` is never connected, whatever else asks for it. It shows on
the strip struck through with a lock, so you can see it was refused rather than
wonder why it is missing.

## OAuth

A server with `auth: oauth` shows an amber Connect button. Clicking it does PKCE
in your browser and comes back to the office. The token is stored in
`office/.staffroom/`, never in `config.yaml`.

## A server that changes its tools

Its tools are re-read, and the office reports what was added, removed and changed
rather than absorbing it quietly. Any standing permission for a tool whose
description changed is suspended, and the next call asks again with the card
saying the tool changed since you allowed it.
