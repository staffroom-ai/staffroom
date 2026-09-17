---
title: Errors
description: Every error the office can report, what it means and what to do.
---

<!-- Written by pnpm docs:gen from the schemas in packages/core. Do not edit by hand. -->

Every error a run can end with. The office shows you the same words; this page
is here so you can search for a code you saw and read it without the office
open.

### `NO_MODEL_CONFIGURED`

No model configured.

Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.

### `PROVIDER_NOT_CONFIGURED`

? uses ?, but it has no API key.

Open Settings > Models and add a ? key, or change the agent's model in office/agents.yaml.

### `MODEL_OVERRIDE_LEAVES_MACHINE`

? runs locally on purpose.

Edit office/agents.yaml if you want to change that.

### `MODEL_NOT_FOUND`

? does not know the model "?".

Check the spelling in office/agents.yaml.

### `AUTH_FAILED`

? rejected the API key.

Paste a new key in Settings > Models, or create one on the provider's site.

### `RATE_LIMITED`

? is rate-limiting requests.

The office retried three times. Wait a minute and try again, or move this agent to another model.

### `PROVIDER_UNAVAILABLE`

Could not reach ?.

Check your connection.

### `CONTEXT_TOO_LONG`

The task and notes are too long for ?.

Shorten the task, or move this agent to a model with a bigger context window.

### `OUTPUT_TRUNCATED`

? ran out of room before finishing.

Ask for a shorter deliverable, or raise runner.max_output_tokens.

### `TOOLS_UNSUPPORTED`

? cannot use tools, but ? has tools listed.

Pick a model that supports tools, or remove the tools from this agent in office/agents.yaml.

### `TOOL_NOT_ALLOWED`

? is not allowed to use ?.

Add it to that agent's tools in office/agents.yaml, or check the deny list in office/config.yaml.

### `TOOL_FAILED`

? kept hitting errors with ?.

Check the connector in office/config.yaml. The error was: ?.

### `TOOL_TIMEOUT`

? did not respond in ? s.

Try again, or raise runner.tool_timeout_ms.

### `APPROVAL_REJECTED`

You declined ?, so ? stopped.

Open their chat and send revise: with what to do instead.

### `MAX_TURNS`

? did not finish within ? steps.

The partial work is saved in the run. Break the task into smaller pieces.

### `BAD_ROUTING`

? could not pick a team member, so the task went to ?.

If that is wrong, open the right agent's chat and give the task there.

### `NOTHING_TO_REVISE`

? has no deliverable to revise yet.

Give them a task first.

### `CANCELLED`

Stopped.

Nothing was saved to the brain.

### `INTERNAL`

Something went wrong inside Staffroom.

Please report this with the run id ?.
