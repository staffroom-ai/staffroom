---
title: Releasing
description: How a version gets to npm.
---

Changesets, then a merge.

1. A pull request that changes a published package includes a changeset:
   `pnpm changeset`. CI fails without one.
2. Merging to `main` opens or updates a **Version packages** pull request that
   bumps every package and writes the changelogs.
3. Merging *that* publishes to npm.

All five packages move together — `fixed` versioning — because a CLI on one
version and a server on another is a combination nobody has tested.

## Trusted publishing

There is no npm token in this repository. The release workflow proves its
identity to npm with a short-lived OIDC token from GitHub Actions, and npm signs
a provenance statement for each package.

Each package on npm names this repository and `release.yml` as its trusted
publisher, with **Allow npm publish** enabled. Without that last box, publishing
fails with `403 OIDC permission denied for this action` — the identity is
accepted and the action is not.

The workflow prints the claims it offers npm before publishing, so a 403 is a
comparison rather than a guess.
