# Staffroom implementation plan

Status: draft 1, 15 Sep 2026. Owner: the maintainer. Source of truth for scope is `docs/product-plan.html`; source of truth for behaviour is the six specs under `docs/specs/` and their `README.md`. This document says in what order to build it, by whom (one engineer directing Claude Code), and how to know each step is finished.

## Decisions

- Five milestones. M0 is the repo and the adapter contract, M1 is the plan's v0.1, M2 is v0.2, M3 is v0.3, M4 is v1.0. Every milestone has exit criteria written as things a person can see or run, not as code that exists.
- The plan's calendar was written before the specs. At spec fidelity M0 plus M1 is 60 half-days of tickets, so v0.1 ships at the end of week 6, not week 4. Section 3 shows the schedule and the cut line that pulls it back to week 5 if needed. M2 then runs weeks 7 to 10 and M3 weeks 11 to 14. The milestone table keeps both columns so the drift is visible rather than hidden.
- Tickets are ordered by dependency and sized in half-days (one half-day is four hours of directing Claude Code against a spec section). A ticket over 3 half-days is split. Nothing is estimated below 1. No ticket depends on a later id.
- Ticket ids are stable once written. When a ticket is inserted it gets a letter suffix (`SR-006b`, `SR-017b`); when one is merged away its id is retired and not reused (SR-009 lives in SR-006b).
- Every ticket names the tests it adds. A ticket with no test named is a docs or ops ticket and says so.
- Build core first, then server, then web. The office scene (`packages/web/src/scene/`) is time-boxed to 4 half-days; if it slips, ship v0.1 with the flat-shaded fallback described in SR-036 and keep the date.
- One branch per ticket, one changeset per ticket that touches `packages/*`, squash-merged with a DCO sign-off. Ticket ids go in commit subjects (`SR-013: RunStore and run_events schema`).
- Clean room: nothing under `agents-office` is opened at any point. CONTRIBUTING carries the rule from day one (SR-003).

## 1. Milestones

| Milestone | Plan version | Plan weeks | Scheduled weeks | Tickets | Half-days |
|---|---|---|---|---|---|
| M0 Foundations | (week 1 of v0.1) | 1 | 1 | SR-001 to SR-008, SR-006b (9 tickets) | 9 |
| M1 It works end to end | v0.1 | 1 to 4 | 2 to 6 | SR-010 to SR-051, SR-017b, SR-058 (44 tickets) | 51 |
| M2 Connected | v0.2 | 5 to 8 | 7 to 10 | SR-052 to SR-079 except SR-058 (27 tickets) | 36 |
| M3 Yours | v0.3 | 9 to 12 | 11 to 14 | SR-080 to SR-088 (9 tickets) | 17 |
| M4 Stable | v1.0 | month 4+ | 15 onward | SR-089 to SR-093 with SR-092 split (6 tickets) | 14 |

### M0 Foundations (week 1)

Exit criteria, all observable:

- `git clone && pnpm install && pnpm build && pnpm test` passes on a fresh machine in under five minutes, and the same four commands are green in CI on ubuntu, macos-14 and windows-2022.
- [x] Met 15 Sep 2026. All five published at `0.0.1` with `--provenance=false`, and `npx staffroom@0.0.1` prints the placeholder line. Publishing needed account 2FA plus an OTP per package: npm now refuses a plain publish, and the granular bypass-2FA token it suggests instead is deprecated from January 2027, so SR-005 should wire trusted publishing (OIDC from Actions) rather than a token. The four scoped packages were live on npmjs.com within minutes but the registry API served 404 for longer; that is replication lag on a new scope, not a failed publish.
- `pnpm --filter @staffroom/core test providers` runs the seven-fixture conformance suite against the Anthropic adapter and `FixtureAdapter` and passes with no network.
- `pnpm lint` fails if `@anthropic-ai/claude-agent-sdk` is added to any `package.json`, and fails on the string `Run staffroom `.
- The repo has LICENSE, CONTRIBUTING (with the clean-room paragraph), CODE_OF_CONDUCT, SECURITY, ROADMAP, issue and PR templates, CODEOWNERS and Dependabot config.

### M1 It works end to end (v0.1, weeks 2 to 6)

Exit criteria:

- On a Mac with Node 20 and nothing else, `npx staffroom` creates `~/Staffroom/office` from the `studio` template, prints the banner with `Office folder:` and a token-bearing URL, and opens a browser showing six pods (three populated, three at 40 percent opacity), four named agents at desks, and one deliverable already in "Latest results". This takes under 60 seconds and needs no key. The shipped roster names no tool that is not registered, so boot never fails on `AGENT_TOOL_UNKNOWN`.
- In demo mode, choosing Marketing, typing `Write a two-line tagline for a bakery` and pressing Enter makes Dana's badge go amber, Priya walk to Dana's desk and back, `brain_search` pulse on the connector strip, text stream into Priya's chat, and a deliverable card appear with Approve. Clicking Approve turns the note's `status` to `approved` and the note is a real file under `office/brain/40-deliverables/marketing/`.
- Pasting an Anthropic, OpenAI or Ollama base URL into Settings > Models flips the mode chip to Live without a restart, and the same task now runs on a real model. Each of the three adapters passes the conformance suite and, behind `STAFFROOM_LIVE_TESTS=1`, a live smoke.
- `office/agents.yaml` with `model: ollama/llama4` on the bookkeeper shows the "local" pill, and the task bar's model override is refused for that agent with the `MODEL_OVERRIDE_LEAVES_MACHINE` hint.
- Dropping `lookup-order.ts` into `office/tools/` registers `lookup_order` within two seconds, the Activity feed shows "New tool lookup_order is ready. Who may use it?", and a file with a syntax error shows the load-failure card with a Copy button and does not stop the server.
- A custom `scope: "write"` tool that is not `local` blocks the run at `waiting_approval`, the agent raises a hand, and the Approvals tab shows a two-button card (Approve once, Deny). Both buttons reach `registry.resolve` through `approval.decide` (SR-027): Approve once lets the run finish, Deny with a note makes the agent shrug and the model explain. Whitelisting (`approve_always`) is M2.
- Killing the server with Ctrl+C during a run and restarting resumes the run; a pending approval is expired with `note: server_restart` and re-asked.
- `npx staffroom doctor` reports Node, office path, config validity, provider reachability and model resolution for every agent, and `doctor --json` is what the CI build job runs.
- `pnpm test` in `packages/core` reports 80% coverage or more; the Playwright smoke test passes on ubuntu against demo mode; the bundle is under 1.5 MB gzipped.
- The README has the hero GIF above the fold, the verbatim first sentence, the step-0 install text, and the first-five-minutes section, and is under 900 words before the comparison table. `staffroom@0.1.0` is on npm with provenance.

### M2 Connected (v0.2, weeks 7 to 10)

Exit criteria:

- Adding a Notion stdio server and a Gmail HTTP server to `config.yaml` shows both on the connector strip within 15 seconds of save without a restart; the Gmail one shows an amber Connect button, and clicking it completes PKCE OAuth back to `/api/mcp/oauth/callback` and turns green. `mcp.deny: [stripe]` shows Stripe struck through with a lock.
- An agent calling `gmail.send_email` produces the three-button approval card with the exact preview, the red irreversible banner and the MCP line. "Approve and always allow (90 days)" writes a row to `office/approvals.yaml` with a prefilled `match`; the next identical call runs without asking; editing the file to remove the row revokes it immediately; a changed tool description suspends it and the next card carries "This tool changed since you allowed it."
- `G` opens the brain graph with every note, `revises` chains, `readBy` from real run events, and search; clicking a node opens the note with Show in Finder.
- "Every weekday at 08:00" on the task bar creates a routine in `office/routines.yaml`; closing the laptop over the fire time and reopening runs the catch-up once, titled `Catch-up: <label>`.
- `docker run ... ghcr.io/staffroom-ai/staffroom` serves the office on `127.0.0.1:4242` with the origin and token checks on.
- `staffroom.so/docs` is live with every config key documented with an example, and `pnpm docs:gen` output matches the committed reference pages in CI.
- The Show HN post is published on a Tuesday to Thursday with twelve `good first issue` labels already open.

### M3 Yours (v0.3, weeks 11 to 14)

Exit criteria:

- `npx staffroom init --template agency|ecommerce|clinic|consultant` each boots in live mode with only `default_model` set and passes `templates.test.ts`.
- Correcting a deliverable in chat ("teach") updates that agent's `instructions` in `agents.yaml` through the document-mode writer, with a diff shown before it is written.
- The Usage panel shows tokens and cost per agent and per model for the last 30 days from `runs.sqlite`, and "cost unknown" for models with no price.
- At least one community adapter (Gemini, Mistral or Bedrock) has merged from an external contributor under 150 lines with seven fixtures.

### M4 Stable (v1.0)

Exit criteria:

- `ProviderAdapter` and `OfficeState` unchanged for two consecutive minor releases; Windows has been in the required CI matrix for eight weeks without a skip; the template rules in `repo-quality-launch.md` §11 have not changed for two minors.
- `npx staffroom import <file>` accepts a CrewAI or AutoGen config file supplied by the user and produces a valid `agents.yaml`.
- The optional `@staffroom/remote` package puts the office behind HTTPS with a login, as a separate install.

## 2. Ticket list

Estimates are half-days. `depends_on` lists ticket ids; "none" means it can start on day one. Packages use short names: `root`, `core`, `server`, `web`, `cli`, `templates`, `docs`, `ci`.

### Index

| id | title | milestone | packages | est |
|---|---|---|---|---|
| SR-001 | Monorepo skeleton | M0 | root | 1 |
| SR-002 | Biome, lefthook and the lint scripts | M0 | root | 1 |
| SR-003 | Repo hygiene files | M0 | root | 1 |
| SR-004 | CI workflow | M0 | ci | 1 |
| SR-005 | Changesets, release workflow, placeholder publish | M0 | ci, cli | 1 |
| SR-006 | Provider types and BaseAdapter | M0 | core | 1 |
| SR-006b | Shared core types, RunError and the error table | M0 | core | 1 |
| SR-007 | FixtureAdapter, recordFixture, conformance harness | M0 | core | 1 |
| SR-008 | Anthropic adapter | M0 | core | 1 |
| SR-009 | retired, merged into SR-006b | M0 | core | 0 (see SR-006b) |
| SR-011 | Config schemas, loaders, Roster | M1 | core | 2 |
| SR-010 | resolveModel and pricing | M1 | core | 1 |
| SR-012 | redactSecrets | M1 | core | 1 |
| SR-013 | RunStore | M1 | core | 1 |
| SR-014 | Tool shape and ToolRegistry | M1 | core | 2 |
| SR-015 | Brain index | M1 | core | 2 |
| SR-016 | SAFETY_RULE and buildSystemPrompt | M1 | core | 1 |
| SR-017 | Brain tools and brainWriteDeliverable | M1 | core | 1 |
| SR-017b | web_search registration with the none backend | M1 | core | 1 |
| SR-018 | The agent loop | M1 | core | 2 |
| SR-019 | Runner, routing and revise | M1 | core | 1 |
| SR-020 | OpenAI-compatible adapter | M1 | core | 1 |
| SR-021 | Ollama adapter | M1 | core | 1 |
| SR-022 | createOffice and OfficeState types | M1 | core | 1 |
| SR-023 | Custom tool loader | M1 | core | 1 |
| SR-024 | Server skeleton, auth and HTTP | M1 | server | 1 |
| SR-025 | WebSocket protocol and socket | M1 | server | 1 |
| SR-026 | OfficeState builder | M1 | server | 1 |
| SR-027 | Task, chat, cancel and replay handlers | M1 | server | 1 |
| SR-028 | Boot sequence, resume and shutdown | M1 | server | 1 |
| SR-029 | File watchers | M1 | server | 1 |
| SR-030 | Studio template content | M1 | templates | 1 |
| SR-031 | Demo transcripts and the five example tools | M1 | templates | 1 |
| SR-032 | Templates package and rules test | M1 | templates | 1 |
| SR-033 | Demo mode wiring | M1 | server | 1 |
| SR-034 | Web scaffold, socket client and store | M1 | web | 1 |
| SR-035 | Scene: floor, Brain, pods, desks, camera | M1 | web | 2 |
| SR-036 | Scene: agents and animation cues | M1 | web | 2 |
| SR-037 | Picking, camera focus and keymap | M1 | web | 1 |
| SR-038 | Top bar and theming | M1 | web | 1 |
| SR-039 | Task bar | M1 | web | 1 |
| SR-040 | Chat tab, deliverable card, inline rename | M1 | web | 1 |
| SR-041 | Activity feed, tool cards, stopped banner, minimal approval card | M1 | web | 2 |
| SR-042 | List view and accessibility | M1 | web | 1 |
| SR-043 | Rename, set_key, deliverable approve, note reveal, reload, brain routes | M1 | server | 1 |
| SR-044 | Settings > Models | M1 | web | 1 |
| SR-045 | CLI: bin, office folder, start, first run | M1 | cli | 1 |
| SR-046 | Doctor engine in server, CLI setup and doctor printer | M1 | server, cli | 1 |
| SR-047 | CLI tests, build job, install timing | M1 | cli, ci | 1 |
| SR-048 | Smoke test, size-limit, e2e job | M1 | web, ci | 1 |
| SR-049 | README and hero GIF | M1 | docs | 1 |
| SR-050 | Core coverage gate and full loop tests | M1 | core | 1 |
| SR-051 | v0.1 release and soft launch | M1 | ci, docs | 1 |
| SR-052 | McpManager | M2 | core | 3 |
| SR-053 | MCP OAuth with PKCE | M2 | core, server | 2 |
| SR-054 | Whitelist, match rules, fingerprints, expiry | M2 | core | 2 |
| SR-055 | Server side of approvals and MCP | M2 | server | 1 |
| SR-056 | Full approval card | M2 | web | 2 |
| SR-057 | Connector bar MCP health states | M2 | web | 1 |
| SR-058 | tools.reloaded card payloads, tools.assign and Roster.addTool | M1 | server, core | 1 |
| SR-059 | web_search backends | M2 | core | 1 |
| SR-060 | BrainGraph, readBy and revisions | M2 | core | 1 |
| SR-061 | Brain WebSocket messages and upload | M2 | server | 1 |
| SR-062 | Brain graph overlay | M2 | web | 2 |
| SR-063 | Routines scheduler | M2 | server | 2 |
| SR-064 | Schedule popover and routine list | M2 | web | 1 |
| SR-065 | Brain import and reindex | M2 | core, cli | 1 |
| SR-066 | Leaving demo mode | M2 | server, web, cli | 1 |
| SR-067 | Settings: whitelist, doctor, default model | M2 | web, server | 1 |
| SR-068 | Config migrations and migrate command | M2 | server, cli | 1 |
| SR-069 | Docker image | M2 | ci | 1 |
| SR-070 | Docs site and docs:gen | M2 | docs, ci | 2 |
| SR-071 | Telemetry opt-in and update check | M2 | core, cli | 1 |
| SR-072 | Perf test and perf job | M2 | web, ci | 1 |
| SR-073 | Live matrix workflow | M2 | ci | 1 |
| SR-074 | Embeddings and hybrid search | M2 | core | 1 |
| SR-075 | Doctor: remaining checks, fix and bundle | M2 | cli | 1 |
| SR-076 | CLI: tools, template, export | M2 | cli | 1 |
| SR-077 | Fix what v0.1 testers hit | M2 | all | 2 |
| SR-078 | v0.2 release | M2 | ci | 1 |
| SR-079 | Launch | M2 | docs | 1 |
| SR-080 | Four more templates | M3 | templates | 3 |
| SR-081 | Templates gallery | M3 | docs, cli | 1 |
| SR-082 | Teach the office | M3 | core, server, web | 3 |
| SR-083 | Usage and cost panel | M3 | server, web | 2 |
| SR-084 | Community adapter programme | M3 | core, docs | 2 |
| SR-085 | brain_propose_edit | M3 | core, web | 2 |
| SR-086 | Chunk compaction | M3 | core | 1 |
| SR-087 | Settings edits roles, tools and models | M3 | web, server | 2 |
| SR-088 | v0.3 release | M3 | ci | 1 |
| SR-089 | Interface freeze audit | M4 | core | 2 |
| SR-090 | Config importers | M4 | cli | 3 |
| SR-091 | Windows first-class | M4 | all | 3 |
| SR-092a | Remote office package: HTTPS and login | M4 | new | 3 |
| SR-092b | Remote office package: docs, packaging, auth tests | M4 | new, docs | 2 |
| SR-093 | v1.0 release | M4 | ci | 1 |

### M0 tickets

#### SR-001 Monorepo skeleton

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-001 | Monorepo skeleton | root | none | 1 |

Create the repo exactly as section 4 of this document lists it: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, root `package.json`, and a `package.json` plus `src/index.ts` for each of `core`, `server`, `web`, `cli`, `templates`, with the names and scripts from `repo-quality-launch.md` §1. Each package builds to `dist/` and exports one placeholder symbol so `turbo build` and `turbo typecheck` pass end to end. `packages/web` is a Vite app with an empty `App.tsx`. `.gitignore` covers `dist`, `node_modules`, `office/`, `.turbo`, `coverage`.

`@staffroom/server` lists `@staffroom/web` as a `devDependency` (`"@staffroom/web": "workspace:*"`) so that turbo's `^build` orders `web` before `server`; the server never imports from it at runtime, it only copies `../web/dist` into `dist/public`. `packages/server/scripts/copy-web.mjs` exits 1 with `copy-web: ../web/dist is missing; run pnpm --filter @staffroom/web build first` when the folder is absent or empty, so a broken build order can never ship an empty `dist/public`.

Acceptance:

- [ ] `pnpm install && pnpm build && pnpm typecheck && pnpm test` pass on a clean clone, and `packages/server/dist/public/index.html` exists afterwards.
- [ ] `pnpm --filter staffroom exec node dist/index.js` prints the placeholder line.
- [ ] Dependency direction is `web -> core (types)`, `server -> core (runtime)`, `server -> web (devDependency, build order only)`, `cli -> server, templates`, `templates -> nothing` and nothing else.
- [ ] Deleting `packages/web/dist` and running `pnpm --filter @staffroom/server build` alone fails with the `copy-web:` message.
- [ ] Every published `package.json` has `type: module`, `license: Apache-2.0`, `engines.node >=20`, `files: ["dist"]`, `sideEffects: false`, `publishConfig.access: public`. `publishConfig.provenance: true` is added by SR-005's release workflow, not here, because the hand publish on day one runs outside CI.

Tests: one Vitest file per package containing a single passing test, so the `test` task has something to run from day one.

#### SR-002 Biome, lefthook and the lint scripts

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-002 | Biome, lefthook and the lint scripts | root | SR-001 | 1 |

`biome.json` per `repo-quality-launch.md` §3 (2-space, width 100, `recommended` plus the six named rules as errors, `cli` override for `noConsoleLog`). `lefthook.yml` runs `biome check --staged` and `turbo typecheck` on pre-commit and checks the `Signed-off-by:` trailer on commit-msg. `scripts/lint/` holds six Node scripts wired into the root `lint` script: `forbidden-sdk.mjs` (fails if `@anthropic-ai/claude-agent-sdk` appears in any `package.json` or `pnpm-lock.yaml`), `npx-grep.mjs` (fails on `Run staffroom ` anywhere under `packages/`), `fixture-secrets.mjs` (fails on `sk-`, `key-`, `Bearer ` in `**/fixtures/**` and `packages/templates/**`), `dep-cycles.mjs` (a hand-rolled walk over workspace `dependencies` only; `devDependencies` edges such as `server -> web` are allowed because they carry build order, not runtime imports, and the script also asserts that no `.ts` file under `packages/server/src` imports `@staffroom/web`), `changeset-present.mjs` (a PR touching `packages/*` must add a `.changeset/*.md`, and any changeset with a `major` bump fails while the version is below 1.0), `route-tests.mjs` (every `packages/server/src/http/*.ts` has a sibling `*.test.ts`).

Acceptance:

- [ ] `pnpm lint` passes on the skeleton.
- [ ] Adding `"@anthropic-ai/claude-agent-sdk": "*"` to any package makes `pnpm lint` exit 1 with a message naming the file.
- [ ] A commit without `Signed-off-by` is rejected locally.
- [ ] `// @ts-ignore` fails Biome.

Tests: `scripts/lint/*.test.mjs` for each script with a fixture tree in a temp dir.

#### SR-003 Repo hygiene files

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-003 | Repo hygiene files | root | SR-001 | 1 |

Write every file in `repo-quality-launch.md` §7 with the content it specifies: `LICENSE` (Apache-2.0, copyright line), `CONTRIBUTING.md` with the clean-room paragraph verbatim, the DCO sentences and a "Running it locally" block whose first command is `pnpm --filter staffroom exec node dist/index.js init --template studio --dir ./office` followed by `pnpm dev` (the `dev` script assumes `./office` exists), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, `conduct@staffroom.so`), `SECURITY.md` with the six-item vulnerability list, `ROADMAP.md` with the four plan headings and the "Not planned" list, `.github/ISSUE_TEMPLATE/{bug,feature,provider-adapter,template}.yml` plus `config.yml` with blank issues off, `PULL_REQUEST_TEMPLATE.md` with the five checkboxes, `CODEOWNERS`, `dependabot.yml` (weekly, npm and Actions). Create the `staffroom-ai` GitHub org today (open question 5) and register `staffroom.so`.

Acceptance:

- [ ] Every file above exists and the bug template asks for `npx staffroom doctor --bundle` output with the "I checked the paste for keys" checkbox.
- [ ] CONTRIBUTING contains the sentence "Staffroom is a clean-room design." verbatim.
- [ ] GitHub Discussions enabled with the four categories; `not planned` and `good first issue` labels exist.

Tests: none (docs ticket). A `scripts/lint/hygiene-files.mjs` check that the nine files exist is added to `lint`.

#### SR-004 CI workflow

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-004 | CI workflow | ci | SR-002 | 1 |

`.github/workflows/ci.yml` with the `lint`, `typecheck`, `test` (ubuntu Node 20 and 22, macos-14, windows-2022) and `build` jobs from `repo-quality-launch.md` §5. The `e2e`, `perf` and `install-timing` jobs are added by SR-048, SR-072 and SR-047 as their tests exist. Coverage upload from ubuntu. `npm audit --audit-level=high` in `lint`. Branch protection on `main`: required jobs, one CODEOWNER review, DCO check app, linear history. Secret scanning with push protection turned on in repo settings.

`.github/workflows/dependabot-automerge.yml` per `repo-quality-launch.md` §5: on `pull_request` from `dependabot[bot]`, `dependabot/fetch-metadata@v2` reads `update-type`; when it is `version-update:semver-patch` or `version-update:semver-minor` the job runs `gh pr merge --auto --squash "$PR_URL"` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `permissions: { pull-requests: write, contents: write }`. `--auto` means the merge waits for branch protection, so a red `ci.yml` still blocks it; major bumps are left for a human.

Acceptance:

- [ ] A PR that breaks typecheck cannot merge.
- [ ] pnpm store is cached per OS; a no-change run finishes under 6 minutes.
- [ ] Windows job uses `shell: bash` for every step that pipes.
- [ ] A Dependabot patch PR with green CI merges itself; a Dependabot major PR does not get auto-merge enabled; a patch PR with a red `test` job stays open.

Tests: none; the workflow is exercised by every PR.

#### SR-005 Changesets, release workflow, placeholder publish

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-005 | Changesets, release workflow, placeholder publish | ci, cli | SR-004 | 1 |

`.changeset/config.json` with `fixed: [["staffroom","@staffroom/core","@staffroom/server","@staffroom/web","@staffroom/templates"]]`, `changelog: @changesets/changelog-github`, `access: public`. `release.yml` opens the "Version Packages" PR and publishes on merge with `id-token: write` and `NPM_CONFIG_PROVENANCE=true`; the same PR adds `publishConfig.provenance: true` to the five `package.json` files, because from then on every publish runs in CI. Create the `@staffroom` npm org at `https://www.npmjs.com/org/create` (the npm CLI has no org-create command; `npm org` only has `set`, `rm` and `ls`).

Hand-publish all five packages at `0.0.1` today with `npm publish --access public --provenance=false`, because npm refuses provenance outside a supported CI/OIDC environment and npm trusted publishing is configured per package that already exists: `staffroom` from `packages/cli` with a bin that prints `Staffroom is not released yet. Watch https://github.com/staffroom-ai/staffroom for the first version.`, and `@staffroom/core`, `@staffroom/server`, `@staffroom/web`, `@staffroom/templates` each with their one placeholder export. Then configure trusted publishing (repo `staffroom-ai/staffroom`, workflow `release.yml`) on each of the five package pages so the `0.1.0` release in SR-051 needs no `NPM_TOKEN`.

Acceptance:

- [ ] `npx staffroom@0.0.1` prints the holding line on a machine that has never seen the package.
- [ ] `npm view @staffroom/core version` (and the other three scoped packages) prints `0.0.1`.
- [ ] Each of the five package pages on npmjs.com shows trusted publishing configured for `release.yml`.
- [ ] `pnpm changeset` works and `pnpm changeset version` bumps all five packages together.
- [ ] A `major` changeset fails `pnpm lint` (pre-1.0 policy) through `scripts/lint/changeset-present.mjs`, which the root `lint` script runs.

Tests: `scripts/lint/changeset-present.test.mjs` covers the major-rejection rule and the missing-changeset rule.

#### SR-006 Provider types and BaseAdapter

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-006 | Provider types and BaseAdapter | core | SR-006b | 1 |

`packages/core/src/providers/types.ts` with `Message`, `ToolCall`, `ToolSpec` (name regex allowing one dot), `Usage`, `StopReason`, `CompletionChunk`, `CompleteOptions`, `ProviderCapabilities`, `ModelPricing`, `ProviderAdapter` (`kind` includes `"demo"`; `listModels(): Promise<Array<{ id: string; created?: string }>>` is part of the contract and every adapter implements it), exactly as in `core-agent-loop.md`. A `BaseAdapter` abstract class provides `estimateTokens()` (chars / 3.5 + 4 per message + schema JSON / 3.5), the `.`-to-`__` tool-name mapping helpers `encodeToolName` / `decodeToolName`, and `pricing()` that checks config then the shipped table. `ProviderError` is imported from `runtime/errors.ts` (SR-006b); nothing in this ticket defines an error class.

Acceptance:

- [ ] All types are exported from `@staffroom/core`.
- [ ] `encodeToolName("notion.search_pages") === "notion__search_pages"` and decoding round-trips; a name with two dots is rejected at `ToolSpec` validation.
- [ ] `estimateTokens` on an empty message list returns 0.
- [ ] `ProviderAdapter` requires `listModels`; a class missing it fails typecheck.

Tests: `providers/types.test.ts` for the name mapping, the regex and `estimateTokens`.

#### SR-006b Shared core types, RunError and the error table

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-006b | Shared core types, RunError and the error table | core | SR-001 | 1 |

One place for the types that three later tickets would otherwise define for each other. `packages/core/src/runtime/errors.ts`: `RunErrorCode` union (19 codes), `RunError` with `code`, `detail`, `retryable`, `retryAfterMs`, `toJSON()` producing `{ code, message, hint, detail }`, `ProviderError extends RunError` carrying `providerKind` and `status`, and `userMessage(code, detail)` returning the message and hint from the table in `core-agent-loop.md`, including the Ollama variants for `MODEL_NOT_FOUND` and `PROVIDER_UNAVAILABLE` selected by `detail.providerKind === "ollama"`. Every hint that names a command says `npx staffroom <sub>`. `packages/core/src/shared/types.ts`: `ToolSource` (`{ kind: "builtin" } | { kind: "custom"; file: string } | { kind: "mcp"; server: string }`), `ApprovalPreview` (`action`, `destination`, `summary`, `body`, `fields`, `irreversible`, `changedSinceAllowed?`), `ApprovalDecision` (`"approve" | "approve_always" | "deny" | "expired" | "cancelled"`), `ApprovalBy` (`"owner" | "system" | "whitelist"`), and the `BrainReader` interface (`search(query, opts)`, `read(id)`, `list(opts)`) that SR-015 implements and SR-014 places on `ToolContext`. SR-013's `RunEvent`, SR-014's `Tool` and SR-006's `ProviderError` all import from these two files, so none of them depends on a later ticket. SR-009 was merged into this ticket and its id is retired.

Acceptance:

- [ ] `userMessage("NO_MODEL_CONFIGURED", {})` returns the hint `Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.` verbatim (the CLI test in SR-047 greps for it).
- [ ] `userMessage` for every code interpolates every `{placeholder}` it names; a missing detail key renders as `?` and a test fails.
- [ ] `import type { ToolSource, ApprovalPreview, ApprovalDecision, ApprovalBy, BrainReader } from "@staffroom/core"` typechecks.

Tests: `runtime/errors.test.ts` snapshot of all 19 messages and hints; a test that no hint contains `Run staffroom `; `shared/types.test.ts` asserting `ApprovalDecision` and `ApprovalBy` unions are closed (an `expectTypeOf` test).

#### SR-007 FixtureAdapter, recordFixture, conformance harness

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-007 | FixtureAdapter, recordFixture, conformance harness | core | SR-006 | 1 |

`packages/core/src/testing/fixture-adapter.ts`: `FixtureAdapter(dir, { delayMs })` with `kind: "demo"`, `id: "demo"`, reading `.jsonl` files whose first line is a header (`request` for adapter fixtures, `matches` for demo runs) and whose remaining lines are `CompletionChunk`s. Selection: exact `request` match by hash for fixtures, keyword score over `matches` for demo runs, else the file named `generic.jsonl`. `recordFixture(adapter, name)` wraps a real adapter, writes the file, and passes every string through `redactSecrets` (SR-012; until then, a local regex for `sk-`/`key-`). `providers/conformance.test.ts` runs the seven named fixtures (`plain-text`, `single-tool-call`, `parallel-tool-calls`, `tool-result-roundtrip`, `streaming-mid-word`, `empty-response`, `provider-error-429`) against every adapter listed in a table, plus the abort test. Exported from `@staffroom/core/testing`.

Acceptance:

- [ ] `FixtureAdapter` passes its own conformance run using hand-written fixtures under `src/testing/fixtures/`.
- [ ] Per-chunk delay is `delayMs / speed` and `setSpeed(1|2|4)` exists for `demo.speed`.
- [ ] Aborting `opts.signal` mid-stream throws `AbortError` and yields no `done`.

Tests: `testing/fixture-adapter.test.ts` (selection, delay, abort) and `providers/conformance.test.ts`.

#### SR-008 Anthropic adapter

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-008 | Anthropic adapter | core | SR-007 | 1 |

`providers/anthropic.ts` per `core-agent-loop.md`: `messages.stream()`, system message to `system`, tool_use and tool_result block mapping, consecutive tool messages merged into one user message, stop reason mapping, `forceTool` to `tool_choice`, `capabilities` all true with 200k context for the claude-5 family, error mapping to `AUTH_FAILED` (401), `RATE_LIMITED` (429 with `retry-after`), `PROVIDER_UNAVAILABLE` (5xx, network), `MODEL_NOT_FOUND` (404), `CONTEXT_TOO_LONG` (400 with the context message). `listModels()` calls `client.models.list()` and returns `{ id, created }` sorted newest first; `setup` (SR-046) and Settings (SR-044) show the six most recent with "Show all". Record the seven fixtures with `STAFFROOM_RECORD=1` against `claude-sonnet-5`, plus `fixtures/anthropic/models-list.json` for `listModels`. Under 150 lines excluding the fixtures.

Acceptance:

- [ ] Conformance suite passes from fixtures with no network.
- [ ] `STAFFROOM_LIVE_TESTS=1` runs the same eight assertions live.
- [x] `providers/anthropic.ts` is 142 code lines (159 with comments). Amended 15 Sep 2026: the criterion was a raw `wc -l` under 150. Message conversion and error mapping were extracted to `anthropic-messages.ts` and `anthropic-errors.ts`, which are real separations, but Biome's formatting plus the comments leave the file at 159 raw lines. Stripping comments to hit the raw number would make the code worse for no gain, so the budget now counts code lines. The intent, that adding a provider stays small, is met: the whole Anthropic provider is 213 code lines across four files.
- [ ] `listModels()` against the mocked SDK returns the fixture ids newest first and maps a 401 to `AUTH_FAILED`.

Tests: the conformance suite plus `providers/anthropic.test.ts` for error mapping and `listModels` using mocked SDK errors and the fixture.

#### SR-009 (retired)

Merged into SR-006b so that `RunError`, `ProviderError` and the shared approval and tool types land in one ticket before anything imports them. The id is not reused; references to "SR-009" in older commits mean SR-006b.

### M1 tickets

#### SR-011 Config schemas, loaders, Roster

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-011 | Config schemas, loaders, Roster | core | SR-006, SR-006b | 2 |

Scheduled before SR-010 because `resolveModel` consumes the `AgentConfig`, `AgentsFile` and `OfficeConfig` types defined here. `packages/core/src/config/`: `agents.ts` (`DepartmentId`, `AgentSchema`, `AgentsFileSchema`, strict), `config.ts` (`EnvString`, `ProviderSchema` with `kind` defaulting from the key, `McpStdioSchema`, `McpHttpSchema`, `ConfigSchema` including `RunnerConfigSchema` and `BrainConfigSchema` and the `approvals`, `telemetry`, `server` blocks, all strict), `errors.ts` (`ConfigError` with the 18 codes and the two-line printed form), `env.ts` (`$NAME` expansion from `process.env` and `office/.env`, `SECRET_LITERAL_IN_CONFIG` for literals over 12 chars in secret positions), `validate.ts` (`validateAgents(file, tools: ToolNameResolver, mcpConfig, providers)` with the id, lead, six-department, seat-limit, provider-prefix and tool-name rules including MCP server names and the `web` alias; `ToolNameResolver` is the one-method interface `{ has(name: string): boolean }` declared in this file so the validator does not import `ToolRegistry` from SR-014, which implements it), and `roster.ts` (`Roster` with `agents`, `departments` in first-appearance order with pod and seat numbers, `leadFor(department)`, `reload()`, `setName(agentId, name)` and `addTool(agentId, tool)` through the `yaml` document API so comments survive, adding `# named by <lead id> on <date>`). `loadRoster(officeDir)` and `loadConfig(officeDir)` are the public exports. `UNKNOWN_KEY` hints name the right file for `default_model`, `name`, `timezone`.

Acceptance:

- [ ] The full `agents.yaml` and `config.yaml` examples from `server-cli-runtime.md` §3 parse with zero errors.
- [ ] `default_model` in `config.yaml` produces `UNKNOWN_KEY` with the hint `put it in office/agents.yaml as a top-level key.`
- [ ] A literal `sk-...` in `api_key` produces `SECRET_LITERAL_IN_CONFIG` with the exact hint text.
- [ ] Seven departments produce `AGENT_DEPARTMENT_LIMIT`; six agents in the pod-5 department produce `AGENT_SEAT_LIMIT` with the reception-desk sentence.
- [ ] `setName` on a file with comments keeps every comment byte-for-byte.

Tests: `config/*.test.ts` for each schema, every `ConfigError` code at least once, the printed form snapshot, `Roster.setName` comment preservation, `validateAgents` with a `Set`-backed `ToolNameResolver`, and `AGENT_ID_DUPLICATE` giving `Two agents share the id "copywriter" in office/agents.yaml. Ids must be unique.`

#### SR-010 resolveModel and pricing

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-010 | resolveModel and pricing | core | SR-011 | 1 |

`providers/resolve.ts` with `ModelId`, `ResolvedModel` and `resolveModel(agent: AgentConfig, agentsFile: AgentsFile, providers, override?)` following the four-step chain, split on the first `/`, skipping unknown providers, failing `NO_MODEL_CONFIGURED` when nothing resolves and `PROVIDER_NOT_CONFIGURED` when the provider exists without a key. The local check (`kind: ollama`, or `base_url` host in `localhost`, `127.0.0.1`, `[::1]`) lives here as `isLocalProvider(adapter, config)` and is what refuses an override with `MODEL_OVERRIDE_LEAVES_MACHINE`. `providers/pricing.ts` is a JSON export with a `checked` date per provider and `input_per_1k` / `output_per_1k` / `cached_input_per_1k` per model. `modelStatusFor(agent, ...)` returns `ok | no_key | unreachable` for the server to place on `OfficeState`.

Acceptance:

- [ ] `openrouter/anthropic/claude-sonnet-5` resolves to provider `openrouter`, model `anthropic/claude-sonnet-5`.
- [ ] An agent on `ollama/llama4` with `override: "anthropic/claude-opus-5"` throws `MODEL_OVERRIDE_LEAVES_MACHINE`.
- [ ] `source` is one of `override | agent | office_default | first_provider` and matches which step succeeded.

Tests: `providers/resolve.test.ts` covering all four steps, the skip rule, both error codes and the local refusal; `pricing.test.ts` asserts every shipped provider has a `checked` date.

#### SR-012 redactSecrets

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-012 | redactSecrets | core | SR-011 | 1 |

`packages/core/src/redact.ts`: `configureRedaction(secrets)` and `redactSecrets<T>(value): T` producing a deep copy with every configured secret (8 characters or longer) replaced by `••••`, plus any string value whose key matches `/token|secret|password|api[_-]?key|authorization/i`. Returns the replacement count through a second export `redactSecretsCounted(value): { value, count }` used for `tool_result.redactedCount`. `createOffice` (SR-022) feeds it every `.env` value, expanded `mcp.servers.*.env` and `args` value, stored OAuth token and `providers.*.api_key`.

Acceptance:

- [ ] `PORT=4242` in `.env` does not redact `4242` elsewhere.
- [ ] Nested arrays and objects are covered; `Date` and `null` pass through.
- [ ] The function is pure and never logs.

Tests: `redact.test.ts` including the `.env` marker case (marker appears in a tool output, is absent from the redacted event, and `count` is 1).

#### SR-013 RunStore

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-013 | RunStore | core | SR-006b, SR-012 | 1 |

`runtime/events.ts` with `Run`, `RunKind`, `RunStatus`, `RunEvent` (13 members; the `approval_needed` and `approval_resolved` members use `ApprovalPreview`, `ApprovalDecision` and `ApprovalBy`, and `tool_call` uses `ToolSource`, all imported from `shared/types.ts` in SR-006b), `RunEventEnvelope`, `Deliverable`, and `SqliteRunStore` implementing `RunStore` over `better-sqlite3` in WAL mode with the schema from `core-agent-loop.md` under `runtime/migrations/001-initial.sql` and a `schema_version` table. `append` redacts, writes and updates the `runs` row in one transaction; `chunk` events are batched at 100 ms while subscribers still receive them immediately; `since(seq)` tails for the server; `pendingApprovals()` and `lastDeliverable(agentId)` are SQL over `run_events`. Ids are ulids with `run_` and `apr_` prefixes.

Acceptance:

- [ ] `append` of an event containing a configured secret stores the redacted payload.
- [ ] A `done` event sets `status`, `finished_at`, tokens and `cost_usd` on the `runs` row.
- [ ] `lastDeliverable` ignores route runs and runs whose deliverable has `noteId: null`.
- [ ] Opening a second connection on the same file for replay works while writes continue.

Tests: `runtime/events.test.ts` using a temp file (never `:memory:`), including batching, `since`, `pendingApprovals` after an `approval_resolved`, and a 10,000-event append benchmark under 2 s.

#### SR-014 Tool shape and ToolRegistry

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-014 | Tool shape and ToolRegistry | core | SR-011, SR-013 | 2 |

`tools/tool.ts` (`ToolScope`, `ToolContext` whose `brain` is the `BrainReader` interface from SR-006b so this ticket does not wait for SR-015, `Tool` whose `source` is the `ToolSource` from SR-006b, `tool()` which fills `scope: "write"` when omitted, validates the name and freezes; `ToolRegistry` implements SR-011's `ToolNameResolver`) and `tools/registry.ts` (`RegisteredTool` with `fingerprint`, `ToolRegistry` with `register`, `unregister`, `get`, `list`, `forAgent` applying the four filters in order, and `invoke` which validates with zod, computes `inputChars`, applies the egress read limit with the exact message, then gates: read runs; `local` appends `approval_needed` and `approval_resolved { by: "system" }` in one append and runs; otherwise appends `approval_needed` and blocks on an in-memory `PendingApproval` map until `registry.resolve(approvalId, decision, by, note?)` is called or the run's signal aborts (resolving `cancelled`). Timeouts produce `timeout` with the "took longer than 60 s" text. `ToolResult` and `ToolErrorCode` as specified. Whitelist lookup is a `Whitelist` interface with a no-op implementation here; SR-054 replaces it. Preview generation for tools without `preview()` (fields from top-level keys, YAML body, `irreversible: true`) lives in `tools/preview.ts`.

Acceptance:

- [ ] A read-scope `egress: true` tool with a 1,001-character input returns `invalid_input` with `Input to <name> is over 1000 characters; this tool sends its input off this computer.`
- [ ] `forAgent` implies the three brain tools, never `web_search`, accepts `web` as the alias, and excludes denied MCP servers.
- [ ] A blocked write resolves to `approval_denied` with `The owner declined this action.` when denied, and to `cancelled` when the signal aborts.
- [ ] `register` of a duplicate name throws `ToolNameConflict`.

Tests: `tools/registry.test.ts` covering every branch above, the local short-circuit producing two events in one append, and `tools/preview.test.ts`.

#### SR-015 Brain index

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-015 | Brain index | core | SR-011 | 2 |

`packages/core/src/brain/`: `types.ts` (`NoteFrontMatter`), `index.ts` (`BrainIndex.open(brainDir, config)` walking the folder, comparing `content_hash` and `mtime`, `reindexFile`, `removeFile`, `close`), the SQLite schema from `brain.md` in `office/brain.index.sqlite` with `meta.schema_version` triggering a full rebuild on mismatch, `parse.ts` (gray-matter, `title` fallback to first heading then filename, `created` fallback to birth time with a `missing_created` warning callback, invalid YAML indexes body-only), `links.ts` (wiki-link resolution by id, basename, title; phantom targets; markdown `.md` links; front-matter `links`), the skip rules (`_attachments/`, `_private/` at any depth, dot folders, `private: true`, `brain.ignore` globs), weights (0.5 for `90-archive/` and `inbox/`), trust (`owner | agent | imported`), and `search.ts` with `brainSearch` in keyword mode (`bm25` weights title 4, tags 2, body 1, multiplied by weight, department boost) and `brainRead(id)`. `BrainIndex.reader()` returns the read-only handle implementing the `BrainReader` interface from SR-006b, which is what SR-014 places in `ToolContext`.

Acceptance:

- [ ] A 2,000-note temp brain opens in under 2 s on the CI macOS runner (benchmark fails over 5 s).
- [ ] A note under `_private/` or with `private: true` has no row in `notes` at all.
- [ ] `[[Acme Pty Ltd]]` resolves to `10-customers/acme-pty-ltd`; an unresolved link produces a `links` row with `resolved = 0`.
- [ ] Note ids use forward slashes on Windows.

Tests: `brain/index.test.ts`, `brain/parse.test.ts`, `brain/links.test.ts`, `brain/search.test.ts` and `brain/bench.test.ts`.

#### SR-016 SAFETY_RULE and buildSystemPrompt

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-016 | SAFETY_RULE and buildSystemPrompt | core | SR-011, SR-014, SR-015 | 1 |

`prompt/safety-rule.ts` exports `SAFETY_RULE` with the six-rule text from `tools-mcp-approvals.md` §6 verbatim. `runtime/prompt.ts` exports `buildSystemPrompt({ agent, department, office, pinnedNotes, tools })` assembling the six sections in order (identity, `<owner_instructions>`, pinned `<note path= updated= trust=>` blocks capped at `pinned_token_budget` with whole-note drops in path order and the included and truncated id lists returned, one tool line per tool with `(read)`, `(needs approval)` or `(read, sends its input to <server>)`, the verbatim output contract, then `SAFETY_RULE` last). Returns `{ text, hash, pinnedIncluded, pinnedTruncated }`. Sample notes are skipped when `office.mode === "live"`.

Acceptance:

- [ ] Nothing from `agents.yaml`, a template or a note appears after `SAFETY_RULE`.
- [ ] `instructions` longer than 4,000 characters is cut at 4,000.
- [ ] The identity sentence for the sample copywriter is `You are Priya, Copywriter in the Marketing department at Northlight Studio. Turns briefs into landing page copy and email sequences.`

Tests: `prompt.test.ts` snapshot of the full prompt for the sample copywriter; `safety-rule.test.ts` snapshot; a truncation test with a 6,000-token pinned set.

#### SR-017 Brain tools and brainWriteDeliverable

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-017 | Brain tools and brainWriteDeliverable | core | SR-014, SR-015 | 1 |

`tools/builtins/brain.ts` registers `brain_search`, `brain_read` and `brain_write` with the schemas and descriptions from `brain.md`. `brain/write.ts` exports `brainWriteDeliverable(input, ctx)`: path `40-deliverables/<department>/<yyyy-mm-dd>-<slug>.md` with `-2`, `-3` on collision, never overwrites, fills `written_by`, `department`, `task`, `run`, `model`, `tools_used`, `status: draft`, `revises`, and `links` from the run's `tool_result.noteIds` not already linked; when `revises` is set, flips the previous note's `status` from `draft` to `rejected` and nothing else. All three tools return `noteIds`. Include `brain_list` (`scope: read`, implied, 50 ids with titles by area or tag) per the recommendation in `brain.md` open question 5, so the v0.1 tool set is final.

Acceptance:

- [ ] `brain_write` has no `path` or `mode` field and cannot write outside `40-deliverables/`.
- [ ] Two writes with the same title on the same day produce `-2`.
- [ ] `brain_search` returns `noteIds` equal to the ids of its hits.

Tests: `brain/write.test.ts` (front-matter snapshot, collision, revises flip), `tools/builtins/brain.test.ts` (schemas, `noteIds`, `brain_list` cap).

#### SR-017b web_search registration with the none backend

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-017b | web_search registration with the none backend | core | SR-014 | 1 |

The product plan lists `web_search` among the v0.1 built-ins and `tools-mcp-approvals.md` §4 says `tools.web.provider: none` still registers the tool; the studio roster's `tools: [web]`, `forAgent`'s `web` alias, SR-026's connector list and SR-031's transcript check all need the name to exist in M1. `tools/builtins/web-search.ts` registers `web_search` with the schema from §4 (`query`, `maxResults` default 5), `scope: "read"`, `egress: true`, never implied, `source: { kind: "builtin" }`, and one backend, `none`, whose handler returns `{ error: "web search is not configured" }` without throwing. `Connector.health` for it is `grey` with the message `Add a search key in office/config.yaml under tools.web to turn this on.` The `brave`, `tavily` and `searxng` backends and the 4,000-character cap are SR-059 (M2).

Acceptance:

- [ ] With no `tools.web` block, `registry.get("web_search")` exists, `forAgent` for an agent with `tools: [web]` includes it, and a call returns the error object.
- [ ] `validateAgents` on the studio roster (`tools: [web]`) produces zero errors with the real registry.
- [ ] A `tools.web.provider: brave` config with no key is a `ConfigError` (`SECRET_MISSING`), not a silent fall-through to `none`.

Tests: `tools/builtins/web-search.test.ts` (registration, alias, the `none` result, the config error); SR-059 extends the same file with backend fixtures.

#### SR-018 The agent loop

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-018 | The agent loop | core | SR-013, SR-014, SR-016, SR-017 | 2 |

`runtime/loop.ts`: `runAgentLoop(ctx)` as written in `core-agent-loop.md`, with `completeWithRetry` (retry `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` and network errors up to `retries.attempts` with exponential backoff, jitter and `retryAfterMs`; partial text kept with its `attempt`), `dispatchToolBatch` (the five numbered steps: `forAgent` check with the "not available to you" text, `tool_call` event with `scope`, `egress`, `inputChars`, `group`; `tools.invoke` per call with `max_parallel_tools` for reads; `<tool_result name= trust="untrusted">` wrapping and truncation at `tool_output_max_chars`; the three-consecutive-error rule), `finish` (title extraction, `brainWriteDeliverable` recorded as a `brain_write` tool_call/tool_result pair plus the auto-resolved approval pair, `brain_note_written`, `done` with cost), `messagesFromEvents` for resume, `waiting_approval` status while any invoke is pending, cancellation through one `AbortSignal` ending in `failed { code: "CANCELLED" }` with `partialText`. `TOOLS_UNSUPPORTED` before the first request when the model lacks tool support.

Acceptance:

- [ ] The exact event sequence for a plain deliverable is `started, chunk*, tool_call(brain_write), approval_needed, approval_resolved(system), tool_result, brain_note_written, done`.
- [ ] A 429 followed by success yields two `chunk` attempts numbered 1 and 2 and one `done`.
- [ ] `messagesFromEvents` after a completed loop deep-equals the messages the loop sent.

Tests: `runtime/loop.test.ts` with a scripted `FixtureAdapter` for: plain deliverable, read tool batch, write tool approve, write tool deny, retry after 429, max turns, cancel during a tool, `OUTPUT_TRUNCATED`, and the round-trip. The resume and injected-instruction cases are added by SR-050.

#### SR-019 Runner, routing and revise

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-019 | Runner, routing and revise | core | SR-018 | 1 |

`runtime/runner.ts` with the five methods and their signatures from `core-agent-loop.md`; `runtime/routing.ts` (`routeTask`: lead selection, single-agent skip, route run with sections 1, 2 and 6 plus the team block, `forceTool: "assign_task"` or the JSON-in-text path when `supportsForcedTool` is false, `BAD_ROUTING` fallback to the first non-lead agent, `Roster.setName` for unnamed agents, `routed` then `done { title: "Handed to <name>", noteId: null }` without `finish()`); `runtime/revise.ts` (`buildReviseMessages`, `NOTHING_TO_REVISE`, `revises` passed to `finish`). Chat runs rebuild the last 20 turns from previous chat runs. `resume(runId)` re-issues the last incomplete turn.

Acceptance:

- [ ] `submitTask({ department: "marketing", prompt })` on the studio roster returns `{ routeRunId, runId }` where the child run's `parentRunId` is the route run id.
- [ ] A department with one agent returns `routeRunId: null`.
- [ ] `revise` with an empty instruction uses `Improve it.` and the new note carries `revises`.
- [ ] Routine submissions land as `kind: "routine"` with `routineId` on both runs.
- [ ] A chat run whose final text starts with a `# ` line writes a deliverable; a chat reply without a leading `# ` line produces `done` with `noteId: null` and no `brain_write` call (the rule from `core-agent-loop.md`).

Tests: `runtime/runner.test.ts` and `runtime/routing.test.ts` (forced tool path, JSON path, BAD_ROUTING, naming an unnamed agent and the comment written to `agents.yaml`), `runtime/revise.test.ts`.

#### SR-020 OpenAI-compatible adapter

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-020 | OpenAI-compatible adapter | core | SR-007 | 1 |

`providers/openai.ts` per spec: `chat.completions.create({ stream: true })`, `baseURL` from config, `tool` role mapping with `ERROR: ` prefix for `isError`, per-index tool delta buffering, `stream_options.include_usage` with the `features.stream_usage: false` fallback and 400 auto-detect cached per process, `forceTool` mapping, `__` tool-name encoding. `listModels()` calls `client.models.list()` and returns `{ id, created }` newest first; for OpenAI-compatible endpoints that return an empty list it returns `[]` and `setup` falls back to a free-text model field. Seven fixtures recorded against `gpt-5-mini` plus `fixtures/openai/models-list.json`. A second fixture set recorded against Groq is optional and not a gate (it is seeded as a good first issue in SR-079).

Acceptance:

- [ ] Conformance passes; under 150 lines.
- [ ] An endpoint that rejects `stream_options` gets `usage.estimated: true` and no second 400.
- [ ] `listModels()` against the mocked SDK returns the fixture ids newest first; an endpoint that 404s on `/models` returns `[]` rather than throwing.

Tests: conformance plus `providers/openai.test.ts` for the usage fallback, name encoding and `listModels`.

#### SR-021 Ollama adapter

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-021 | Ollama adapter | core | SR-007 | 1 |

`providers/ollama.ts`: `chat({ stream: true })`, positional `call_<n>` ids, `supportsTools` from `show({ model })` once per process, `supportsForcedTool: false`, zero pricing, `MODEL_NOT_FOUND` when not pulled and `PROVIDER_UNAVAILABLE` when not running, both with `providerKind: "ollama"` in `detail` so the hints say `ollama pull {model}` and `Install it from ollama.com`. `listModels()` calls `client.list()` and returns the pulled model names with `modified_at` as `created`, newest first. Fixtures recorded against `llama3.2:1b` plus `fixtures/ollama/models-list.json`.

Acceptance:

- [ ] Conformance passes; under 150 lines.
- [ ] With Ollama stopped, `complete` throws `PROVIDER_UNAVAILABLE` whose hint mentions ollama.com.
- [ ] `listModels()` against the mocked client returns the fixture names; with Ollama stopped it throws `PROVIDER_UNAVAILABLE` with the same hint.

Tests: conformance plus `providers/ollama.test.ts` for id assignment, `listModels` and the two error hints.

#### SR-022 createOffice and OfficeState types

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-022 | createOffice and OfficeState types | core | SR-017b, SR-019, SR-020, SR-021 | 1 |

`runtime/office.ts` with the `Office` interface and `createOffice({ officeDir, demo })`: loads config and roster, expands env, calls `configureRedaction`, opens `RunStore` and `BrainIndex`, instantiates adapters for providers whose key resolves, builds the registry with built-ins (the three brain tools, `brain_list` and `web_search` from SR-017b), constructs `Runner`, and holds an `McpManager` stub until SR-052. Opens no sockets, starts no watchers. `packages/core/src/office-state.ts` holds every `OfficeState` type from `office-ui.md` §1. Public exports of `@staffroom/core` match the table in `repo-quality-launch.md` §1.

Acceptance:

- [ ] `createOffice` against the studio template in a temp dir resolves in under 2 s and `office.close()` releases both SQLite files.
- [ ] With no keys and `demo: false`, `providers` is empty and no error is thrown (the server decides on demo mode).
- [ ] `import { createOffice, tool, SAFETY_RULE, redactSecrets, loadRoster, loadConfig } from "@staffroom/core"` typechecks from a sibling package.

Tests: `runtime/office.test.ts`; an `exports.test.ts` that imports the built `dist` and checks each named export exists.

#### SR-023 Custom tool loader

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-023 | Custom tool loader | core | SR-014 | 1 |

`tools/custom-loader.ts`: `CustomToolLoader.loadAll(dir)`, `load(file)`, `unload(file)` per `tools-mcp-approvals.md` §2. esbuild bundle with the `resolveHostPackages` plugin marking a fixed allow-list `HOST_PACKAGES = ["@staffroom/core", "zod", "better-sqlite3"]` as external and rewriting each import to the server process's own `import.meta.resolve(name)` `file://` URL, so a tool file in an office with no `node_modules` still gets the running core, the same zod and the same native `better-sqlite3` build (a native addon cannot be bundled and must not be loaded twice). Any other bare import fails the load with `Tool file <name> imports "<pkg>", which Staffroom does not provide. Only @staffroom/core, zod and better-sqlite3 are available; copy other code into the tool file.` This ticket writes that sentence and the three-package list into `tools-mcp-approvals.md` §2. Output to `office/.staffroom/cache/tools/<hash>.mjs`, cache-busted `import()`, brand check, `source: { kind: "custom", file }`, `register`. Failures return `{ ok: false, file, message, line? }`. Files starting with `_` are skipped. A missing `scope` is reported as `{ ok: true, warning: "no_scope" }` so the server can raise the card.

Acceptance:

- [ ] A fixture tool importing `@staffroom/core`, `zod` and `better-sqlite3` loads from a temp office with no `node_modules`, `instanceof ZodObject` holds on its `input`, and the loaded `better-sqlite3` is the same module object the server holds.
- [ ] A fixture tool importing `lodash` returns `ok: false` with the "does not provide" message.
- [ ] A syntax error returns `ok: false` with the line number and does not throw.
- [ ] In-flight invocations finish on the old handler after `load` replaces a tool.

Tests: `tools/custom-loader.test.ts` including the no-`node_modules` case with the three-package fixture and a `sqlite_query`-shaped fixture, which `doctor tools.resolve` reuses. Loading the five shipped example tools is asserted in SR-031, which owns them.

#### SR-024 Server skeleton, auth and HTTP

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-024 | Server skeleton, auth and HTTP | server | SR-022 | 1 |

`packages/server/src/index.ts` with `ServerOptions` (`officeDir`, `port`, `host`, `open`, `demo`, `watch`, `demoRunsDir?: string` for the transcripts SR-033 reads, with the fallback `office/.staffroom/demo-runs/` when omitted; this ticket writes the field into `server-cli-runtime.md` §1), `StaffroomServer`, `createServer` (Node `http` plus `ws`), `auth.ts` (Origin check on every upgrade and non-GET, per-boot 32-byte token embedded as `<meta name="staffroom-token">` in served `index.html`, required in `hello` and as `X-Staffroom-Token` on POST, `Host` allow-list), `http/health.ts` (`{ ok, version, mode, office, uptimeSec }`), `http/static.ts` serving `dist/public` with no CORS headers, pino logging with the scope list and the never-logged list, rolling file at `.staffroom/logs/staffroom.log`. Bind `127.0.0.1` by default; `--host` prints the no-user-accounts warning every start.

Acceptance:

- [ ] `createServer({ officeDir, port: 0 })` returns a `url` ending in `/?t=<token>`.
- [ ] `GET /api/health` returns `mode: "live"` when a provider is configured.
- [ ] Logs never contain the token, a prompt or a key.

Tests: `http/health.test.ts`, `http/static.test.ts`, `auth.test.ts` (evil Origin 403, `Host: evil` 403, missing token on POST 403).

#### SR-025 WebSocket protocol and socket

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-025 | WebSocket protocol and socket | server | SR-024 | 1 |

`ws/protocol.ts` with the full `ClientMessage` and `ServerMessage` unions from `server-cli-runtime.md` §6 (types only; handlers for MCP (`mcp.*`), routines (`routine.*`, `task.create.schedule`), the brain graph (`brain.graph.get`) and `doctor.run` arrive in M2, and `office.reload` and `note.reveal` in SR-043; until their ticket lands each returns `error` with code `INTERNAL` and hint `Not available in this version.`). `approval.decide` and `tools.assign` are M1 (SR-027, SR-058) and are not placeholders. `ws/socket.ts`: one connection per tab, `hello` validation (close 4401 on a bad token), `welcome` with `state` and `mode`, `ack` and `error` echoing `reqId`, monotonic `seq`, `event` forwarding from `RunStore.subscribe` unchanged, `ping`/`pong`, 60 s silent-socket close, an in-memory ring of the last 5,000 pushes for `resumeFrom`, `resumed: false` on a larger gap. `ws/replay.ts` serves `runs.replay` from `RunStore.events`.

Acceptance:

- [ ] `hello` without a token closes with 4401; a WS upgrade from `Origin: https://evil.example` gets 403.
- [ ] A client reconnecting with `resumeFrom` receives every push it missed, in order, with no duplicates.
- [ ] `runs.replay` for a 3,000-event run streams in pages with `done: true` on the last.

Tests: `ws/socket.test.ts` with a real `ws` client against `port: 0`; `ws/replay.test.ts`.

#### SR-026 OfficeState builder

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-026 | OfficeState builder | server | SR-025 | 1 |

`ws/state.ts` builds `OfficeState` from `Office`: departments with pods by first appearance, agents with seats, resolved `model`, `modelSource`, `modelStatus`, `local`, `tools` (brain tools omitted), `status` and `currentRunId` from active runs, connectors (built-ins including the grey `web_search` from SR-017b, and custom tools now; MCP in SR-055), `runs` (running or waiting), `approvals` from `RunStore.pendingApprovals` with `agentName` and the `tool` triple, `routines` (empty until SR-063), `latestDeliverables` (last five `done` events with `noteId`), `clock` every 30 s. Department ids come from the agents, so a template with agents in three departments yields three entries and the scene renders the other three pods unused. Snapshots are coalesced at 250 ms and pushed as `state`.

Acceptance:

- [ ] The studio template (agents in marketing, finance and sales) produces three departments, pods 0 to 2 in `agents.yaml` order, four agents with correct seats, and `web_search` in `connectors` with `health: "grey"`.
- [ ] A `started` event on a worker run flips that agent to `working` in the next snapshot; `done` flips it back to `idle`.
- [ ] Two changes 10 ms apart produce one `state` push.

Tests: `ws/state.test.ts` including the snapshot size under 20 KB for a 35-agent roster built from the test's own fixture `fixtures/roster-35.yaml` (six departments, six agents each, not the studio template).

#### SR-027 Task, chat, cancel and replay handlers

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-027 | Task, chat, cancel and replay handlers | server | SR-026 | 1 |

Handlers for `task.create` (calls `runner.submitTask`, `ack` with `{ runId, routeRunId }`, `modelOverride` refusal for local agents returned as `error` with `MODEL_OVERRIDE_LEAVES_MACHINE`; `schedule` returns the M2 placeholder error), `task.cancel`, `chat.send` (strips a leading `revise:` case-insensitively with optional space and calls `runner.revise`, else `runner.chat`), `runs.replay`, and `approval.decide { reqId, approvalId, decision: "approve" | "deny", note? }` calling `registry.resolve(approvalId, decision, "owner", note)` and replying `ack`; an unknown or already-resolved `approvalId` replies `error { code: "APPROVAL_NOT_PENDING" }` with the hint `This approval was already answered or has expired.`, and `decision: "approve_always"` returns the M2 placeholder error until SR-055 adds it. Every `RunError` becomes `error { code, message, hint }` verbatim from `toJSON()`.

Acceptance:

- [ ] The worked exchange in `server-cli-runtime.md` §6 reproduces on the studio office with `FixtureAdapter` end to end through the owner's `approval.decide { decision: "approve" }`: the blocked `send_sms` call runs, `approval_resolved { decision: "approve", by: "owner" }` is appended, and the run reaches `done`.
- [ ] `approval.decide { decision: "deny", note: "wrong number" }` appends `approval_resolved { decision: "deny", by: "owner", note: "wrong number" }` and the tool result carries `The owner declined this action.`
- [ ] `chat.send { text: "Revise: shorter" }` reaches `runner.revise` with `instructions: "shorter"`.

Tests: `ws/handlers.test.ts` for the four run messages plus the override refusal; `ws/approvals-basic.test.ts` for approve, deny with note, and the not-pending error. SR-055 extends the latter with `approve_always`.

#### SR-028 Boot sequence, resume and shutdown

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-028 | Boot sequence, resume and shutdown | server | SR-027 | 1 |

The 13 boot steps with their `boot.*` log prefixes: Node check with the exact message, office resolution and `Office folder:` print, migrate (no-op until SR-068), config validation printing every `ConfigError` and exiting 1, `runs.sqlite` open and pending-approval expiry with `note: "server_restart"`, brain open, providers and `modelStatus` (demo mode when zero resolve, SR-033), tools, `runner.resume` for `running` and `waiting_approval`, watchers (SR-029), scheduler (SR-063), listen with the 4242 to 4252 fallback and the exact failure text, banner. Shutdown on SIGINT/SIGTERM as specified; second SIGINT exits at once.

Acceptance:

- [ ] Starting with a `waiting_approval` run in `runs.sqlite` appends `approval_resolved { decision: "expired", by: "system", note: "server_restart" }` and the resumed loop receives the `approval_lost` tool error text.
- [ ] Starting with a `running` run resumes it and it ends in `done` or `failed`, never stuck.
- [ ] Two servers on 4242 make the second bind 4243 and print it.

Tests: `boot.test.ts` (expiry, resume, port fallback, Node-version message), `shutdown.test.ts`.

#### SR-029 File watchers

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-029 | File watchers | server | SR-028, SR-023 | 1 |

`packages/server/src/watch/{agents,config,env,tools,brain,approvals}.ts` on chokidar (`usePolling` on `win32`), each calling core's imperative method and pushing the matching message: `agents.ts` -> `Roster.reload` then `config.reloaded` or `config.error` with the previous roster kept live; `config.ts` -> re-validate, re-instantiate providers, `McpManager.applyConfig` (no-op until SR-052); `env.ts` -> re-run providers and `modelStatus`, flip demo to live; `tools.ts` -> `CustomToolLoader.load/unload` and `tools.reloaded`; `brain.ts` -> `reindexFile`/`removeFile` with 300 ms debounce per path and the ignore list; `approvals.ts` -> `Whitelist.reload`. `--no-watch` skips all.

Acceptance:

- [ ] Editing an agent's `name` in `agents.yaml` produces `config.reloaded { file: "agents.yaml" }` and a new `state` within 1 s.
- [ ] A broken edit produces `config.error` and the old roster still answers `task.create`.
- [ ] Writing a `.ts` file into `office/tools/` produces `tools.reloaded { ok: true }` within 2 s.

Tests: `watch/*.test.ts`, one per watcher, touching real files in a temp office; the Windows polling case from seeded issue 12 is added here as a skipped-unless-win32 test.

#### SR-030 Studio template content

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-030 | Studio template content | templates | SR-011, SR-013 | 1 |

`packages/templates/studio/`: the `agents.yaml` and `config.yaml` from `server-cli-runtime.md` §3 (no `model:` lines, `mcp.servers: {}`, Notion and Gmail in comments), `.npmrc` with `ignore-scripts=true`, `.gitignore`, `approvals.yaml` with an empty `allow: []`, an empty `data/.gitkeep` so `sheet_append` has a folder to write into, and the 17 Northlight Studio notes listed in `brain.md` with `sample: true`, four pinned `00-about/` notes fitting 4,000 tokens, the approved autumn-offer email with its rejected v1 beside it, the draft prospect shortlist, and `_private/logins.md`. The shipped roster names only tools that exist without `--tools`: Lee the researcher has `tools: [web]` and the line above it reads `# tools: [web, lookup_order]   # after: npx staffroom tools add lookup-order`, because `lookup_order` lives in `packages/templates/tools/` and is only copied by `init --tools`; `validateAgents` would otherwise fail boot with `AGENT_TOOL_UNKNOWN`. This ticket changes the §3 example in `server-cli-runtime.md` to match. The roster stays at four agents in three departments (marketing, finance, sales); pods 3 to 5 render unused. A `runs.sqlite` with one `sample: true` run whose `done` deliverable points at the autumn-offer note, generated by `packages/templates/scripts/build-sample-runs.ts` through `SqliteRunStore` (SR-013) so it is reproducible.

Acceptance:

- [ ] Every `[[wiki-link]]` in the sample brain resolves.
- [ ] `loadRoster` and `loadConfig` on the template produce zero `ConfigError`s, and `validateAgents` against a registry holding only the built-ins produces zero errors.
- [ ] Starting the server on a fresh copy shows one item in "Latest results".
- [ ] `data/` exists in the copied office.

Tests: covered by SR-032's `templates.test.ts`.

#### SR-031 Demo transcripts and the five example tools

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-031 | Demo transcripts and the five example tools | templates | SR-007, SR-030 | 1 |

`packages/templates/studio/demo-runs/*.jsonl` with `matches` headers: `bakery-tagline` (the smoke test and GIF task, calls `brain_search` then writes a deliverable containing "bakery"), `landing-page`, `prospect-shortlist` (calls `web_search`, which returns the not-configured error in demo, then finishes from the brain), `monthly-summary` (bookkeeper), `route-marketing` and `route-sales` (lead transcripts calling `assign_task`), a `revise` transcript, and `generic`. Tool calls reference only tools that exist in the template without `--tools`. `packages/templates/tools/` with `lookup-order.ts`, `sheet-append.ts` (`local: true`, `preview()`, writes under `office/data/`), `sqlite-query.ts` (`stmt.readonly` check, imports `better-sqlite3` through SR-023's host allow-list), `send-sms.ts` (`egress: true`, env credentials, preview with recipient and body), `http-get.ts` (hostname allow-list), each under 60 lines with the header paragraph and a `// TRY IT:` line.

Five more transcripts, one per example tool, so that every `// TRY IT:` line does something in demo mode and so the M1 exit criterion's blocked `send_sms` run exists: `try-lookup-order.jsonl`, `try-sheet-append.jsonl`, `try-sqlite-query.jsonl`, `try-send-sms.jsonl` (calls `send_sms` with a recipient and body, then finishes with a one-line deliverable once the result comes back, so the approval card and the deny path both have something to show) and `try-http-get.jsonl`. Each transcript's `matches` header is the words of that tool's `// TRY IT:` line. They only select when the tool is registered, so they need `init --tools` or `tools add <name>`; SR-045 and the README say so.

Acceptance:

- [ ] `FixtureAdapter` picks `bakery-tagline.jsonl` for "Write a two-line tagline for a bakery".
- [ ] All five tools load through SR-023 from a temp office with no `node_modules`, including `sqlite_query`, and `instanceof ZodObject` holds on each `input`.
- [ ] `sqlite_query` with `DELETE FROM x` returns `This tool only runs read queries`.
- [ ] Typing each tool's `// TRY IT:` line selects its `try-*.jsonl` transcript; in an office copied with `--tools`, the `send_sms` one blocks at `waiting_approval`.

Tests: `templates/tools.test.ts` (load all five, the sqlite readonly case, the `send_sms` preview shape) and `demo-runs.test.ts`, which parses every transcript, checks tool names against a registry holding the built-ins plus the five example tools, and asserts each `TRY IT` line selects its transcript.

#### SR-032 Templates package and rules test

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-032 | Templates package and rules test | templates | SR-030, SR-031 | 1 |

`packages/templates/src/index.ts` with `listTemplates()` (id, label, one-line description; `studio` first), `templateDir(id)` (the absolute path of the template folder, used by the CLI to pass `demoRunsDir`), `exampleToolsDir()` (the absolute path of `packages/templates/tools/`), and `copyTemplate(id, dest, { includeTools })`, which copies the template's `demo-runs/` into `<dest>/.staffroom/demo-runs/` (the server's fallback location, added to the `office/` layout in `server-cli-runtime.md` §3 by this ticket), refuses `package.json`, `node_modules/`, `tools/` and `.staffroom/` from the template root unless asked, copies `packages/templates/tools/*.ts` into `<dest>/tools/` when `includeTools` is true, and returns what it skipped. `templates.test.ts` enforces every rule in `repo-quality-launch.md` §11 for every template folder present, plus one rule added by this ticket to §11: every `tools:` entry in a template's `agents.yaml` resolves to a built-in, the alias `web`, or a file inside the template's own `tools/` folder, without `--tools`.

Acceptance:

- [ ] `copyTemplate("studio", tmp)` produces a folder the server boots from with no `ConfigError`, and `tmp/.staffroom/demo-runs/bakery-tagline.jsonl` exists.
- [ ] `copyTemplate("studio", tmp, { includeTools: true })` adds the five example tools under `tmp/tools/`.
- [ ] A template with a `model:` line, a literal secret, an unresolved link, no `_private/` note, or a `tools:` entry that needs `--tools` fails the test with the rule named.

Tests: `templates.test.ts`, `index.test.ts`.

#### SR-033 Demo mode wiring

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-033 | Demo mode wiring | server | SR-028, SR-031 | 1 |

`demo/demo.ts`: when zero providers resolve, `--demo` or `STAFFROOM_DEMO=1`, register `FixtureAdapter` from `@staffroom/core/testing` as the only provider, reading transcripts from `opts.demoRunsDir` when set, else `office/.staffroom/demo-runs/` (which `copyTemplate` fills, SR-032). The server never imports `@staffroom/templates`; the CLI passes `demoRunsDir: join(templateDir("studio"), "demo-runs")` (SR-045) and server tests pass a temp folder. If neither location has a `generic.jsonl`, boot fails with `Demo mode needs transcripts. Run npx staffroom init again, or pass --office to a folder created by it.` Set `mode: "demo"` in `health` and `welcome`, print the demo line from `server-cli-runtime.md` §8, handle `demo.speed { factor }` by calling `setSpeed`. Demo never sends telemetry. A configured-but-broken provider never falls into demo mode. This ticket writes the two locations and the failure text into `server-cli-runtime.md` §1 and §9.

Acceptance:

- [ ] `createServer({ officeDir, port: 0, demoRunsDir })` in a server test enters demo mode with no template package on the import path; the same call without `demoRunsDir` reads `officeDir/.staffroom/demo-runs/`.
- [ ] `STAFFROOM_DEMO=1` with a valid key present still reports `mode: "demo"`; a bad key with no flag reports `mode: "live"` and `modelStatus: no_key`.
- [ ] `demo.speed { factor: 4 }` makes the bakery transcript finish about four times faster.
- [ ] `brain_search` in a demo run really hits the sample index and `brain_write` really creates the file.

Tests: `demo/demo.test.ts` running the bakery task end to end and asserting the note exists on disk.

#### SR-034 Web scaffold, socket client and store

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-034 | Web scaffold, socket client and store | web | SR-025 | 1 |

Vite + React 19 + R3F + drei + Zustand. `ws.ts` (token from the meta tag or `?t=`, `sessionStorage`, `hello`, reconnect with 500 ms to 8 s backoff, `resumeFrom`, `connection` states including `stopped` after 10 s), `store.ts` with the `OfficeStore` shape from `office-ui.md` §7, `selectors.ts`, `ingestEvent` producing Activity lines and `AnimationCue`s per the section 1 table with `id` equal to the envelope `seq`, `chats` rebuilt from `runs.replay`, `pendingTaskReqIds`. Types imported from `@staffroom/core` as types only.

Acceptance:

- [ ] `ingestEvent` of a `routed` event whose parent `reqId` is in `pendingTaskReqIds` sets `selectedAgentId` and opens the Chat tab.
- [ ] Replaying the same envelope twice produces one cue.
- [ ] Dropping the socket freezes `state` and sets `connection: "reconnecting"`; `welcome` replaces the store wholesale.

Tests: `tests/store.test.ts`, `tests/selectors.test.ts`, `tests/ws.test.ts` with a mock socket (jsdom).

#### SR-035 Scene: floor, Brain, pods, desks, camera

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-035 | Scene: floor, Brain, pods, desks, camera | web | SR-034 | 2 |

`scene/Scene.tsx`, `Office.tsx`, `Desks.tsx`: 24 by 24 floor, Brain cylinder at the origin with 24 instanced cards, six pod platforms on the radius-8 ring at 0 to 300 degrees with floor labels (`<Html>`, system font) and colour stripes by pod index, 36 desks, chairs and monitors through drei `<Instances>` with per-instance emissive, one `MeshToonMaterial` with vertex colours, unused pods at 40 percent opacity. `OrthographicCamera` at 35.264 degrees, overview azimuth 45, `Q`/`E` orbit over 400 ms, scroll zoom, drag pan clamped to the floor. `window.__staffroom` with `renderInfo` and `frameTimes` outside production or with `?perf=1`.

Acceptance:

- [ ] Draw calls under 60 and triangles under 30,000 with the full 35-agent roster (read from `renderInfo`).
- [ ] Three materials total.
- [ ] `three` and drei are imported per path, not from barrels; no GLTF loader in the bundle.

Tests: `tests/layout.test.ts` for the pod and seat position tables (pure functions); visual checks are manual until SR-072.

#### SR-036 Scene: agents and animation cues

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-036 | Scene: agents and animation cues | web | SR-035 | 2 |

`scene/Agents.tsx`, `Papers.tsx`, `paths.ts`: instanced bodies (4-bone skinned, 320 tris), heads coloured by department, status badge billboards with glyphs, the "local" pill, the reception in-tray, a pool of 8 paper sprites. `useFrame` drains `animations` from `getState()` into per-agent timelines in a `useRef` array and writes instance matrices: `walk_to_lead` and `walk_back` (1.2 s along the precomputed path table with 0.3 unit corners), `type_start`/`type_stop`, `raise_hand`/`lower_hand`, `shrug`, `slump`, `paper_to_brain` (900 ms), `monitor_flash`, `connector_pulse` (forwarded to the HUD). Status colours read from `state.agents[i].status`, never from cues. `prefers-reduced-motion` turns every cue into an instant badge change. Time box: 4 half-days total for SR-035 and SR-036. Fallback if the box is blown: agents are flat-shaded capsules with badges and no walk; cues still update badges and monitors. The fallback is acceptable for v0.1.

Acceptance:

- [ ] The bakery demo task shows Priya walk to Dana's desk and back, type, then a paper fly to the Brain.
- [ ] A missed cue never leaves an agent in the wrong colour.
- [ ] p95 frame time under 8 ms on the maintainer's Apple Silicon machine with 35 agents cycling demo runs (measured by hand; CI in SR-072).

Tests: `tests/cues.test.ts` (cue to timeline mapping, reduced-motion collapse) and `tests/paths.test.ts`.

#### SR-037 Picking, camera focus and keymap

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-037 | Picking, camera focus and keymap | web | SR-036 | 1 |

`scene/picking.ts` registering per-frame screen-space rectangles for agents and pod labels, hover and click resolved against that array. Camera focus on agent (9-unit frustum, 500 ms, rail opens on chat), focus on pod (12 units), `Esc` order (overlay, then focus, then overview), `0`/`Home`. `keymap.ts` as one table read by both the handler and the `?` dialog, with every binding from the table in `office-ui.md` §4, including the two-key approval chords and `D` in demo mode. `[`/`]` cycle agents in pod then seat order.

Acceptance:

- [ ] Clicking Priya's desk focuses the camera and opens her chat; `Esc` returns to overview.
- [ ] Every keymap row appears in the help dialog with the same label.
- [ ] `A` alone never approves; `A` then `Enter` does (wired fully in SR-041).

Tests: `tests/picking.test.ts` (no WebGL needed), `tests/keymap.test.ts`.

#### SR-038 Top bar and theming

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-038 | Top bar and theming | web | SR-034 | 1 |

`hud/TopBar.tsx`: office name, mode chip with the two tooltip texts, connector strip (24 px logos, health dot colours, `pulse` ring, hover card; MCP-specific states are completed in SR-057), models-in-use chips with the popover explaining `modelSource` in the three phrases, grey `modelStatus` badge with the `Sam needs an OpenAI key. Open Settings > Models.` tooltip, clock, theme toggle, `?`, Settings gear. `theme.ts` with the CSS tokens, light on `:root`, dark under the media query guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`, remembered in `localStorage` under `staffroom.theme`, and the six department colour pairs and four status colours. The scene reads tokens once per theme change.

Acceptance:

- [ ] Demo chip tooltip reads `Sample office, no keys needed. Click Settings > Models to add a key and go live.`
- [ ] Toggling the theme recolours the scene without a reload.

Tests: `tests/topbar.test.tsx` (jsdom) for chip text, popover phrases and the badge tooltip.

#### SR-039 Task bar

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-039 | Task bar | web | SR-034 | 1 |

`hud/TaskBar.tsx`: department segmented control (`combobox` named "Department", `Alt+1` to `Alt+6`), task field (`textbox` named "Task", one to three lines, rotating placeholders from the template, `Enter` submits, `Shift+Enter` newline, no prefixes), model override select ("Default (per agent)" plus configured models, amber chip when set), schedule control showing only "Now" until SR-064, "Give task" button. Sends `task.create` with a `reqId` added to `pendingTaskReqIds`; clears on `ack`; shows `error.hint` inline. In demo mode the caption "Demo runs are pre-recorded." appears under the field.

Acceptance:

- [ ] Submitting with Marketing selected sends `task.create { department: "marketing", text }`.
- [ ] `MODEL_OVERRIDE_LEAVES_MACHINE` from the server renders its hint under the override control.

Tests: `tests/taskbar.test.tsx`.

#### SR-040 Chat tab, deliverable card, inline rename

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-040 | Chat tab, deliverable card, inline rename | web | SR-034, SR-039, SR-043 | 1 |

`hud/Rail.tsx` and `hud/Chat.tsx`: three tabs with `Alt+C/A/P`; per-agent chat header with name (editable, 1 to 40 chars, sends `agent.rename`), role, model chip, local pill, status, the "To change role or model, edit office/agents.yaml." popover, and "Revise last result" when a deliverable exists. History from `runs.replay` of `chat` and `revise` runs; live streaming from `chunk`s. Deliverable card on `done` for task, routine and revise runs: title, body, `Open in brain`, `Approve` (sends `deliverable.approve` from SR-043), `Show in Finder` (sends `note.reveal { noteId, app: "finder" }` from SR-043; labelled "Show in Explorer" on Windows and "Show in file manager" on Linux from `welcome.platform`), `Revise` (prefills `revise: `). `Open in brain` opens `hud/NoteSheet.tsx`, a minimal side sheet added here: fetches `GET /api/brain/file?path=<noteId>.md` with the `X-Staffroom-Token` header, renders the markdown with the front-matter as a small table, and carries the same `Show in Finder` button; SR-062 extends it with revisions, diff and `Open in editor`. `NOTHING_TO_REVISE` shows "Give them a task first." `failed` shows `error.message` in the bubble and `error.hint` under it with a Dismiss.

Acceptance:

- [ ] After the bakery demo task the card shows the title from the first `# ` line and an Approve button.
- [ ] `Open in brain` renders the note body in the sheet and `Esc` closes it; `Show in Finder` sends `note.reveal` with the card's `noteId`.
- [ ] Renaming Priya to "Anna" updates the list view row and the scene label on `config.reloaded`.

Tests: `tests/chat.test.tsx` (history rebuild from replay events, card rendering, rename message, the two messages the card sends), `tests/note-sheet.test.tsx` (fetch with token header, markdown render, 404 shows "This note is no longer in the brain.").

#### SR-041 Activity feed, tool cards, stopped banner, minimal approval card

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-041 | Activity feed, tool cards, stopped banner, minimal approval card | web | SR-040, SR-027, SR-058 | 2 |

`hud/Activity.tsx`: reverse-chronological lines for every event in the section 1 table in words (`Dana handed this to Priya: ...`, `Priya sent 840 characters to notion`, `contains 1 redacted value`), filter by agent, department, connector; `/` focuses its search. Three Activity cards driven by the `tools.reloaded` payloads from SR-058, rendered inline in the feed and never as toasts: the load-failure card with the exact text `Your tool file x.ts could not be loaded. Line 12: ...` and a Copy button that copies file, line and message; the no-scope warning with the exact sentence from `tools-mcp-approvals.md` §2; and `New tool <name> is ready. Who may use it?` with one checkbox per agent and a Save button sending `tools.assign { name, agentIds }`. `hud/StoppedBanner.tsx` with the exact text `Staffroom has stopped on this Mac. Open Terminal and run: npx staffroom` and a Copy button after 10 s of failed reconnects. `hud/Approvals.tsx` in its v0.1 form: one card per `PendingApproval` with agent, action, destination, summary, body, fields with `sensitive` masked, the irreversible banner, and two buttons (`Approve once`, `Deny` with note) sending `approval.decide { decision: "approve" | "deny", note }` to SR-027's handler; the chords `A`/`R` then `Enter`. Tab label carries the count. `Approve and always allow` is added by SR-056. The `send_sms` acceptance below runs in an office copied with `--tools`, using SR-031's `try-send-sms.jsonl`.

Acceptance:

- [ ] Typing `send_sms`'s TRY IT line in a `--tools` office makes the agent raise a hand, the tab count go to 1, and the card show the recipient and body.
- [ ] Approve once produces `approval_resolved { decision: "approve", by: "owner" }` and the run finishes; Deny with a note produces `approval_resolved { decision: "deny", by: "owner", note }` and the agent shrugs.
- [ ] A syntax error in `office/tools/x.ts` shows the load-failure card with Copy; ticking Priya on the "who may use it" card sends `tools.assign` and the next `config.reloaded` shows `lookup_order` on her row.

Tests: `tests/activity.test.tsx`, `tests/activity-cards.test.tsx` (three cards, Copy payload, checkbox message), `tests/approvals.test.tsx`, `tests/banner.test.tsx`.

#### SR-042 List view and accessibility

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-042 | List view and accessibility | web | SR-040 | 1 |

`list/ListView.tsx`: "Latest results" first (five items, `listitem` with accessible name starting `Written by <agent name>`, `data-testid="deliverable-latest"` on the first), one `<section>` per department with the table columns from `office-ui.md` §5, rows `data-testid="agent-<id>"` with `data-state`, editable name, `Enter` opens chat, "Reception" section for queued runs. Forced under 768 px, remembered between 768 and 1024 px under `staffroom.view`, `L` toggles. Canvas `aria-hidden`, `aria-live="polite"` region throttled to one announcement per agent per 5 s, "Skip to list view" first in tab order.

Acceptance:

- [ ] Every control is reachable by keyboard with a visible focus ring.
- [ ] The smoke test selectors from `repo-quality-launch.md` §4 all resolve on the studio office.

Tests: `tests/listview.test.tsx` including the `data-testid` and role contract as a snapshot so a rename fails loudly.

#### SR-043 Rename, set_key, deliverable approve, note reveal, reload, brain routes

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-043 | Rename, set_key, deliverable approve, note reveal, reload, brain routes | server | SR-029 | 1 |

Handlers: `agent.rename` (`Roster.setName`, reply `config.reloaded`), `provider.set_key` (one-token completion test, write `office/.env`, re-run `boot.providers`, `boot.config` and `modelStatus` in place, flip `mode` to `live`, reply `config.reloaded { file: ".env" }` then `state`; never echoed or logged; `provider: "ollama"` accepts a base URL written to `config.yaml`, per server open question 3), `deliverable.approve { reqId, noteId }` (flips the note's `status` from `draft` to `approved` through gray-matter, reindexes; this message is missing from `server-cli-runtime.md` §6 and is added there by this ticket, see open question 1), `note.reveal { reqId, noteId, app?: "finder" | "editor" }` (canonicalises `noteId` with the same rule as `/api/brain/file`, 404-style `error { code: "NOTE_NOT_FOUND" }` on failure, then `open -R <path>` on darwin, `explorer /select,<path>` on win32, `xdg-open <dir>` on linux; `app: "editor"` runs `open -a Obsidian|"Visual Studio Code"|Typora <path>` or the platform equivalent for the first detected editor and returns `error { code: "NO_EDITOR" }` when none is detected; replies `ack`), `office.reload { reqId }` (re-runs boot steps 4 to 8 in place through the same function the `.env` watcher calls, replies `ack` then pushes `config.reloaded { file: "office" }` and `state`; a `ConfigError` during the reload replies `config.error` and keeps the old office live), `brain.search`. `welcome` gains `platform: "darwin" | "win32" | "linux"` and `editors: Array<"obsidian" | "vscode" | "typora">`, detected once at boot by checking the application folders on darwin and win32 and `which obsidian code typora` on linux. Both new messages and the two `welcome` fields are written into `server-cli-runtime.md` §6 and the specs README vocabulary table in the same PR, the same way as `deliverable.approve`. HTTP routes `GET /api/brain/file`, `GET /api/deliverables/:noteId/download`, `GET /api/runs/:id/export` (`?format=md`), all with the path canonicalisation rule (must start with `brainDir + sep`, no `..`, no leading slash, no null byte, allowed extensions only, else 404).

Acceptance:

- [ ] `GET /api/brain/file?path=..%2F.env` is 404; `?path=10-customers/acme-pty-ltd.md` returns the markdown.
- [ ] `provider.set_key` with a bad key returns `error` with the `AUTH_FAILED` hint and leaves `.env` unchanged.
- [ ] After `deliverable.approve`, the file on disk has `status: approved` and `latestDeliverables[0].status` is `approved`.
- [ ] `note.reveal { noteId: "../.env" }` replies `NOTE_NOT_FOUND` and spawns nothing; a valid id spawns the platform command with the canonical path (spawn is mocked).
- [ ] `office.reload` after editing `config.yaml` by hand produces a new `state` with the changed provider list; with a broken file it produces `config.error` and `task.create` still works.

Tests: `http/brain-file.test.ts`, `http/export.test.ts`, `ws/handlers-rename-setkey.test.ts`, `ws/deliverable-approve.test.ts`, `ws/note-reveal.test.ts`, `ws/office-reload.test.ts`.

#### SR-058 tools.reloaded card payloads, tools.assign and Roster.addTool

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-058 | tools.reloaded card payloads, tools.assign and Roster.addTool | server, core | SR-029 | 1 |

Moved into M1 because the M1 exit criteria and the definition of done need the tool cards in v0.1 (the "custom tools become a foot-gun" mitigation). Server pushes the three card payloads on `tools.reloaded` (`{ ok: false, file, line, message }` for a load failure; `{ ok: true, warning: "no_scope", file, name }` with the exact sentence from `tools-mcp-approvals.md` §2; `{ ok: true, name, unassigned: true, agents: [{ id, name }] }` when the name is in no agent's `tools`) and handles a `tools.assign { reqId, name, agentIds }` client message (added to `server-cli-runtime.md` §6 and the specs README vocabulary table by this ticket) calling `Roster.addTool(agentId, name)` for each id and replying `ack` then `config.reloaded { file: "agents.yaml" }`. Closes seeded issue 8's behaviour before launch, so SR-079 replaces that issue.

Acceptance:

- [ ] `tools.assign { name: "lookup_order", agentIds: ["researcher"] }` writes `tools: [web, lookup_order]` on Lee's row keeping the existing comment on that line, and the next `state` shows it on `agents[].tools`.
- [ ] Dropping a file with a syntax error into `office/tools/` pushes `tools.reloaded { ok: false, line }` within 2 s and the server keeps answering `task.create`.

Tests: `watch/tools-cards.test.ts`, `ws/tools-assign.test.ts`.

#### SR-044 Settings > Models

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-044 | Settings > Models | web | SR-043, SR-038 | 1 |

`hud/Settings.tsx` opened from the gear or the grey model badge: one row per provider in `config.yaml` (Anthropic, OpenAI, OpenAI-compatible, Ollama) with a masked "Paste an API key" field (base URL for Ollama), a Test button sending `provider.set_key`, inline result, and the line "Keys are saved to office/.env, a hidden file in your office folder." Whitelist rows, doctor output and the leaving-demo question arrive in SR-066 and SR-067.

Acceptance:

- [ ] Pasting a valid Anthropic key in demo mode flips the chip to Live without a reload and the bakery task now runs on the real model.
- [ ] A failed test shows the server's hint verbatim under the row.

Tests: `tests/settings.test.tsx`.

#### SR-045 CLI: bin, office folder, start, first run

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-045 | CLI: bin, office folder, start, first run | cli | SR-033, SR-032 | 1 |

`packages/cli/src/index.ts` (commander router; `#!/usr/bin/env node` is line 1 of the source file, which tsup preserves and chmods, so no banner flag is needed; tsup single file), `office-dir.ts` (resolution order `--office`, `STAFFROOM_OFFICE`, `./office` with `agents.yaml`, `~/.staffroom/current-office`, then ask; first run creates `~/Staffroom/office` and writes the pointer), `node-check.ts`, `open-browser.ts` (never in Docker or over SSH), `commands/start.ts` with every flag including `--exit-when-ready` (print the banner, then exit 0 without serving; used by the install-timing job and the Playwright setup) and the four-line banner including `Keep this window open. Closing it stops the office. Press Ctrl+C to stop.`, passing `demoRunsDir: join(templateDir("studio"), "demo-runs")` from `@staffroom/templates` to `createServer` so demo mode works even when `.staffroom/demo-runs/` was deleted, `commands/init.ts` (`--template`, `--dir`, `--tools`; the label list, not ids; prints the tree and `You can change everything later in the office folder.`; `--tools` copies the five example tools from `packages/templates/tools/` through `copyTemplate(..., { includeTools: true })`, and the printed tree ends with `Tip: the example tools each have a TRY IT line you can type in demo mode.` when they were copied; `copyTemplate`'s refusal of a template's own `tools/` and `.staffroom/` applies to `template apply` and `brain import` from user folders in SR-076 and SR-065, not to `init`), the no-subcommand first-run flow with the demo line, `commands/demo.ts` as `start --demo`, `commands/version.ts`. Every string says `npx staffroom <sub>`.

Acceptance:

- [ ] `node dist/index.js init --template studio --dir /tmp/o` creates the office and exits 0; with `--tools` it also creates `/tmp/o/tools/` with five files.
- [ ] `node dist/index.js` with no office and no TTY picks `studio` and starts in demo mode without prompting.
- [ ] The banner prints `Office folder: <path>` and a token-bearing URL.
- [ ] `node dist/index.js demo --no-open --exit-when-ready` prints the banner and exits 0 within 10 s without leaving a listener.
- [ ] `ls -l dist/index.js` shows the executable bit and `head -1` shows the shebang.

Tests: added in SR-047.

#### SR-046 Doctor engine in server, CLI setup and doctor printer

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-046 | Doctor engine in server, CLI setup and doctor printer | server, cli | SR-045 | 1 |

The check engine lives in the server so that SR-067's `doctor.run` WebSocket message can call it (the CLI depends on the server, never the reverse): `packages/server/src/doctor/index.ts` exports `runDoctor(opts: { officeDir: string; fix?: boolean }): Promise<{ checks: DoctorCheck[]; ok: boolean }>` with `DoctorCheck = { id, status: "ok" | "warn" | "fail", message, hint?, fixed? }`, re-exported from `@staffroom/server`, with the v0.1 checks: `node.version`, `office.path`, `office.exists`, `office.gitignore`, `config.version`, `config.valid`, `agents.valid`, `config.secrets`, `providers.<name>`, `models.resolve`, `ollama.installed`, `ollama.reachable`, `tools.custom`, `tools.resolve`, `brain.index`, `runs.db`, `port`, `disk`; `fix: true` applies the gitignore lines, the index rebuild and the literal-key move. This moves the path named in `server-cli-runtime.md` §1 and in seeded issue 6 from `packages/cli/src/commands/doctor.ts` to `packages/server/src/doctor/`; both are updated by this ticket. `packages/cli/src/commands/doctor.ts` is the printer only: calls `runDoctor`, prints the table, `--json` prints the result verbatim, `--fix` passes `fix: true`, `--bundle` arrives in SR-075. `commands/setup.ts` with `@inquirer/prompts`: pick providers, paste keys masked, one-token test, `default_model` chosen from `adapter.listModels()` showing the six most recent ids with `(recommended)` on the shipped default and `Show all`, web search key or skip, telemetry default no, document-mode YAML writes, the closing line `Saved to office/.env (a hidden file). Run npx staffroom setup again to change it.`, `--non-interactive` flags. Remaining checks in SR-075.

Acceptance:

- [ ] `doctor` with no keys prints the `NO_MODEL_CONFIGURED` hint verbatim.
- [ ] `doctor --fix` on a config with a literal key moves it to `.env` and rewrites `$NAME`, keeping comments.
- [ ] `setup --non-interactive --anthropic-key $K --default-model anthropic/claude-sonnet-5` writes both files.
- [ ] `import { runDoctor } from "@staffroom/server"` typechecks and `runDoctor({ officeDir })` on the studio template returns `ok: true` except `models.resolve` when no key is set.

Tests: `packages/server/src/doctor/doctor.test.ts` per check with fixture offices; the CLI printer tests are added in SR-047.

#### SR-047 CLI tests, build job, install timing

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-047 | CLI tests, build job, install timing | cli, ci | SR-046 | 1 |

`packages/cli/test/*.test.ts` with `execa` (a devDependency of the CLI, nothing at runtime uses it) against the built binary in temp dirs: `init` writes an office, `doctor` prints the hint, `demo --no-open` starts with an empty environment and answers `/api/health` with `mode: "demo"`, `version` matches `package.json`, and the `Run staffroom ` grep across `packages/` finds nothing. Add the `build` job steps (`init --template studio --dir tmp-office`, `doctor --json`) on all three OSes and the `install-timing` job on macos-14: `pnpm pack` the CLI, then `time npx ./staffroom-*.tgz demo --no-open --exit-when-ready` in a fresh `HOME` with an empty npm cache, failing over 60 s. `--exit-when-ready` (SR-045) is what makes the command return; without it `demo` is a foreground server and `time` never completes.

Acceptance:

- [ ] All CLI tests pass on Windows (paths with spaces, `open` skipped).
- [ ] `install-timing` reports under 60 s on the runner.

Tests: the files above.

#### SR-048 Smoke test, size-limit, e2e job

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-048 | Smoke test, size-limit, e2e job | web, ci | SR-042, SR-045 | 1 |

`packages/web/e2e/smoke.spec.ts` exactly as in `repo-quality-launch.md` §4. Playwright's `webServer` option cannot parse a token-bearing URL and cannot learn a `--port 0` port, so `playwright.config.ts` uses `globalSetup: "./e2e/global-setup.ts"` and `globalTeardown` instead: setup makes a temp dir, runs `node packages/cli/dist/index.js init --template studio --dir <tmp>` to completion, spawns `node packages/cli/dist/index.js demo --no-open --port 0 --office <tmp>`, reads stdout until a line matching `/^\s*(http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]+)/` appears (30 s deadline), sets `process.env.STAFFROOM_URL` to that URL, and stores the child pid in a file; teardown kills the child (SIGTERM, then SIGKILL after 5 s) and removes the temp dir. Tests read `process.env.STAFFROOM_URL`. `.size-limit.json` with 1.5 MB total and 600 KB main chunk gzipped. The `e2e` job on ubuntu runs both.

Acceptance:

- [ ] The smoke test passes three times in a row on CI (no flake).
- [ ] `global-setup.ts` fails with the child's stderr when no URL line appears within 30 s, and teardown leaves no `node` process behind (asserted by `ps` in the job).
- [ ] `size-limit` reports the numbers in the job summary.

Tests: the smoke test itself.

#### SR-049 README and hero GIF

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-049 | README and hero GIF | docs | SR-048 | 1 |

README in the 13-part order from `repo-quality-launch.md` §7: title and tagline, GIF, the verbatim first sentence, two badges, step-0 install text with "Keep the Terminal window open", first five minutes (Settings > Models, rename in the chat header, give a task, approve the card, look in `~/Staffroom/office/brain/`, and one line: `npx staffroom tools add send-sms` then type its TRY IT line to see an approval card), how it works with one diagram, the `agents.yaml` snippet, one MCP and one custom tool example importing `@staffroom/core`, the safety rules with the link to `safety-rule.ts` and the MCP-changes sentence, the comparison table with a "last checked" date, links, licence and trademark note. Under 900 words before the table. `scripts/hero-gif.sh` records the studio demo at 2x in light theme with Playwright video, ffmpeg and gifski to `docs/hero.gif` (under 8 MB, 1200 by 675, 20 to 30 s) and `docs/hero.mp4`, following the beat list.

Acceptance:

- [ ] `wc -w` of the README up to the comparison heading is under 900.
- [ ] The GIF shows all seven beats and is under 8 MB.

Tests: none (docs ticket); the `npx-grep` lint covers the README too.

#### SR-050 Core coverage gate and full loop tests

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-050 | Core coverage gate and full loop tests | core | SR-028 | 1 |

Turn on the 80 percent thresholds in `packages/core/vitest.config.ts` (lines, branches, functions, statements over `src/**` excluding `src/testing/**`) and add the two remaining `loop.test.ts` cases: resume after restart from `waiting_approval` (pending approval expired by the boot step, `approval_lost` text reaches the model, the model re-issues the call and a fresh `approval_needed` appears) and the injected-instruction note (a pinned note telling the agent to email the customer list produces no write call, the note is wrapped `trust="owner"`, the tool result is wrapped `trust="untrusted"`, and the deliverable mentions the instruction). Fill any coverage holes the report shows.

Acceptance:

- [ ] `pnpm --filter @staffroom/core test` fails below 80 percent on any of the four measures.
- [ ] Both new cases pass with a scripted `FixtureAdapter`.

Tests: the two cases above plus whatever the gap report demands.

#### SR-051 v0.1 release and soft launch

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-051 | v0.1 release and soft launch | ci, docs | SR-047, SR-048, SR-049, SR-050 | 1 |

Merge the "Version Packages" PR for `0.1.0`, confirm provenance on npm for all five packages, write the GitHub release notes by hand, run the definition of done in section 6 on a fresh Mac and a fresh Windows VM, and send the link to ten people with a two-question form (what broke, what confused you). Open a `v0.1 feedback` Discussion.

Acceptance:

- [ ] `npx staffroom@0.1.0` on a fresh Mac opens the office in under 60 s.
- [ ] Every item in section 6 is ticked.

Tests: none (release ticket).

### M2 tickets

#### SR-052 McpManager

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-052 | McpManager | core | SR-022 | 3 |

`packages/core/src/mcp/manager.ts` with `McpStatus`, `McpConnection`, `McpManager` (`start`, `stop`, `applyConfig`, `reconnect`, `status`, `beginOAuth` stub until SR-053) per `tools-mcp-approvals.md` §3: `StdioClientTransport` with the expanded env over a minimal base (`PATH`, `HOME`, `TMPDIR`) and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk`, 15 s connect deadline, `listTools` registering `server.tool` with `egress: true`, `scope` from `readOnlyHint` unless `force_write`, description cap 1,000 and schema cap 16 KB, `z.custom()` with a JSON Schema validator, fingerprints, re-list every `discovery_ttl_s` and on `list_changed` with add/remove/changed diffs, backoff 2 s to 60 s forever on close, `denied` servers never spawned, unresolved `$NAME` parked at `unavailable` with the `NOTION_TOKEN is not set...` message. `applyConfig` diffs and reconnects only changed servers. Wire into `createOffice`. Extend `tools/preview.ts` (SR-014) with the MCP variant from `tools-mcp-approvals.md` §5 for tools whose `source.kind === "mcp"`: `action` is the MCP tool description (first sentence, capped at 120 characters), `destination` is `<server> (MCP server, npx)` with only the command basename for stdio servers or `<server> (MCP server at <origin>)` for HTTP servers with the URL reduced to scheme, host and port and no path or query, `irreversible: true` always, and `summary` carries the verbatim line `Staffroom cannot see what this server will do with these fields; approve only if you trust it.` which SR-056 renders.

Acceptance:

- [ ] A stdio server that never answers leaves the connection at `unavailable` after 15 s and boot has already finished.
- [ ] A changed remote description emits `tools_changed { changed: ["notion.search_pages"] }` and the registry's fingerprint updates.
- [ ] `mcp.deny: [stripe]` produces status `denied` and no child process.
- [ ] The preview for a tool on `https://mcp.example.com/gmail/v2?tenant=acme` has `destination: "gmail (MCP server at https://mcp.example.com)"`; for a stdio server with `command: /usr/local/bin/npx` it has `destination: "notion (MCP server, npx)"`; both have `irreversible: true`.

Tests: `mcp/manager.test.ts` against a tiny in-repo stdio MCP server (`src/testing/mcp-echo-server.ts`) covering connect, list, call, readOnlyHint, force_write, caps, re-list diff, close and backoff, deny; `tools/preview.test.ts` extended with the two MCP destination cases.

#### SR-053 MCP OAuth with PKCE

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-053 | MCP OAuth with PKCE | core, server | SR-052 | 2 |

`beginOAuth(name)` using the SDK's `OAuthClientProvider` with S256 PKCE and a random `state` bound to the pending call; tokens saved to `office/.staffroom/secrets/mcp-<name>.json` (mode 0600, dir 0700) and fed to `configureRedaction`. Server: `GET /api/mcp/oauth/callback` on the loopback origin only, unknown `state` rejected, then reconnect; `mcp.oauth.begin` handler replying `mcp.oauth.url`. A 401 with an OAuth challenge sets `auth_required` and stops retrying until the owner clicks Connect.

Acceptance:

- [ ] A fake OAuth server in tests completes the flow and the connection reaches `ready`.
- [ ] A callback with a wrong `state` returns 400 and stores nothing.
- [ ] The token never appears in logs, `runs.sqlite` or an export.

Tests: `mcp/oauth.test.ts`, `http/oauth-callback.test.ts`.

#### SR-054 Whitelist, match rules, fingerprints, expiry

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-054 | Whitelist, match rules, fingerprints, expiry | core | SR-014 | 2 |

`tools/whitelist.ts` replacing SR-014's no-op: reads `office/approvals.yaml` (`allow` rows keyed by `(agent, tool)` with `granted`, `expires`, `match`, `fingerprint`, `suspended`), `reload()`, `grant(agentId, tool, match, fingerprint)` writing a row with `whitelist_days` expiry, `revoke`, `suspendWhere(fingerprint changed)`. Match rules with picomatch `{ nobrace: true, noglobstar: true }` and the `*` that does not cross `,`, whitespace, `<`, `>` or `;`; arrays require every element to match; other types never match. `invoke` step 3 uses it and appends both events with `by: "whitelist"`. `approve_always` in `registry.resolve` grants and then runs; refused without a `match` unless `allowAnyRecipient` is passed. A 60 s sweeper expires pending approvals past `expiresAt` as `expired`, `by: "system"`; the tool result is `approval_expired` and the loop's `APPROVAL_REJECTED` reply text is used when the model cannot continue. `changedSinceAllowed` is set on the preview when a suspended row exists. `approval_before_send` on a routine run bypasses the whitelist for that run.

Acceptance:

- [ ] `evil@x.com,a@acme.com` does not match `*@acme.com`; `["a@acme.com","b@acme.com"]` does.
- [ ] Deleting a row from the file and calling `reload` makes the next call block for approval.
- [ ] A suspended row produces a card with `changedSinceAllowed: true`; `approve_always` refreshes the fingerprint and clears `suspended`.

Tests: `tools/whitelist.test.ts` and additions to `tools/registry.test.ts` for the array case, the comma case, the suspended case, expiry sweep, and the routine bypass.

#### SR-055 Server side of approvals and MCP

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-055 | Server side of approvals and MCP | server | SR-027, SR-052, SR-054 | 1 |

Extend SR-027's `approval.decide` handler with `decision: "approve_always"` and the `match` field (calling `registry.resolve(approvalId, "approve_always", "owner", note, { match })`, refused with `error { code: "MATCH_REQUIRED" }` when `match` is absent and `allowAnyRecipient` is not set), replacing the M2 placeholder error. Add `mcp.reconnect`, pushes `mcp.status` and `mcp.tools_changed` from manager events, the `McpStatus` to `Connector.health` mapping table in `ws/state.ts` with `message` through `redactSecrets` and `toolCount`, the `approvals.yaml` watcher calling `Whitelist.reload`, and MCP server names accepted by `validateAgents`.

Acceptance:

- [ ] `approval.decide { decision: "approve_always", match: { to: "*@acme.com" } }` writes the `approvals.yaml` row and the next identical call runs with `by: "whitelist"`.
- [ ] Killing the echo MCP server's process flips its connector to `down` with a message within 5 s and back to `ok` after restart.

Tests: `ws/approvals-basic.test.ts` extended with the `approve_always` and `MATCH_REQUIRED` cases, `ws/mcp.test.ts`, `watch/approvals.test.ts`.

#### SR-056 Full approval card

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-056 | Full approval card | web | SR-041, SR-055 | 2 |

Extend `hud/Approvals.tsx`: three buttons (`Approve once`, `Approve and always allow (90 days)`, `Deny`), amber "This tool changed since you allowed it." line, the verbatim MCP paragraph, the approve-always confirm with the prefilled `match` for `to`, `cc`, `bcc`, `recipient`, `recipients`, `channel`, `url`, `phone`, `number`, the "allow any recipient" tick when none exist, wording `Always allow <name> to <action> (<full tool name>) to <match>`, sending `approval.decide { decision: "approve_always", match }`. Chord `S` then `Enter`. Hand-raise and shrug cues already exist.

Acceptance:

- [ ] An MCP send with `to: ["list@northlight.example"]` shows the confirm prefilled with `to: list@northlight.example`.
- [ ] A custom tool with no recipient field cannot be always-allowed without the tick.

Tests: `tests/approvals-full.test.tsx`.

#### SR-057 Connector bar MCP health states

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-057 | Connector bar MCP health states | web | SR-038, SR-055 | 1 |

Amber `auth_required` with a Connect button (`mcp.oauth.begin`, open `mcp.oauth.url` in a new tab), red `down`/`load_failed` with `message` on hover and in Activity, struck-through `denied` with a lock, click on a red connector shows the last three `mcp.status` events and a Reconnect button, and `brain.warning` lines in Activity. The three tool cards moved to SR-041 (M1). Errors are never toasts. Grey-circle fallback logo with initials (seeded issue 9 is closed by this ticket if not taken by then).

Acceptance:

- [ ] An MCP server with an unresolved `$NOTION_TOKEN` shows red with `NOTION_TOKEN is not set...` on hover; `mcp.deny: [stripe]` shows Stripe struck through with a lock.
- [ ] Clicking Connect on an `auth_required` connector sends `mcp.oauth.begin` and opens the returned URL.

Tests: `tests/connectors.test.tsx`.

#### SR-059 web_search backends

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-059 | web_search backends | core | SR-017b | 1 |

Extend SR-017b's `tools/builtins/web-search.ts` with the `brave`, `tavily` and `searxng` backends selected by `tools.web.provider`, each mapping its response to `{ title, url, snippet }[]`, capped at `maxResults` and 4,000 characters total, with the key read through `$NAME` expansion. The connector turns from grey to `ok` when a backend is configured and the first call succeeds, and to `down` with the HTTP status on failure.

Acceptance:

- [ ] A Brave response is mapped to `{ title, url, snippet }[]` and truncated at 4,000 characters.
- [ ] A 401 from the backend produces `tool_result { error: "..." }` with the provider's status, never a thrown error, and the connector goes `down`.

Tests: `tools/builtins/web-search.test.ts` extended with recorded HTTP fixtures per backend.

#### SR-060 BrainGraph, readBy and revisions

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-060 | BrainGraph, readBy and revisions | core | SR-015, SR-017 | 1 |

`brain/graph.ts`: `buildGraph(index, runs, { includeReads })` producing `BrainGraph` with node kinds `note | deliverable | sample | missing`, `readBy` joined from `tool_result` events named `brain_search` or `brain_read` (last 20 per note), `wroteBy` from `brain_note_written`, `revises` edges, `read` edges only with `includeReads`. `brainRevisions(noteId)` oldest-first. Per-note delta builders for `brain.note.indexed` and `brain.note.removed`.

Acceptance:

- [ ] On the studio template with its sample run, the graph has one `revises` chain and non-empty `readBy` on the notes the demo transcript read.

Tests: `brain/graph.test.ts`.

#### SR-061 Brain WebSocket messages and upload

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-061 | Brain WebSocket messages and upload | server | SR-060 | 1 |

Handlers `brain.graph.get` and pushes `brain.note.indexed`, `brain.note.removed` (from the brain watcher), `brain.warning` (`missing_created`, `embed_unsupported`, pinned truncation). `POST /api/brain/upload` (multipart, `.md`, `.txt`, `.pdf` into `brain/inbox/`, token and Origin required).

Acceptance:

- [ ] Creating a note by hand pushes `brain.note.indexed` within 1 s with its edges.
- [ ] A pinned set over budget pushes `brain.warning { scope: "pinned" }` once per run.

Tests: `ws/brain.test.ts`, `http/upload.test.ts`.

#### SR-062 Brain graph overlay

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-062 | Brain graph overlay | web | SR-061 | 2 |

`hud/GraphOverlay.tsx` on `G`: scene faded to 20 percent, 2D SVG force graph from `brain.graph.get` patched live, nodes coloured by `writtenBy`, `sample` dimmed, `status` ring, last five deliverables highlighted, search with 150 ms debounce through `brain.search`, Tab between nodes, Enter opens SR-040's `hud/NoteSheet.tsx`, extended here with `Open in editor` (sends `note.reveal { app: "editor" }`, shown only when `welcome.editors` is non-empty, labelled with the first detected editor), "v3, revised from v2" from `brainRevisions` with a diff toggle. A drop zone on the Brain cylinder and an Upload button in the overlay both `POST /api/brain/upload` (SR-061) as multipart with the `X-Staffroom-Token` header, accept `.md`, `.txt`, `.pdf`, show a progress line in Activity and the resulting `brain.note.indexed` as a new node. A list-view twin of the graph (a table of notes with the same Upload button).

Acceptance:

- [ ] The studio graph renders 17 notes and the phantom node for any unresolved link at under 16 ms per frame during drag.
- [ ] Dropping `notes.md` on the Brain posts it with the token header and the node appears without a reload; a `.exe` is refused client-side with "Only .md, .txt and .pdf files can be added."
- [ ] `Open in editor` is absent when `welcome.editors` is `[]`.

Tests: `tests/graph.test.tsx` for layout data and keyboard order; `tests/brain-upload.test.tsx` (jsdom, mocked fetch asserting the multipart body and the header).

#### SR-063 Routines scheduler

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-063 | Routines scheduler | server | SR-028, SR-054 | 2 |

`scheduler/routines.ts` and `catchup.ts`: `RoutineSchema`, `office/routines.yaml`, 30 s tick with `Temporal` in the office timezone, one-at-a-time serialisation among routines, `submitTask` with `source: "routine"` and `routineId`, `approval_before_send`, `.staffroom/scheduler.json` with `lastRunAt`, catch-up rules (`latest`, `all` capped at 7, `skip`, misses over 7 days skipped), the 90 s sleep gap trigger, handlers `routine.upsert`, `routine.delete`, `routine.run_now`, `task.create` with `schedule` turned into an upsert, `OfficeState.routines` with `nextRunAt`.

Acceptance:

- [ ] A `weekdays 08:00` routine in `Australia/Melbourne` fires at the right UTC instant across a DST change (two fixed dates in the test).
- [ ] Advancing a fake clock 26 hours with `catch_up: latest` runs once, titled `Catch-up: <label>`.

Tests: `scheduler/routines.test.ts`, `scheduler/catchup.test.ts` with fake timers.

#### SR-064 Schedule popover and routine list

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-064 | Schedule popover and routine list | web | SR-039, SR-063 | 1 |

Task bar schedule control ("Now", "Every weekday at", "Every day at", "Every week on", time), calendar icon on submit, a Routines section in Settings and in the list view with pause, run now, delete.

Acceptance:

- [ ] Choosing "Every weekday at 08:00" and submitting creates a row in `routines.yaml` and shows it with the next fire time.

Tests: `tests/schedule.test.tsx`.

#### SR-065 Brain import and reindex

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-065 | Brain import and reindex | core, cli | SR-015, SR-046 | 1 |

`brain/import.ts` (`importBrain(source, opts)`: Obsidian vault detection, links and embeds intact, attachments to `_attachments/`, plain folder walk, `--area` default `90-archive/`, front-matter fill, `written_by: owner`, skip list unless `--include-tools`, summary) and the CLI commands `brain import` and `brain reindex [--embeddings]`.

Acceptance:

- [ ] Importing a 50-note Obsidian vault fixture resolves every internal link and copies its images.
- [ ] `brain reindex` on a deleted index recreates it and exits 0 with warnings printed.

Tests: `brain/import.test.ts`, CLI tests for both commands.

#### SR-066 Leaving demo mode

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-066 | Leaving demo mode | server, web, cli | SR-043, SR-046 | 1 |

On the first flip to live (set_key, `.env` watcher, or `setup`), ask once `Remove the sample notes and runs from Northlight Studio? Your own notes are kept. (Recommended)`; yes moves `sample: true` notes to `90-archive/_sample/` with `pinned: false` and deletes `sample: true` runs; no makes the pinned set skip samples and the graph dim them; the answer is recorded in `.staffroom/scheduler.json`; `approvals.yaml` untouched. Shown in Settings > Models and in `setup`.

Acceptance:

- [ ] After yes, `brain_search` no longer returns Northlight notes and "Latest results" is empty.
- [ ] The question is not asked on the next boot.

Tests: `demo/leave.test.ts`, `tests/settings-leave-demo.test.tsx`.

#### SR-067 Settings: whitelist, doctor, default model

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-067 | Settings: whitelist, doctor, default model | web, server | SR-044, SR-055 | 1 |

Whitelist rows from `approvals.yaml` with Revoke and last-used time, a Doctor section that sends the new `doctor.run { reqId }` client message (added to §6 by this ticket), whose server handler calls `runDoctor({ officeDir })` from `packages/server/src/doctor/` (SR-046) directly and replies `doctor.result { reqId, checks, ok }`, rendered as a table, and a `default_model` select populated from `listModels()` of each configured provider, writing `agents.yaml` through the document-mode writer (office-ui open question 5, recommended yes).

Acceptance:

- [ ] Revoke removes the row from the file and the next call asks for approval.
- [ ] `doctor.run` returns the same `checks` array as `npx staffroom doctor --json` on the same office.

Tests: `tests/settings-full.test.tsx`, `ws/doctor.test.ts`.

#### SR-068 Config migrations and migrate command

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-068 | Config migrations and migrate command | server, cli | SR-028 | 1 |

`migrate/index.ts` with the `{ file, from, to, describe, run(doc) }` shape, `.staffroom/backups/<file>.v<from>.bak`, idempotent, `CONFIG_VERSION_UNKNOWN` for newer files, `boot.migrate` wired, `npx staffroom migrate --dry-run`, deprecated-key warnings kept for two minors. Ship one real migration as the example even if it only renames nothing (`v1-to-v1-noop` is not acceptable; use the first real key change the M2 work introduces, for example adding `approvals.whitelist_days`).

Acceptance:

- [ ] Running the server twice on a v1 file produces one `.bak` and no second rewrite.

Tests: `migrate/migrate.test.ts`.

#### SR-069 Docker image

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-069 | Docker image | ci | SR-051 | 1 |

`Dockerfile` on `node:20-bookworm-slim` with `npx` available, binds `0.0.0.0` inside, `STAFFROOM_IN_DOCKER=1` swaps the warning text, `STAFFROOM_OFFICE=/office`, multi-arch build and push to `ghcr.io/staffroom-ai/staffroom` from `release.yml`. The docs line: `docker run -d --name staffroom -p 127.0.0.1:4242:4242 -v $PWD/office:/office -e ANTHROPIC_API_KEY ghcr.io/staffroom-ai/staffroom:latest`.

Acceptance:

- [ ] The image runs the demo with no environment and answers health; origin and token checks are still on.

Tests: a `docker` step in `release.yml` that runs the container and curls `/api/health`.

#### SR-070 Docs site and docs:gen

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-070 | Docs site and docs:gen | docs, ci | SR-051 | 2 |

`apps/docs` on Astro Starlight with the tree from `repo-quality-launch.md` §8, `pnpm docs:gen` producing `reference/office-state.md`, `reference/errors.md`, `reference/config-keys.md` and the two YAML pages from the zod schemas, `RunErrorCode` and `userMessage`, a CI step failing on drift, `docs.yml` deploying to GitHub Pages at `staffroom.so/docs`. Includes the "Ask an AI to write it" block and the custom-tool header paragraph.

Acceptance:

- [ ] Every key in `ConfigSchema` and `AgentsFileSchema` appears in the generated pages with an example.

Tests: `apps/docs/gen.test.ts` comparing generated output to committed files.

#### SR-071 Telemetry opt-in and update check

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-071 | Telemetry opt-in and update check | core, cli | SR-046 | 1 |

`packages/core/src/telemetry.ts` with `TelemetryEvent` exactly as `repo-quality-launch.md` §9, `installId` at `office/.staffroom/telemetry-id`, batching every 10 minutes, `STAFFROOM_TELEMETRY=0`, never in demo. `apps/telemetry` Cloudflare Worker keeping daily counts. The once-a-day update check in `~/.staffroom/update-check.json`, only when `telemetry.enabled`, `STAFFROOM_NO_UPDATE_CHECK=1` disables.

Acceptance:

- [ ] With telemetry off, a packet capture during a full demo session shows zero outbound requests from the server process.
- [ ] `doctor telemetry` prints the exact payload that would be sent.

Tests: `telemetry.test.ts` (payload shape snapshot, never-sent fields absent), `update-check.test.ts`.

#### SR-072 Perf test and perf job

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-072 | Perf test and perf job | web, ci | SR-048 | 1 |

`e2e/office-perf.spec.ts` asserting draw calls under 60, triangles under 150,000, p95 frame time under 8 ms after 3 s warm-up and 10 s recording with 35 agents cycling demo runs, first frame under 2 s, with the reasoning comment. The `perf` job on `macos-14`.

Acceptance:

- [ ] The job passes on the studio template extended to 35 agents by the test's own fixture.

Tests: the perf test.

#### SR-073 Live matrix workflow

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-073 | Live matrix workflow | ci | SR-021 | 1 |

`live-matrix.yml` nightly at 03:00 UTC and on dispatch: Anthropic and OpenAI with repo secrets, an Ollama service container pulling `llama3.2:1b`, `STAFFROOM_LIVE_TESTS=1`, and the smoke test on macOS. A failure opens an issue labelled `provider-drift`.

Acceptance:

- [ ] A dispatch run is green once before launch.

Tests: none (workflow).

#### SR-074 Embeddings and hybrid search

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-074 | Embeddings and hybrid search | core | SR-015 | 1 |

`brain.embeddings` with `model` required when enabled, chunking (400 tokens, 60 overlap), `embed()` on adapters that have it, `embed_unsupported` warning, cosine over the `embeddings` table, reciprocal rank fusion (k=60) in `mode: "hybrid"`, chunk excerpt for vector hits, invalidation on model change, and the cloud warning text next to the key in the docs.

Acceptance:

- [ ] Enabling without `model` is a `ConfigError`.
- [ ] With Ollama `nomic-embed-text`, a paraphrased query finds the note that keyword search misses in the fixture set.

Tests: `brain/embeddings.test.ts` with a fake `embed()`.

#### SR-075 Doctor: remaining checks, fix and bundle

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-075 | Doctor: remaining checks, fix and bundle | cli | SR-046, SR-055, SR-063 | 1 |

Add to `packages/server/src/doctor/` (SR-046): `mcp.<name>`, `tools.web`, `approvals.whitelist`, `brain.links`, `brain.secrets` (key-name regex or 16+ digit number in a non-private note), `scheduler`, `telemetry`; in the CLI printer, `--bundle` zipping log, doctor output and config with every secret-bearing value replaced by `$NAME` unconditionally; the SQLite version and WAL line (seeded issue 6, if untaken; its path is `packages/server/src/doctor/checks/runs-db.ts`).

Acceptance:

- [ ] `doctor --bundle` output contains no value from `.env` (asserted by grep in the test).

Tests: CLI tests per check with fixture offices.

#### SR-076 CLI: tools, template, export

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-076 | CLI: tools, template, export | cli | SR-045 | 1 |

`tools new <name> [--scope]` from the header comment plus stub, `tools add <example>` (copies one file from `exampleToolsDir()` and prints its `// TRY IT:` line), `template list`, `template apply <id> --into <dir> [--include-tools]` (this is where `copyTemplate`'s refusal of `tools/` and `.staffroom/` applies, because the source may be a user folder), `export --out office-export.zip` (never `.env` or `.staffroom/secrets/`, config values redacted unconditionally, `runs.sqlite` as JSON).

Acceptance:

- [ ] `export` on the studio office produces a zip whose `config.yaml` has `$ANTHROPIC_API_KEY` and no literal.

Tests: CLI tests for each command.

#### SR-077 Fix what v0.1 testers hit

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-077 | Fix what v0.1 testers hit | all | SR-051 | 2 |

Buffer ticket for the feedback Discussion. Each fix gets its own PR referencing this id; anything larger than a half-day becomes its own ticket.

Acceptance:

- [ ] Every item from the ten testers is answered in the Discussion with a fix link or a ROADMAP line.

Tests: one regression test per fix.

#### SR-078 v0.2 release

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-078 | v0.2 release | ci | SR-052 to SR-077 | 1 |

Ids swapped with the launch ticket so that no ticket depends on a later id. `0.2.0` with the M2 exit criteria walked on a fresh Mac, Ubuntu and Windows, release notes naming external contributors, Docker tag pushed, docs deployed.

Acceptance:

- [ ] Every M2 exit criterion ticked in the release checklist issue.

Tests: none.

#### SR-079 Launch

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-079 | Launch | docs | SR-078 | 1 |

Show HN post with the exact title and the body structure from `repo-quality-launch.md` §10, X post with the GIF, r/LocalLLaMA (Ollama bookkeeper), r/selfhosted (files, no telemetry), r/SideProject, Product Hunt a week later, twelve seeded `good first issue`s opened the day before. Of the twelve in §10, four are already closed by earlier tickets and are replaced so that twelve are open on launch day: issue 11 (`AGENT_ID_DUPLICATE` message, a test in SR-011), issue 12 (win32 polling case, SR-029), issue 8 (tool cards, SR-041 and SR-058) and issue 9 (fallback logo, SR-057); issue 6 (SQLite version line) stays only if SR-075 left it. Replacements: a docs page for `brain_list`; `?azimuth=` support in the office URL for screenshots; a Groq fixture set for the OpenAI-compatible adapter (SR-020's optional set); `Open in editor` detection on Linux beyond `which` (desktop files and Flatpak). Six hours in the thread.

Acceptance:

- [ ] Post is up on a Tuesday to Thursday between 8 and 9 am US Eastern with twelve `good first issue`s open, none of which is already fixed on `main`.

Tests: none.

### M3 tickets (coarser)

#### SR-080 Four more templates

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-080 | Four more templates | templates | SR-032 | 3 |

`agency`, `ecommerce`, `clinic`, `consultant`, each meeting §11: roster of four to eight agents across two to six departments, a 12 to 18 note brain with `sample: true`, pinned `00-about/`, one `_private/` note, one deliverable per department, no `model:` lines, and at least three demo transcripts. Tests: `templates.test.ts` already enforces the rules; add a per-template boot test.

#### SR-081 Templates gallery

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-081 | Templates gallery | docs, cli | SR-080 | 1 |

`templates/gallery.md` and one page per template with a screenshot from the office, `template apply` polish (`--into` an existing office merges `brain/` only with a prompt). Tests: CLI test for merge behaviour.

#### SR-082 Teach the office

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-082 | Teach the office | core, server, web | SR-040, SR-019 | 3 |

A "Teach" action on a deliverable card: the owner writes what was wrong, a run of kind `chat` on the same agent produces a one-paragraph addition to `agents[].instructions`, shown as a diff, written through the document-mode writer only on Confirm, capped at 4,000 characters with the oldest paragraph dropped and archived to `90-archive/instructions/<agent>.md`. Tests: loop test for the instruction-proposal prompt, roster write test, jsdom test for the diff dialog.

#### SR-083 Usage and cost panel

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-083 | Usage and cost panel | server, web | SR-013 | 2 |

`usage.get { reqId, days }` returning tokens, cost and run counts per agent and per model from `runs`, "cost unknown" for null prices, a Usage tab in Settings with a 30-day table and a per-agent sparkline; `doctor` prints last-7-day totals. Tests: SQL aggregation test with a seeded store; jsdom test.

#### SR-084 Community adapter programme

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-084 | Community adapter programme | core, docs | SR-073 | 2 |

`contributing/adapters.md` with a worked example, a `pnpm new:adapter <name>` scaffold generating the file, the seven fixture stubs and the conformance table entry, and review of the Gemini, Mistral and Bedrock PRs (seeded issues 1 to 3). Tests: scaffold test.

#### SR-085 brain_propose_edit

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-085 | brain_propose_edit | core, web | SR-054 | 2 |

A write tool that takes `{ id, newBody, reason }`, always requires approval, whose preview is a unified diff against the existing owner note, and whose approve applies the edit with `updated` bumped. Tests: registry and preview tests, jsdom diff rendering.

#### SR-086 Chunk compaction

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-086 | Chunk compaction | core | SR-013 | 1 |

Nightly job compacting `chunk` events of runs older than 30 days into one per turn (core open question 1). Tests: compaction preserves `messagesFromEvents` output.

#### SR-087 Settings edits roles, tools and models

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-087 | Settings edits roles, tools and models | web, server | SR-067 | 2 |

Per-agent role, tools and model editable in Settings through the document-mode writer, with the same validation errors shown inline. Tests: handler tests and jsdom.

#### SR-088 v0.3 release

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-088 | v0.3 release | ci | SR-080 to SR-087 | 1 |

`0.3.0`, M3 exit criteria walked, the "1,000 installs" post published.

### M4 tickets (coarser)

#### SR-089 Interface freeze audit

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-089 | Interface freeze audit | core | SR-088 | 2 |

Review `ProviderAdapter`, `OfficeState`, `RunEvent`, `tool()` and the WS protocol against two minors of changesets; write `docs/stability.md` listing what is frozen; add an API-extractor report to `lint` so a change to a frozen type fails CI. Tests: the api report check.

#### SR-090 Config importers

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-090 | Config importers | cli | SR-089 | 3 |

`npx staffroom import <file>` for CrewAI (`agents.yaml`/`tasks.yaml`) and AutoGen (JSON) formats as documented publicly, producing a valid `agents.yaml` with a printed mapping. An agents-office importer is written only against a config file a user supplies in an issue, never from that project's source (clean room), and is skipped if none is supplied. Tests: fixture files per format.

#### SR-091 Windows first-class

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-091 | Windows first-class | all | SR-088 | 3 |

Windows in the required matrix for eight weeks: `usePolling` verified, path canonicalisation tests with backslashes, `Show in Finder` becomes "Show in Explorer", `open` fallback, `install-timing` on `windows-2022`, PowerShell install text in the README. Tests: the Windows-only suites un-skipped.

#### SR-092a Remote office package: HTTPS and login

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-092a | Remote office package: HTTPS and login | new | SR-091 | 3 |

`packages/remote` as `@staffroom/remote`, wrapping `createServer` with TLS (`--cert`/`--key` or an ACME hook), a single-owner login (argon2 hash in `office/.staffroom/remote.json`, session cookie, rate-limited), and the same origin and token checks as `auth.ts`; `--host 0.0.0.0` allowed only through this package. Tests: login, lockout after ten failures, TLS handshake against a self-signed pair.

#### SR-092b Remote office package: docs, packaging, auth tests

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-092b | Remote office package: docs, packaging, auth tests | new, docs | SR-092a | 2 |

Add `@staffroom/remote` to the changeset `fixed` group and the release workflow, a docs page (`remote.md`: when to use it, what it does not do, the reverse-proxy alternative), the `docker run` variant, and the auth suite mirroring `auth.test.ts` (evil Origin, bad Host, missing token, expired session) plus a Playwright login smoke. Documented as optional.

#### SR-093 v1.0 release

| id | title | packages | depends_on | estimate |
|---|---|---|---|---|
| SR-093 | v1.0 release | ci | SR-089 to SR-092b | 1 |

`1.0.0` when the criteria in `repo-quality-launch.md` §6 hold; `major` changesets become allowed from here.

## 3. Week-by-week schedule, weeks 1 to 6

Weeks are five working days of two half-days each, ten half-days a week. Week 1 begins Tuesday 15 Sep 2026 and runs to Monday 21 Sep; each later week starts on a Tuesday so that release day (Tuesday) is the first day of a week, not the last. The policy is nine half-days scheduled and one in reserve per week; the reserve rolls forward but is not banked past the milestone. After the spec-fidelity review (SR-006b, SR-017b, SR-041 at 2 and SR-058 pulled into M1) M0 plus M1 is 60 half-days against 60 available, so the per-week reserve is fully consumed and the cut line below is the only buffer. The sums in the table are the ticket estimates added up, not the policy figure.

| Week | Dates | Tickets | Half-days | Buffer | What is true at the end of the week |
|---|---|---|---|---|---|
| 1 | 15 to 21 Sep | SR-001, SR-002, SR-003, SR-004, SR-005, SR-006b, SR-006, SR-007, SR-008, SR-020 | 10 | 0 | M0 exit criteria met. `staffroom@0.0.1` and the four `@staffroom/*` placeholders hold the names. Anthropic and OpenAI adapters pass conformance from fixtures. |
| 2 | 22 to 28 Sep | SR-011, SR-010, SR-012, SR-013, SR-014, SR-015, SR-021 | 10 | 0 | Config, redaction, run log, registry and brain index exist with tests. All three adapters done. No loop yet. |
| 3 | 29 Sep to 5 Oct | SR-016, SR-017, SR-017b, SR-018, SR-019, SR-022, SR-023 | 8 | 2 | `createOffice` runs the bakery task end to end in Vitest on all three adapters and `FixtureAdapter`. Custom tools load. |
| 4 | 6 to 12 Oct | SR-024, SR-025, SR-026, SR-027, SR-028, SR-029, SR-030, SR-031, SR-032, SR-033 | 10 | 0 | The server answers the worked WebSocket exchange, approve and deny included, on the studio template in demo mode; `wscat` is enough to see a run happen. |
| 5 | 13 to 19 Oct | SR-034, SR-035, SR-036, SR-037, SR-038, SR-039, SR-043, SR-058 | 10 | 0 | The office renders and animates in the browser against the real server; rename, set_key, note reveal and the tool card payloads exist server-side. |
| 6 | 20 to 26 Oct | SR-040, SR-041, SR-042, SR-044, SR-045, SR-046, SR-047, SR-048, SR-049, SR-050, SR-051 | 12 | -2 | `staffroom@0.1.0` published on Tuesday 27 Oct. Ten testers have the link. |

How the arithmetic works: SR-020 and SR-021 need only SR-007, so they fill the reserve half-days of weeks 1 and 2 instead of sitting in week 3; that leaves week 3 two half-days short of full, which week 4 borrows (SR-024 and SR-025 start on Friday of week 3 because they only need SR-022). SR-043 and SR-058 are server tickets that only need SR-029, so they run in week 5 alongside the scene work, which also lets SR-040 and SR-041 start on Tuesday of week 6 with their dependencies closed. Week 6 is then two half-days over, and that is exactly what the cut line pays for.

Cut line, in the order to cut if week 6 is running late, each item moving to `0.1.1` the following Tuesday:

1. SR-036 walking, hand-raise and paper animations degrade to the flat-shaded fallback described in the ticket (saves 1 half-day; badges and monitors still animate).
2. SR-046 `setup` wizard ships as `--non-interactive` only; Settings > Models is the interactive path and the `NO_MODEL_CONFIGURED` hint still names both (saves 1; the `@inquirer/prompts` flow lands in 0.1.1).
3. SR-049 hero GIF is recorded by hand rather than by `scripts/hero-gif.sh` (saves 1; the script lands in 0.1.1).

Cuts 1 and 2 together bring week 6 back to 10 and are the default plan unless weeks 1 to 5 finish with time to spare; cut 3 is the reserve behind them. Do not cut tests, the smoke test, SR-041's tool cards (they are an exit criterion), or SR-050; a v0.1 with a fallback scene and full tests is better than the reverse.

After week 6: week 7 is SR-077 (tester fixes) plus SR-052 (MCP); weeks 7 to 10 cover M2 at 36 half-days against 40 available, so M2 keeps four half-days of reserve on top of SR-077's own two; `0.2.0` (SR-078) ships on Tuesday 10 Nov 2026 and the Show HN post (SR-079) goes out in that week's Tuesday to Thursday window (10 to 12 Nov 2026). That is three weeks later than the plan's "week 6 launch" and the reason is the size of the specs, not scope creep; the ROADMAP says so.

## 4. First day

Everything below happens before SR-001 is closed. Run from an empty directory. Versions are the current releases on 15 Sep 2026; pin whatever `pnpm add` resolves and let Dependabot move them.

```bash
mkdir staffroom && cd staffroom
git init -b main
corepack enable && corepack prepare pnpm@10.0.0 --activate   # matches packageManager below
# if corepack on Node 20 reports a keyid or signature error here, run: npm i -g corepack@latest && corepack prepare pnpm@10.0.0 --activate
pnpm init
mkdir -p packages/{core,server,web,cli,templates}/src apps .changeset .github/workflows scripts/lint docs
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json` (root):

```json
{
  "name": "staffroom-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "biome ci . && node scripts/lint/forbidden-sdk.mjs && node scripts/lint/npx-grep.mjs && node scripts/lint/fixture-secrets.mjs && node scripts/lint/dep-cycles.mjs && node scripts/lint/route-tests.mjs && node scripts/lint/hygiene-files.mjs && node scripts/lint/changeset-present.mjs",
    "e2e": "turbo e2e",
    "dev:init": "pnpm --filter staffroom exec node dist/index.js init --template studio --dir ./office",
    "dev": "pnpm --filter staffroom exec node dist/index.js start --office ./office --open",
    "docs:gen": "pnpm --filter docs gen",
    "changeset": "changeset",
    "release": "changeset publish"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@changesets/cli": "latest",
    "@changesets/changelog-github": "latest",
    "lefthook": "latest",
    "turbo": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["build"], "outputs": ["coverage/**"] },
    "lint": {},
    "e2e": { "dependsOn": ["build"], "cache": false }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

Each package's `tsconfig.json` is `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }`; `packages/web` adds `"lib": ["ES2022", "DOM", "DOM.Iterable"]`, `"jsx": "react-jsx"`, and `"module": "ESNext"` with `"moduleResolution": "Bundler"`.

`packages/core/package.json`:

```json
{
  "name": "@staffroom/core",
  "version": "0.0.1",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=20" },
  "files": ["dist"],
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "import": "./dist/testing/index.js" }
  },
  "scripts": {
    "build": "tsup src/index.ts src/testing/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage"
  },
  "publishConfig": { "access": "public" }
}
```

`publishConfig.provenance: true` is not set on day one on any package: the placeholder publish runs from a laptop, where npm refuses provenance. SR-005's release PR adds it to all five packages once `release.yml` publishes from CI.

`packages/server/package.json`: name `@staffroom/server`, same shape, single export `.`, `devDependencies: { "@staffroom/web": "workspace:*" }` (build order only, never imported), scripts `build: tsup src/index.ts --format esm --dts --clean && node scripts/copy-web.mjs` (copies `../web/dist` to `dist/public` and exits 1 if `../web/dist` is missing or empty), `typecheck`, `test: vitest run`.

`packages/web/package.json`: name `@staffroom/web`, `private: false`, `files: ["dist"]`, scripts `build: vite build`, `typecheck: tsc --noEmit`, `test: vitest run --environment jsdom`, `e2e: playwright test`.

`packages/cli/package.json`:

```json
{
  "name": "staffroom",
  "version": "0.0.1",
  "description": "Your AI staff, in an office you can watch. Free for commercial use.",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=20" },
  "bin": { "staffroom": "dist/index.js" },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --format esm --clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "publishConfig": { "access": "public" },
  "repository": "github:staffroom-ai/staffroom"
}
```

The shebang is line 1 of `packages/cli/src/index.ts` (`#!/usr/bin/env node`); tsup keeps it in the output and sets the executable bit, so no banner flag is needed (and `--banner.js` is not a documented tsup CLI flag).

`packages/templates/package.json`: name `@staffroom/templates`, `files: ["dist", "studio", "agency", "ecommerce", "clinic", "consultant", "tools"]`, scripts `build: tsup src/index.ts --format esm --dts --clean`, `typecheck`, `test: vitest run`.

Install the toolchain and the core dependencies:

```bash
pnpm add -Dw @biomejs/biome @changesets/cli @changesets/changelog-github lefthook turbo typescript vitest @vitest/coverage-v8 tsup
pnpm --filter @staffroom/core add @anthropic-ai/sdk openai ollama @modelcontextprotocol/sdk better-sqlite3 zod zod-to-json-schema yaml gray-matter esbuild picomatch ulid
pnpm --filter @staffroom/core add -D @types/better-sqlite3 @types/picomatch
pnpm --filter @staffroom/server add ws chokidar pino pino-pretty
pnpm --filter @staffroom/server add -D @types/ws
pnpm --filter @staffroom/web add react react-dom three @react-three/fiber @react-three/drei zustand
pnpm --filter @staffroom/web add -D vite @vitejs/plugin-react @types/react @types/react-dom @types/three jsdom @playwright/test size-limit @size-limit/file
pnpm --filter staffroom add commander @inquirer/prompts open
pnpm --filter staffroom add -D @types/node execa
pnpm --filter @staffroom/server add -D @staffroom/web@workspace:*
pnpm changeset init
pnpm exec biome init
pnpm exec lefthook install
```

`execa` is a devDependency: only the CLI tests in SR-047 use it.

Placeholder publish to hold the names (do this before anything else is pushed). Create the `@staffroom` org first at `https://www.npmjs.com/org/create` (there is no `npm org create`; `npm org` only has `set`, `rm` and `ls`), then:

```bash
# packages/cli/src/index.ts, line 1: #!/usr/bin/env node
# line 2: console.log("Staffroom is not released yet. Watch https://github.com/staffroom-ai/staffroom for the first version.");
pnpm build
npm login
for p in packages/cli packages/core packages/server packages/web packages/templates; do
  (cd "$p" && npm publish --access public --provenance=false)
done
npm view staffroom version          # 0.0.1
npm view @staffroom/core version    # 0.0.1
```

`--provenance=false` is required: npm refuses provenance outside a supported CI/OIDC environment, and trusted publishing can only be configured on a package that already exists, which is why all five go up now (SR-005).

Then the first commit. Create the `staffroom-ai` GitHub org at `https://github.com/organizations/plan` before this step, because `gh repo create` needs it to exist:

```bash
git add -A
git commit -s -m "SR-001: monorepo skeleton"
gh repo create staffroom-ai/staffroom --public --source . --push
```

To run the office locally from the repo, `pnpm dev:init` once (it creates `./office` from the studio template) and then `pnpm dev`; CONTRIBUTING says the same (SR-003).

Also on day one, outside the repo: buy `staffroom.so`, turn on secret scanning with push protection, enable Discussions, configure npm trusted publishing on the five packages for `release.yml`, and add `NPM_TOKEN` only if trusted publishing cannot be configured the same day (remove it once it can).

## 5. Risks

| Risk | Likelihood | What it looks like | Mitigating ticket |
|---|---|---|---|
| 3D eats the schedule | high | SR-035 and SR-036 run past four half-days | The time box and flat-shaded fallback inside SR-036; SR-072 measures rather than guesses |
| Own agent loop has gaps versus mature frameworks | medium | Parallel tool calls or resume misbehave on one provider | SR-007's conformance suite on every adapter; SR-050's resume and injection cases; SR-073 nightly live matrix |
| Custom tools become a foot-gun | medium | A tool with no scope runs writes without asking | SR-014 treats missing scope as write; SR-023 reports it, SR-058 pushes the payload and SR-041 shows the card, all in M1; SR-031 ships five safe examples |
| Build order ships an empty web bundle | low | `dist/public` missing after a clean `pnpm build` | SR-001's `server -> web` devDependency and the loud `copy-web.mjs` failure |
| Approval gate bypassed | low | A write reaches a tool without an `approval_needed` event | SR-014 makes `invoke` the only path; SR-054 tests array, comma and suspended cases; SR-003's SECURITY.md names it as a vulnerability |
| Secrets leak into the log, WS or export | medium | A key appears in `runs.sqlite` | SR-012 redaction applied in `RunStore.append` (SR-013); SR-076 redacts exports unconditionally; SR-002's fixture grep |
| Another web page reaches the WebSocket | medium | A tab on another site approves an action | SR-024 origin, token and Host checks with their three tests |
| Calendar slip against the plan's week 4 | high | v0.1 not out by 12 Oct | Section 3's cut line; SR-051 fixed for 27 Oct; ROADMAP states the date |
| Scope creep from issues after launch | high | Feature requests crowd out SR-077 | SR-003's ROADMAP "Not planned" list and `not planned` label; SR-077 is the only open-ended ticket |
| Demo lies about the product | medium | Demo path differs from live path | SR-033 runs `FixtureAdapter` through the real loop, registry and brain; SR-048's smoke test runs on that path |
| Licence contamination | must not happen | Code or prompts resembling agents-office | SR-003's clean-room paragraph and PR checkbox; this plan was written without opening that folder |
| Single-maintainer burnout | medium | Issues unanswered for days | SR-005 automates releases; SR-079 seeds issues that others can take; the one day off per week in the launch checklist |
| Unproven demand | medium | Few installs after launch | SR-051's soft launch and SR-077's feedback loop come before SR-079, so the Show HN post reflects real usage |
| Windows breaks silently | medium | Watchers or paths fail only on win32 | SR-004 puts Windows in the matrix from week 1; SR-029's polling case; SR-091 finishes it |

## 6. Definition of done for the v0.1 public release

- [ ] `npx staffroom` on a fresh macOS machine with Node 20 and nothing else reaches a rendered office in under 60 seconds, with no key, and the same on Ubuntu and Windows.
- [ ] The first screen shows one deliverable in "Latest results"; no blank screen at any point.
- [ ] The bakery demo task produces a deliverable card and a real note under `office/brain/40-deliverables/marketing/`, and Approve flips its `status`.
- [ ] Pasting a key into Settings > Models flips to live without a restart; the same task runs on Anthropic, OpenAI and Ollama.
- [ ] An agent on an Ollama model shows the "local" pill and refuses a model override with the hint.
- [ ] A custom tool file registers within 2 s of being saved and the Activity feed asks who may use it; a broken one shows the card with Copy and does not stop the server (SR-058 payloads, SR-041 cards).
- [ ] A non-local write tool blocks the run with a raised hand and the two-button card; Approve once finishes the run, deny makes the agent shrug and the model explain (both through `approval.decide`, SR-027).
- [ ] `Open in brain` on a deliverable card shows the note; `Show in Finder` reveals the file on disk (`note.reveal`, SR-043).
- [ ] Ctrl+C during a run and restart resumes it; a pending approval is expired and re-asked.
- [ ] `npx staffroom doctor` runs the v0.1 checks and prints the `NO_MODEL_CONFIGURED` hint when there is no key.
- [ ] Every error a user can hit has a message and a hint, and every hint that names a command says `npx staffroom <sub>`.
- [ ] `packages/core` coverage is 80 percent or more on all four measures; the loop tests cover resume and the injected-instruction note.
- [ ] The smoke test passes on ubuntu; `size-limit` is under 1.5 MB gzipped; p95 frame time under 8 ms measured on the maintainer's machine.
- [ ] CI is green on ubuntu (Node 20 and 22), macos-14 and windows-2022 for lint, typecheck, test, build, e2e and install-timing.
- [ ] `pnpm lint` fails on `@anthropic-ai/claude-agent-sdk` and on `Run staffroom `.
- [ ] LICENSE, CONTRIBUTING (clean-room paragraph), CODE_OF_CONDUCT, SECURITY (real email), ROADMAP, issue and PR templates, CODEOWNERS, Dependabot present.
- [ ] README under 900 words before the comparison table, hero GIF under 8 MB above the fold, the verbatim first sentence, step-0 install text, first five minutes.
- [ ] Telemetry does not exist yet in v0.1 (SR-071 is M2); the README says nothing is sent.
- [ ] `staffroom@0.1.0` and the four `@staffroom/*` packages are on npm with provenance and one shared version.
- [ ] Release notes written by hand; a `v0.1 feedback` Discussion is open; ten testers have the link.
- [ ] No file under `agents-office` was opened during the build, and CONTRIBUTING says how to keep it that way.

## Open questions

1. The deliverable card's Approve and Show in Finder buttons have no WebSocket messages in `server-cli-runtime.md` §6, and `welcome` carries no detected editors. Recommendation: add `deliverable.approve { reqId, noteId }` and `note.reveal { reqId, noteId, app? }` (client) with an `ack`, plus `platform` and `editors` on `welcome`, done in SR-043 and written back into §6 and the README's shared vocabulary table by the same PR. `tools.assign` (SR-058) and `demoRunsDir` on `ServerOptions` (SR-024) follow the same write-back rule. Owner: server maintainer, before week 4.
2. v0.1 ships at the end of week 6, three weeks after the plan's week 4. Recommendation: accept it, publish the date in ROADMAP.md at SR-003 time, and use the section 3 cut line only if week 6 slips further. Cutting scope below the specs (for example dropping custom tools from v0.1) is not recommended because the hero GIF and the safety story both depend on the registry being real.
3. `brain_list` (brain.md open question 5) is included in SR-017 so the v0.1 tool set does not change after release. Recommendation: yes, it is 20 lines and closes the "browse without a query" gap; the core maintainer confirms before SR-017 starts in week 3.
4. `provider.set_key` for Ollama takes a base URL rather than a key (server open question 3). Recommendation: yes, in SR-043, written to `config.yaml` through the document-mode writer; Settings > Models labels the field "Ollama address" for that row.
5. The GitHub org. Recommendation: create `staffroom-ai` on day one (SR-003), put it in `.changeset/config.json`, CODEOWNERS, the CLI's `repository` field and the placeholder bin's URL, and never rename it; the npm name `staffroom` is what users type and the org name matters less.
