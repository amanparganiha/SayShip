import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testEnv } from "./server/test/testEnv.ts";

export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  test: {
    include: ["server/test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["server/test/global-setup.ts"],
    env: testEnv,
    // Test files share one Postgres database; run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
