# Roadmap

Dates are targets, not promises. The detail behind each line is in
[`docs/implementation-plan.md`](docs/implementation-plan.md).

## v0.1 — it works end to end (27 October 2026)

- [ ] The office renders, six departments, agents at desks
- [ ] Type a task, the right agent picks it up and files a result in your notes
- [ ] Anthropic, OpenAI-compatible and Ollama adapters, with a model per agent
- [ ] Custom tools from `office/tools/*.ts`
- [ ] Demo mode with no keys configured
- [ ] One-command install

## v0.2 — connected (10 November 2026)

- [ ] MCP servers over stdio and HTTP, with the connector bar
- [ ] Approvals with an exact preview of what will be sent
- [ ] Brain graph and search
- [ ] Routines on a schedule
- [ ] Docker image and the docs site

## v0.3 — yours

- [ ] Templates: agency, ecommerce, clinic, consultant
- [ ] Teach the office: correct a result, the agent learns
- [ ] Cost and usage per agent and per model
- [ ] Community provider adapters

## v1.0 — stable

- [ ] Frozen adapter and OfficeState interfaces
- [ ] Import from other agent configs
- [ ] Windows as a first-class platform
- [ ] Optional remote office as a separate package

## Not planned

These are deliberate noes. An issue asking for one will be closed with a link to
this line, usually within 72 hours.

- Multi-user accounts or authentication in the main package
- A visual workflow builder (Langflow and n8n do this well)
- Custom office layouts before v1.0
- RAG beyond the markdown brain
- Any dependency on `@anthropic-ai/claude-agent-sdk`
- Telemetry that is on by default

The `not planned` label is never applied to a bug report.
