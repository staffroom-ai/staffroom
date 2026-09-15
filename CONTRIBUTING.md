# Contributing to Staffroom

Thanks for being here. This is a young project and the first contributors shape it.

## Clean room

**Staffroom is a clean-room design.** It was written from its own specifications in
[`docs/specs/`](docs/specs/), without reading the source of any non-commercially
licensed project in the same space. In particular, do not open, copy, paraphrase or
consult `agents-office` (PolyForm Noncommercial) while working on Staffroom.

This matters because Staffroom is Apache-2.0 and must stay usable commercially by
anyone. Code derived from a non-commercial project would take that away, and it
cannot be undone later. If you have read such a project's source, you can still
contribute: say so in the pull request, and stick to areas you are not drawing on it
for.

## Sign your work

Every commit needs a `Signed-off-by` line. Commit with `-s`:

```bash
git commit -s -m "Fix the thing"
```

That line means you agree to the [Developer Certificate of Origin](https://developercertificate.org/):
you wrote the patch, or you have the right to submit it under this project's licence.
We use the DCO rather than a Contributor License Agreement because it asks less of
you and is checked by a git hook rather than a lawyer.

A commit-msg hook rejects commits without it. If you forget:
`git commit --amend -s --no-edit`.

## Running it locally

Requires Node 20 or newer and pnpm 10.

```bash
pnpm install
pnpm build
pnpm --filter staffroom exec node dist/index.js init --template studio --dir ./office
pnpm dev
```

The third command creates `./office` from the studio template; `pnpm dev` assumes it
exists. Then open the URL the server prints.

Other things you will want:

```bash
pnpm typecheck     # every package
pnpm test          # unit tests
pnpm lint          # Biome plus the guard scripts in scripts/lint/
pnpm changeset     # describe your change for the release notes
```

## Before you open a pull request

- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
- You added a changeset if you touched anything under `packages/`.
- You added tests for behaviour you changed.
- You updated the docs if you changed a config key or a user-facing string.
- Your commits are signed off.

## What gets merged

Small, focused pull requests get reviewed fastest. If you are planning something
large, open a discussion first so you do not spend a weekend on something we have
already said no to in [ROADMAP.md](ROADMAP.md).

Good first contributions are labelled `good first issue`. Provider adapters and
office templates are the two areas designed to be extended by other people, and both
have a guide in the docs.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
