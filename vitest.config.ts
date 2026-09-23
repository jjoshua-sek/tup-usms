import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure logic modules.
 *
 * Scope is deliberate: the modules under test take their inputs as arguments
 * and their clock as a parameter, so none of them need a database, a browser
 * or a running server. That is the property that makes the scheduler, the
 * risk scorer, the sanction ladder and the delivery policy assertable at all,
 * and it is worth preserving as more of them get covered.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
