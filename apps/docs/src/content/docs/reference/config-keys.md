---
title: config.yaml keys
description: Every setting in office/config.yaml, with an example of each.
---

<!-- Written by pnpm docs:gen from the schemas in packages/core. Do not edit by hand. -->

Every setting the office reads from `office/config.yaml`. Anything not listed
here is refused by name when the office starts, rather than ignored quietly.

| Key | Type | Required | Example | Accepts |
|---|---|---|---|---|
| `version` | number | yes | `2` |  |
| `providers` | map |  | `{}` |  |
| **`mcp`** | block |  | | |
| `mcp.servers` | map |  | `{}` |  |
| `mcp.deny` | array |  | `[]` |  |
| `mcp.departments` | map |  | `{}` |  |
| **`tools`** | block |  | | |
| **`tools.web`** | block |  | | |
| `tools.web.provider` | string |  | `"none"` | one of `brave`, `tavily`, `searxng`, `none` |
| `tools.web.api_key` | string |  | `"..."` |  |
| `tools.web.base_url` | string |  | `"..."` |  |
| `tools.web.max_results` | integer |  | `8` | 1 to 20 |
| `tools.custom_dir` | string |  | `"tools"` |  |
| `tools.hot_reload` | boolean |  | `true` |  |
| **`runner`** | block |  | | |
| `runner.max_turns` | integer |  | `25` | 1 to 50 |
| `runner.max_parallel_tools` | integer |  | `4` | 1 to 16 |
| `runner.tool_timeout_ms` | integer |  | `60000` | 1000 to 600000 |
| `runner.tool_output_max_chars` | integer |  | `20000` | 1000 to 500000 |
| `runner.max_output_tokens` | integer |  | `4096` | 256 to 64000 |
| `runner.egress_input_max_chars` | integer |  | `1000` | 100 to 100000 |
| `runner.temperature` | number |  | `0` | 0 to 2 |
| **`runner.retries`** | block |  | | |
| `runner.retries.attempts` | integer |  | `3` | 0 to 10 |
| `runner.retries.base_ms` | integer |  | `1000` | 100 to 60000 |
| `runner.retries.max_ms` | integer |  | `20000` | 100 to 300000 |
| **`brain`** | block |  | | |
| `brain.dir` | string |  | `"brain"` |  |
| **`brain.embeddings`** | block |  | | |
| `brain.embeddings.enabled` | boolean |  | `false` |  |
| `brain.embeddings.model` | string |  | `"..."` |  |
| `brain.pinned_token_budget` | integer |  | `2000` | 200 to 50000 |
| **`approvals`** | block |  | | |
| `approvals.expiry_hours` | integer |  | `24` | 1 to 168 |
| `approvals.whitelist_days` | integer |  | `90` | 1 to 365 |
| **`telemetry`** | block |  | | |
| `telemetry.enabled` | boolean |  | `false` |  |
| **`server`** | block |  | | |
| `server.port` | integer |  | `4242` | 1 to 65535 |
| `server.log_level` | string |  | `"info"` | one of `debug`, `info`, `warn`, `error` |
| `server.host` | string |  | `"127.0.0.1"` |  |

A key with an example and no "required" can be left out; the example is what the
office uses when you do.
