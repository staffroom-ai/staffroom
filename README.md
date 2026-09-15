# Staffroom

**Your AI staff, in an office you can watch. Free for commercial use.**

A 3D isometric office where named AI agents with roles do real work. Type a task,
the right agent picks it up, reads your notes, uses your connected tools, and files
the result back for your approval. Everything runs on your machine.

- **Apache-2.0.** Free for personal, internal and commercial use, with a patent grant.
- **Every agent can run on a different model.** Anthropic, OpenAI-compatible, or a
  local Ollama model for the work that should never leave the machine.
- **Tools are yours.** Any MCP server, plus custom tools you write as a single file.
- **Local-first.** Your notes are a folder of markdown you already own.

## Status

Pre-release. Nothing is installable yet. The design is finished and the build is
scheduled: see [docs/implementation-plan.md](docs/implementation-plan.md) for the
ticket list and [docs/specs/](docs/specs/) for the specifications.

First public release (`v0.1.0`) is scheduled for 27 October 2026.

## Development

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
