# Repository guard scripts

Small Node scripts run by `pnpm lint` alongside Biome. Each one enforces a
decision that a reviewer would otherwise have to remember.

| Script | Enforces | Ticket |
|---|---|---|
| `forbidden-sdk.mjs` | No dependency on Anthropic's proprietary agent SDK. The loop is ours. | done |
| `npx-grep.mjs` | Every user-facing string says `npx staffroom <sub>`, never a bare command. | SR-004 |
| `fixture-secrets.mjs` | No real API keys in test fixtures. | SR-004 |
| `dep-cycles.mjs` | No import cycles between packages. | SR-004 |
| `route-tests.mjs` | Every WebSocket message in the protocol table has a test. | SR-004 |
| `hygiene-files.mjs` | The required repo files exist and are not empty. | SR-004 |
| `changeset-present.mjs` | A PR touching a published package carries a changeset. | SR-004 |

`pnpm lint` only runs the scripts that exist. Add each one to the root
`lint` script in the same pull request that creates it.
