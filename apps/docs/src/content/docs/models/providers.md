---
title: Providers
description: Connecting Anthropic, OpenAI, Ollama, or anything that speaks their API.
---

```yaml
providers:
  anthropic:
    api_key: $ANTHROPIC_API_KEY
  openai:
    api_key: $OPENAI_API_KEY
  ollama:
    base_url: http://127.0.0.1:11434
```

Keys go in `office/.env`, never in `config.yaml`. The office reads them when it
starts, so restart it after adding one.

## Pasting a key from the office

Settings, Models, paste, Save. It goes to `office/.env` and nowhere else. The
field is write-only: an office that can show you your key is an office that can
leak it.

## OpenAI-compatible endpoints

The `openai` provider takes a `base_url`, so Groq, Together, OpenRouter and LM
Studio all work through it:

```yaml
providers:
  openai:
    api_key: $GROQ_API_KEY
    base_url: https://api.groq.com/openai/v1
```

## Ollama

Runs on your machine and needs no key. Whatever you have pulled is what you can
use. See [Per-agent models](/docs/models/per-agent-models/) for keeping one
person's work local.

## The default model

`default_model` in `agents.yaml` is what everybody uses unless their own row says
otherwise. Settings shows a list of what each configured provider says it can run
today, rather than a list Staffroom shipped that went stale after a release.
