# Repository structure, quality bar, and launch

Status: draft 2, 15 Sep 2026 (reconciled). Source of truth: `docs/product-plan.html`. Sibling specs: `core-agent-loop.md`, `tools-mcp-approvals.md`, `brain.md`, `server-cli-runtime.md`, `office-ui.md`.

This spec owns: the monorepo layout, package names and public exports, TypeScript and lint config, CI job topology (which test runs where), the release flow, repo hygiene files, the docs site structure, the telemetry policy (the only place the payload is listed), template rules, the launch checklist and the seeded issues.

## Decisions

- pnpm workspaces plus Turborepo. Five publishable packages under `packages/`, one docs app under `apps/`. Node 20+, ESM only.
- npm scope: unscoped `staffroom` is the CLI and the name people type. Library packages publish as `@staffroom/core`, `@staffroom/server`, `@staffroom/web`, `@staffroom/templates`. All five share one version number. Custom tools import `@staffroom/core`; there is no `staffroom/core`.
- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. One shared `tsconfig.base.json`.
- Biome for lint and format. No ESLint, no Prettier.
- Vitest for `core`, `server`, `cli`, `templates`. Playwright only for the office: one smoke test on Ubuntu, one perf test on Apple Silicon. Coverage gate is 80% on `packages/core`.
- Provider adapters are tested against recorded fixtures on every PR through `FixtureAdapter`, which is also the demo-mode provider. A live matrix runs nightly, never as a merge blocker.
- CI runs on macOS, Ubuntu, Windows. Nothing merges red.
- Changesets for versioning; npm provenance from OIDC. Pre-1.0: `0.x.0` for breaking, `0.x.y` for everything else.
- DCO sign-off, not a CLA. Clean-room note in CONTRIBUTING.
- Docs site: Astro Starlight in `apps/docs`, GitHub Pages.
- Telemetry is off by default. Section 9 is the only list of what it sends; no other file may add to it.
- Template ids are `studio`, `agency`, `ecommerce`, `clinic`, `consultant`. Section 11 holds the rules a template must meet.

## 1. Monorepo layout

```
staffroom/
  .changeset/
  .github/
    workflows/ci.yml, release.yml, docs.yml, live-matrix.yml
    ISSUE_TEMPLATE/bug.yml, feature.yml, provider-adapter.yml, template.yml, config.yml
    PULL_REQUEST_TEMPLATE.md  CODEOWNERS  dependabot.yml
  apps/docs/                Astro Starlight site
  apps/telemetry/           the 80-line Cloudflare Worker that receives section 9's payload
  packages/
    core/  server/  web/  cli/  templates/
  biome.json  tsconfig.base.json  turbo.json  pnpm-workspace.yaml  package.json
  LICENSE  README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  ROADMAP.md  CHANGELOG.md
```

`turbo.json` tasks: `build` (`dependsOn: ["^build"]`, outputs `dist/**`), `typecheck`, `test` (`dependsOn: ["build"]`), `lint`, `e2e` (`cache: false`).

### Packages

| Package | npm name | Build | Purpose | Public exports |
|---|---|---|---|---|
| `packages/core` | `@staffroom/core` | tsup (ESM + `.d.ts`) | Agent runner, provider adapters, tool registry, brain index, MCP client, run log. Zero UI, zero HTTP, zero file watchers. Depends on `@anthropic-ai/sdk`, `openai`, `ollama`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `yaml`, `gray-matter`, `esbuild`, `picomatch`. | `createOffice()`, `Office`, `tool()`, `ToolRegistry`, `OfficeState`, `RunEvent`, `RunEventEnvelope`, `ProviderAdapter`, `SAFETY_RULE`, `redactSecrets()`, `loadRoster()`, `loadConfig()` |
| `packages/core/testing` | `@staffroom/core/testing` | same | `FixtureAdapter`, `recordFixture()`. Used by adapter tests, server tests, community adapters and demo mode. | |
| `packages/server` | `@staffroom/server` | tsup | HTTP + WebSocket, file watchers, scheduler. Serves the built `web` bundle. Protocol in `server-cli-runtime.md` §6. | `createServer(opts: ServerOptions): Promise<StaffroomServer>` |
| `packages/web` | `@staffroom/web` | Vite | React 19 + React Three Fiber + drei + Zustand. Talks to `server` over WS only. | `dist/` only |
| `packages/cli` | `staffroom` | tsup single-file, `#!/usr/bin/env node` | `npx staffroom`. Subcommands: `init`, `setup`, `start`, `demo`, `doctor`, `brain reindex\|import`, `tools new\|add`, `template list\|apply`, `migrate`, `export`, `version` (`server-cli-runtime.md` §8). | `bin` only |
| `packages/templates` | `@staffroom/templates` | copied as-is plus a 40-line `index.ts` | `studio/`, `agency/`, `ecommerce/`, `clinic/`, `consultant/`, and `tools/` (the five example tools). | `listTemplates()`, `copyTemplate(id, dest, opts)` |
| `apps/docs` | private | Astro | Docs site. | none |

`package.json` shape every published package copies: `"type": "module"`, `"license": "Apache-2.0"`, `"engines": { "node": ">=20" }`, `exports` with `types` and `import`, `"files": ["dist"]`, `"sideEffects": false`, `"publishConfig": { "access": "public", "provenance": true }`.

Dependency direction: `web -> (types only) core`, `server -> core`, `cli -> server, templates`, `templates -> nothing`. A `depcheck-cycles` script in `lint` fails on any cycle. A second `lint` script fails if `@anthropic-ai/claude-agent-sdk` appears in any `package.json` or lockfile.

## 2. TypeScript config

`tsconfig.base.json`: `target ES2022`, `module NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, `declaration`, `sourceMap`. `packages/web` adds `DOM` to `lib` and `jsx: "react-jsx"`. Nothing else may loosen a flag; Biome fails on `// @ts-ignore`.

## 3. Lint and format

One `biome.json`: 2-space indent, line width 100, `recommended` rules plus `noExplicitAny`, `noConsoleLog`, `noNonNullAssertion`, `useImportType`, `noUnusedImports`, `noUnusedVariables` as errors. `cli` overrides `noConsoleLog`. `lefthook` runs `biome check --staged` and `typecheck` on pre-commit and checks the DCO trailer on commit-msg. Extra `lint` scripts: changeset presence, fixture secret grep (`sk-`, `key-`, `Bearer`), route-test presence in `server`, dependency cycles, the forbidden-SDK check, and the `Run staffroom ` grep from `server-cli-runtime.md` §8.

## 4. Test strategy

### Vitest

- `packages/core`: `vitest run --coverage`, thresholds 80% lines, branches, functions, statements on `src/**` excluding `src/testing/**`. Includes the loop, prompt snapshot, redaction, registry (array and comma match cases, suspended fingerprint, local short-circuit), custom-tool loading from a temp office with no `node_modules`, and the brain index benchmark.
- `packages/server`: real in-process `createServer({ port: 0 })` with a WS client. Every route file has a matching `*.test.ts`. Required cases: WS upgrade from `Origin: https://evil.example` is 403; `hello` without a token closes 4401; `GET /api/brain/file?path=..%2F.env` is 404; boot expires pending approvals; restart resumes a `running` run.
- `packages/cli`: `execa` against the built binary in a temp dir. `init` writes an office at the given `--dir`; `doctor` with no keys prints the `NO_MODEL_CONFIGURED` hint verbatim from `core-agent-loop.md` (`Open Settings > Models in the office and paste a key, or run npx staffroom setup in Terminal.`); `demo` starts with no environment variables; the `Run staffroom ` grep across `packages/` finds nothing.
- `packages/web`: jsdom for the store, selectors, picking and cue generation only.
- `packages/templates`: one test loads every template through `loadRoster()` and `loadConfig()` and applies the section 11 rules. A broken template cannot ship.

SQLite in tests uses a temp file, never `:memory:`, because the run log relies on WAL mode and a second connection for replay.

### Provider adapters: fixtures plus an optional live matrix

Each adapter ships `fixtures/*.jsonl` in `packages/core/src/providers/<name>/`. A fixture's first line is `{ "provider", "model", "recordedAt", "request": { messages, tools, opts } }`; the rest are `CompletionChunk`s exactly as the adapter emitted them. The same file format is what demo mode plays from `packages/templates/studio/demo-runs/` (there the header carries `matches` instead of `request`).

```ts
// packages/core/src/testing/fixture-adapter.ts
export class FixtureAdapter implements ProviderAdapter { constructor(dir: string, opts?: { delayMs?: number }) }
export function recordFixture(adapter: ProviderAdapter, name: string): ProviderAdapter;
```

Seven required fixtures per adapter, named identically so `providers/conformance.test.ts` runs them all: `plain-text`, `single-tool-call`, `parallel-tool-calls`, `tool-result-roundtrip`, `streaming-mid-word`, `empty-response`, `provider-error-429`. Recording: `STAFFROOM_RECORD=1 pnpm --filter @staffroom/core test providers/anthropic`; keys are redacted by `recordFixture` before write.

Live matrix: `live-matrix.yml` nightly at 03:00 UTC and on dispatch, against Anthropic, OpenAI and an Ollama container pulling `llama3.2:1b`. A failure opens an issue labelled `provider-drift`. Never blocks a PR.

### End to end: one smoke test, one perf test

`packages/web/e2e/smoke.spec.ts`, Ubuntu, headless Chromium, against demo mode with `FixtureAdapter` and the `studio` template:

```ts
test("adds a task and sees a deliverable", async ({ page }) => {
  await page.goto(process.env.STAFFROOM_URL!);            // token-bearing URL printed by the webServer
  await page.getByRole("combobox", { name: "Department" }).selectOption("marketing");
  await page.getByRole("textbox", { name: "Task" }).fill("Write a two-line tagline for a bakery");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("agent-copywriter")).toHaveAttribute("data-state", "working", { timeout: 5_000 });
  await expect(page.getByTestId("deliverable-latest")).toContainText("bakery", { timeout: 20_000 });
  await expect(page.getByRole("listitem", { name: /Written by Priya/ })).toBeVisible();   // list-view twin
});
```

The hooks it uses are the contract in `office-ui.md` §5. `packages/web/e2e/office-perf.spec.ts` runs in a separate `perf` job on `macos-14` and asserts the four numbers in `office-ui.md` §3 (draw calls, triangles, p95 frame time 8 ms on Apple Silicon, first frame). `size-limit` runs in the `e2e` job.

## 5. CI

`ci.yml` on `pull_request` and `push` to `main`:

| Job | OS | Steps |
|---|---|---|
| `lint` | ubuntu | `biome ci .` plus the scripts in section 3 |
| `typecheck` | ubuntu | `turbo typecheck` |
| `test` | ubuntu, macos-14, windows-2022 | `turbo test`; coverage upload from ubuntu |
| `build` | ubuntu, macos-14, windows-2022 | `turbo build`, then `node packages/cli/dist/index.js init --template studio --dir tmp-office` and `doctor --json` |
| `e2e` | ubuntu | `smoke.spec.ts` plus `size-limit` |
| `perf` | macos-14 | `office-perf.spec.ts` |
| `install-timing` | macos-14 | `time npx ./packages/cli/staffroom-*.tgz demo --no-open`, fails over 60 s |

Node 20 and 22 on ubuntu; 22 on macOS and Windows. Branch protection: all seven jobs, one CODEOWNER review, DCO check, linear history. Dependabot auto-merges patch and minor bumps when green. Security: Dependabot weekly for npm and Actions, secret scanning with push protection, `npm audit --audit-level=high` in `lint`.

## 6. Release flow

`.changeset/config.json` with `fixed` locking all five packages, `changelog-github`, `access: public`. Every PR touching `packages/*` carries a changeset. `release.yml` opens a "Version Packages" PR; merging it publishes with `NPM_CONFIG_PROVENANCE=true` and `id-token: write` (npm trusted publishing, no long-lived token) and creates the GitHub release, which the maintainer edits within the hour to thank contributors by handle. Cadence: weekly, Tuesday.

Version policy before 1.0: `0.x.0` for any change to `ProviderAdapter`, `OfficeState`, `RunEvent`, `tool()` options, a non-additive `agents.yaml` or `config.yaml` change, or the WS protocol; `0.x.y` for everything else; `major` changesets rejected. `1.0.0` criteria: `ProviderAdapter` and `OfficeState` unchanged for two consecutive minors, Windows in the required matrix for 8 weeks without a skip, and the template rules in section 11 stable.

## 7. Repo hygiene files

### README.md

Under 900 words before the comparison table.

1. `# Staffroom` and the tagline.
2. Hero GIF (section 10).
3. First sentence verbatim: Apache-2.0. Free for commercial use. Every agent can run on a different model.
4. Two badges: npm version, CI.
5. Install, for someone who has never opened Terminal. Step 0: "Install Node from nodejs.org (press the green LTS button, open the download, click through). Then open Terminal (Cmd+Space, type Terminal) and paste: `npx staffroom`. The first time, Terminal asks `Ok to proceed?` Press y then Return." Then the three-line description of what happens, and: "Keep the Terminal window open. Closing it stops the office."
6. First five minutes: click Settings > Models and paste a key, rename an agent in its chat header, give a task, approve the deliverable card, look in `~/Staffroom/office/brain/`.
7. How it works: one diagram, 150 words, link to docs.
8. Per-agent models: the `agents.yaml` snippet from the plan.
9. Tools: one MCP example and one `office/tools/*.ts` example, both importing `@staffroom/core`.
10. Safety rules: the five rules from the plan as a bulleted list, with a link to `packages/core/src/prompt/safety-rule.ts` for the exact text agents receive, and one sentence that MCP tools can change under you and Staffroom suspends the whitelist when they do.
11. Comparison table against agents-office, AI-Employee, Dify, n8n, Flowise, AnythingLLM, LibreChat, Langflow: licence, commercial use, per-agent models, spatial office, MCP. Facts with a "last checked" date.
12. Roadmap, Contributing, Security links. 13. Licence line and trademark note.

### CONTRIBUTING.md

Ten-minute setup (`pnpm install`, `pnpm dev` against `office/` from the `studio` template, `pnpm test`); DCO in two sentences; the clean-room note verbatim: "Staffroom is a clean-room design. Do not read, copy, or port code, assets, prompts, or configuration from agents-office or any other non-permissive project in this space. If you have read that source, do not contribute to the same area of this repo. If you are unsure, ask in a Discussion before opening a PR. Pull requests that reference such code will be closed."; what a good PR looks like (changeset, tests, one concern, under 400 lines); adding a provider adapter (seven fixtures, 150-line rule); adding a template (section 11 rules, must pass the templates test); docs (every config key needs an example); labels; release cadence; code of conduct link.

### CODE_OF_CONDUCT.md

Contributor Covenant 2.1, enforcement contact `conduct@staffroom.so`.

### SECURITY.md

Supported: latest `0.x`. Report to `security@staffroom.so` or GitHub private reporting; acknowledgement in 48 hours, fix or plan in 14 days. Scope: `staffroom`, `@staffroom/*`; out of scope: third-party MCP servers, models, user-written tools. What counts as a vulnerability: a way for an agent to call a non-local `write` tool without approval, a network listener beyond localhost by default, a way to reach the WebSocket or a POST route from another origin or without the session token, a secret from `.env` or `config.yaml` appearing in `runs.sqlite`, a WS frame, a log or an export, a way to read a file outside `brain/` through the file routes, a fixture with a real key. No bounty; credit in the advisory.

### Issue templates, PR template, CODEOWNERS, ROADMAP.md

`bug.yml` asks for `npx staffroom doctor --bundle` output (secrets already replaced) and a checkbox "I checked the paste for keys". `feature.yml`, `provider-adapter.yml`, `template.yml`, `config.yml` (blank issues off) as before. PR template checklist: changeset, tests, docs if a config key changed, signed off, "I have not read agents-office source for this change". CODEOWNERS: `@amanchhabra` for everything at launch. ROADMAP.md: the plan's four headings with checkboxes, then "Not planned": multi-user or auth in the main package, visual workflow builder, custom layouts before v1.0, RAG beyond the markdown brain, any dependency on `@anthropic-ai/claude-agent-sdk`, telemetry on by default. `not planned` label policy: maintainer reply naming the ROADMAP line, closed within 72 hours, never applied to a bug.

## 8. Docs site

Astro Starlight at `staffroom.so/docs`. Structure:

```
index.mdx
start/          install.md (step 0 from the README, Docker, from source)  first-five-minutes.md  demo-mode.md
office/         agents-yaml.md  config-yaml.md  brain.md  approvals.md  routines.md  office-folder.md
tools/          mcp-servers.md  custom-tools.md ("Ask an AI to write it" block from tools-mcp-approvals.md §2)  built-ins.md
models/         providers.md  per-agent-models.md  cost.md
templates/      gallery.md  studio.md  agency.md  ecommerce.md  clinic.md  consultant.md
safety.md       the six rules from safety-rule.ts, what an approval shows, what MCP tools can and cannot do
reference/      cli.md  errors.md  office-state.md  ws-protocol.md  config-keys.md
contributing/   setup.md  adapters.md  templates.md  clean-room.md  releasing.md
```

`reference/office-state.md`, `reference/errors.md`, `reference/config-keys.md` and the two YAML pages are generated by `pnpm docs:gen` from the zod schemas, `RunErrorCode` and `userMessage`; CI fails if the committed output differs.

## 9. Telemetry policy

Off by default. Nothing leaves the machine unless `office/config.yaml` contains:

```yaml
telemetry:
  enabled: true                          # default false; absent means false
  endpoint: https://t.staffroom.so/v1    # overridable for self-hosters
```

`npx staffroom setup` asks once, default No. `npx staffroom demo` never sends anything. `STAFFROOM_TELEMETRY=0` forces off. The npm registry update check (`server-cli-runtime.md` §11) runs only when `telemetry.enabled` is true; `STAFFROOM_NO_UPDATE_CHECK=1` disables it regardless.

When enabled: one event per process start and one per completed run, batched, sent at most every 10 minutes, `POST` JSON, no cookies, user agent `staffroom/<version>`.

```ts
// packages/core/src/telemetry.ts
export interface TelemetryEvent {
  v: 1;
  installId: string;        // random UUID generated on opt-in, stored in office/.staffroom/telemetry-id, deletable
  event: "start" | "run_done";
  version: string; os: "darwin" | "linux" | "win32"; node: string;   // major only
  providers: string[];      // provider kinds configured, e.g. ["anthropic","ollama"]; never models
  agentCount: number;
  toolSources: { mcp: number; custom: number };
  runDurationMs?: number;   // run_done only, rounded to 100 ms
  runOutcome?: "done" | "failed" | "cancelled";
  approvalUsed?: boolean;
}
```

Never sent: task text, deliverable text, brain content, agent names, tool names, MCP server names, hostnames, keys, error messages. Adding a field requires a PR that edits this section and `office/config-yaml.md`. The receiving Worker lives in `apps/telemetry` and keeps daily counts only, no per-install rows past 30 days.

## 10. Launch checklist

### Hero GIF

`docs/hero.gif` (under 8 MB, 1200 by 675, 2x speed, 20 to 30 s) and `docs/hero.mp4`, recorded from the `studio` demo in light theme. Beats at 2x: 0 to 3 s idle office; 3 to 6 s pick Marketing, type "Write a two-line tagline for a bakery", Enter; 6 to 10 s Priya walks to Dana's desk and back, badge flips to working, her chat opens; 10 to 16 s `brain_search` flashes on the connector bar; 16 to 22 s the deliverable card slides in with the Approve button; 22 to 26 s click Approve, the note appears in "Latest results" as "Written by Priya, tools: brain_search"; 26 to 30 s pull back. Made by `scripts/hero-gif.sh` from Playwright video capture, `ffmpeg`, `gifski`.

### Show HN

Title: `Show HN: Staffroom – an open-source 3D office where AI agents do real work (Apache-2.0)`. Body under 350 words, first person: what I wanted; why the existing ones did not work (licence) and one sentence on clean-room; what it does at v0.2 (task bar, per-agent models with the Ollama bookkeeper, MCP plus one-file tools, approvals for anything outbound, brain as markdown); three honest rough edges; `npx staffroom`, no keys needed; ask people to try it with their own notes. Tuesday to Thursday, 8 to 9 am US Eastern, six hours in the thread, every technical answer links to a file in the repo.

### Channels

HN; X with the GIF; r/LocalLLaMA leading with the Ollama bookkeeper and the "local" pill; r/selfhosted leading with files-not-databases and no telemetry; r/SideProject; Product Hunt one week later; a "what I learned from 1,000 installs" post two weeks after HN. No paid promotion.

### First 60 days

Reply to every issue within 24 hours. Release weekly on Tuesday. Name the first three external contributors in release notes and README. Discussions on (Q&A, Ideas, Show your office, Announcements); no Discord until three people ask. ROADMAP updated every release. One full day off per week from day one. Day-60 retro decides on a second maintainer and v0.3 scope.

### Seeded good first issues (12)

1. Gemini adapter via `@google/genai`, seven fixtures, under 150 lines. `packages/core/src/providers/gemini/`.
2. Mistral adapter via `@mistralai/mistralai`. Same shape.
3. Bedrock adapter via `@aws-sdk/client-bedrock-runtime`. Same shape.
4. `photographer` template: marketing and ops, 12-note sample brain, passes section 11.
5. `bookkeeping-firm` template around the Ollama story: every agent local.
6. `npx staffroom doctor` prints the SQLite version and whether WAL is active. `packages/cli/src/commands/doctor.ts`.
7. Docs `tools/custom-tools.md`: a sixth example, CSV lookup over `office/data/*.csv` with `scope: "read"`.
8. A tool file without `scope` loads as `write` but the warning is only in the log; surface it as the Activity card from `tools-mcp-approvals.md` §2 (`office/tools/lookup-order.ts has no scope, so it will ask for approval every time. Add scope: "read" if it only looks things up.`). Keep treat-as-write. `packages/server/src/watch/tools.ts`, test in `packages/server`.
9. Connector bar: MCP logos fall back to a grey circle; add initials inside it. `packages/web/src/hud/TopBar.tsx`, jsdom test.
10. List view: sort agents by department then name, matching the pods. `packages/web/src/list/ListView.tsx`.
11. Duplicate agent `id` fails with a zod stack trace; give it the `AGENT_ID_DUPLICATE` message `Two agents share the id "copywriter" in office/agents.yaml. Ids must be unique.` `packages/core/src/config/agents.ts`.
12. Windows: `office/tools/*.ts` hot reload does not fire in some editors; confirm `usePolling` on `win32` and add the Vitest case that touches a file. `packages/server/src/watch/tools.ts`.

## 11. Templates

A template is a folder under `packages/templates/<id>/` containing `agents.yaml`, `config.yaml`, `brain/`, and optionally `routines.yaml`, `runs.sqlite` and `demo-runs/`. Rules, enforced by `packages/templates/templates.test.ts`:

- `agents.yaml` and `config.yaml` validate against `AgentsFileSchema` and `ConfigSchema` (`server-cli-runtime.md` §4 and §5) with no `ConfigError`.
- No `model:` lines on agents and `mcp.servers: {}`; the template must boot in live mode with only `default_model` set. Comments may show examples.
- No literal secrets anywhere (the fixture grep runs over templates too).
- Every note carries `sample: true` and `written_by: owner` or `agent:<id>` where `<id>` exists in `agents.yaml`; at least one `00-about/` note is `pinned: true`; the pinned set fits in 4,000 tokens; every `[[wiki-link]]` resolves; one `_private/` note exists.
- Every deliverable's `department` matches an agent's department id.
- `demo-runs/*.jsonl`, when present, only call tools that exist in the template (built-ins plus `packages/templates/tools/`).
- No `package.json`, `node_modules/` or `.staffroom/` inside the template.
- `id` matches `^[a-z][a-z0-9-]{1,23}$` and appears in `listTemplates()` with a label and one-line description; `studio` is first.

## Open questions

1. GitHub org name: `staffroom` is taken. Recommendation: create `staffroom-ai` this week and set it in `.changeset/config.json` and CODEOWNERS. Decide by 19 Sep 2026, maintainer.
2. Should the smoke test also run on macOS on PRs? Recommendation: no on PRs; yes in the nightly live-matrix workflow.
3. Coverage gate for `server` and `cli`: 80% or route-test presence only? Recommendation: presence only until v0.3, then 70%.
4. Telemetry endpoint hosting: the Worker in `apps/telemetry` or PostHog? Recommendation: the Worker, because the HN audience will read the code.
5. Biome versus ESLint for `web`, where React hooks rules are weaker in Biome. Recommendation: stay on Biome; revisit at v0.3 if hooks bugs appear in issues.
