# Changesets

Every pull request that changes a published package needs a changeset. Run:

```bash
pnpm changeset
```

Pick the packages you touched, pick patch/minor/major, and write one sentence a
user would understand. The file it creates goes in the pull request.

All five packages are versioned together (`fixed` in `config.json`), so a change
to any one of them releases the whole set at the same version.

Read more: https://github.com/changesets/changesets
