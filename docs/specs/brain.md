# Brain: the user's notes and the deliverables agents write back

Status: draft 2, 15 Sep 2026 (reconciled). Owner: core maintainer.

The brain is the one place Staffroom keeps knowledge about the business. It is a folder of markdown files the owner already owns and can edit in any editor. Agents read it to get context and write their deliverables back into it as new notes. Everything else (the search index, the graph, embeddings) is derived from those files and can be thrown away.

Sibling specs: `core-agent-loop.md` (the run log the graph joins against, the prompt section that carries the pinned set, `finish()`), `tools-mcp-approvals.md` (the three brain tools are registered there; their schemas are defined here), `server-cli-runtime.md` (file watching, the WebSocket messages `brain.*`, the CLI), `office-ui.md` (graph overlay, deliverable card).

This spec owns: `NoteFrontMatter`, the folder layout, the note id rule, `brainSearch` and `BrainSearchHit`, `brainWriteDeliverable`, the input schemas of `brain_search`, `brain_read` and `brain_write`, `BrainGraph` and its node and edge types, the `brain:` block of `config.yaml`, and the sample studio content.

## Decisions

- The brain is `office/brain/**/*.md`. Files are the source of truth. No note content lives only in a database.
- Front-matter is YAML. Required keys: `title`, `created`. Agent-written notes fill in `written_by`, `task`, `run`, `model`, `tools_used`.
- Links between notes use Obsidian-style `[[wiki-links]]`. The graph is derived from them at index time.
- The index is SQLite FTS5 in `office/brain.index.sqlite`, next to `runs.sqlite` and outside `brain/`. It is a cache; `npx staffroom brain reindex` recreates it.
- Embeddings are off by default. When on, `brain.embeddings.model` is required; there is no default, so enabling them cannot pick a cloud provider by accident.
- Agents reach the brain only through three registry tools: `brain_search` (read), `brain_read` (read), `brain_write` (write, local). All three are implied for every agent (`tools-mcp-approvals.md` §1). No agent gets a filesystem handle.
- `brain_write` can only create a new draft under `40-deliverables/<department>/`. It takes no path and no mode. Nothing is ever overwritten and no tool can edit or delete an existing note. Writing to the brain never blocks on approval; the owner's Approve click on the deliverable card is the approval.
- Two context mechanisms and only two: the pinned set (`pinned: true`, capped at `brain.pinned_token_budget`) in every system prompt, and the agent-initiated tools. There is no automatic retrieval the agent did not ask for, so the run log shows every read.
- Anything under a folder named `_private/`, and any note with `private: true`, is never indexed, never pinned and never returned by a tool. It is not in the index at all.
- Sample content from a template is marked `sample: true` and is offered for archiving the moment the office goes live.
- Core exposes `BrainIndex.reindexFile(path)` and `.removeFile(path)`; the server's chokidar watcher calls them (`server-cli-runtime.md` §2). Core does not watch files.
- The brain never leaves the machine except as excerpts inside prompts sent to whichever provider the agent's model resolves to. An agent on `ollama/*` sends nothing off-machine.

## Folder layout

Numbered top-level areas so the folder sorts the same in Finder, Obsidian and `ls`. The numbers are convention; the indexer treats any `.md` under `brain/` as a note.

```
office/brain/
  00-about/            who we are, what we sell, who we sell to, tone of voice (the pinned notes)
  10-customers/        one note per customer or segment
  20-products/         offerings, pricing, FAQs
  30-processes/        how we do things
  40-deliverables/     agent output, one folder per department id
    marketing/  sales/  finance/  ops/  product/  support/
  50-meetings/         call notes, decisions
  90-archive/          indexed at 0.5 weight, never pinned; where brain import lands by default
  inbox/               files dropped through the office upload; trust "imported"
  _private/            never indexed: logins, card numbers, anything agents must never read
  _attachments/        images and PDFs referenced by notes (indexed by filename only)
```

Rules the indexer applies:

- A file is a note if it ends in `.md` and is not under `_attachments/`, `_private/` (at any depth), or any folder starting with `.`. A note with `private: true` in its front-matter is skipped the same way.
- The note id is the path relative to `brain/`, without `.md`, forward slashes on every platform: `10-customers/acme-pty-ltd`.
- Filenames are kebab-case ASCII. `brain_write` slugifies titles; hand-written files with spaces still index but new files never get spaces.
- `90-archive/` and `inbox/` notes score at 0.5 weight and are never pinned.
- Trust, as the prompt assembler in `core-agent-loop.md` needs it: `owner` for `written_by: owner`, `agent` for `written_by: agent:*`, `imported` for anything under `90-archive/` or `inbox/` or created by `brain import`.

## Note format

```markdown
---
title: Acme Pty Ltd
tags: [customer, retainer, melbourne]
created: 2026-09-02T09:14:00+10:00
updated: 2026-09-11T16:40:00+10:00
written_by: owner
pinned: false
---

Acme is a 12-person accounting firm in Richmond. Monthly retainer, $2,400.
Main contact is Dana Kerr. They care about turnaround more than price.

See [[30-processes/monthly-reporting]] for what we send them on the 1st.
```

```ts
// packages/core/src/brain/types.ts
export interface NoteFrontMatter {
  title: string;                    // required
  created: string;                  // required, ISO 8601 with offset
  updated?: string;
  tags?: string[];
  written_by: "owner" | `agent:${string}`;   // defaults to "owner" if missing
  task?: string;                    // task id, or "routine:<routineId>"
  run?: string;                     // run id
  tools_used?: string[];            // registry tool names actually called
  model?: string;                   // resolved model id
  department?: string;              // a department id from agents.yaml
  status?: "draft" | "approved" | "sent" | "rejected";   // deliverables only
  revises?: string;                 // note id of the previous revision
  pinned?: boolean;                 // include in the always-on context set
  private?: boolean;                // never indexed
  sample?: boolean;                 // shipped by a template
  links?: string[];                 // explicit extra links (note ids)
}
```

Missing `title` falls back to the first `# heading`, then the filename. Missing `created` falls back to file birth time with a `brain.warning { scope: "note", reason: "missing_created" }` pushed over the WebSocket (`server-cli-runtime.md` §6). Invalid YAML indexes as body-only; a note is never dropped for bad front-matter.

## Wiki-links and the graph

Resolution order: exact id `[[10-customers/acme-pty-ltd]]`; basename `[[acme-pty-ltd]]` if unique; title `[[Acme Pty Ltd]]` case-insensitive if unique; `|alias` and `#heading` are ignored for resolution. Unresolved links become edges to a phantom node (`kind: "missing"`). Plain markdown links to `.md` paths count as links. Front-matter `links:` adds edges. Edges are directed from the linking note.

## The index

`office/brain.index.sqlite`:

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, front_matter TEXT NOT NULL, body TEXT NOT NULL,
  content_hash TEXT NOT NULL, mtime INTEGER NOT NULL, word_count INTEGER NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
  trust TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE notes_fts USING fts5(id UNINDEXED, title, tags, body, tokenize = 'porter unicode61');
CREATE TABLE links (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, resolved INTEGER NOT NULL, PRIMARY KEY (from_id, to_id, kind));
CREATE TABLE embeddings (id TEXT PRIMARY KEY, model TEXT NOT NULL, dims INTEGER NOT NULL, vec BLOB NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`meta.schema_version` mismatch triggers a full rebuild, not a migration.

### Search

```ts
export interface BrainSearchOptions {
  limit?: number;                          // default 8, max 25
  department?: string;                     // boosts 40-deliverables/<department>/ and matching front-matter
  tags?: string[];
  writtenBy?: "owner" | "agent" | "any";
  mode?: "keyword" | "hybrid";
}
export interface BrainSearchHit { id: string; title: string; score: number; excerpt: string; frontMatter: NoteFrontMatter }
export function brainSearch(q: string, opts?: BrainSearchOptions): Promise<BrainSearchHit[]>;
```

Keyword mode is FTS5 `bm25()` with weights title 4, tags 2, body 1, multiplied by `notes.weight`. Hybrid runs FTS5 and cosine over `embeddings`, top 25 each, merged with reciprocal rank fusion (k=60). `brain.results` over the WebSocket carries the same `BrainSearchHit[]`.

### Embeddings (behind a flag)

```yaml
# office/config.yaml
brain:
  path: ./brain
  ignore: ["**/.trash/**"]
  pinned_token_budget: 4000
  embeddings:
    enabled: false
    model: ollama/nomic-embed-text      # required when enabled; no default
    chunk_tokens: 400
    chunk_overlap: 60
```

`BrainConfigSchema` is referenced from `ConfigSchema` (`server-cli-runtime.md` §5); `enabled: true` without `model` is a `ConfigError`. Adapters expose optional `embed()` (`core-agent-loop.md`). A provider without it logs `brain.warning { scope: "index", reason: "embed_unsupported" }` and stays in keyword mode. Changing `model` invalidates every row. The config docs and the Settings panel both say, next to the key: enabling this on a cloud model sends every note to that provider once.

### Rebuild and watch

- `npx staffroom brain reindex [--embeddings]` deletes the index and reindexes every note. Exits 0 even with warnings.
- On server start `BrainIndex.open()` walks `brain/`, compares `content_hash` and `mtime`, reindexes changed files, removes rows whose file is gone. A 2,000-note brain finishes in under two seconds on a 2020 MacBook Air; a Vitest benchmark fails over five.
- Core exposes `reindexFile(path)` and `removeFile(path)`. The server's watcher (`packages/server/src/watch/brain.ts`) debounces 300 ms per path, ignores `.obsidian/`, `_attachments/`, `_private/` and `brain.ignore`, and pushes `brain.note.indexed` or `brain.note.removed` so the graph updates live.
- Writes by `brain_write` go through the same path; core does not double-index.

## How an agent gets context

Two mechanisms, and only two. The prompt assembler in `core-agent-loop.md` handles the first; the registry handles the second.

### 1. The pinned set, always included

Every note with `pinned: true` (and not `sample: true` while the office is live) is concatenated in path order into system prompt section 3, "About this business", each wrapped as `<note path=... updated=... trust=...>`. The block is capped at `brain.pinned_token_budget` (default 4,000 tokens). Overflow drops whole notes in path order; the loop emits `brain_pinned_included` with the ids used and `brain_pinned_truncated` with the ids left out, and the server pushes `brain.warning { scope: "pinned" }`. Convention: `00-about/` holds the pinned notes and nothing else is pinned.

### 2. The tools, on demand

```ts
tool({
  name: "brain_search", scope: "read",
  description: "Search the owner's notes. Returns the best matching notes with excerpts. Use before doing any work that depends on facts about this business.",
  input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(25).optional(), tags: z.array(z.string()).optional() }),
  async run({ query, limit, tags }, ctx) { return brainSearch(query, { limit, tags, department: ctx.department }); },
})
tool({
  name: "brain_read", scope: "read",
  description: "Read one note in full by its id, when a search excerpt is not enough.",
  input: z.object({ id: z.string() }),
  async run({ id }) { return brainRead(id); },      // { id, frontMatter, body } or a not-found error
})
```

Both return the note ids they touched as `ToolResult.noteIds`, which the loop copies onto the `tool_result` event; that is the only source of "who read this". The model sees the results as JSON inside the `<tool_result trust="untrusted">` wrapper. There is no automatic retrieval step.

## Writing deliverables back

```ts
tool({
  name: "brain_write", scope: "write", local: true,
  description: "Save a deliverable to the owner's notes. Call once, at the end, with the finished work.",
  input: z.object({
    title: z.string(),
    body: z.string(),                       // markdown, may contain [[wiki-links]]
    tags: z.array(z.string()).optional(),
    revises: z.string().optional(),         // note id of the previous revision
  }),
  async run(input, ctx) { return brainWriteDeliverable(input, ctx); },   // -> { noteId }
})
```

`brainWriteDeliverable` is also what `finish()` in `core-agent-loop.md` calls, so a deliverable is recorded the same way whether the model or the loop wrote it. It derives the path `40-deliverables/<ctx.department>/<yyyy-mm-dd>-<slug>.md`, adding `-2`, `-3` on collision, and refuses to overwrite. It fills the front-matter from run context; the model cannot set these fields:

```yaml
---
title: Landing page copy for the autumn retainer offer
tags: [deliverable, landing-page, marketing]
created: 2026-09-15T10:22:31+10:00
updated: 2026-09-15T10:22:31+10:00
written_by: agent:copywriter
department: marketing
task: task_01J8ZKQ4M2S3X9F7W1A6B0CDE
run: run_01J8ZKQ4NQ5T2V8H3C9D4E5FG
model: anthropic/claude-opus-5
tools_used: [brain_search, brain_read, notion.search_pages]
status: draft
links: [00-about/tone-of-voice, 20-products/retainer-packages]
---
```

`tools_used` comes from the run's `tool_call` events. `links` is filled with every note id in this run's `tool_result.noteIds` that the body does not already link to. The registry treats the tool as `local: true`: it appends the approval pair with `by: system` and runs at once (`tools-mcp-approvals.md` §5). The loop then appends `brain_note_written { noteId, revises?, status: "draft" }`. The office shows the note on the deliverable card; the owner's Approve click flips `status` to `approved`. If the same task also named an outbound action, the approval for that action is separate and comes first.

## Revision history

`revise:` in the agent chat creates a run of kind `revise` (`core-agent-loop.md`) whose `finish()` passes `revises: <previous noteId>`. Result:

- A new file `40-deliverables/marketing/2026-09-15-landing-page-copy-autumn-retainer-2.md` with `revises` set.
- The previous note gets one front-matter change: `status: rejected` if it was `draft`; unchanged if `approved` or `sent`.
- A `revises` edge in `links` (kind `revises`), so the chain reads as a line. `brainRevisions(noteId)` returns the chain oldest-first; position in the chain is derived, never stored.
- The UI shows the latest revision with "v3, revised from v2" and a client-side diff toggle.

## Graph view data contract

Served as one snapshot on `brain.graph.get` (reply `brain.graph`), then patched by `brain.note.indexed`, `brain.note.removed` and `brain_note_written` run events. Rendered on `G` in `packages/web` as a 2D SVG with a list-view twin.

```ts
export interface BrainGraph { generatedAt: string; nodes: BrainGraphNode[]; edges: BrainGraphEdge[] }

export interface BrainGraphNode {
  id: string;                          // note id, or "missing:<target>"
  kind: "note" | "deliverable" | "sample" | "missing";
  title: string; area: string; department?: string;
  writtenBy: "owner" | `agent:${string}`; trust: "owner" | "agent" | "imported";
  pinned: boolean; status?: "draft" | "approved" | "sent" | "rejected";
  created: string; updated: string; wordCount: number;
  readBy: Array<{ agentId: string; runId: string; at: string }>;      // last 20
  wroteBy?: { agentId: string; runId: string; taskId: string; at: string };
}
export interface BrainGraphEdge { from: string; to: string; kind: "link" | "revises" | "read" }   // "read" only with includeReads
```

`readBy` is joined at snapshot time from `runs.sqlite`: every `tool_result` event whose `name` is `brain_search` or `brain_read` carries `noteIds`, grouped by note. `wroteBy` comes from `brain_note_written`. Neither is stored in the brain index.

The side panel shows the rendered note with `Show in Finder` (`open -R`, or the platform equivalent) by default; `Open in editor` appears only when Obsidian, VS Code or Typora is detected, because TextEdit in rich-text mode mangles front-matter on save. The docs say to set TextEdit to plain text for `.md` files.

## Sample studio content (demo mode)

`packages/templates/studio/brain/` is Northlight Studio, a 3-person brand and web design studio in Melbourne. Every note carries `sample: true`. The template's `runs.sqlite` ships one run with `sample: true` (`core-agent-loop.md`). The demo transcripts in `packages/templates/studio/demo-runs/*.jsonl` reference these ids so the graph opens with real `readBy`, `wroteBy` and one `revises` chain.

| Note id | One line |
|---|---|
| `00-about/company` (pinned) | Northlight Studio, founded 2023, projects from $6k, retainers from $2,400/mo. |
| `00-about/customers-we-want` (pinned) | Professional services firms with 5 to 50 staff who have outgrown a DIY site. |
| `00-about/tone-of-voice` (pinned) | Plain, warm, specific. Short sentences. Say the price. |
| `00-about/how-we-work` (pinned) | Discovery call, fixed-price proposal within 3 days, 50% deposit, two rounds of revisions. |
| `10-customers/acme-pty-ltd` | Accounting firm, retainer, contact Dana Kerr; links to monthly-reporting. |
| `10-customers/harbour-physio` | Physio clinic, one-off site in 2025, asked about a booking page; warm upsell. |
| `10-customers/kerr-and-lowe-lawyers` | Prospect from a referral, discovery call 22 Sep. |
| `20-products/retainer-packages` | Three tiers ($2,400 / $3,800 / $5,500). |
| `20-products/website-projects` | Fixed-price tiers ($6k, $11k, $18k), timelines. |
| `20-products/faq` | Twelve questions clients ask before signing. |
| `30-processes/monthly-reporting` | What goes in the retainer report sent on the 1st. |
| `30-processes/invoicing` | Xero, net 14, reminder cadence. |
| `30-processes/onboarding-a-client` | Checklist from signed proposal to kickoff. |
| `40-deliverables/marketing/2026-09-08-autumn-offer-email` | Priya: three-email sequence, `status: approved`; its rejected v1 sits beside it. |
| `40-deliverables/sales/2026-09-10-prospect-shortlist-melbourne-law-firms` | Lee: eight law firms, `status: draft`. |
| `50-meetings/2026-09-04-acme-check-in` | Dana wants a case study by November. |
| `_private/logins.md` | Demonstrates the private folder: a fake Xero login that no search ever returns. |

### Leaving demo mode

When the office flips to live (Settings > Models, `npx staffroom setup`, or a key found at boot), the server asks once, in the UI and in `setup`: `Remove the sample notes and runs from Northlight Studio? Your own notes are kept. (Recommended)`. Yes moves every `sample: true` note to `90-archive/_sample/` with `pinned: false` and deletes runs with `sample: true`. No keeps them, but the pinned set skips `sample: true` notes from then on, and they render dimmed in the graph (`kind: "sample"`). Either way the answer is recorded in `.staffroom/scheduler.json` so the question is not asked twice. `approvals.yaml` is not touched.

## Importing an existing vault or folder

`npx staffroom brain import <path> [--move] [--area 90-archive] [--include-tools]`, also exposed as `importBrain(source, opts)` for the setup wizard.

- Copies by default; `--move` moves. An Obsidian vault (`.obsidian/` present) imports with links, aliases, headings and `![[embeds]]` intact; attachments go to `_attachments/` with references rewritten.
- A plain folder is walked recursively; relative markdown links are kept.
- Files land under `--area` (default `90-archive/`). Existing front-matter is kept; missing `title` and `created` are filled; `written_by: owner` is added. No note is pinned by import.
- `package.json`, `node_modules/`, `tools/` and `.staffroom/` in the source are skipped unless `--include-tools` is passed, and the summary says so (`tools-mcp-approvals.md` §2).
- Ends with an incremental index pass and a summary: notes imported, links resolved and unresolved, attachments copied, files skipped.

## What never leaves the machine

- The `brain/` folder, the index, and the graph are never uploaded anywhere. No sync, no telemetry that includes note content or titles.
- Note text reaches a model provider only as part of a prompt for an agent whose resolved model is on that provider, and only the pinned notes plus what `brain_search` and `brain_read` returned in that run. The run log records exactly which ids (`brain_pinned_included` and `tool_result.noteIds`), so the owner can answer "what did Priya send to Anthropic on Tuesday" from the runs panel.
- An agent on `ollama/*` sends nothing off the machine; the office shows a "local" pill on those agents.
- Anything under `_private/` or marked `private: true` is not in the index and cannot be read by any agent. `npx staffroom doctor brain.secrets` warns when a non-private note contains a line matching the key-name regex from `core-agent-loop.md`'s `redactSecrets` or a 16+ digit number, with the fix "move it to _private/ or add private: true".
- MCP servers never receive brain content unless an agent passes it as a tool argument, which is capped by the egress limit for reads and shown in the approval preview for writes.
- `_attachments/` files are indexed by filename only in v1.

## Open questions

1. Should `brain_write` create the note as `draft` even when the task named no outbound action? Recommended: always `draft`. One rule, and the Approve click is cheap.
2. Should the pinned budget be per agent as well as per office? Recommended: office-level only in v0.1; per-agent override in v0.3 when usage reporting shows why it matters.
3. Chunked embeddings return chunk hits, but the API returns notes; which excerpt? Recommended: chunk excerpt when the hit came from the vector side, FTS excerpt otherwise, one `excerpt` field.
4. Should hand edits to a deliverable count as a revision? Recommended: no. Only `brain_write` creates `revises` edges; a hand edit updates `updated` and the diff view says "edited by you".
5. Do we need a `brain_list` tool (browse by area or tag without a query)? Recommended: yes, `scope: read`, capped at 50 ids with titles, implied like the other three. Decide before the v0.1 tool freeze; owner is the core maintainer.
