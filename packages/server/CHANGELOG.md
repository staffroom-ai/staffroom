# @staffroom/server

## 0.1.0

### Minor Changes

- [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Demo mode, the studio template, file watchers and the boot sequence. A folder made
  by init now serves a working office with no API key at all.

- [`863a471`](https://github.com/staffroom-ai/staffroom/commit/863a471aa88caecd3818107fd0f65e93e3f0c646) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The office over HTTP and WebSocket. A client can now open a socket, submit a task,
  watch it run, approve what it asks for, and see the deliverable land.

- [`5f16d5d`](https://github.com/staffroom-ai/staffroom/commit/5f16d5dfb49343f8a62b66e44afe04513039a127) Thanks [@amanchhabra](https://github.com/amanchhabra)! - A visual identity for the office, and the last of the M1 server routes: renaming
  someone, storing a provider key, giving someone a tool, and opening a deliverable
  in the file manager.

- The activity feed gained search and a person filter, with `/` to focus. Tool cards
  appear in the feed rather than as toasts: a toast about a tool that will not
  compile disappears before you have read the line number. A failure shows the
  compiler's own words with a Copy button; a success asks who may use the new tool.

  After ten seconds without a server, a banner says the office has stopped and hands
  you the command to restart it.

  Approval cards now render their fields, with sensitive ones masked, and accept
  `A` or `R` then Enter.

  Fixed: the file watcher announced every tool change as successful without ever
  opening the file, so a syntax error looked exactly like a working tool. It now
  loads the file, registers what is new, and reports what failed.

- Talk to one member of staff, and do something with what they produce. The chat tab
  shows a single person: their name edited in place, their model, and the turns of
  the conversation. A finished piece of work arrives as a card you can open, reveal
  on disk, or send back for another pass, and `Open in brain` reads the actual file
  without leaving the office. Selecting someone from the Staff list is the way in,
  which is also the first time anything in the office was clickable.

  `welcome` now carries the platform, so the button says Finder, Explorer or file
  manager according to the machine it is running on.

- `runDoctor` is exported, so the office can run the same checks the CLI does and
  show them in the browser. Every check that is not ok carries a hint: a diagnostic
  that only tells you something is broken has moved the problem, not helped with it.

### Patch Changes

- [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Every package now ships its own LICENSE, NOTICE and README, and `@staffroom/core`
  no longer bundles vitest into its testing entry.

- Fixed: the office could finish a whole piece of work without ever appearing to do
  any. Every state push was coalesced by 250 ms, and a replayed demo run's working
  window is about 300 ms, so the browser's snapshot routinely arrived after the work
  had already finished — nobody ever showed as working, on the first thing a new
  user sees.

  Status changes now go out immediately and cancel anything queued behind them.
  Ordinary chatter still coalesces.

- Updated dependencies [[`1fac259`](https://github.com/staffroom-ai/staffroom/commit/1fac25921daadd06136186694fd9fb868ac988d3), [`d0d2179`](https://github.com/staffroom-ai/staffroom/commit/d0d21790030db02a1e25d5a0c185344b8a084b62), [`8e44496`](https://github.com/staffroom-ai/staffroom/commit/8e4449692f25d55b5a798331a4b59f9eb8c457ce), [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611), [`29569aa`](https://github.com/staffroom-ai/staffroom/commit/29569aacce9d7e202331b78dcf1ad03e9c79a715), [`ecbdbd4`](https://github.com/staffroom-ai/staffroom/commit/ecbdbd426657acbd0efbcbcd7e2ce0028ec236ea), [`55ea25d`](https://github.com/staffroom-ai/staffroom/commit/55ea25def2211078bab60cb8d2577dc23188cb39), [`bbeccd8`](https://github.com/staffroom-ai/staffroom/commit/bbeccd8bf03626fe199c2cf63902aef921d92bb4), [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261), [`6ac1b9a`](https://github.com/staffroom-ai/staffroom/commit/6ac1b9a6a2259da27e46266e3267202a272ae177), [`d989317`](https://github.com/staffroom-ai/staffroom/commit/d989317b61d18098ba0f649da29f558c31195d87), [`863a471`](https://github.com/staffroom-ai/staffroom/commit/863a471aa88caecd3818107fd0f65e93e3f0c646), [`5f16d5d`](https://github.com/staffroom-ai/staffroom/commit/5f16d5dfb49343f8a62b66e44afe04513039a127), [`c6c0ea2`](https://github.com/staffroom-ai/staffroom/commit/c6c0ea2cf05593a645341a037e882dba7accc22b)]:
  - @staffroom/core@0.1.0
