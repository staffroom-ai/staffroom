---
title: agents.yaml keys
description: Every setting in office/agents.yaml, with an example of each.
---

<!-- Written by pnpm docs:gen from the schemas in packages/core. Do not edit by hand. -->

Who works in your office, and what they are allowed to use. Edited by hand or
from the office; either way it stays yours, and Staffroom keeps your comments
when it writes to it.

| Key | Type | Required | Example | Accepts |
|---|---|---|---|---|
| `version` | number | yes | `1` |  |
| **`office`** | block |  | | |
| `office.name` | string | yes | `"..."` | not empty |
| `office.timezone` | string | yes | `"..."` |  |
| `default_model` | string |  | `"..."` | matching `^[a-z0-9-]+\/[A-Za-z0-9._:/-]+$` |
| `departments` | map |  | `{}` |  |
| **`agents`** | list | yes | | |
| `agents[].id` | string | yes | `"..."` | matching `^[a-z][a-z0-9-]{1,39}$` |
| `agents[].department` | string | yes | `"..."` | matching `^[a-z][a-z0-9-]{1,23}$` |
| `agents[].name` | string |  | `"..."` | not empty |
| `agents[].role` | string | yes | `"..."` | not empty |
| `agents[].does` | string | yes | `"..."` | not empty |
| `agents[].model` | string |  | `"..."` | matching `^[a-z0-9-]+\/[A-Za-z0-9._:/-]+$` |
| `agents[].tools` | array |  | `[]` |  |
| `agents[].lead` | boolean |  | `false` |  |
| `agents[].instructions` | string |  | `"..."` |  |
