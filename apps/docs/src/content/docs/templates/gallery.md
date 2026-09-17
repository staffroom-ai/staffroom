---
title: Templates
description: The offices you can start from.
---

```bash
npx staffroom init --template studio
```

| Template | Who it is for |
|---|---|
| [studio](/docs/templates/studio/) | A small design or marketing studio. The one the demo runs on. |

More are coming: agency, ecommerce, clinic and consultant. Each is a folder of
YAML and markdown in the repository — if you build one for your trade, it is a
pull request, not a plugin. See [Contributing a template](/docs/contributing/templates/).

## Starting from nothing

```bash
npx staffroom init --template studio --dir ./office
```

Then edit `agents.yaml`. Everybody in a template is a starting point: rename them,
delete the ones you do not need, change what they do.
