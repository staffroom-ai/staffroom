# core-agent-loop: the packages/core agent runtime

Status: draft 2, 15 Sep 2026 (reconciled). Owner: core maintainer.

This spec covers everything in `packages/core/src/runtime/` and `packages/core/src/providers/`: the provider adapter interface, the three v1 adapters plus the demo adapter, model resolution, the agent loop, the run log, routing, `revise:` and the error taxonomy. It has no UI or HTTP knowledge. `packages/server` calls into it and forwards run events over WebSocket (protocol in `server-cli-runtime.md` §6); `packages/web` only ever sees `RunEventEnvelope` rows and `OfficeState` (`office-ui.md` §1).

This spec owns: `RunEvent` and its names, `Run`, `RunStore`, `ProviderAdapter`, `resolveModel`, `RunErrorCode`, the `runner:` block of `config.yaml`, `redactSecrets`, and the `Office` interface.

## Decisions

- The loop is ours. A few hundred lines of TypeScript over `@anthropic-ai/sdk`, `openai` and `ollama`. `@anthropic-ai/claude-agent-sdk` is never imported, anywhere in the monorepo, and CI fails the build if it appears in any `package.json`.
- One adapter method matters: `complete(messages, tools, opts)` returning an async stream of `text | tool_call | done`. Adapters are dumb translators. Retries, tool dispatch, streaming and the run log live in the loop; the approval gate lives in `ToolRegistry.invoke` (`tools-mcp-approvals.md` §5), and the loop only reflects its status.
- Model ids are always `provider/model`, for example `anthropic/claude-sonnet-5`, `ollama/llama4`, `groq/llama-4-70b`. The provider half is a key under `providers:` in `office/config.yaml`.
- Resolution chain is `modelOverride` (task bar, per run) then `agent.model` then `default_model` (top-level key of `office/agents.yaml`) then the first provider listed in `config.yaml`. If none of those produce a usable model the run fails before it starts with `NO_MODEL_CONFIGURED`. An override is refused for an agent whose own model is local (`MODEL_OVERRIDE_LEAVES_MACHINE`).
- A run is an append-only list of events in `office/runs.sqlite`. The message list sent to the model is rebuilt from events, never stored separately. A run in `running` or `waiting_approval` survives a server restart: the server calls `runner.resume(runId)` at boot. There is no `interrupted` status or event.
- Event names are bare snake_case (`started`, `tool_call`, `done`). Every other spec uses these names; nobody defines dotted variants.
- Brain context is exactly the two mechanisms in `brain.md`: the pinned set in the system prompt and the agent-initiated `brain_search` / `brain_read` tools. The loop never runs a search the agent did not ask for.
- The system prompt ends with `SAFETY_RULE` from `packages/core/src/prompt/safety-rule.ts` (text owned by `tools-mcp-approvals.md` §6). Nothing from `agents.yaml`, a template or a brain note appears after it.
- Every event payload passes through `redactSecrets` before it is written, so `runs.sqlite`, the WebSocket and run exports never carry a key.
- Routing (the lead picking a worker) is its own `Run` of kind `route`; the worker's run points back through `parentRunId`. Route runs never call `finish()`.
- Cancellation is one `AbortSignal` threaded from `Runner.cancel()` through the adapter and every in-flight tool. It ends the run with `failed` and code `CANCELLED`.

## Files

```
packages/core/src/
  providers/
    types.ts          ProviderAdapter, Message, CompletionChunk, pricing types
    anthropic.ts      AnthropicAdapter
    openai.ts         OpenAIAdapter (also Groq, Together, OpenRouter, LM Studio)
    ollama.ts         OllamaAdapter
    pricing.ts        shipped price table, overridable from config
    resolve.ts        resolveModel()
  prompt/
    safety-rule.ts    SAFETY_RULE constant (text in tools-mcp-approvals.md §6)
  runtime/
    office.ts         Office: the object server and tests hold
    runner.ts         Runner: submitTask, chat, revise, cancel, resume
    loop.ts           runAgentLoop(): the turn loop
    prompt.ts         buildSystemPrompt()
    routing.ts        routeTask(): lead picks worker, names if unnamed
    revise.ts         buildReviseMessages()
    events.ts         Run, RunEvent, RunStore (SQLite)
    errors.ts         RunError, RunErrorCode, userMessage()
  redact.ts           redactSecrets()
  testing/
    fixture-adapter.ts  FixtureAdapter (kind "demo"), recordFixture()
```

The `Office` interface (`runtime/office.ts`) is what `createServer` builds and what `@staffroom/core` exports for embedders:

```ts
export interface Office {
  config: OfficeConfig;              // parsed config.yaml (schema in server-cli-runtime.md §5)
  roster: Roster;                    // parsed agents.yaml plus setName()
  registry: ToolRegistry;            // tools-mcp-approvals.md §1
  mcp: McpManager;                   // tools-mcp-approvals.md §3
  brain: BrainIndex;                 // brain.md
  runs: RunStore;
  runner: Runner;
  providers: Map<string, ProviderAdapter>;
  close(): Promise<void>;
}
export function createOffice(opts: { officeDir: string; demo?: boolean }): Promise<Office>;
```

`createOffice` opens no sockets and starts no file watchers. Watching is the server's job (`server-cli-runtime.md` §2 step 9).

## Model ids and resolution

```ts
// providers/resolve.ts
export type ModelId = `${string}/${string}`;   // "anthropic/claude-sonnet-5"

export interface ResolvedModel {
  providerId: string;     // "anthropic"
  model: string;          // "claude-sonnet-5"
  adapter: ProviderAdapter;
  source: "override" | "agent" | "office_default" | "first_provider";
}

export function resolveModel(
  agent: AgentConfig,
  agentsFile: AgentsFile,          // for default_model
  providers: Map<string, ProviderAdapter>,
  override?: ModelId,
): ResolvedModel;
```

`resolveModel` tries, in order:

1. `override` if given. Before trying it, the caller checks the agent's own model: if `agent.model` resolves to a provider of `kind: ollama`, or to any provider whose `base_url` host is `localhost`, `127.0.0.1` or `[::1]`, the override is refused with `MODEL_OVERRIDE_LEAVES_MACHINE`. An agent that was put on a local model was put there on purpose.
2. `agent.model` if set.
3. `agentsFile.default_model`.
4. `${firstProviderId}/${adapter.defaultModel()}` where `firstProviderId` is the first key under `providers:` in `config.yaml`.

Each candidate is split on the first `/` (so `openrouter/anthropic/claude-sonnet-5` resolves to provider `openrouter`, model `anthropic/claude-sonnet-5`). If the provider half is not a configured provider the candidate is skipped and the next one tried. If all fail, the run fails with `NO_MODEL_CONFIGURED`. If the provider exists but the API key is missing, the run fails with `PROVIDER_NOT_CONFIGURED` naming the provider, because falling through to a different provider silently would send a private-notes agent's data somewhere the owner did not choose.

The same function, run for every agent at boot and on config reload, produces `Agent.modelStatus` in `OfficeState` (`ok | no_key | unreachable`) so the office can show a grey badge before any task is given.

Provider configuration in `office/config.yaml` (the zod schema is `ProviderSchema` in `server-cli-runtime.md` §5; the `features` and `pricing` blocks are defined here):

```yaml
providers:
  anthropic:
    kind: anthropic
    api_key: $ANTHROPIC_API_KEY
  openai:
    kind: openai
    api_key: $OPENAI_API_KEY
  groq:
    kind: openai                          # any OpenAI-compatible endpoint
    base_url: https://api.groq.com/openai/v1
    api_key: $GROQ_API_KEY
    features: { parallel_tool_calls: false, stream_usage: false }
  ollama:
    kind: ollama
    base_url: http://127.0.0.1:11434
    pricing: { "llama4": { input_per_1k: 0, output_per_1k: 0 } }
```

`$NAME` values are read from the process environment and `office/.env` at load time. `kind` defaults to the key name when the key is `anthropic`, `openai` or `ollama`.

## ProviderAdapter

The types below are the contract. They live in `packages/core/src/providers/types.ts` and are exported from `@staffroom/core`.

```ts
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolCall {
  id: string;                          // provider id, or "call_<n>" when the provider gives none
  name: string;
  input: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;                        // ^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31})?$  ("notion.search_pages")
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema draft 2020-12, object at the root
}

export interface Usage { inputTokens: number; outputTokens: number; cachedInputTokens?: number }
export type StopReason = "end" | "tool_calls" | "max_tokens";

export type CompletionChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason: StopReason; usage: Usage };

export interface CompleteOptions {
  model: string;                       // model half only
  maxTokens: number;
  temperature?: number;
  signal: AbortSignal;
  forceTool?: string;                  // routing forces "assign_task"
}

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsParallelToolCalls: boolean;
  supportsForcedTool: boolean;
  maxContextTokens: number | null;    // null = unknown, loop assumes 32k
}

export interface ModelPricing { inputPer1k: number; outputPer1k: number; cachedInputPer1k?: number }
export interface ModelInfo { id: string; created?: string }

export interface ProviderAdapter {
  readonly id: string;                 // config key: "anthropic", "groq", ...
  readonly kind: "anthropic" | "openai" | "ollama" | "demo";
  defaultModel(): string;
  capabilities(model: string): ProviderCapabilities;
  complete(messages: Message[], tools: ToolSpec[], opts: CompleteOptions): AsyncIterable<CompletionChunk>;
  countTokens(messages: Message[], tools: ToolSpec[], model: string): Promise<number>;
  pricing(model: string): ModelPricing | null;
  listModels(): Promise<ModelInfo[]>;   // { id, created? } — Settings > Models sorts by created
  embed?(texts: string[], model: string): Promise<number[][]>;   // optional, used by brain.md embeddings
}
```

Rules every adapter follows:

- `complete` yields zero or more `text` chunks, zero or more `tool_call` chunks, then exactly one `done`. A tool call whose arguments fail to parse is yielded with `input: { _raw: "<string>" }` and the loop returns a tool error to the model.
- If `opts.signal` aborts, the adapter stops iterating and throws `DOMException("AbortError")`. It does not yield `done`.
- Provider errors are thrown as `ProviderError` with `code` already mapped (`AUTH_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `MODEL_NOT_FOUND`, `CONTEXT_TOO_LONG`) and `retryAfterMs` when the provider supplied one. Adapters never retry.
- A dot in a tool name is sent as `__` on providers that forbid dots (OpenAI-compatible, Ollama) and mapped back on the returned `ToolCall` before the loop sees it. The loop and the registry only ever see `notion.search_pages`.
- `countTokens` may be an estimate. The base class ships `estimateTokens()` (characters divided by 3.5, plus 4 per message, plus tool schema JSON length divided by 3.5). Billing always uses `Usage` from `done`.
- `pricing` looks up `config.providers.<id>.pricing[model]` first, then the shipped table, then returns `null`. A null price makes `Run.costUsd` null and the office shows "cost unknown".
- Adding a provider must take under 150 lines. If it does not, the interface changes, not the adapter.

### Anthropic adapter (`anthropic.ts`)

Uses `@anthropic-ai/sdk` `messages.stream()`. The leading `system` message becomes the `system` parameter. `ToolSpec` maps 1:1 to `{ name, description, input_schema }`. Assistant messages with `toolCalls` become one `text` block then one `tool_use` block per call. Consecutive `tool` messages merge into one `user` message of `tool_result` blocks. Streaming: `text_delta` yields `text`; `content_block_start` of type `tool_use` opens a buffer, `input_json_delta` appends, `content_block_stop` parses and yields `tool_call`. `stop_reason` `tool_use` maps to `tool_calls`, `end_turn` and `stop_sequence` to `end`, `max_tokens` to `max_tokens`. `forceTool` maps to `tool_choice: { type: "tool", name }`. `capabilities`: all true, `maxContextTokens` 200000 for the claude-5 family.

### OpenAI-compatible adapter (`openai.ts`)

Uses the `openai` package `chat.completions.create({ stream: true })` with `baseURL` from config. `tool` role becomes `{ role: "tool", tool_call_id, content }`; `isError` has no wire equivalent so content is prefixed `ERROR: `. Tool call deltas are buffered per `index` and yielded on `finish_reason`. Usage needs `stream_options: { include_usage: true }`; endpoints that reject it (`features.stream_usage: false`, or auto-detected on a 400 and cached) get an estimated `Usage`, flagged `estimated`. `forceTool` maps to `tool_choice: { type: "function", function: { name } }`.

### Ollama adapter (`ollama.ts`)

Uses the `ollama` package `chat({ stream: true })`. Tool calls carry no ids; the adapter assigns `call_1`, `call_2` per turn and matches results by position. `supportsTools` comes from `show({ model })` once per process; `supportsForcedTool` is false (routing uses the JSON-in-text path). `pricing` returns zero unless overridden. Not pulled: `MODEL_NOT_FOUND`. Not running: `PROVIDER_UNAVAILABLE`. Both hints assume nothing is installed (see the error table).

### Demo adapter (`testing/fixture-adapter.ts`)

`FixtureAdapter` has `kind: "demo"`, `id: "demo"`. It is the only replay implementation in the repo: adapter conformance tests use it with `packages/core/src/providers/<name>/fixtures/`, and demo mode (`server-cli-runtime.md` §9) uses it with `packages/templates/studio/demo-runs/*.jsonl`. Given a prompt it picks the transcript whose header `matches` keywords score highest and streams its `CompletionChunk`s with a per-chunk delay (`delayMs`, default 40, scaled by `demo.speed`). Tool calls in the transcript go through the real `ToolRegistry`.

If an agent lists tools but its resolved model has `supportsTools: false`, the run fails before the first request with `TOOLS_UNSUPPORTED`.

## Run and RunEvent

```ts
// runtime/events.ts
export type RunKind = "task" | "route" | "chat" | "revise" | "routine";
export type RunStatus = "queued" | "running" | "waiting_approval" | "done" | "failed";

export interface Run {
  id: string;                          // ulid, "run_01J8..."
  kind: RunKind;
  agentId: string;
  department: string;
  model: ModelId;
  prompt: string;                      // what the owner typed, or the brief from routing
  parentRunId: string | null;          // route run for tasks; previous run for revise
  routineId: string | null;            // set when a routine started it
  sample: boolean;                     // true for runs shipped inside a template's runs.sqlite
  status: RunStatus;                   // cache of the last event, rebuildable
  createdAt: number;
  finishedAt: number | null;
  usage: Usage & { estimated?: boolean };
  costUsd: number | null;
}

export interface RunEventEnvelope { seq: number; runId: string; at: number; event: RunEvent }

export type RunEvent =
  | { type: "started"; agentId: string; kind: RunKind; model: ModelId; modelSource: ResolvedModel["source"];
      prompt: string; parentRunId: string | null; routineId: string | null; systemPromptHash: string; toolNames: string[] }
  | { type: "routed"; toAgentId: string; childRunId: string; brief: string }          // on the route run only
  | { type: "chunk"; turn: number; attempt: number; text: string }
  | { type: "tool_call"; turn: number; call: ToolCall; scope: "read" | "write"; egress: boolean; inputChars: number; group: string }
  | { type: "tool_result"; toolCallId: string; name: string; output: string; isError: boolean; durationMs: number;
      truncated: boolean; redactedCount: number; noteIds?: string[] }
  | { type: "tool_log"; toolCallId: string; msg: string; data?: Record<string, unknown> }
  | { type: "approval_needed"; approvalId: string; toolCallId: string; tool: { name: string; source: ToolSource; scope: "write" };
      input: unknown; preview: ApprovalPreview; requestedAt: number; expiresAt: number }
  | { type: "approval_resolved"; approvalId: string; decision: ApprovalDecision; by: ApprovalBy; note?: string }
  | { type: "brain_pinned_included"; noteIds: string[] }
  | { type: "brain_pinned_truncated"; noteIds: string[] }                              // ids that did not fit
  | { type: "brain_note_written"; noteId: string; revises?: string; status: "draft" }
  | { type: "done"; deliverable: Deliverable; usage: Usage; costUsd: number | null; toolsUsed: string[]; turns: number }
  | { type: "failed"; error: ReturnType<RunError["toJSON"]>; partialText: string | null; turns: number };

export interface Deliverable {
  title: string;                       // first "# " line of the final text, else first 60 chars
  text: string;                        // the final assistant text, markdown
  noteId: string | null;               // brain note id once written ("40-deliverables/marketing/2026-09-15-landing-copy"); null on route runs
}
```

`ApprovalPreview`, `ApprovalDecision` (`approve | approve_always | deny | expired | cancelled`), `ApprovalBy` (`owner | whitelist | system`) and `ToolSource` are imported from `tools-mcp-approvals.md` §5 and §1. Core does not redefine them.

`tool_result.noteIds` is set by the registry for `brain_search`, `brain_read` and `brain_write` (the ids returned or created) and copied onto the event so `brain.md`'s `readBy` join is a query over `run_events`, not a parse of `output`.

SQLite schema (owned by `RunStore`, migrations in `runtime/migrations/`):

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, agent_id TEXT NOT NULL, department TEXT NOT NULL,
  model TEXT NOT NULL, prompt TEXT NOT NULL, parent_run_id TEXT, routine_id TEXT,
  sample INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, finished_at INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL
);
CREATE TABLE run_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id),
  type TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL   -- JSON of RunEvent, already redacted
);
CREATE INDEX run_events_by_run ON run_events(run_id, seq);
CREATE INDEX run_events_by_type ON run_events(type, seq);
```

`RunStore` API:

```ts
export interface RunStore {
  create(run: Omit<Run, "status" | "finishedAt" | "usage" | "costUsd">): Promise<Run>;
  append(runId: string, event: RunEvent): Promise<RunEventEnvelope>;   // redacts, writes, updates runs row, notifies
  events(runId: string): AsyncIterable<RunEventEnvelope>;
  since(seq: number): AsyncIterable<RunEventEnvelope>;                 // server tails this for the WS
  get(runId: string): Promise<Run | null>;
  list(filter: { status?: RunStatus[]; kind?: RunKind[]; agentId?: string; limit?: number }): Promise<Run[]>;
  lastDeliverable(agentId: string): Promise<{ run: Run; deliverable: Deliverable } | null>;
  pendingApprovals(): Promise<Array<Extract<RunEvent, { type: "approval_needed" }> & { runId: string }>>;
  subscribe(fn: (e: RunEventEnvelope) => void): () => void;
}
```

`append` calls `redactSecrets(event)` first, then writes the row and updates `runs.status`, `finished_at`, tokens and cost in one transaction. `chunk` events are written in batches of at most 100 ms; subscribers still receive them immediately. `pendingApprovals` is `approval_needed` events with no `approval_resolved` sibling.

### redactSecrets (`packages/core/src/redact.ts`)

```ts
export function redactSecrets<T>(value: T): T;              // deep copy with secrets replaced by "••••"
export function configureRedaction(secrets: string[]): void; // called once by createOffice
```

The secret list is every value in `office/.env`, every expanded `mcp.servers.<name>.env` and `args` value, every stored OAuth token and every `providers.<id>.api_key`, plus any string value whose key name matches `/token|secret|password|api[_-]?key|authorization/i`. Values shorter than 8 characters are not added to the list (so `PORT=4242` does not redact every 4242). The count of replacements made in a `tool_result` is stored as `redactedCount` so the office can show "contains 1 redacted value". The same function runs on `tool_log.data` and on approval previews. Test: seed `.env` with a marker, run a `FixtureAdapter` loop whose tool returns the marker, assert it is absent from `run_events.payload` and from the WS frames.

### Rebuilding messages

`messagesFromEvents(events)` regenerates the system prompt from the roster and brain (the hash in `started` lets the loop warn if it changed), concatenates `chunk` events of the highest attempt per turn into the assistant text, attaches `tool_call` events to that assistant message, and turns `tool_result` events into `tool` messages. On `resume`, an incomplete last turn (a `tool_call` with no `tool_result`, or a turn with no `done`) is re-issued. A pending approval does not survive a restart: the server resolves it as `expired` with `by: "system"`, `note: "server_restart"` at boot (`server-cli-runtime.md` §2 step 5), and the resumed loop sees the tool error `The approval was lost when Staffroom restarted; ask again.` so the model re-issues the call and a fresh preview is produced.

## The agent loop

Entry points on `Runner` (`runtime/runner.ts`):

```ts
export class Runner {
  constructor(deps: { store: RunStore; tools: ToolRegistry; brain: BrainIndex; roster: Roster;
                      agentsFile: AgentsFile; providers: Map<string, ProviderAdapter>; config: RunnerConfig });
  submitTask(input: { department: string; prompt: string; agentId?: string; modelOverride?: ModelId;
                      source?: "taskbar" | "routine"; routineId?: string }): Promise<{ routeRunId: string | null; runId: string }>;
  chat(input: { agentId: string; text: string; modelOverride?: ModelId }): Promise<{ runId: string }>;
  revise(input: { agentId: string; instructions: string }): Promise<{ runId: string }>;
  cancel(runId: string): void;
  resume(runId: string): Promise<void>;
}
```

`agentId` set on `submitTask` skips routing (`routeRunId: null`). `modelOverride` is tried first in `resolveModel` and recorded on `started.model` with `modelSource: "override"`. `routineId` lands on `Run.routineId` and `started.routineId`, which is what `brain.md` writes as `task: routine:<id>` in the deliverable's front-matter.

`RunnerConfig` keys, under `runner:` in `office/config.yaml` (the zod block lives in `ConfigSchema`, `server-cli-runtime.md` §5, and references this list):

```yaml
runner:
  max_turns: 25                  # model calls per run
  max_parallel_tools: 4          # concurrent tool executions inside one batch
  tool_timeout_ms: 60000
  tool_output_max_chars: 20000   # longer results are truncated with a "[truncated]" tail
  max_output_tokens: 4096
  egress_input_max_chars: 1000   # largest input a read tool that leaves the machine may receive
  retries: { attempts: 3, base_ms: 1000, max_ms: 20000 }
```

### System prompt assembly (`prompt.ts`)

`buildSystemPrompt({ agent, department, office, pinnedNotes, tools })` concatenates these sections, in this order, separated by blank lines:

1. Identity. `You are Priya, Copywriter in the Marketing department at Northlight Studio. Turns briefs into landing page copy and email sequences.` The sentence after the name is `agent.does` verbatim.
2. Owner instructions. `agents[].instructions` from `agents.yaml` (up to 4,000 characters), wrapped as `<owner_instructions>...</owner_instructions>`. Omitted when empty.
3. About this business. The pinned set from `brain.md`, in path order, capped at `brain.pinned_token_budget`. Each note is wrapped as `<note path="00-about/company" updated="2026-09-12" trust="owner">...</note>`, where `trust` is `owner` for `written_by: owner`, `agent` for `written_by: agent:*`, and `imported` for notes under `90-archive/` or created by `brain import`. The loop emits `brain_pinned_included` with the ids used and `brain_pinned_truncated` with the ids that did not fit. Sample notes (`sample: true`) are skipped in live mode.
4. Tool notes. One line per tool the agent may use: `- lookup_order (read)`, `- gmail.send_email (needs approval)`, `- notion.search_pages (read, sends its input to Notion)`. Tool schemas go through the `tools` parameter, not the prompt.
5. Output contract, verbatim:
   ```
   When the work is finished, reply with the deliverable itself as markdown, starting with a "# " title line. Do not describe what you did; the office records that. If you need something from the owner, ask one clear question and stop.
   ```
6. `SAFETY_RULE`, imported from `prompt/safety-rule.ts`. The text is owned by `tools-mcp-approvals.md` §6 and includes the data-not-instructions rule. Nothing from `agents.yaml`, a template, or a brain note appears after it.

The SHA-256 of the assembled prompt is recorded in `started.systemPromptHash`. `prompt.test.ts` snapshot-tests the full assembled prompt for one sample agent so the ordering cannot drift.

### The turn loop (`loop.ts`)

```ts
export async function runAgentLoop(ctx: LoopContext): Promise<void> {
  const { run, adapter, model, store, tools, signal, config } = ctx;
  let messages = await ctx.initialMessages();       // system + user, or rebuilt from events on resume
  await store.append(run.id, { type: "started", ... });

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    const { text, calls, stop, usage } = await completeWithRetry(ctx, messages, turn);
    messages.push({ role: "assistant", content: text, toolCalls: calls });
    if (stop === "max_tokens" && calls.length === 0) throw new RunError("OUTPUT_TRUNCATED");
    if (calls.length === 0) { await finish(ctx, text, usage); return; }
    const results = await dispatchToolBatch(ctx, calls, turn);
    messages.push(...results);
  }
  throw new RunError("MAX_TURNS");
}
```

`completeWithRetry` streams one model call. Each `text` chunk is appended as `chunk` with `turn` and `attempt`. Retryable `ProviderError`s (`RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, network) are retried up to `retries.attempts` times with `min(max_ms, base_ms * 2^(attempt-1))` plus up to 25% jitter, or `retryAfterMs`. Partial text from a failed attempt stays in the log with its `attempt` number. Non-retryable errors fail the run immediately.

`dispatchToolBatch` handles everything the model returned in one turn:

1. Every call is checked against `tools.forAgent(agent)`: the tool must exist and be allowed for this agent. A call that fails gets a `tool_result` with `isError: true` and content `Tool "stripe.refund" is not available to you.` The run continues.
2. A `tool_call` event is appended per call with the tool's `scope`, `egress`, `inputChars` (length of `JSON.stringify(input)`) and a shared `group` ulid.
3. Each call becomes `tools.invoke(name, input, ctx)`. The registry validates input, applies the egress limit, and is the approval gate: for a write-scope tool it appends `approval_needed` and blocks until `approval_resolved` (`tools-mcp-approvals.md` §5). Read-scope calls run at most `max_parallel_tools` at a time; write calls are dispatched in the same batch and simply wait longer. While any invoke in the batch is pending on an approval the run status is `waiting_approval`; it returns to `running` when the last one resolves.
4. Every result is wrapped as a tool message whose content is `<tool_result name="notion.search_pages" trust="untrusted">...</tool_result>`, truncated to `tool_output_max_chars`, and appended as `tool_result`. A denial produces `The owner declined this action.`; expiry produces `The owner did not decide in time.` Results go back to the model in the order the calls were issued.
5. A tool that throws produces `isError: true`; a timeout produces `Tool "web_search" took longer than 60 s and was stopped.` If three consecutive turns contain only errored results the run fails with `TOOL_FAILED`.

`finish` extracts the title, then calls `brainWriteDeliverable` (`brain.md`, the same function behind the `brain_write` tool) with `written_by: agent:<id>`, `task: <task id or routine:<id>>`, `run: <run id>`, `model`, `tools_used` from this run's `tool_call` events, and `revises` for revise runs. The write is recorded as a `tool_call`/`tool_result` pair for `brain_write` plus the registry's auto-resolved approval events (`brain_write` is `local: true`, `tools-mcp-approvals.md` §4), so the audit trail looks the same whether the model or the loop wrote the note. It never waits: brain writes stay on this machine and only ever create a new draft. Then `brain_note_written` and `done` are appended. `costUsd` is `usage.inputTokens / 1000 * inputPer1k + usage.outputTokens / 1000 * outputPer1k`, cached tokens priced at `cachedInputPer1k` when present.

Cancellation: `Runner.cancel(runId)` aborts the run's `AbortController`. The adapter stops streaming, tools receive the same signal, the registry resolves pending approvals with `decision: "cancelled", by: "system"`, and the loop appends `failed` with `code: "CANCELLED"` and streamed text in `partialText`. Nothing is written to the brain.

Chat runs (`Runner.chat`) use the same loop with `kind: "chat"`. The initial messages are the system prompt plus the last 20 user and assistant turns from this agent's previous chat runs (rebuilt from their `started.prompt` and `chunk` events), then the new text. A chat deliverable is written to the brain only when the final text starts with a `# ` title line. The office rebuilds the Chat tab from these same events (`server-cli-runtime.md` §6); there is no separate chat message type.

## Routing: the lead picks a worker

`Runner.submitTask({ department, prompt })` without `agentId`:

1. The lead is the agent in that department with `lead: true`, else the first agent listed for it. A department with exactly one agent skips routing (`routeRunId: null`).
2. A `Run` of kind `route` is created for the lead. Its single model call sends the system prompt sections 1, 2 and 6 only (no brain notes, no tools list) plus:

   ```
   A new task has arrived for your department:
   "Write the landing page copy for the autumn retainer offer."

   Your team:
   - copywriter (Priya, Copywriter): Turns briefs into landing page copy and email sequences. Tools: notion, gmail
   - designer (unnamed, Brand designer): Produces image briefs and alt text for campaigns. Tools: none

   Pick the one team member best placed to do this, and write them a brief in one paragraph.
   ```

   with one tool, `forceTool: "assign_task"`, whose schema has `agent_id` (enum of the team's ids), `brief` (string) and optional `name` (only if the chosen member is unnamed).
3. If `supportsForcedTool` is false (Ollama), the same request goes without tools and with `Reply with only a JSON object with keys agent_id, brief and optional name.` The reply is parsed with a first-`{`-to-last-`}` slice. On failure routing fails with `BAD_ROUTING` and the task goes to the first non-lead agent with the owner's prompt as the brief; the route run records `failed`, the worker run still starts.
4. If the chosen agent is unnamed and the result carries `name`, `Roster.setName(agentId, name)` writes it into `office/agents.yaml` with the `yaml` document API so comments survive, adding `# named by <lead id> on 2026-09-15`. A name already in the roster is dropped.
5. The worker's `Run` is created with `kind: "task"`, `prompt: brief`, `parentRunId: routeRun.id`. The route run appends `routed { toAgentId, childRunId, brief }` and then `done` with `deliverable: { title: "Handed to Priya", text: brief, noteId: null }`. Route runs never call `finish()` and never write a brain note.

Routine runs (`source: "routine"`) follow the same path with `kind: "routine"` on the worker run and `routineId` set on both runs.

## revise: reworking the last deliverable

`revise:` is a chat action. `packages/server` strips a leading `revise:` (case-insensitive, optional space) from `chat.send` and calls `Runner.revise`; anything else calls `Runner.chat`. The task bar has no prefixes (`office-ui.md` §4).

1. `store.lastDeliverable(agentId)` finds the most recent `done` run for this agent of kind `task`, `revise`, `routine` or `chat` with `noteId` set. None: `NOTHING_TO_REVISE`.
2. A new run of kind `revise` is created with `parentRunId` set to that run and `prompt` set to the instructions (empty means `Improve it.`).
3. `buildReviseMessages` produces the fresh system prompt (pinned set only, no search), then `user: <original run.prompt>`, `assistant: <previous deliverable text>`, `user: Revise the deliverable above. Keep everything that was not mentioned. Changes requested: <instructions>`. Tool calls from the previous run are not replayed.
4. `finish` writes a new note with `revises: <previous noteId>`; `brain.md` owns the filename rule and derives the chain position. The previous note stays in place.

## Error taxonomy

```ts
export type RunErrorCode =
  | "NO_MODEL_CONFIGURED" | "PROVIDER_NOT_CONFIGURED" | "MODEL_OVERRIDE_LEAVES_MACHINE"
  | "MODEL_NOT_FOUND" | "AUTH_FAILED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "CONTEXT_TOO_LONG"
  | "OUTPUT_TRUNCATED" | "TOOLS_UNSUPPORTED" | "TOOL_NOT_ALLOWED" | "TOOL_FAILED" | "TOOL_TIMEOUT"
  | "APPROVAL_REJECTED" | "MAX_TURNS" | "BAD_ROUTING" | "NOTHING_TO_REVISE" | "CANCELLED" | "INTERNAL";

export class RunError extends Error {
  constructor(public readonly code: RunErrorCode, public readonly detail: Record<string, string | number> = {},
              options?: { cause?: unknown; retryable?: boolean; retryAfterMs?: number });
  toJSON(): { code: RunErrorCode; message: string; hint: string; detail: Record<string, string | number> };
}
export class ProviderError extends RunError {}
export function userMessage(code: RunErrorCode, detail: Record<string, string | number>): { message: string; hint: string };
```

The server's WS `error` message reuses `{ code, message, hint }` verbatim. Every command the hints name is written `npx staffroom <sub>`; a Vitest grep across `packages/` fails on the string `Run staffroom `.

| code | message | hint |
|---|---|---|
| NO_MODEL_CONFIGURED | No model configured. | Open Settings > Models in the office and paste a key, or run `npx staffroom setup` in Terminal. |
| PROVIDER_NOT_CONFIGURED | {agent} uses {provider}, but it has no API key. | Open Settings > Models and add a {provider} key, or change the agent's model in office/agents.yaml. |
| MODEL_OVERRIDE_LEAVES_MACHINE | {agent} runs locally on purpose. | Edit office/agents.yaml if you want to change that. |
| MODEL_NOT_FOUND | {provider} does not know the model "{model}". | Check the spelling in office/agents.yaml. (Ollama: Ollama does not have {model} yet. Open Terminal and run: `ollama pull {model}` (about 5 GB).) |
| AUTH_FAILED | {provider} rejected the API key. | Paste a new key in Settings > Models, or create one on the provider's site. |
| RATE_LIMITED | {provider} is rate-limiting requests. | The office retried three times. Wait a minute and try again, or move this agent to another model. |
| PROVIDER_UNAVAILABLE | Could not reach {provider}. | Check your connection. (Ollama: Ollama is not running. Install it from ollama.com, open the Ollama app, then try again.) |
| CONTEXT_TOO_LONG | The task and notes are too long for {model}. | Shorten the task, or move this agent to a model with a bigger context window. |
| OUTPUT_TRUNCATED | {agent} ran out of room before finishing. | Ask for a shorter deliverable, or raise `runner.max_output_tokens`. |
| TOOLS_UNSUPPORTED | {model} cannot use tools, but {agent} has tools listed. | Pick a model that supports tools, or remove the tools from this agent in office/agents.yaml. |
| TOOL_FAILED | {agent} kept hitting errors with {tool}. | Check the connector in office/config.yaml. The error was: {error}. |
| TOOL_TIMEOUT | {tool} did not respond in {seconds} s. | Try again, or raise `runner.tool_timeout_ms`. |
| APPROVAL_REJECTED | You declined {tool}, so {agent} stopped. | Open their chat and send `revise:` with what to do instead. |
| MAX_TURNS | {agent} did not finish within {turns} steps. | The partial work is saved in the run. Break the task into smaller pieces. |
| BAD_ROUTING | {lead} could not pick a team member, so the task went to {agent}. | If that is wrong, open the right agent's chat and give the task there. |
| NOTHING_TO_REVISE | {agent} has no deliverable to revise yet. | Give them a task first. |
| CANCELLED | Stopped. | Nothing was saved to the brain. |
| INTERNAL | Something went wrong inside Staffroom. | Please report this with the run id {runId}. |

`TOOL_NOT_ALLOWED` never fails a run by itself; it is the tool-result text the model sees.

## Testing

- `providers/*.test.ts`: each adapter against recorded fixtures (`FixtureAdapter`) and, behind `STAFFROOM_LIVE_TESTS=1`, a small live model. Same eight assertions for all: text streams, single tool call, two parallel tool calls, tool error round-trip, forced tool, max_tokens stop, abort mid-stream, auth failure mapping.
- `runtime/loop.test.ts` with a scripted `FixtureAdapter` asserts the exact event sequence for: plain deliverable, read tool batch, write tool with approve, write tool with deny, retry after 429, max turns, cancel during a tool, resume after restart from `waiting_approval` (asserting the pending approval is expired by the server and the tool error text reaches the model), and: a pinned note containing an instruction to email the customer list produces no write call, the note is wrapped with `trust="owner"`, the tool result is wrapped `trust="untrusted"`, and the deliverable mentions the instruction.
- `prompt.test.ts`: snapshot of the assembled prompt for the sample copywriter; `SAFETY_RULE` is the last block.
- `redact.test.ts`: the `.env` marker test described above.
- `messagesFromEvents(events)` round-trips: run a loop, rebuild from the log, assert deep equality with the messages the loop sent.

## Open questions

1. Should `chunk` events be persisted at all, or only the final text per turn? Recommendation: persist them, batched at 100 ms, because replaying the typing animation is part of the demo and a 2,000-token reply is about 30 rows. Compact runs older than 30 days into one `chunk` per turn in a nightly job from v0.3.
2. Should the office default model be resolvable per department? Recommendation: not in v1. The per-agent field covers the privacy story.
3. Does a denied approval end the run or let the model continue? Recommendation as written: the model sees the denial as a tool error and gets one more turn to explain or finish; `APPROVAL_REJECTED` is raised only if it calls the same write tool again in that run.
4. Who owns the pricing table? Recommendation: `pricing.ts` is a plain JSON export with a `checked: "2026-09-15"` field per provider, updated in the weekly release, overridable in `config.yaml`.
5. Should routing use the lead's own model or the office default? Recommendation: the lead's resolved model, same chain as any run; a lead on a local model is exactly the case where the owner does not want the task text going to a cloud provider.
