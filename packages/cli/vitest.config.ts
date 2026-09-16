import { defineConfig } from "vitest/config";

/**
 * The CLI's tests do real work on the filesystem: they copy a template, write an
 * office, and spawn the built binary as a child process. Five seconds is the
 * default because most tests are arithmetic; these are not, and on a shared
 * Windows runner the first template copy has timed out at five seconds while
 * saying nothing at all about the CLI.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
