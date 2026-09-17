---
title: Built-in tools
description: What every agent can do without being given anything.
---

Four brain tools are available to every agent and are not listed in their `tools`:

| Tool | Scope | What it does |
|---|---|---|
| `brain_search` | read | Full-text search over your notes. Archived and inbox notes answer at half weight. |
| `brain_read` | read | Reads one note by its id. |
| `brain_list` | read | Lists notes in a folder. |
| `brain_write` | read | Writes a deliverable into `brain/40-deliverables/`. |

`brain_write` is `read` scope on purpose: it writes a markdown file inside your
own office folder and sends nothing anywhere. Asking permission to file a note in
your own filing cabinet would train you to click Approve without reading.

## Web search

Not built in. It appears only when you configure a provider:

```yaml
tools:
  web:
    provider: brave        # brave | tavily | searxng | none
    api_key: $BRAVE_API_KEY
    max_results: 8
```

`searxng` needs no key, only the address of your own instance. With
`provider: none` there is no web tool at all, and an agent that names `web` will
be told the office has no web search rather than silently getting nothing.
