import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Real sockets and SQLite: a forked process per file keeps them isolated.
    pool: "forks",
    testTimeout: 20_000,
  },
});
