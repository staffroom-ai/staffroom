# Server, CLI and runtime lifecycle

Status: draft 2, 15 Sep 2026 (reconciled). Owner: server maintainer.

Covers `packages/server`, `packages/cli`, and how a Staffroom process starts, runs, sleeps and upgrades. Sibling specs: `core-agent-loop.md` (the run loop, `RunEvent`, `Office`), `tools-mcp-approvals.md` (ToolRegistry, MCP client, custom tools, approvals), `brain.md` (markdown brain, index, note front-matter) and `office-ui.md` (`OfficeState` and rendering). Where a type is owned by a sibling it is named here but not redefined.

This spec owns: the WebSocket protocol (§6, the only place message types are defined), `ConfigSchema` for `config.yaml` (§5), `AgentsFileSchema` for `agents.yaml` (§4), `ConfigError`, the `office/` layout, routines, demo mode wiring, the CLI, doctor, and file watching.

## Decisions

- One long-lived Node process per office. `packages/server` owns HTTP, WebSocket, the scheduler and every file watcher. `packages/core` owns everything else, never imports `node:http`, and never watches files.
- Bind to `127.0.0.1:4242` by default. Any other interface needs `--host` and prints a warning every start.
- No user accounts in v1, but not no protection: every WebSocket and every non-GET request must carry the server's own `Origin` and a per-boot session token, because loopback binding is not a boundary against the owner's own browser.
- The browser talks to the server over one WebSocket. HTTP exists for static files, health, upload, download and the OAuth callback.
- The WebSocket carries `RunEventEnvelope`s from the append-only log and full `OfficeState` snapshots. No JSON patch. The client never computes state from events.
- `default_model` and `office.name` live in `office/agents.yaml`. `config.yaml` is providers, tools, MCP, runner, brain, approvals, telemetry, server. Both schemas are `.strict()`, so a key in the wrong file is an error, not silence.
- Departments are free ids, at most six distinct, pods assigned by first appearance. The template ships the six the plan names.
- Runs in `running` or `waiting_approval` are resumed at boot through `runner.resume`. Pending approvals do not survive a restart; they are expired and re-asked.
- Demo mode is a full office with `FixtureAdapter` as the provider, not a stubbed UI. Every code path that runs in real mode runs in demo mode.
- The office folder has a fixed home, `~/Staffroom/office`, and its location is printed on every start.
- Every user-facing message that names a command says `npx staffroom <sub>` verbatim.
- Config carries a `version` integer. Migrations are forward-only, idempotent, and always leave a `.bak` file.

## 1. Packages and boundaries

```
packages/server/src/
  index.ts          createServer(opts): Promise<StaffroomServer>
  auth.ts           origin check, session token
  http/             one file per route: health.ts, static.ts, upload.ts, export.ts, brain-file.ts, oauth-callback.ts
  ws/               socket.ts (connection), protocol.ts (message types), state.ts (builds OfficeState), replay.ts
  scheduler/        routines.ts, catchup.ts
  watch/            agents.ts, config.ts, env.ts, tools.ts, brain.ts, approvals.ts (chokidar; call core's imperative methods)
  demo/             demo.ts (wires FixtureAdapter to templates/studio/demo-runs)
  migrate/          v1-to-v2.ts ... , index.ts
packages/cli/src/
  index.ts          bin entry, command router (commander)
  commands/         init.ts, setup.ts, start.ts, demo.ts, doctor.ts, brain.ts, tools.ts, template.ts, migrate.ts, export.ts
  office-dir.ts, node-check.ts, open-browser.ts
```

`packages/cli` depends on `packages/server`; `packages/server` on `packages/core`. `packages/web` is built with Vite and copied into `packages/server/dist/public` at build time.

```ts
// packages/server/src/index.ts
export interface ServerOptions {
  officeDir: string; host?: string; port?: number; demo?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error"; open?: boolean; watch?: boolean;
}
export interface StaffroomServer {
  url: string;                  // "http://127.0.0.1:4242/?t=<token>"
  office: Office;               // core-agent-loop.md
  close(reason?: string): Promise<void>;
}
export function createServer(opts: ServerOptions): Promise<StaffroomServer>;
```

## 2. Runtime lifecycle

Boot order, each step logged at `info` with a fixed prefix so `doctor` and bug reports line up:

1. `boot.node` Check `process.versions.node >= 20.0.0`. Fail: `Staffroom needs Node 22 or newer. You have 18.19.0. Install from https://nodejs.org and run npx staffroom again.`
2. `boot.office` Resolve `officeDir` (§8). Print `Office folder: /Users/aman/Staffroom/office`.
3. `boot.migrate` Read `config.yaml`, `agents.yaml`, `routines.yaml`; compare `version`; run migrations (§11).
4. `boot.config` Parse and validate with zod. Collect every `ConfigError`, print all, exit 1. Never fix files silently. `office/.env` is loaded here.
5. `boot.runs` Open `runs.sqlite` (better-sqlite3, WAL). Resolve every pending approval as `expired`, `by: system`, `note: server_restart`.
6. `boot.brain` Open or create `office/brain.index.sqlite`, incremental reindex (`brain.md`).
7. `boot.providers` Instantiate every provider whose key resolves. If none resolve, enter demo mode (§9). Compute `modelStatus` for every agent.
8. `boot.tools` Build the ToolRegistry: built-ins, then `CustomToolLoader.loadAll`, then `McpManager.start()` (connects in parallel, never blocks, `tools-mcp-approvals.md` §3).
9. `boot.resume` Call `runner.resume(runId)` for every run in `running` or `waiting_approval`. A run that cannot resume (provider gone) ends through the normal `failed` event.
10. `boot.watch` Start chokidar on `agents.yaml`, `config.yaml`, `.env`, `approvals.yaml`, `tools/`, `brain/` (skipped with `--no-watch`). Each watcher calls the matching core method: `Roster.reload`, `McpManager.applyConfig`, provider re-instantiation, `Whitelist.reload`, `CustomToolLoader.load/unload`, `BrainIndex.reindexFile/removeFile`. On `win32` chokidar uses `usePolling`.
11. `boot.scheduler` Load routines, run catch-up (§7), start the tick loop.
12. `boot.listen` Bind. If `port` was defaulted and taken, try 4243 through 4252, then fail `Port 4242 to 4252 are all in use. Pass --port.`
13. `boot.ready` Print the banner (§8). Open the browser if asked.

Shutdown on SIGINT or SIGTERM: stop accepting connections, ask the scheduler to finish its tick, abort in-flight adapter streams (their partial `chunk`s stay in the log with their attempt number), append nothing, close MCP clients, close SQLite. Resume on next boot re-issues the last incomplete turn. A second SIGINT exits immediately.

Sleep and wake: the scheduler compares wall clock to its last tick; a gap over 90 seconds triggers catch-up.

## 3. On-disk layout of office/

```
office/
  agents.yaml          the roster, default_model, office name and timezone
  config.yaml          providers, MCP servers, tools, runner, brain, approvals, telemetry, server
  approvals.yaml       whitelist rows written by "Approve and always allow"; owner-editable
  routines.yaml        optional, created on first routine
  .env                 API keys and tokens, NAME=value, hidden file
  .npmrc               ignore-scripts=true (shipped)
  brain/               markdown notes (layout in brain.md)
    00-about/  10-customers/  20-products/  30-processes/  40-deliverables/  50-meetings/  90-archive/  _private/  _attachments/
  brain.index.sqlite   FTS5 cache, outside brain/, safe to delete
  tools/               custom tools, one .ts per tool
  data/                CSV and other files local tools write to
  runs.sqlite          append-only event log
  .staffroom/          state that is not config
    secrets/mcp-<name>.json   OAuth tokens, 0600
    telemetry-id
    scheduler.json
    cache/tools/*.mjs
    logs/staffroom.log
    backups/config.yaml.v1.bak
  .gitignore           shipped: .env, runs.sqlite, brain.index.sqlite, .staffroom/, node_modules/
```

`agents.yaml`, `config.yaml`, `approvals.yaml`, `routines.yaml`, `brain/`, `tools/` and `data/` are the owner's. `npx staffroom export` includes those and `runs.sqlite` as JSON; it never includes `.env` or `.staffroom/secrets/`, and every `api_key`, `token`, `env` and `args` value in the exported config is replaced with `$NAME` or `<redacted>`, unconditionally.

### Full example: agents.yaml

```yaml
# office/agents.yaml
version: 1
office:
  name: Northlight Studio
  timezone: Australia/Melbourne

default_model: anthropic/claude-sonnet-5   # written by npx staffroom setup

departments:                               # optional display names; ids come from the agents
  marketing: Marketing
  sales: Sales
  finance: Finance
  ops: Operations
  product: Product
  support: Support

agents:
  - id: marketing-lead
    department: marketing
    name: Dana
    role: Marketing lead
    does: Takes a marketing task and picks who on the team does it.
    lead: true

  - id: copywriter
    department: marketing
    name: Priya
    role: Copywriter
    does: Turns briefs into landing page copy and email sequences.
    tools: [web]                         # brain tools are always available

  - id: bookkeeper
    department: finance
    name: Sam
    role: Bookkeeper
    does: Categorises transactions and drafts the monthly summary.
    # model: ollama/llama4               # keep this agent local

  - id: researcher
    department: sales
    name: Lee
    role: Lead researcher
    does: Builds shortlists of prospects from a one-line description.
    tools: [web, lookup_order]
```

Templates ship no `model:` lines and no MCP servers, so a fresh office runs entirely on `default_model` and the shipped custom examples. The Notion and Gmail examples live in comments in `config.yaml` and in `docs/tools/mcp-servers.md`.

### Full example: config.yaml

```yaml
# office/config.yaml
version: 1

providers:
  anthropic:
    api_key: $ANTHROPIC_API_KEY
  openai:
    api_key: $OPENAI_API_KEY
  ollama:
    base_url: http://127.0.0.1:11434

mcp:
  servers: {}
  # notion:
  #   command: npx
  #   args: ["-y", "@notionhq/notion-mcp-server"]
  #   env: { NOTION_TOKEN: $NOTION_TOKEN }
  # gmail:
  #   url: https://mcp.example.com/gmail
  #   auth: oauth
  deny: []
  departments: {}

tools:
  web:
    provider: none                       # brave | tavily | searxng | none
    api_key: $BRAVE_API_KEY
    max_results: 8
  custom_dir: tools
  hot_reload: true

runner: {}                               # defaults in core-agent-loop.md
brain: {}                                # defaults in brain.md

approvals:
  expiry_hours: 24
  whitelist_days: 90

telemetry:
  enabled: false                         # opt-in; what is sent is listed in repo-quality-launch.md §9

server:
  port: 4242
  log_level: info
```

`$NAME` in a string resolves from the environment and `office/.env` at boot. An unresolved `$NAME` under `providers` skips that provider with a `warn` line; under `mcp.servers.<name>` it marks that server `unavailable` with a connector message (`tools-mcp-approvals.md` §3); anywhere else it is `ENV_VAR_UNRESOLVED`.

Literal secrets are refused: for `api_key`, `token`, `bearer` and every `mcp.servers.*.env` and `args` value, a string that is not a `$NAME` reference and is longer than 12 characters fails with `SECRET_LITERAL_IN_CONFIG`: `config.yaml contains what looks like a key. Move it to office/.env as ANTHROPIC_API_KEY=... and write $ANTHROPIC_API_KEY here.` `npx staffroom doctor --fix` does the move.

## 4. agents.yaml schema and validation

```ts
// packages/core/src/config/agents.ts
export const DepartmentId = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);

export const AgentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  department: DepartmentId,
  name: z.string().min(1).max(40).optional(),       // unnamed agents are named by the lead on first routing
  role: z.string().min(1).max(60),
  does: z.string().min(10).max(400),
  model: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/).optional(),
  tools: z.array(z.string()).default([]),
  lead: z.boolean().default(false),
  instructions: z.string().max(4000).optional(),   // <owner_instructions> block, core-agent-loop.md prompt section 2
}).strict();

export const AgentsFileSchema = z.object({
  version: z.literal(1),
  office: z.object({ name: z.string().min(1).max(60), timezone: z.string().refine(isIanaTimezone) }),
  default_model: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/).optional(),
  departments: z.record(DepartmentId, z.string().min(1).max(40)).default({}),
  agents: z.array(AgentSchema).min(1).max(35),
}).strict();
```

Rules zod cannot express, checked in `validateAgents(file, registry, mcpConfig, providers)`:

- `id` unique.
- Zero or one `lead: true` per department. Zero means the first agent listed is the lead.
- At most six distinct department ids (`AGENT_DEPARTMENT_LIMIT`). Pod order is first appearance. At most six agents per department, and at most five in the department that lands in pod 5 (`AGENT_SEAT_LIMIT`: `Department support has 6 agents but sits in the pod with the reception desk, which holds 5 in v1.`).
- `model` provider prefix must match a configured provider, unless the office is in demo mode.
- Every `tools` entry must be a registered tool name, the alias `web`, or the name of a configured MCP server (connected or not). Anything else is `AGENT_TOOL_UNKNOWN`. A denied server is `AGENT_TOOL_DENIED`; a department not in `mcp.departments[server]` is `AGENT_TOOL_WRONG_DEPARTMENT`.

```ts
export interface ConfigError {
  code: "AGENT_ID_DUPLICATE" | "AGENT_ID_INVALID" | "AGENT_DEPARTMENT_LIMIT" | "AGENT_SEAT_LIMIT"
      | "AGENT_MODEL_PROVIDER_MISSING" | "AGENT_TOOL_UNKNOWN" | "AGENT_TOOL_DENIED" | "AGENT_TOOL_WRONG_DEPARTMENT"
      | "AGENT_LEAD_DUPLICATE" | "AGENT_FIELD_MISSING" | "OFFICE_TIMEZONE_INVALID" | "CONFIG_VERSION_UNKNOWN"
      | "ENV_VAR_UNRESOLVED" | "SECRET_LITERAL_IN_CONFIG" | "UNKNOWN_KEY" | "PROVIDER_KIND_UNKNOWN"
      | "MCP_SERVER_INVALID" | "YAML_PARSE";
  file: "agents.yaml" | "config.yaml" | "routines.yaml" | "approvals.yaml";
  path: string; line?: number; message: string; hint?: string;
}
```

Printed:

```
office/config.yaml:3  default_model
  UNKNOWN_KEY: default_model is not a setting in this file.
  Hint: put it in office/agents.yaml as a top-level key.

office/agents.yaml:31  agents[3].tools[1]
  AGENT_TOOL_UNKNOWN: no tool called "lookup_orders". Did you mean "lookup_order"?
  Hint: check the name in office/tools/ or config.yaml mcp.servers.
```

On a hot-reload edit the same errors are pushed as `config.error` and the previous good roster stays live.

## 5. config.yaml schema

`ConfigSchema` is the single schema. The `runner:` block's keys are listed in `core-agent-loop.md`, `brain:` in `brain.md`, and `mcp:`, `tools:`, `approvals:` in `tools-mcp-approvals.md` §7; this file holds the zod and those files hold the meaning.

```ts
const EnvString = z.string().refine(notLiteralSecret, { message: "SECRET_LITERAL_IN_CONFIG" });

export const ProviderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anthropic"), api_key: EnvString, base_url: z.string().url().optional(), features: Features, pricing: Pricing }),
  z.object({ kind: z.literal("openai"),    api_key: EnvString, base_url: z.string().url().optional(), features: Features, pricing: Pricing }),
  z.object({ kind: z.literal("ollama"),    base_url: z.string().url().default("http://127.0.0.1:11434"), pricing: Pricing }),
]);
// kind defaults to the map key when the key is anthropic | openai | ollama; otherwise required.
// Features = { parallel_tool_calls?, stream_usage? }; Pricing = record of { input_per_1k, output_per_1k, cached_input_per_1k? }.

export const McpStdioSchema = z.object({ command: z.string(), args: z.array(EnvString).default([]), env: z.record(EnvString).default({}),
  cwd: z.string().optional(), timeout_ms: z.number().int().default(60000), force_write: z.boolean().default(false) }).strict();
export const McpHttpSchema = z.object({ url: z.string().url(),
  auth: z.union([z.literal("none"), z.literal("oauth"), z.object({ bearer: EnvString })]).default("none"),
  oauth: z.object({ client_id: EnvString.optional(), client_secret: EnvString.optional(), scopes: z.array(z.string()).optional() }).optional(),
  headers: z.record(EnvString).default({}), timeout_ms: z.number().int().default(60000), force_write: z.boolean().default(false) }).strict();

export const ConfigSchema = z.object({
  version: z.literal(1),
  providers: z.record(ProviderSchema).default({}),
  mcp: z.object({
    servers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.union([McpStdioSchema, McpHttpSchema])).default({}),
    deny: z.array(z.string()).default([]),
    departments: z.record(z.array(DepartmentId)).default({}),
    discovery_ttl_s: z.number().int().min(30).default(300),
  }).strict().default({}),
  tools: z.object({
    web: z.object({ provider: z.enum(["brave", "tavily", "searxng", "none"]).default("none"), api_key: EnvString.optional(),
                    base_url: z.string().url().optional(), max_results: z.number().int().min(1).max(20).default(8) }).strict().default({}),
    custom_dir: z.string().default("tools"),
    hot_reload: z.boolean().default(true),
  }).strict().default({}),
  runner: RunnerConfigSchema.default({}),           // core-agent-loop.md
  brain: BrainConfigSchema.default({}),             // brain.md
  approvals: z.object({ expiry_hours: z.number().int().min(1).default(24), whitelist_days: z.number().int().min(1).default(90) }).strict().default({}),
  telemetry: z.object({ enabled: z.boolean().default(false), endpoint: z.string().url().default("https://t.staffroom.so/v1") }).strict().default({}),
  server: z.object({ port: z.number().int().min(1).max(65535).default(4242), log_level: LogLevel.default("info") }).strict().default({}),
}).strict();
```

`.strict()` on every object turns an unknown key into `UNKNOWN_KEY` with a hint naming the right file when the key is known elsewhere (`default_model`, `name`, `timezone` point at `agents.yaml`).

`tools.web.provider: none` registers `web_search` but it returns `{ error: "web search is not configured" }`. We do not scrape search engines. Telemetry content is defined in `repo-quality-launch.md` §9 and nowhere else.

## 6. HTTP and WebSocket protocol

### Reaching the server

Loopback binding does not stop a web page the owner has open from connecting to `ws://127.0.0.1:4242/ws`. So, in `auth.ts`:

1. On every WS upgrade and every non-GET request, the `Origin` header must exactly equal the server's own origin (scheme, the host the page was served from, port). Missing or mismatched: 403, logged at `warn` under scope `ws`.
2. A random 32-byte session token is generated at boot, embedded in the served `index.html` as `<meta name="staffroom-token">`, and required in the `hello` message (`token`) and as `X-Staffroom-Token` on every POST. A `hello` without a valid token is closed with code 4401. The web stores it in `sessionStorage`.
3. The `Host` header must be `localhost`, `127.0.0.1`, `[::1]`, or, when `--host` was passed, the bound host, each with the bound port. Anything else: 403. This stays on with `--host`.
4. The banner prints the token-bearing URL, `http://127.0.0.1:4242/?t=<token>`, so `--open` and the printed link both work.

Tests in `packages/server`: a WS upgrade with `Origin: https://evil.example` gets 403; a `hello` without a token gets close 4401; `GET /api/brain/file?path=..%2F.env` gets 404.

### HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/` and `/assets/*` | the built web app |
| GET | `/api/health` | `{ ok, version, mode: "live" \| "demo", office, uptimeSec }` |
| GET | `/api/brain/file?path=10-customers/acme-pty-ltd.md` | raw markdown for the note viewer |
| POST | `/api/brain/upload` | multipart, drops `.md`, `.txt`, `.pdf` into `brain/inbox/` (notes there are `trust="imported"`) |
| GET | `/api/runs/:id/export` | the run as JSON events, or `?format=md` |
| GET | `/api/deliverables/:noteId/download` | the note as a file |
| GET | `/api/mcp/oauth/callback` | OAuth redirect target, PKCE and `state` checked (`tools-mcp-approvals.md` §3) |
| GET | `/ws` | the WebSocket upgrade |

`path` and `noteId` are resolved with `path.resolve(brainDir, value)`; the result must start with `brainDir + sep`, must contain no `..` segment, leading slash or null byte, and must end in `.md`, `.txt`, `.png`, `.jpg` or `.pdf`. Anything else is 404. No CORS headers are set.

### No user accounts in v1

Anyone with the token and same-origin access, which in practice means the owner's browser, can read the brain and approve actions. With `--host` the token is the only thing between the LAN and the office, and the warning says so: `Staffroom has no user accounts. Anyone who can reach 0.0.0.0:4242 and sees this link can read your notes and approve actions. Put it behind a VPN or a reverse proxy with auth.` A remote-office package with real auth is v1.0 scope.

### WebSocket

One connection per tab. JSON text frames with a `type`; client messages carry a `reqId` the server echoes on the `ack` or `error`; server pushes carry a monotonic `seq`.

```ts
// packages/server/src/ws/protocol.ts
export type ClientMessage =
  | { type: "hello"; reqId: string; protocol: 1; token: string; resumeFrom?: number }
  | { type: "task.create"; reqId: string; department: string; text: string; agentId?: string; modelOverride?: string; schedule?: ScheduleSpec }
  | { type: "task.cancel"; reqId: string; runId: string }
  | { type: "chat.send"; reqId: string; agentId: string; text: string; modelOverride?: string }  // server strips a leading "revise:" and calls runner.revise; anything else calls runner.chat
  | { type: "approval.decide"; reqId: string; approvalId: string; decision: "approve" | "approve_always" | "deny"; note?: string; match?: Record<string, string> }
  | { type: "agent.rename"; reqId: string; agentId: string; name: string }        // Roster.setName, replies config.reloaded
  | { type: "provider.set_key"; reqId: string; provider: string; key: string }    // never echoed, never logged; see §9
  | { type: "routine.upsert"; reqId: string; routine: RoutineInput }
  | { type: "routine.delete"; reqId: string; routineId: string }
  | { type: "routine.run_now"; reqId: string; routineId: string }
  | { type: "brain.search"; reqId: string; query: string; limit?: number }
  | { type: "brain.graph.get"; reqId: string; includeReads?: boolean }
  | { type: "runs.replay"; reqId: string; runId: string }
  | { type: "mcp.reconnect"; reqId: string; server: string }
  | { type: "mcp.oauth.begin"; reqId: string; server: string }
  | { type: "tools.assign"; reqId: string; name: string; agentIds: string[] }    // Roster.addTool per id; acks with { name, assigned, failed? } then pushes config.reloaded { file: "agents.yaml" }
  | { type: "demo.speed"; reqId: string; factor: 1 | 2 | 4 }
  | { type: "office.reload"; reqId: string }
  | { type: "ping"; reqId: string };

export type ServerMessage =
  | { type: "welcome"; reqId: string; seq: number; protocol: 1; version: string; mode: "live" | "demo"; resumed: boolean; state: OfficeState }
  | { type: "ack"; reqId: string; seq: number; ok: true; result?: unknown }              // task.create result: { runId, routeRunId }
  | { type: "error"; reqId?: string; seq: number; code: RunErrorCode | ConfigError["code"]; message: string; hint: string }
  | { type: "state"; seq: number; state: OfficeState }                                    // full snapshot, coalesced at 250 ms
  | { type: "event"; seq: number; event: RunEventEnvelope }                               // forwarded unchanged from core
  | { type: "replay"; reqId: string; seq: number; runId: string; events: RunEventEnvelope[]; done: boolean }
  | { type: "config.error"; seq: number; errors: ConfigError[] }
  | { type: "config.reloaded"; seq: number; file: "agents.yaml" | "config.yaml" | "routines.yaml" | "approvals.yaml" | ".env" }
  | { type: "tools.reloaded"; seq: number; file: string; name?: string; ok: boolean; message?: string; line?: number; tools?: string[]; warning?: "no_scope"; unassigned?: boolean; agents?: { id: string; name: string }[] }  // one message, three cards: it would not load, it has no scope, nobody may use it. A file can be more than one at once.
  | { type: "mcp.status"; seq: number; connection: McpConnection }
  | { type: "mcp.tools_changed"; seq: number; server: string; added: string[]; removed: string[]; changed: string[] }
  | { type: "mcp.oauth.url"; reqId: string; seq: number; server: string; authorizeUrl: string }
  | { type: "brain.results"; reqId: string; seq: number; hits: BrainSearchHit[] }
  | { type: "brain.graph"; reqId: string; seq: number; graph: BrainGraph }
  | { type: "brain.note.indexed"; seq: number; node: BrainGraphNode; edges: BrainGraphEdge[] }
  | { type: "brain.note.removed"; seq: number; noteId: string; nowMissing?: BrainGraphNode; edges: BrainGraphEdge[] }   // edges that now point at a hole, so the picture can be redrawn
  | { type: "brain.warning"; seq: number; scope: "note" | "index" | "pinned"; noteId?: string; reason: string; message: string }
  | { type: "pong"; reqId: string; seq: number };
```

`OfficeState` is defined in `office-ui.md` §1; the server builds it in `ws/state.ts`. `McpConnection` is in `tools-mcp-approvals.md` §3; `BrainSearchHit`, `BrainGraph`, `BrainGraphNode`, `BrainGraphEdge` in `brain.md`.

Chat history has no message type of its own: the client rebuilds an agent's Chat tab from `event`s of that agent's runs of kind `chat` and `revise` (`started.prompt` is the owner's text, `chunk`s are the reply), fetched with `runs.replay`.

`modelOverride` on `task.create` or `chat.send` for an agent on a local model returns `error` with `MODEL_OVERRIDE_LEAVES_MACHINE` (`core-agent-loop.md`).

Worked exchange, creating a task:

```json
{ "type": "task.create", "reqId": "c1", "department": "marketing", "text": "Write a landing page for the spring sale" }
```
```json
{ "type": "ack", "reqId": "c1", "seq": 118, "ok": true, "result": { "runId": "run_01J8ZK5B2R", "routeRunId": "run_01J8ZK4M9Q" } }
{ "type": "event", "seq": 119, "event": { "seq": 119, "runId": "run_01J8ZK4M9Q", "at": 1789459203120, "event": { "type": "started", "agentId": "marketing-lead", "kind": "route", "model": "anthropic/claude-sonnet-5", "modelSource": "office_default", "prompt": "Write a landing page for the spring sale", "parentRunId": null, "routineId": null, "systemPromptHash": "9c1f...", "toolNames": [] } } }
{ "type": "state", "seq": 120, "state": { "...": "marketing-lead now working" } }
{ "type": "event", "seq": 121, "event": { "seq": 121, "runId": "run_01J8ZK4M9Q", "at": 1789459205002, "event": { "type": "routed", "toAgentId": "copywriter", "childRunId": "run_01J8ZK5B2R", "brief": "Write the landing page copy for the spring sale..." } } }
{ "type": "event", "seq": 124, "event": { "seq": 124, "runId": "run_01J8ZK5B2R", "at": 1789459205310, "event": { "type": "tool_call", "turn": 1, "call": { "id": "tc_3", "name": "brain_search", "input": { "query": "spring sale" } }, "scope": "read", "egress": false, "inputChars": 23, "group": "01J8ZK5C" } } }
{ "type": "event", "seq": 125, "event": { "seq": 125, "runId": "run_01J8ZK5B2R", "at": 1789459205351, "event": { "type": "tool_result", "toolCallId": "tc_3", "name": "brain_search", "output": "[...]", "isError": false, "durationMs": 41, "truncated": false, "redactedCount": 0, "noteIds": ["20-products/retainer-packages"] } } }
{ "type": "event", "seq": 131, "event": { "seq": 131, "runId": "run_01J8ZK5B2R", "at": 1789459206100, "event": { "type": "chunk", "turn": 2, "attempt": 1, "text": "# Spring Sale\n\nEverything " } } }
{ "type": "event", "seq": 140, "event": { "seq": 140, "runId": "run_01J8ZK5B2R", "at": 1789459209800, "event": { "type": "approval_needed", "approvalId": "apr_01J8ZK7F", "toolCallId": "tc_4", "tool": { "name": "gmail.send_email", "source": { "kind": "mcp", "server": "gmail", "remoteName": "send_email" }, "scope": "write" }, "input": { "to": ["list@northlight.example"], "subject": "Spring sale is on", "body": "..." }, "preview": { "action": "Send an email", "destination": "to list@northlight.example via gmail (MCP server at https://mcp.example.com)", "summary": "One email announcing the spring sale to the customer list.", "body": "...", "irreversible": true }, "requestedAt": 1789459209800, "expiresAt": 1789545609800 } } }
{ "type": "state", "seq": 141, "state": { "...": "copywriter now waiting_approval" } }
```

Owner clicks Approve once:

```json
{ "type": "approval.decide", "reqId": "c2", "approvalId": "apr_01J8ZK7F", "decision": "approve" }
```
```json
{ "type": "ack", "reqId": "c2", "seq": 142, "ok": true }
{ "type": "event", "seq": 143, "event": { "seq": 143, "runId": "run_01J8ZK5B2R", "at": 1789459260000, "event": { "type": "approval_resolved", "approvalId": "apr_01J8ZK7F", "decision": "approve", "by": "owner" } } }
{ "type": "event", "seq": 150, "event": { "seq": 150, "runId": "run_01J8ZK5B2R", "at": 1789459262400, "event": { "type": "done", "deliverable": { "title": "Spring Sale", "text": "# Spring Sale\n...", "noteId": "40-deliverables/marketing/2026-09-15-spring-sale" }, "usage": { "inputTokens": 5120, "outputTokens": 890 }, "costUsd": 0.0289, "toolsUsed": ["brain_search", "gmail.send_email", "brain_write"], "turns": 3 } } }
```

An error:

```json
{ "type": "error", "reqId": "c3", "seq": 151, "code": "PROVIDER_NOT_CONFIGURED", "message": "Sam uses ollama, but it has no API key.", "hint": "Open Settings > Models and add a ollama key, or change the agent's model in office/agents.yaml." }
```

Resume: on reconnect the client sends `hello` with `resumeFrom`. The server replies `welcome` with a fresh `state`, then replays `event`s with `seq > resumeFrom` from its in-memory ring (last 5,000); a larger gap sets `resumed: false` and the client re-requests `runs.replay` for runs it was watching. Heartbeat `ping` every 20 s; the server closes a silent socket after 60 s. `state` is coalesced at 250 ms; `event` is not.

## 7. Routines

Stored in `office/routines.yaml`, mirrored into `OfficeState.routines`.

```yaml
# office/routines.yaml
version: 1
routines:
  - id: daily-inbox-summary
    label: Morning inbox summary
    agent: ops-assistant
    task: Summarise anything in brain/inbox/ from the last 24 hours and file it as a note.
    cadence: weekdays          # daily | weekdays | weekly | monthly | cron
    time: "08:00"              # office timezone from agents.yaml
    approval_before_send: true
    catch_up: latest           # latest | all | skip
    paused: false
  - id: monthly-books
    label: Monthly bookkeeping summary
    agent: bookkeeper
    task: Categorise last month's transactions and draft the summary note.
    cadence: monthly
    day: 1
    time: "09:30"
```

```ts
export const RoutineSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/), label: z.string().min(1).max(80), agent: z.string(),
  task: z.string().min(5).max(2000), cadence: z.enum(["daily", "weekdays", "weekly", "monthly", "cron"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.enum(["mon","tue","wed","thu","fri","sat","sun"]).optional(), day: z.number().int().min(1).max(28).optional(),
  cron: z.string().optional(), approval_before_send: z.boolean().default(true),
  catch_up: z.enum(["latest", "all", "skip"]).default("latest"), paused: z.boolean().default(false),
}).strict();
```

Rules:

- A routine run is `runner.submitTask({ department: agent.department, agentId, prompt: task, source: "routine", routineId })`, so it skips routing and lands as `kind: "routine"` with `routineId` on the run and in `started`. `brain.md` writes `task: routine:<id>` in the note.
- `approval_before_send: true` makes the registry ignore the whitelist for this run's write tools. `false` lets the whitelist apply. Nothing bypasses approval for a tool that is not whitelisted.
- One at a time. Routines serialise against each other; task-bar tasks are not blocked.
- Catch-up after sleep or downtime: for each routine the scheduler computes fire times between `lastRunAt` (`.staffroom/scheduler.json`) and now. `latest` runs once, titled `Catch-up: <label>`; `all` runs once per missed fire, capped at 7; `skip` moves `lastRunAt` forward. Misses older than 7 days are skipped and logged.
- Tick every 30 s; fire times computed in the office timezone with `Temporal` (or the polyfill).
- `routine.run_now` enqueues immediately without moving the schedule. The task bar's Schedule popover (`office-ui.md` §4) sends `task.create` with `schedule`, which the server turns into a `routine.upsert`.

## 8. The CLI

Published as `staffroom` with `bin: { staffroom: "dist/index.js" }`. Because `npx staffroom` puts nothing on PATH, every message, hint, banner and doc says `npx staffroom <sub>`; a Vitest grep across `packages/` fails on the string `Run staffroom `.

### Office folder

Resolution order: `--office`, then `STAFFROOM_OFFICE`, then `./office` if it contains `agents.yaml`, then the path in `~/.staffroom/current-office`, then ask. First run creates `~/Staffroom/office` (a visible folder in the home directory) and writes that path to `~/.staffroom/current-office`. Every start prints `Office folder: /Users/aman/Staffroom/office`. `doctor office.path` lists every folder found in those locations and warns `Two offices found. Using /Users/aman/Staffroom/office. Pass --office to pick the other.`

### `npx staffroom` (no subcommand)

First run:

1. Node check, same message as boot.
2. No office: ask `Which kind of business is this office for?` with labels, not ids: `Design or creative studio (sample, recommended for a first look)`, `Agency`, `Online shop`, `Clinic`, `Consultant`. Ids are `studio`, `agency`, `ecommerce`, `clinic`, `consultant`. Copy the template, print the tree and `You can change everything later in the office folder.`
3. No provider key in env or `office/.env`: print `No model keys found. Starting in demo mode. Run npx staffroom setup when you want your agents to do real work.` and continue.
4. `npx staffroom start --open`.

Later runs: step 4 only. `npx staffroom init [--template <id>] [--dir <path>] [--tools]` is the explicit form of steps 2 and 3; `--tools` also copies the five example tools.

### `npx staffroom setup`

Interactive with `@inquirer/prompts`: pick providers, paste each key (masked, written to `office/.env`), test each with a one-token completion, pick `default_model` (the adapter's `defaultModel()` preselected with `(recommended)`, the six most recent ids shown, `Show all` for the rest; written to `agents.yaml`), web search (Brave or Tavily key, or skip), telemetry (default no). Edits YAML in document mode so comments survive. Ends with `Saved to office/.env (a hidden file). Run npx staffroom setup again to change it.` If the office is leaving demo mode it asks the sample-content question from `brain.md` ("Leaving demo mode"). `--non-interactive` takes the same answers as flags.

### `npx staffroom start`

Flags: `--port`, `--host`, `--open`, `--demo`, `--log-level`, `--no-watch`. Runs `createServer` in the foreground and prints:

```
Staffroom 0.2.1  office: Northlight Studio  mode: live
  Office folder: /Users/aman/Staffroom/office
  http://127.0.0.1:4242/?t=3f9a...
  agents 4  connectors 5 (1 unavailable: gmail)  routines 2
  Keep this window open. Closing it stops the office. Press Ctrl+C to stop.
```

`npx staffroom demo` is `start --demo`.

### Other commands

- `npx staffroom doctor [--fix] [--json] [--bundle]` runs §13. `--fix` applies safe fixes (create `.gitignore` lines, rebuild the brain index, run migrations, move a literal key to `.env`). `--bundle` zips the log, doctor output and config with every secret-bearing value replaced by `$NAME`, unconditionally.
- `npx staffroom brain reindex [--embeddings]`, `npx staffroom brain import <path> [--move] [--area <folder>] [--include-tools]` (`brain.md`).
- `npx staffroom tools new <name> [--scope read|write]`, `npx staffroom tools add <example>` (`tools-mcp-approvals.md` §2).
- `npx staffroom template list`, `npx staffroom template apply <id> --into <dir> [--include-tools]`.
- `npx staffroom migrate --dry-run`, `npx staffroom export --out office-export.zip`, `npx staffroom version`.

Browser opening uses `open` (npm) with a printed-URL fallback; never in Docker or over SSH.

## 9. Demo mode

Entered when zero providers resolve at boot, or `--demo`, or `STAFFROOM_DEMO=1`. `/api/health` and `welcome` report `mode: "demo"` and the web shows a strip: `Demo mode. Agents are replaying sample work. Open Settings > Models or run npx staffroom setup to connect a model.`

`packages/server/src/demo/demo.ts` registers `FixtureAdapter` from `@staffroom/core/testing` (`kind: "demo"`, `core-agent-loop.md`) pointed at `packages/templates/studio/demo-runs/*.jsonl`. Each file's first line is `{ "matches": ["tagline", "landing"] }`; the rest are `CompletionChunk`s. On a task the adapter picks the best keyword match, else a generic transcript, and streams at 40 ms per chunk divided by `demo.speed`. Tool calls in a transcript hit the real ToolRegistry: `brain_search` really searches the sample brain, `brain_write` really writes the draft, approvals really appear and block, routines really fire. MCP and web tools are answered from the transcript's recorded results. The studio ships one `sample: true` run in `runs.sqlite` so the first screen is never blank.

Going live without a restart: `provider.set_key` (Settings > Models, `office-ui.md` §4) or a new line in `office/.env` (watched) re-runs `boot.providers`, `boot.config` and `modelStatus` in place, flips `mode` to `live`, and asks the sample-content question from `brain.md`. The key is written to `office/.env`, never echoed back, never logged.

Demo mode is never chosen when a provider is configured but broken. That surfaces as `PROVIDER_NOT_CONFIGURED` or `AUTH_FAILED` on the agent, plus `modelStatus: no_key | unreachable` before any task.

## 10. Docker image

`ghcr.io/staffroom-ai/staffroom:<version>`, multi-arch, base `node:20-bookworm-slim`, contains `npx` so stdio MCP servers work. Inside the container the server binds `0.0.0.0`; `STAFFROOM_IN_DOCKER=1` swaps the `--host` warning for a reminder to publish the port on `127.0.0.1` only, and the origin and token checks stay on. `STAFFROOM_OFFICE=/office`. Ollama on the host is `http://host.docker.internal:11434`.

```
docker run -d --name staffroom -p 127.0.0.1:4242:4242 -v $PWD/office:/office -e ANTHROPIC_API_KEY ghcr.io/staffroom-ai/staffroom:latest
```

## 11. Upgrade path and config migrations

`npx staffroom` fetches the latest published version. `start` prints `Update available: 0.3.0 (you have 0.2.1). Run npx staffroom@latest.` from a once-a-day registry check cached in `~/.staffroom/update-check.json`. The check runs only when `telemetry.enabled` is true; `STAFFROOM_NO_UPDATE_CHECK=1` disables it regardless.

Each of `agents.yaml`, `config.yaml`, `routines.yaml`, `approvals.yaml` and `runs.sqlite` carries a `version`. Migrations live in `packages/server/src/migrate/` as `{ file, from, to, describe, run(doc: YAML.Document) }`, copy the original to `.staffroom/backups/<file>.v<from>.bak`, are pure and idempotent. A version newer than the server knows is `CONFIG_VERSION_UNKNOWN`. `runs.sqlite` uses additive migrations only; the events table is never rewritten. Deprecated keys keep working for two minor versions with a `warn` line.

## 12. Logging

pino JSON lines to stderr, pretty when a TTY. Fields: `time`, `level`, `msg`, `scope` (`boot`, `ws`, `run`, `tool`, `mcp`, `scheduler`, `brain`, `watch`, `migrate`), plus `runId`, `agentId`, `tool` where relevant. Never logged: prompt contents, tool inputs and outputs, note contents, API keys, session token. A rolling file at `.staffroom/logs/staffroom.log` (10 MB, 5 files).

## 13. Doctor checks

| Check | ok | warn | fail |
|---|---|---|---|
| `node.version` | >= 20 | | < 20 |
| `office.path` | one office found | two offices found, which is used | none |
| `office.exists` | has agents.yaml and config.yaml | | missing |
| `office.gitignore` | ignores .env, runs.sqlite, brain.index.sqlite, .staffroom/, node_modules/ | missing lines (fixable) | |
| `config.version` | current | pending migration (fixable) | newer than server |
| `config.valid`, `agents.valid` | zero ConfigErrors | | any, all listed |
| `config.secrets` | no literal keys | | `SECRET_LITERAL_IN_CONFIG` (fixable) |
| `providers.<name>` | one-token completion succeeds | not configured | key present, request fails |
| `models.resolve` | every agent `modelStatus: ok` | resolves to demo | `no_key` or `unreachable` agents listed |
| `ollama.installed` | binary on PATH or /Applications/Ollama.app | not installed: `Install from ollama.com` | |
| `ollama.reachable` | `/api/tags` responds | not configured | configured, unreachable |
| `mcp.<name>` | connects and lists tools within 15 s | `unavailable` with its message | connect fails, stderr tail (redacted) |
| `tools.custom` | every `tools/*.ts` compiles | no `scope`; package with install scripts in office/node_modules | compile error, with line |
| `tools.resolve` | shipped examples load from an office with no node_modules | | resolution error |
| `tools.web` | search returns results | provider none | key present, request fails |
| `approvals.whitelist` | prints each row: agent, tool, match, expiry, suspended | rows expired or suspended | file invalid |
| `brain.index` | index newer than newest note | stale (fixable) | corrupt (fixable) |
| `brain.links` | | broken wiki-links listed | |
| `brain.secrets` | | non-private note with a key-like line or 16+ digit number (`brain.md`) | |
| `runs.db` | integrity ok | runs still `running` with no live process (will resume) | corrupt |
| `scheduler` | routines valid, next fires printed | routine references a missing agent | |
| `port` | free or held by this server | held by another process, pid | |
| `disk` | > 500 MB free | < 500 MB | < 50 MB |
| `telemetry` | enabled/disabled and the exact payload | | |

`--json` gives `{ checks: [{ id, status, message, hint? }], ok }`.

## Open questions

1. Should `auth: oauth` for HTTP MCP servers ship in v0.2 or v0.3? Recommendation: v0.2 with the PKCE flow as specified, because Gmail is the connector everyone asks for first and the callback route is small.
2. Should interactive tasks and routines share the one-at-a-time queue? Recommendation: no. Revisit if owners report duplicate sends from a task bar task overlapping a routine.
3. Should `provider.set_key` also accept an Ollama base URL, so the Settings panel covers the local story too? Recommendation: yes, as `provider.set_key { provider: "ollama", key: "http://..." }` written to `config.yaml` rather than `.env`; decide before the Settings panel lands in week 5.
4. Should the session token rotate on every boot or persist in `~/.staffroom`? Recommendation: every boot. A stale bookmark just reloads from the printed link, and a persisted token is one more secret on disk.
5. Do we ship a launchd plist or Windows service so routines fire without the terminal? Recommendation: not before v1.0. Document `pm2` and lean on catch-up.
