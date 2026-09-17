# staffroom

## 0.3.0

### Minor Changes

- [`83dd5f6`](https://github.com/staffroom-ai/staffroom/commit/83dd5f607efc1f74162ad536bc3b536bdbbbf239) Thanks [@amanchhabra](https://github.com/amanchhabra)! - More from `npx staffroom doctor`, and a support bundle that is safe to send.
  
  Six new checks: one line per MCP server and whether its secrets resolved, whether
  web search will actually work, standing permissions nobody has used in a month,
  links pointing at notes that are not there, and how much runs unattended.
  
  And `brain.secrets`: a note containing something shaped like an API key or a card
  number. Every agent reads your notes and a pinned one goes into every prompt, so
  a key written into a note is a key sent to a model provider. Notes in
  `brain/_private/` are skipped, because that is where such a note belongs.
  
  `npx staffroom doctor --bundle` writes a zip with the config, the doctor report
  and the log, with every value from your `.env` replaced by the name it came from,
  in every file. The `.env` itself is never included. It exists so nobody zips the
  folder by hand, because the hand-made version is the one with the keys in it.

- [`e6050e7`](https://github.com/staffroom-ai/staffroom/commit/e6050e717da3010791baa35080629cbd2bfdeeb2) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Three commands: write your own tool, lay down a template, and take the whole
  office with you.
  
  `npx staffroom tools new <name>` writes a tool file you fill in. It compiles as
  it stands, so the office does not greet you with a load failure before you have
  written a line, and the warning about what a custom tool can do is in the file
  rather than in the docs — where the person who needs it is looking.
  
  `npx staffroom template list` and `template apply <id> --into <dir>`. Apply
  refuses a folder that already has an office in it rather than merging.
  
  `npx staffroom export --out office-export.zip` puts everything in one file that
  does not need Staffroom to read: the notes stay markdown, the settings stay YAML,
  and the run log becomes JSON. No `.env`, nothing from `.staffroom/secrets/`, and
  every value from your `.env` replaced by the name it came from.
  
  `tools add` now prints the example's TRY IT line instead of telling you where to
  find it.

- [#12](https://github.com/staffroom-ai/staffroom/pull/12) [`6e465a7`](https://github.com/staffroom-ai/staffroom/commit/6e465a73437b526087a69a35049bf138c4dd9b5b) Thanks [@amanchhabra](https://github.com/amanchhabra)! - `npx staffroom setup` exists. Two doctor checks and the `NO_MODEL_CONFIGURED`
  error have been telling people to run it, and it was not there. It asks for your
  model keys, checks each one with a one-token request, picks the default model
  from what your provider actually offers, and asks about web search and telemetry.
  `--non-interactive` takes the same answers as flags.

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
- Updated dependencies [[`1d06d00`](https://github.com/staffroom-ai/staffroom/commit/1d06d004a18761d6aa883eec12e4bcf34028cb78), [`61a7ff5`](https://github.com/staffroom-ai/staffroom/commit/61a7ff5a9b7b32ed6d2bf4654fca31c9ca5ee354), [`7c7e8f5`](https://github.com/staffroom-ai/staffroom/commit/7c7e8f59c1556400aa3f2d800ea0a788fe68d22b), [`b65ed37`](https://github.com/staffroom-ai/staffroom/commit/b65ed370dd2ab87f74ba3a832d5bd68457d210c6), [`83dd5f6`](https://github.com/staffroom-ai/staffroom/commit/83dd5f607efc1f74162ad536bc3b536bdbbbf239), [`e51a874`](https://github.com/staffroom-ai/staffroom/commit/e51a8741d7bb011cb7d8216aa45c575588797b0b), [`c536962`](https://github.com/staffroom-ai/staffroom/commit/c536962227de9cfb58481666d0844fc640bd1765), [`6e465a7`](https://github.com/staffroom-ai/staffroom/commit/6e465a73437b526087a69a35049bf138c4dd9b5b)]:
  - @staffroom/server@0.3.0
  - @staffroom/core@0.3.0
  - @staffroom/templates@0.3.0

## 0.2.0

### Minor Changes

- [`c72e0e2`](https://github.com/staffroom-ai/staffroom/commit/c72e0e2995b4cac4e8d7194d3ca52cd7e13b0adc) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Bring an existing folder of notes into the brain, and rebuild the index when it
  is wrong.
  
  `staffroom brain import <path>` copies markdown in, fills in any front matter it
  is missing, and rewrites wiki-links so they still point at the right note now
  that it lives somewhere else. Obsidian vaults are recognised. Only the pictures
  something actually refers to come too. A `tools/` folder is left behind unless
  you ask for it, because those files run on your machine.
  
  `staffroom brain reindex` reads every note again from scratch. It works when the
  index has been deleted, which is the point: the index is a cache of the files
  and never the other way round.

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

### Patch Changes

- Updated dependencies [[`f88fae1`](https://github.com/staffroom-ai/staffroom/commit/f88fae1b233d9e076eaa4df982567ea6f75dbb06), [`f345e76`](https://github.com/staffroom-ai/staffroom/commit/f345e76aea2488378efa6a5b73fbbaed3aa71cb2), [`29d73be`](https://github.com/staffroom-ai/staffroom/commit/29d73be8c00067422b1878e2fe46b06e4ab83b5d), [`195a745`](https://github.com/staffroom-ai/staffroom/commit/195a74525276536972b92e82f54bebd1f7c419b9), [`0dec60b`](https://github.com/staffroom-ai/staffroom/commit/0dec60b95955e89cd1bc55ffe7384dddee2b3e4a), [`07cd7bd`](https://github.com/staffroom-ai/staffroom/commit/07cd7bd1f65f989d7696726b2bc787641a2c3e79), [`b2689da`](https://github.com/staffroom-ai/staffroom/commit/b2689dab2da35f779b5adcddc3d25070f7cb97d9), [`106b3cf`](https://github.com/staffroom-ai/staffroom/commit/106b3cfc0788103e8e6275bc3f7020ebc6884be9), [`41e563c`](https://github.com/staffroom-ai/staffroom/commit/41e563c609561e9ec1b74133b56b6a3a95d4b70f), [`289801b`](https://github.com/staffroom-ai/staffroom/commit/289801b48c5173e0ef65713430b5b04dba936137), [`beab34c`](https://github.com/staffroom-ai/staffroom/commit/beab34cf9c644ac0988791c81ae3a02306a2dc9b), [`422f788`](https://github.com/staffroom-ai/staffroom/commit/422f7884876255396e4021511da029179413c6e4), [`4ae6943`](https://github.com/staffroom-ai/staffroom/commit/4ae69436b4d199fac88496ba1fcca6d136c26bc1), [`c72e0e2`](https://github.com/staffroom-ai/staffroom/commit/c72e0e2995b4cac4e8d7194d3ca52cd7e13b0adc), [`6da13db`](https://github.com/staffroom-ai/staffroom/commit/6da13dbbb40441b89382f777de4aeafaf69664f6), [`96a686b`](https://github.com/staffroom-ai/staffroom/commit/96a686be284384fdb02aa6732ebae2469af7de84), [`3a6ada6`](https://github.com/staffroom-ai/staffroom/commit/3a6ada670c0eed866fb62333b4704de4fa471e1f), [`417fd1d`](https://github.com/staffroom-ai/staffroom/commit/417fd1df1e5b4d90deb19b1d4aca81d2a1e182b7), [`ab14f50`](https://github.com/staffroom-ai/staffroom/commit/ab14f50b48318f07cf64928e8b8eb51f2dd80b3f), [`c9dcb05`](https://github.com/staffroom-ai/staffroom/commit/c9dcb05a235310a0cd7ec771adb875086eb41a94), [`d2c83aa`](https://github.com/staffroom-ai/staffroom/commit/d2c83aac3f2e094d3b76d12667b8864f67d8d509)]:
  - @staffroom/server@0.2.0
  - @staffroom/core@0.2.0
  - @staffroom/templates@0.2.0

## 0.1.1

### Patch Changes

- Fixed: 0.1.0 of `staffroom`, `@staffroom/server` and `@staffroom/web` could not be
  installed. They were published with `npm publish`, which ships pnpm's
  `workspace:*` literally instead of rewriting it to a version, so every install
  failed with `Unsupported URL Type "workspace:"`.

  `prepublishOnly` now refuses any publish that is not pnpm, in every package.

- Updated dependencies []:
  - @staffroom/server@0.1.1
  - @staffroom/templates@0.1.1

## 0.1.0

### Minor Changes

- `npx staffroom` opens an office. It previously printed "not released yet".

  It works when you have done nothing at all: no office, no key, no configuration.
  Which folder counts as "the office" is resolved from `--office`, then
  `STAFFROOM_OFFICE`, then `./office` when it really is one, then the office you
  used last, and only then a new one. It will not open a browser over SSH, in
  Docker, in CI, or on a Linux box with no display.

  `npx staffroom init` makes an office folder, `--tools` adds the example tools, and
  `npx staffroom doctor` checks one over and says what to do about anything wrong:
  Node, the `.gitignore` lines that keep `.env` out of a commit, both config files,
  providers, the databases, custom tools that will not compile, and the port.
  `--fix` applies what is safe, `--json` prints it for anything that reads it.

### Patch Changes

- [`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611) Thanks [@amanchhabra](https://github.com/amanchhabra)! - Every package now ships its own LICENSE, NOTICE and README, and `@staffroom/core`
  no longer bundles vitest into its testing entry.
- Updated dependencies [[`8c5614f`](https://github.com/staffroom-ai/staffroom/commit/8c5614f0de334795918b702054087502308f2611), [`572f1d9`](https://github.com/staffroom-ai/staffroom/commit/572f1d98096534538e738259c73379969885e261), [`863a471`](https://github.com/staffroom-ai/staffroom/commit/863a471aa88caecd3818107fd0f65e93e3f0c646), [`5f16d5d`](https://github.com/staffroom-ai/staffroom/commit/5f16d5dfb49343f8a62b66e44afe04513039a127)]:
  - @staffroom/server@0.1.0
  - @staffroom/templates@0.1.0
