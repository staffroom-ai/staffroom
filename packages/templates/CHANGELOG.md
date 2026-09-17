# @staffroom/templates

## 0.3.0

### Patch Changes

- [`61a7ff5`](https://github.com/staffroom-ai/staffroom/commit/61a7ff5a9b7b32ed6d2bf4654fca31c9ca5ee354) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Fixes the version every package reports about itself.
  
  0.2.0 shipped reporting 0.1.1 from `npx staffroom --version`, from `/health` and
  in the welcome frame. Changesets bumps package.json and knows nothing about a
  constant in the source, so the two had drifted apart during the release itself.
  The constants are now synced as part of `changeset version`, inside the Version
  pull request, rather than left for a lint gate to catch after the fact.

- [#10](https://github.com/staffroom-ai/staffroom/pull/10) [`e51a874`](https://github.com/staffroom-ai/staffroom/commit/e51a8741d7bb011cb7d8216aa45c575588797b0b) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Three things a new office got wrong on its first run. A brand-new office no
  longer warns that your keys could end up in a commit — its own `.gitignore` was
  missing SQLite's `-wal` and `-shm` files. A mistyped command says which word it
  did not know instead of "too many arguments for 'start'". And pointing `--office` at a folder
  that already has your files in it no longer claims there is nothing there — nor
  writes over them: laying a template down now skips every file that already
  exists and names the ones it left alone.

## 0.2.0

### Patch Changes

- [`0dec60b`](https://github.com/staffroom-ai/staffroom/commit/0dec60b95955e89cd1bc55ffe7384dddee2b3e4a) Thanks [@amanchhabra](https://github.com/amanchhabra)! - A new office is no longer an empty room.
  
  The studio template ships one run that already happened — the copywriter reading
  four notes and writing the autumn retainer email that revises the first draft —
  and it is written into the run log the first time the office opens. The office
  now opens showing one thing filed, and the brain graph opens with real arrows on
  it rather than a filing cabinet nobody has ever read.
  
  Three rules keep it from being a lie. It is marked `sample: true`, like the
  template's notes, so it can be cleared out when the owner goes live. It is only
  ever written into an empty run log, so it can never add history to an office that
  has a past of its own. And its events are stamped at the run's own time rather
  than now: the note is dated March in its own front matter, and a card saying it
  was filed a moment ago would be a small lie about when work happened.
  
  `RunStore.append` takes an optional timestamp for this, which is also what
  replaying recorded history needs.

- [`ab14f50`](https://github.com/staffroom-ai/staffroom/commit/ab14f50b48318f07cf64928e8b8eb51f2dd80b3f) Thanks [@amanchhabra](https://github.com/amanchhabra)! - `npx staffroom tools add <name> --for <agent>` copies one of the example tools
  into your office and gives it to somebody. The README told you to run this; it did
  not exist, and a tool on disk that nobody holds does nothing except make you
  think the product is broken. Without `--for` it copies the file and tells you who
  your staff are so the next command can be copied straight out.
  
  Fixed: the approval demo in the README did not work. Asking for the `send_sms`
  tool's own TRY IT line produced an ordinary written answer instead of an approval
  card, because the department lead's generic routing transcript rewrote the task
  into a brief with none of the original words in it. There is now a routing
  transcript for that request.
  
  The approval card no longer prints the destination twice.

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Demo mode, the studio template, file watchers and the boot sequence. A folder made
  by init now serves a working office with no API key at all.

### Patch Changes

- [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Every package now ships its own LICENSE, NOTICE and README, and `@staffroom/core`
  no longer bundles vitest into its testing entry.
