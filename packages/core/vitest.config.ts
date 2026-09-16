import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The same reason the server package raises it: most of these tests are
    // arithmetic, but a good few open a real office — SQLite, the run store,
    // esbuild compiling a custom tool, a spawned MCP server. Five seconds is
    // sized for the arithmetic, and on a shared Windows runner it has failed
    // three of the office tests while the code was doing the right thing.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/testing/**"],
      reporter: ["text", "lcov"],
      // The gate is the point: core is the part a bug in cannot be seen from the
      // interface. Branches sit closest to the line, which is expected — error
      // paths have the most branches and the fewest natural callers.
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
