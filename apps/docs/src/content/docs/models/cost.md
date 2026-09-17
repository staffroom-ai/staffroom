---
title: Cost
description: What a run cost, and what the office does when it does not know.
---

Every run records the tokens it used. Where the office knows the price of that
model, it records the cost too.

## Where prices come from

`config.yaml`, under the provider. The office ships no price list, because a
price list in a released package is wrong the next time a provider changes one,
and a confidently wrong number is worse than no number.

```yaml
providers:
  anthropic:
    api_key: $ANTHROPIC_API_KEY
    pricing:
      claude-sonnet-5: { input: 3.00, output: 15.00 }   # USD per million tokens
```

## When it does not know

The run says "cost unknown" and still records the tokens. It never guesses.

## Keeping it down

- Put routine work on a cheaper or local model, per agent.
- Keep the pinned set small. Pinned notes go in every prompt every agent sees.
- `runner.max_turns` caps how long one run can go round.
