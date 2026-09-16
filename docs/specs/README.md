# Staffroom specs

Six design documents for the v0.1 to v0.2 build, reconciled on 15 Sep 2026 against `docs/product-plan.html`. Each spec is self-contained; where an interface crosses a boundary it names the sibling file and section. When a type or name is defined in one spec, every other spec references it rather than restating it. The table below says which spec owns what.

## The specs

**`core-agent-loop.md`**: `packages/core/src/runtime/` and `providers/`. Defines the `ProviderAdapter` contract and the four adapters (Anthropic, OpenAI-compatible, Ollama, and `FixtureAdapter` for demo and tests), model resolution (`modelOverride` then `agent.model` then `default_model` then first provider, with local agents refusing overrides), the `Run` and `RunEvent` vocabulary that every other spec uses, the SQLite run log and `redactSecrets`, the turn loop and how it hands writes to the registry's approval gate, the six-section system prompt ending in `SAFETY_RULE`, routing through a lead, `revise:`, the `Office` interface, and the full error table with owner-facing hints.

**`tools-mcp-approvals.md`**: the one `ToolRegistry` and the `Tool` shape, including the `local` and `egress` flags. Covers custom tools in `office/tools/*.ts` (esbuild loading that resolves `@staffroom/core` from the server, the five shipped examples, the scaffold command and the copy-paste prompt for asking an AI to write one), the MCP client (boot-time connect, fingerprints, OAuth with PKCE, secrets under `.staffroom/secrets/`), the four built-ins, and approvals end to end: `ToolRegistry.invoke` as the single gate, the `ApprovalPreview` type, the whitelist file `office/approvals.yaml` with its match and fingerprint rules, expiry, and the six-rule `SAFETY_RULE` text.

**`server-cli-runtime.md`**: `packages/server` and `packages/cli`. Owns the boot sequence and restart semantics, the `office/` folder layout and its fixed home under `~/Staffroom/office`, the full `agents.yaml` and `config.yaml` examples and their strict zod schemas (`AgentsFileSchema`, `ConfigSchema`, `ConfigError`), the origin and session-token checks that keep other web pages off the WebSocket, the complete WebSocket protocol table (the only place message types are defined), routines and catch-up, every CLI command with its exact wording (`npx staffroom <sub>`), demo mode wiring, the Docker image, migrations, logging and the doctor table.

**`office-ui.md`**: `packages/web`. Owns `OfficeState` and every type inside it (the render contract), the table of which run event triggers which animation, the scene layout and mesh budget, the performance numbers, every HUD panel including Settings > Models (paste a key in the browser), the task bar, the per-agent chat with inline rename and the deliverable card, the three-button approval card, the brain graph overlay, the disconnected banner, the keyboard map, the list-view twin and its `data-testid` contract with the smoke test, demo-mode behaviour, the Zustand store, theming, and what is not customisable in v1.

**`brain.md`**: the markdown brain. Owns the folder layout (including `_private/` and `inbox/`), `NoteFrontMatter`, the note id and trust rules, the FTS5 index at `office/brain.index.sqlite`, search and optional embeddings, the two and only two context mechanisms (pinned set plus agent-initiated tools), the schemas and behaviour of `brain_search`, `brain_read` and `brain_write` (create-only drafts under `40-deliverables/`), revision chains, the `BrainGraph` contract with `readBy` joined from `tool_result.noteIds`, the Northlight Studio sample content, what happens to sample content when the office goes live, import, and what never leaves the machine.

**`repo-quality-launch.md`**: the monorepo, package names and public exports, TypeScript and Biome config, the test strategy (Vitest gates, adapter fixtures, the smoke test on Ubuntu and the perf test on Apple Silicon), CI job topology, Changesets release flow and the pre-1.0 version policy, every repo hygiene file with its required content, the docs site structure, the telemetry policy (the only list of what is sent), the template rules, the hero GIF and Show HN plan, and twelve seeded good first issues.

## Shared vocabulary

| Name | Kind | Owner |
|---|---|---|
| `RunEvent`, `RunEventEnvelope`, and every event name (`started`, `routed`, `chunk`, `tool_call`, `tool_result`, `tool_log`, `approval_needed`, `approval_resolved`, `brain_pinned_included`, `brain_pinned_truncated`, `brain_note_written`, `done`, `failed`) | type, events | `core-agent-loop.md` |
| `Run`, `RunKind`, `RunStatus`, `Deliverable`, `RunStore`, `runs.sqlite` schema | type | `core-agent-loop.md` |
| `ProviderAdapter`, `Message`, `ToolCall`, `ToolSpec`, `CompletionChunk`, `ModelId`, `ResolvedModel`, `resolveModel` | type | `core-agent-loop.md` |
| `FixtureAdapter` (`kind: "demo"`), `recordFixture`, fixture and demo-run `.jsonl` format | type, file format | `core-agent-loop.md` (format details also in `repo-quality-launch.md` §4) |
| `RunErrorCode`, `RunError`, `userMessage`, the error and hint table | type | `core-agent-loop.md` |
| `Runner` (`submitTask`, `chat`, `revise`, `cancel`, `resume`), `Office`, `createOffice` | API | `core-agent-loop.md` |
| `redactSecrets`, `configureRedaction` | API | `core-agent-loop.md` |
| `buildSystemPrompt` section order; `<note trust=...>` and `<tool_result trust="untrusted">` wrappers; `<owner_instructions>` | prompt | `core-agent-loop.md` |
| `runner.*` config keys (`max_turns`, `max_parallel_tools`, `tool_timeout_ms`, `tool_output_max_chars`, `max_output_tokens`, `egress_input_max_chars`, `retries`) | config | `core-agent-loop.md` (zod in `server-cli-runtime.md` §5) |
| `providers.<id>.features`, `providers.<id>.pricing` | config | `core-agent-loop.md` (zod in `server-cli-runtime.md` §5) |
| `Tool`, `ToolScope`, `ToolSource`, `ToolContext`, `tool()`, `local`, `egress` | type | `tools-mcp-approvals.md` |
| `ToolRegistry`, `RegisteredTool`, `ToolResult`, `ToolErrorCode`, `forAgent` rules, the `web` alias | type, rules | `tools-mcp-approvals.md` |
| `CustomToolLoader`, `office/.staffroom/cache/tools/` | API | `tools-mcp-approvals.md` |
| `McpManager`, `McpConnection`, `McpStatus`, `McpStdioServer`, `McpHttpServer`, `McpConfig` | type | `tools-mcp-approvals.md` |
| `ApprovalPreview`, `ApprovalDecision`, `ApprovalBy` | type | `tools-mcp-approvals.md` |
| `office/approvals.yaml` (whitelist rows, `match`, `fingerprint`, `suspended`), `Whitelist.reload` | file | `tools-mcp-approvals.md` |
| `SAFETY_RULE` text, `packages/core/src/prompt/safety-rule.ts` | constant | `tools-mcp-approvals.md` §6 |
| `mcp.*`, `tools.*`, `approvals.expiry_hours`, `approvals.whitelist_days` config keys | config | `tools-mcp-approvals.md` §7 (zod in `server-cli-runtime.md` §5) |
| `web_search` schema and backend | tool | `tools-mcp-approvals.md` §4 |
| `brain_search`, `brain_read`, `brain_write` schemas and behaviour; `brainWriteDeliverable`, `brainSearch`, `BrainSearchOptions`, `BrainSearchHit` | tool, API | `brain.md` |
| `NoteFrontMatter` (including `department: string`, `private`, `sample`), note id rule, trust rule, folder layout | type, rules | `brain.md` |
| `BrainGraph`, `BrainGraphNode`, `BrainGraphEdge`, `readBy` join | type | `brain.md` |
| `BrainIndex` (`open`, `reindexFile`, `removeFile`), `office/brain.index.sqlite` | API, file | `brain.md` |
| `brain.*` config keys (`path`, `ignore`, `pinned_token_budget`, `embeddings.*`) | config | `brain.md` (zod in `server-cli-runtime.md` §5) |
| Northlight Studio sample content, "Leaving demo mode" behaviour | content, behaviour | `brain.md` |
| `ClientMessage` and `ServerMessage` unions (every WebSocket type: `hello`, `task.create`, `task.cancel`, `chat.send`, `approval.decide`, `agent.rename`, `provider.set_key`, `routine.*`, `brain.search`, `brain.graph.get`, `runs.replay`, `mcp.reconnect`, `mcp.oauth.begin`, `tools.assign`, `demo.speed`, `office.reload`, `ping`; `welcome`, `ack`, `error`, `state`, `event`, `replay`, `config.error`, `config.reloaded`, `tools.reloaded`, `mcp.status`, `mcp.tools_changed`, `mcp.oauth.url`, `brain.results`, `brain.graph`, `brain.note.indexed`, `brain.note.removed`, `brain.warning`, `pong`) | protocol | `server-cli-runtime.md` §6 |
| HTTP routes, origin check, session token, `Host` allow-list, path canonicalisation | protocol | `server-cli-runtime.md` §6 |
| `AgentSchema`, `AgentsFileSchema`, `DepartmentId` regex, department and seat limits, `agents.yaml` keys (`office.name`, `office.timezone`, `default_model`, `departments`, `agents[].instructions`) | schema | `server-cli-runtime.md` §4 |
| `ConfigSchema`, `ProviderSchema`, `McpStdioSchema`, `McpHttpSchema`, `EnvString`, `SECRET_LITERAL_IN_CONFIG`, `UNKNOWN_KEY` | schema | `server-cli-runtime.md` §5 |
| `ConfigError` and its codes | type | `server-cli-runtime.md` §4 |
| `ServerOptions`, `StaffroomServer`, `createServer` | API | `server-cli-runtime.md` §1 |
| Boot steps, restart and shutdown semantics, file watchers (`packages/server/src/watch/`) | behaviour | `server-cli-runtime.md` §2 |
| `office/` layout, `~/Staffroom/office`, `~/.staffroom/current-office`, `.staffroom/` contents | files | `server-cli-runtime.md` §3 and §8 |
| `RoutineSchema`, `office/routines.yaml`, catch-up rules | schema | `server-cli-runtime.md` §7 |
| CLI commands and every printed string (`npx staffroom <sub>` rule) | CLI | `server-cli-runtime.md` §8 |
| Demo mode wiring, `STAFFROOM_DEMO`, demo strip text | behaviour | `server-cli-runtime.md` §9 |
| Doctor check ids | CLI | `server-cli-runtime.md` §13 |
| `OfficeState`, `Agent` (`modelSource`, `modelStatus`, `local`), `Department`, `Connector` (`health` values), `ActiveRun`, `PendingApproval`, `Routine`, `DeliverableSummary` | type | `office-ui.md` §1 |
| Run event to animation table, `AnimationCue` | behaviour | `office-ui.md` §1 and §7 |
| Performance budget numbers, `window.__staffroom` | numbers | `office-ui.md` §3 |
| Approval card labels (`Approve once`, `Approve and always allow (90 days)`, `Deny`), banner texts, Settings > Models, disconnected banner text, keyboard map | UI text | `office-ui.md` §4 |
| `data-testid` and role contract for the smoke test | test contract | `office-ui.md` §5 |
| Package names, `@staffroom/core` exports, `@staffroom/core/testing` | packaging | `repo-quality-launch.md` §1 |
| CI jobs and which runner runs which test | CI | `repo-quality-launch.md` §5 |
| `TelemetryEvent`, `telemetry.enabled`, `telemetry.endpoint`, `office/.staffroom/telemetry-id`, update-check rule | policy | `repo-quality-launch.md` §9 |
| Template ids (`studio`, `agency`, `ecommerce`, `clinic`, `consultant`) and template rules | rules | `repo-quality-launch.md` §11 |
| Hero GIF beats, README order, SECURITY.md vulnerability list, seeded issues | launch | `repo-quality-launch.md` §7 and §10 |

## Findings deliberately not applied, or applied differently

1. **"Runs shipped with the studio carry `kind: demo`" (brain.md, sample content finding).** Not applied as written. `RunKind` is used by `lastDeliverable`, chat history rebuilding and routing, and a fifth kind would leak into all of them. Instead `Run` gained a `sample: boolean` column (`core-agent-loop.md`), templates ship their run with `sample: true`, and "Leaving demo mode" deletes runs where `sample` is true. Same effect, one flag instead of a kind.

2. **"Drop `modelOverride` from v1 (recommended)" (office-ui.md).** The finding offered two options; the constrained option was taken rather than dropping the field, because the task bar's override is the cheapest way for an owner to try a second model without editing YAML. The server refuses it for any agent whose own model is local (`MODEL_OVERRIDE_LEAVES_MACHINE`), which closes the privacy hole the finding was about.

3. **"`brain_write` auto-resolves with both approval events" versus "the registry short-circuits the gate when `tool.local === true`" (two findings on tools-mcp-approvals.md).** Both were applied together: `local: true` is the flag, and the registry still appends the `approval_needed` / `approval_resolved { by: "system" }` pair back to back so the audit trail has one shape. The pending-approval set never sees them because both events land in the same append.

4. **Department id regex: `{1,23}` in one finding, `{1,19}` in another (server-cli-runtime.md).** `{1,23}` was chosen, matching the agent id style; the shorter limit had no stated reason.

5. **"Add `tool.error` to core's union" was not done; the finding said drop it, and it was dropped.** Listed here because tools-mcp-approvals.md's old wire section referenced it and `office-ui.md`'s old event table implied it. Errors are `tool_result.isError` only.

6. **`approvals.default: never_send` (server-cli-runtime.md).** Deleted rather than defined, as the finding recommended; no spec had a use for it and the routine-level `approval_before_send` covers the "always ask" case.

7. **The demo-runs and fixture file format.** The server spec said `.json` with a `matches` array; the office-ui finding said `.jsonl`. Both are now `.jsonl` with a JSON header line (`matches` for demo runs, `request` for adapter fixtures) followed by `CompletionChunk`s, so `FixtureAdapter` is the single reader. This goes slightly beyond the finding by making the two formats the same file shape.

8. **Word count.** Two specs (`core-agent-loop.md`, `server-cli-runtime.md`) are over the 3,500-word target after applying the findings, because the findings added the protocol table, the security section, the error table and the redaction rules to them. Splitting either would have created exactly the cross-file drift the findings were about, so they were left long.
