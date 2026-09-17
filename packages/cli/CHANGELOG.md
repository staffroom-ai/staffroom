# staffroom

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
