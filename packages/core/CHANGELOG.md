# @staffroom/core

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- [`1fac259`](https://github.com/staffroom-ai/staffroom/commit/1fac25921daadd06136186694fd9fb868ac988d3) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Config loading, model resolution and secret redaction. `agents.yaml` and
  `config.yaml` now parse, validate and report problems the way an owner can act on,
  edits keep the owner's comments, and every agent resolves to a model through a
  documented four-step chain.

- [`d0d2179`](https://github.com/staffroom-ai/staffroom/commit/d0d21790030db02a1e25d5a0c185344b8a084b62) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Tool registry and the approval gate. Every call from an agent to a tool goes
  through one path, which is what makes the safety rules enforceable rather than
  advisory.

- [`8e44496`](https://github.com/staffroom-ai/staffroom/commit/8e4449692f25d55b5a798331a4b59f9eb8c457ce) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Ollama adapter. Agents on a local model send nothing off the machine, which is what
  makes "keep this agent local" a promise rather than a label.

- [`29569aa`](https://github.com/staffroom-ai/staffroom/commit/29569aacce9d7e202331b78dcf1ad03e9c79a715) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Append-only run log over SQLite. Every event is redacted before it reaches disk,
  streaming chunks are batched for the disk but delivered to the office immediately,
  and the run's status is maintained in the same transaction as the event that
  changed it.

- [`ecbdbd4`](https://github.com/staffroom-ai/staffroom/commit/ecbdbd426657acbd0efbcbcd7e2ce0028ec236ea) Thanks [@amanchhabra](https://github.com/amanchhabra)! - `createOffice` assembles the whole runtime: roster, brain, tools, providers and the
  Runner. A task now routes to an agent, runs, and leaves a deliverable on disk.

- [`55ea25d`](https://github.com/staffroom-ai/staffroom/commit/55ea25def2211078bab60cb8d2577dc23188cb39) Thanks [@amanchhabra](https://github.com/amanchhabra)! - OpenAI-compatible adapter. Works with OpenAI, and with anything else speaking
  chat-completions (Groq, Together, OpenRouter, LM Studio) by pointing `baseURL` at
  it. Endpoints that reject `stream_options` are detected once and never asked
  again; their token usage is estimated and marked as such.

- [`6ac1b9a`](https://github.com/staffroom-ai/staffroom/commit/6ac1b9a6a2259da27e46266e3267202a272ae177) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Brain index: search, wiki-links and the graph over a folder of markdown. The notes
  are the truth and the index is a disposable cache, so deleting it costs nothing but
  a rebuild.

- [`d989317`](https://github.com/staffroom-ai/staffroom/commit/d989317b61d18098ba0f649da29f558c31195d87) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Provider contract, error taxonomy and the Anthropic adapter. Core can now talk to
  a model: 19 named errors with a message and a fix for each, a replay adapter that
  lets every provider be tested without a network, and the first real adapter.

- [`863a471`](https://github.com/staffroom-ai/staffroom/commit/863a471aa88caecd3818107fd0f65e93e3f0c646) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The office over HTTP and WebSocket. A client can now open a socket, submit a task,
  watch it run, approve what it asks for, and see the deliverable land.

- [`5f16d5d`](https://github.com/staffroom-ai/staffroom/commit/5f16d5dfb49343f8a62b66e44afe04513039a127) Thanks [@amanchhabra](https://github.com/amanchhabra)! - A visual identity for the office, and the last of the M1 server routes: renaming
  someone, storing a provider key, giving someone a tool, and opening a deliverable
  in the file manager.

- [`c6c0ea2`](https://github.com/staffroom-ai/staffroom/commit/c6c0ea2cf05593a645341a037e882dba7accc22b) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The agent loop. An agent can now be given a task, use its tools, and file a
  deliverable, with every step recorded as a replayable event.

### Patch Changes

- [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Every package now ships its own LICENSE, NOTICE and README, and `@staffroom/core`
  no longer bundles vitest into its testing entry.

- [`bbeccd8`](https://github.com/staffroom-ai/staffroom/commit/bbeccd8bf03626fe199c2cf63902aef921d92bb4) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The 3D office renders: floor, Brain, six pods, desks and agents at their seats,
  with a task bar that runs a real task.

- [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Demo mode, the studio template, file watchers and the boot sequence. A folder made
  by init now serves a working office with no API key at all.

- Fixed: custom tools could not be loaded from the published package at all.

  The loader worked out where to put its build cache, and where its own entry point
  was, by counting directories up from `import.meta.url`. That depth is different in
  the source tree and in the bundle, so it resolved correctly under test and one
  level too high once built. Anyone who wrote a tool in `office/tools/` and ran the
  released package got `Cannot find package 'zod'`, while every test stayed green.

  Both paths now find the package root instead of counting, and the regression test
  lives in `@staffroom/server`, which imports core the way a user does.

- Fixed: every installed copy of the CLI failed on launch with
  `Cannot find package 'vitest'`.

  Demo mode replays through `FixtureAdapter`, which it imports from
  `@staffroom/core/testing`. That entry also re-exported the provider conformance
  suite, which imports vitest. vitest is an optional peer, so it is present in this
  repository and absent in every real install: the office worked here and died
  everywhere else, on the first command a new user runs.

  The conformance suite now lives at `@staffroom/core/testing/conformance`.
  `@staffroom/core/testing` keeps the fixtures and fakes and imports no test
  framework.
