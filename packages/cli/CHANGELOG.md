# staffroom

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
