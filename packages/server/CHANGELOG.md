# @staffroom/server

## 0.2.0

### Minor Changes

- [`f88fae1`](https://github.com/staffroom-ai/staffroom/commit/f88fae1b233d9e076eaa4df982567ea6f75dbb06) Thanks [@amanchhabra](https://github.com/amanchhabra)! - "Approve and always allow" works from the office, not just from code, and the
  connector strip now tells you the truth about your MCP servers.
  
  A decision has to say what it is allowing: `approve_always` without a match is
  refused with `MATCH_REQUIRED` and a hint saying to allow it for a specific
  recipient instead. Guessing on the owner's behalf is how one permission becomes
  every permission.
  
  Each MCP server is one connector rather than one per tool, carrying the
  connection's own health — starting, ok, down, denied, needs auth — and the reason
  when there is one. That message goes through redaction, because a connection
  failure can quote a URL with a token in it. A server that is down reads as down
  even though the tools it used to offer are no longer registered at all.
  
  `mcp.reconnect` brings a server back after you have fixed whatever was wrong,
  without restarting the office. And `approvals.yaml` is watched: deleting a row
  takes the permission back straight away.

- [`106b3cf`](https://github.com/staffroom-ai/staffroom/commit/106b3cfc0788103e8e6275bc3f7020ebc6884be9) Thanks [@amanchhabra](https://github.com/amanchhabra)! - MCP servers that need you to sign in can now be signed in to. The SDK does the
  protocol — PKCE with S256, discovery, the token exchange; what Staffroom owns is
  everything touching your machine.
  
  Tokens are written to `office/.staffroom/secrets/`, the file mode 0600 and the
  folder 0700, and are registered for redaction the moment they are saved rather
  than at the next restart: a token that reaches a log before then is a token in a
  log. Saved tokens are re-registered as the office opens, before any run can
  start.
  
  The callback route carries no session token, because the redirect arrives from
  somebody else's website. A `state` the office issued is therefore the only thing
  that makes a callback ours, it is good for exactly one use, and it expires. A
  callback without one is refused and nothing is written.
  
  A server that answers 401 is left at `needs_auth` and is not retried. Retrying
  achieves nothing until you have actually signed in, and a loop of failing
  requests against somebody's auth server is a good way to be rate-limited.

- [`6da13db`](https://github.com/staffroom-ai/staffroom/commit/6da13dbbb40441b89382f777de4aeafaf69664f6) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Ask once about the sample business, and act on the answer.
  
  Every office starts as Northlight Studio, a design studio in Melbourne, because
  an empty office cannot show anybody what an office does. The moment you connect
  a model of your own, that content is a stranger's business sitting in the middle
  of yours, and your staff read it as fact.
  
  So the first time the office comes up live it asks, in Settings > Models, and
  never asks again. Say remove and the template's notes move to
  `90-archive/_sample/`, which the index skips, so they stop answering searches and
  stop reaching prompts — the files are still there to open. The sample runs are
  deleted, so "Latest results" is yours from the start. Nothing you wrote is
  touched, and `approvals.yaml` is left alone either way.

- [`96a686b`](https://github.com/staffroom-ai/staffroom/commit/96a686be284384fdb02aa6732ebae2469af7de84) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Three things Settings could not do before: see what you have already allowed,
  check the office without leaving it, and change the model everybody uses.
  
  **Standing permissions.** Every row from `approvals.yaml`, with who it is for,
  what it is pinned to, and when it was last used — the field that tells a
  permission still earning its place from one to take back. Revoke removes that
  one row from the file, and the next call asks again.
  
  **Checks.** A button that runs the same checks as `npx staffroom doctor`, in a
  table. Same function, so the two surfaces cannot drift apart.
  
  **Default model.** A select filled from what each configured provider says it
  can run today, written to `agents.yaml` through the document-mode writer so your
  comments survive. A provider that could not answer is named with its reason,
  rather than quietly leaving its models out of the list.

- [`3a6ada6`](https://github.com/staffroom-ai/staffroom/commit/3a6ada670c0eed866fb62333b4704de4fa471e1f) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Bring an office's files forward when Staffroom learns a new setting.
  
  An office made with an older version now opens, rather than printing an
  instruction. `config.yaml` goes to version 2, which writes
  `approvals.whitelist_days` out explicitly — it arrived with "Approve and always
  allow" and until now has been a 90-day default nobody could see, which is the
  wrong way round for a setting that decides how long an agent may send email
  unattended.
  
  Your file is edited, not rewritten, so comments and ordering survive, and a copy
  of it as it was is kept at `.staffroom/backups/config.yaml.v1.bak` before
  anything is written. Running twice does nothing the second time.
  
  `npx staffroom migrate --dry-run` says what would change and writes nothing.
  A file written by a newer Staffroom than you have is refused with the one thing
  that helps, rather than opened on settings this build does not understand.

### Patch Changes

- [`29d73be`](https://github.com/staffroom-ai/staffroom/commit/29d73be8c00067422b1878e2fe46b06e4ab83b5d) Thanks [@amanchhabra](https://github.com/amanchhabra)! - web_search can actually search now: Brave, Tavily and self-hosted SearXNG.
  
  Each maps its own reply shape to the same `{ title, url, snippet }`, and the
  whole result set is capped at 4,000 characters — titles and links included,
  because all three are text a stranger wrote arriving inside the agent's context,
  which makes them the cheapest prompt-injection surface in the product. The hit
  that crosses the line is truncated rather than dropped, so a partial extract
  still carries a link worth following.
  
  Nothing here throws. A rejected key, a backend that is down, a reply in a shape
  nobody expected: each comes back as a result the agent can read and report,
  rather than an exception that ends a run somebody was watching. The key goes in
  a header, never a query string, and never appears in an error message.
  
  The web_search connector follows: grey with no backend, and red with the reason
  once a call has actually failed. Configured-but-never-called is not reported as
  working, because it has not been shown to work.

- [`07cd7bd`](https://github.com/staffroom-ai/staffroom/commit/07cd7bd1f65f989d7696726b2bc787641a2c3e79) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Show what the office is connected to, and whether it is working, in the header.
  
  Each connector is a 24px chip with a health dot: green when it is working, amber
  when it needs signing in to, red when it is not answering, struck through when it
  has been denied. Anything the owner can fix sorts to the front. Hovering or
  focusing a chip opens a card with the server's name, its state in plain English,
  any error message, how many tools it has and who can use them — the state is
  never carried by colour alone.
  
  An amber connector gets a Connect button, which completes the OAuth sign-in that
  was already implemented but had no way to be started from the office; a red one
  gets Try again.

- [`41e563c`](https://github.com/staffroom-ai/staffroom/commit/41e563c609561e9ec1b74133b56b6a3a95d4b70f) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Say when, beside the task bar.
  
  "Do it" and "do it every weekday at eight" are the same sentence with a time
  attached, so they are the same control: a calendar button in the task bar opens
  four choices and a time, the button changes from Send to Schedule, and what was
  chosen is written out in full beside it. An icon alone would say there is
  something about time here and nothing about what was picked.
  
  The picker offers only cadences the office will actually fire. `cron` is in the
  routine schema and the scheduler refuses it, so it is not on the menu — and a
  cron routine already in someone's file is listed saying plainly that this
  version will not run it, rather than sitting there looking scheduled.
  
  Routines are listed in Settings and in the list view, with pause, run now and
  delete. Unattended work is the part of this product that happens while nobody is
  looking, so it is stoppable from wherever the owner happens to be. Delete asks
  first; it is the one thing here that cannot be undone from this screen.
  
  `routine.upsert` now merges onto a routine that already exists, which is what
  the word means and what makes Pause possible: the browser is sent a routine's
  label and cadence, never its task or its agent, so it cannot send a whole one
  back.

- [`422f788`](https://github.com/staffroom-ai/staffroom/commit/422f7884876255396e4021511da029179413c6e4) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The brain, as a picture you can open with G.
  
  A force layout drawn in SVG, written out rather than pulled in: the graph is a
  business's notes, not a social network, so a general-purpose library would be
  several times the size of the thing it lays out. It is also deterministic — the
  same brain draws the same picture every time it opens, because an owner learns
  the shape of their own notes and a picture that rearranges itself is one they
  stop reading.
  
  Colour says who wrote a note, a ring says a deliverable is waiting on them,
  template filler is dimmed and a note nobody wrote is an outline. None of it is
  carried by colour alone: every node is a real element carrying a sentence saying
  who wrote it, what state it is in and whether it exists, so the picture can be
  read with a keyboard and a screen reader. Tab follows the folders the owner
  made, not wherever the physics settled.
  
  Notes can be dropped onto the office or chosen with a button, and the new node
  appears without a reload. A file the brain cannot use is refused in the browser,
  so nobody waits for a round trip to be told. There is a table twin of the whole
  thing for narrow windows and for anybody the picture does not serve.
  
  A note with a revision before it says which draft it is and offers to show what
  changed, line by line. "Open in editor" appears only when Obsidian, VS Code or
  Typora is actually installed — on a Mac a `.md` with nothing installed opens in
  TextEdit, which rewrites the file as RTF on save and destroys the front matter,
  and a button that quietly corrupts the owner's notes is worse than no button.

- [`4ae6943`](https://github.com/staffroom-ai/staffroom/commit/4ae69436b4d199fac88496ba1fcca6d136c26bc1) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Tell the owner what happened to a tool file they just saved.
  
  One `tools.reloaded` message now carries three pieces of news, and a file can be
  more than one of them at once: it would not compile and here is the line the
  compiler blamed; its author left `scope` out, so it will ask for approval on
  every call; and nobody may use it yet, with everyone who could be given it.
  
  `tools.assign` takes the whole card's answer — a tool and a set of people — in
  one message instead of one per person, reports any name that did not take rather
  than quietly doing three of four, and announces `agents.yaml` itself so other
  tabs update even when the office is not watching the folder.
  
  Assigning a tool or renaming someone now takes effect in the office that is
  running. Both wrote the file and left the roster in memory as it was read at
  boot, so a tool handed out from the card did not reach the agent, and the next
  state still showed the old row, until a restart.
  
  The who-may-use-it checkboxes were 13 pixels square and unnamed. They are now
  rows you can hit, each carrying the person's name for a screen reader.

- [`417fd1d`](https://github.com/staffroom-ai/staffroom/commit/417fd1df1e5b4d90deb19b1d4aca81d2a1e182b7) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Routines: work the office does without being asked.
  
  `office/routines.yaml` holds them, and the scheduler ticks every thirty seconds
  in the office's own timezone. That last part is the whole difficulty: 08:00 in
  Melbourne is a different UTC instant in March than in July, and a routine that
  drifts by an hour twice a year is a routine nobody trusts. Every fire time is
  decided as a wall clock and then converted, with both sides of a daylight-saving
  change pinned in the tests by date.
  
  Three rules the scheduler is built on. Routines run one at a time, so two agents
  do not write to the brain at eight in the morning; a task the owner types is
  never blocked behind one. The mark moves before the work starts, so a crash
  loses a run rather than repeating it — for something that emails a customer,
  twice is the worse failure. And waking from sleep is noticed: a gap far longer
  than a tick means the lid was down, and the office works out what was missed.
  
  What it does about that is the owner's setting. `latest` runs once, titled
  `Catch-up: <label>`; `all` runs one per missed fire, capped at seven; `skip`
  moves on. Two limits are not settings, because neither has a defensible other
  value: nothing older than a week is ever run, and coming back from a fortnight
  away to fourteen queued runs is a mess rather than a catch-up.
  
  `task.create` with a `schedule` becomes a routine, so "do it" and "do it every
  morning" are one control rather than two concepts. A routine naming somebody who
  is not in the office is refused while the owner is looking at the screen, not at
  eight the next morning with nobody there to see it.
  
  `Run` gains a `label`, so a catch-up can say so while the agent still receives
  exactly the task that was written. `runs.sqlite` gains the incremental migration
  path the spec always described: an older log is brought forward rather than
  moved aside, because it is the owner's history of everything their office has
  done.

- [`d2c83aa`](https://github.com/staffroom-ai/staffroom/commit/d2c83aac3f2e094d3b76d12667b8864f67d8d509) Thanks [@amanchhabra](https://github.com/amanchhabra)! - The brain reaches the browser: the graph, live note changes, warnings, uploads.
  
  `brain.graph.get` answers the tab that asked and nobody else — it is a whole
  snapshot of the brain, and sending it to every tab because one person opened a
  panel would be sending it to tabs looking at something else.
  
  A note written or deleted in Obsidian now shows up without a reload. The office
  pushes a delta rather than a new graph, because this comes from a file watcher
  and a snapshot per keystroke is not a design.
  
  `brain.warning` is pushed for the first time. Front matter that would not parse
  says so and says the note was indexed anyway, so nobody thinks their writing was
  thrown away. A pinned set over budget names the notes the agent did not get to
  see: the pinned notes are the only context every agent gets without asking, so
  one falling out silently is an agent working without something the owner
  believed it had.
  
  `POST /api/brain/upload` takes a `.md`, `.txt` or `.pdf` into `brain/inbox/`,
  where notes are indexed at half weight and never pinned. It is the one route
  that writes a file the owner did not type, so the filename is not checked but
  thrown away and rebuilt: a multipart filename is attacker-chosen text about to
  become a path. An upload never lands on a name already taken.
- Updated dependencies [[`f88fae1`](https://github.com/staffroom-ai/staffroom/commit/f88fae1b233d9e076eaa4df982567ea6f75dbb06), [`f345e76`](https://github.com/staffroom-ai/staffroom/commit/f345e76aea2488378efa6a5b73fbbaed3aa71cb2), [`29d73be`](https://github.com/staffroom-ai/staffroom/commit/29d73be8c00067422b1878e2fe46b06e4ab83b5d), [`195a745`](https://github.com/staffroom-ai/staffroom/commit/195a74525276536972b92e82f54bebd1f7c419b9), [`0dec60b`](https://github.com/staffroom-ai/staffroom/commit/0dec60b95955e89cd1bc55ffe7384dddee2b3e4a), [`b2689da`](https://github.com/staffroom-ai/staffroom/commit/b2689dab2da35f779b5adcddc3d25070f7cb97d9), [`106b3cf`](https://github.com/staffroom-ai/staffroom/commit/106b3cfc0788103e8e6275bc3f7020ebc6884be9), [`289801b`](https://github.com/staffroom-ai/staffroom/commit/289801b48c5173e0ef65713430b5b04dba936137), [`beab34c`](https://github.com/staffroom-ai/staffroom/commit/beab34cf9c644ac0988791c81ae3a02306a2dc9b), [`422f788`](https://github.com/staffroom-ai/staffroom/commit/422f7884876255396e4021511da029179413c6e4), [`4ae6943`](https://github.com/staffroom-ai/staffroom/commit/4ae69436b4d199fac88496ba1fcca6d136c26bc1), [`c72e0e2`](https://github.com/staffroom-ai/staffroom/commit/c72e0e2995b4cac4e8d7194d3ca52cd7e13b0adc), [`6da13db`](https://github.com/staffroom-ai/staffroom/commit/6da13dbbb40441b89382f777de4aeafaf69664f6), [`96a686b`](https://github.com/staffroom-ai/staffroom/commit/96a686be284384fdb02aa6732ebae2469af7de84), [`3a6ada6`](https://github.com/staffroom-ai/staffroom/commit/3a6ada670c0eed866fb62333b4704de4fa471e1f), [`417fd1d`](https://github.com/staffroom-ai/staffroom/commit/417fd1df1e5b4d90deb19b1d4aca81d2a1e182b7), [`c9dcb05`](https://github.com/staffroom-ai/staffroom/commit/c9dcb05a235310a0cd7ec771adb875086eb41a94), [`d2c83aa`](https://github.com/staffroom-ai/staffroom/commit/d2c83aac3f2e094d3b76d12667b8864f67d8d509)]:
  - @staffroom/core@0.2.0

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
