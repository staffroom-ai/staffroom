---
title: Per-agent models
description: A different model for one person, and keeping one person's work on your machine.
---

```yaml
default_model: anthropic/claude-sonnet-5

agents:
  - id: bookkeeper
    model: ollama/llama4        # this one never leaves the machine
```

A model id is `provider/model`. The provider half has to be one you configured,
or the office says so by name when it opens rather than at the moment somebody
gives that person a task.

## Local stays local

An agent on an `ollama/...` model shows a **local** pill in the office. The task
bar's model override is refused for that person, with the hint
`MODEL_OVERRIDE_LEAVES_MACHINE`.

That refusal is deliberate. Putting your bookkeeper on a local model is a decision
about where your invoices go, and a dropdown in a browser tab is not the place to
undo it by accident. Change the file if you mean it.

## Why you might

Cost, for work that does not need the best model. Privacy, for anything you would
not send to a third party. Speed, for a short task where a local model answers
sooner than a round trip.
