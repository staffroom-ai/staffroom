import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
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
