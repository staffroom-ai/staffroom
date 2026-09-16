// Refuses `npm publish`, which cannot publish this repository correctly.
//
// pnpm rewrites `workspace:*` into a real version range when it packs. npm does
// not: it ships the literal string, and every install then fails with
// `Unsupported URL Type "workspace:"`. That is exactly what happened to 0.1.0 —
// three of the five packages went out unusable.
//
// Wired as prepublishOnly so it fires whichever way publish is invoked.
const agent = process.env.npm_config_user_agent ?? "";

if (!agent.includes("pnpm")) {
  console.error(`
  Publish with pnpm, not npm.

  npm leaves pnpm's "workspace:*" in the tarball and every install of it fails
  with: Unsupported URL Type "workspace:". pnpm rewrites it to a real version.

    pnpm publish --access public

  Normally CI does this for you: .github/workflows/release.yml
`);
  process.exit(1);
}
