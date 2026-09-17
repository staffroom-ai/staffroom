---
title: Demo mode
description: A working office with no key, no card, and nothing sent anywhere.
---

With no provider configured, the office runs in demo mode: it replays recorded
transcripts through the same loop, the same tools and the same approval gate a
real run uses. What you see is the real thing with a scripted model behind it.

This exists so a first-time visitor sees staff doing work inside a minute,
without a key and without reading anything.

## What is real in demo mode

The agent loop, the routing, the tools, the approval cards, and the files. A
deliverable written in demo mode is a real markdown file in your brain folder.

## What is not

The model. The words come from a recording rather than from a provider, so they
will not be about your business.

## Turning it off

Configure any provider and restart. The office comes up live, and asks you once
whether to clear out the sample business it shipped with — see
[Your office folder](/docs/office/office-folder/).

To force demo mode even with a provider configured:

```bash
npx staffroom demo
```

Demo mode never sends anything anywhere, including telemetry.
