# @staffroom/web

## 0.1.1

### Patch Changes

- Fixed: 0.1.0 of `staffroom`, `@staffroom/server` and `@staffroom/web` could not be
  installed. They were published with `npm publish`, which ships pnpm's
  `workspace:*` literally instead of rewriting it to a version, so every install
  failed with `Unsupported URL Type "workspace:"`.

  `prepublishOnly` now refuses any publish that is not pnpm, in every package.

- Updated dependencies []:
  - @staffroom/core@0.1.1

## 0.1.0

### Minor Changes

- [`12bee73`](https://github.com/staffroom-ai/staffroom/commit/12bee734ab032c042d0432fa90383c81572c9c9d) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Department cards over the model and a rail beside it: what is happening, what came
  out, and what needs your permission. The office can now be read, not just looked at.

- [`bbeccd8`](https://github.com/staffroom-ai/staffroom/commit/bbeccd8bf03626fe199c2cf63902aef921d92bb4) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The 3D office renders: floor, Brain, six pods, desks and agents at their seats,
  with a task bar that runs a real task.

- [`eed23b4`](https://github.com/staffroom-ai/staffroom/commit/eed23b4fe1a1a5db18d1ba5e7296219b29a6304f) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The office's logic layer: the socket client, the store, the floor plan, the keymap
  and the mapping from run events to what the screen does.

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

- A list view: the same office said plainly, for a screen reader, a phone, or when
  you just want the facts in a column. Latest results, a section per department with
  the lead named, and Reception for work nobody has picked up. Status is a word as
  well as a dot, so it is never carried by colour alone.

  Below 768px it is the only view; above 1024px the office is the default; the band
  between remembers your choice. `L` toggles. "Skip to list view" is first in the
  tab order, the canvas is hidden from screen readers, and a polite live region
  announces status changes at most once per person every five seconds.

- Settings > Models, opened from the model chip in the header. Paste a key and it is
  written to `office/.env`; the field is a password field and is never populated,
  because an office that can show your key back to you is an office that can leak
  it. A rejected key shows the server's own message under its own row.

  The office reads keys when it starts, so a pasted key takes effect on restart.

### Patch Changes

- [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Every package now ships its own LICENSE, NOTICE and README, and `@staffroom/core`
  no longer bundles vitest into its testing entry.

- The first download dropped from 325 kB to 81 kB gzipped. three.js, fiber and drei
  are more than four fifths of the bundle, and anyone on a phone or in the list view
  never renders a frame of it, so the 3D office is now fetched only when it draws.
- Updated dependencies [[`1fac259`](https://github.com/staffroom-ai/staffroom/commit/1fac25921daadd06136186694fd9fb868ac988d3), [`d0d2179`](https://github.com/staffroom-ai/staffroom/commit/d0d21790030db02a1e25d5a0c185344b8a084b62), [`8e44496`](https://github.com/staffroom-ai/staffroom/commit/8e4449692f25d55b5a798331a4b59f9eb8c457ce), [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611), [`29569aa`](https://github.com/staffroom-ai/staffroom/commit/29569aacce9d7e202331b78dcf1ad03e9c79a715), [`ecbdbd4`](https://github.com/staffroom-ai/staffroom/commit/ecbdbd426657acbd0efbcbcd7e2ce0028ec236ea), [`55ea25d`](https://github.com/staffroom-ai/staffroom/commit/55ea25def2211078bab60cb8d2577dc23188cb39), [`bbeccd8`](https://github.com/staffroom-ai/staffroom/commit/bbeccd8bf03626fe199c2cf63902aef921d92bb4), [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261), [`6ac1b9a`](https://github.com/staffroom-ai/staffroom/commit/6ac1b9a6a2259da27e46266e3267202a272ae177), [`d989317`](https://github.com/staffroom-ai/staffroom/commit/d989317b61d18098ba0f649da29f558c31195d87), [`863a471`](https://github.com/staffroom-ai/staffroom/commit/863a471aa88caecd3818107fd0f65e93e3f0c646), [`5f16d5d`](https://github.com/staffroom-ai/staffroom/commit/5f16d5dfb49343f8a62b66e44afe04513039a127), [`c6c0ea2`](https://github.com/staffroom-ai/staffroom/commit/c6c0ea2cf05593a645341a037e882dba7accc22b)]:
  - @staffroom/core@0.1.0
