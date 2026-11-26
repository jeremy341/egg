import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/server/test/setup.ts"],
    // Holds one WSL session open for the whole run so the distro is never cold-started mid-test.
    globalSetup: ["src/server/test/global-setup.ts"],
    // Ten files drive the mock Nest, and every command they run is a wsl.exe process that
    // costs real CPU. One worker per core (11 here) starved those commands: with 11 workers
    // the full run failed 2 to 16 deploy tests by timeout, with 6 it still failed jobs.test,
    // with 4 it passed. The suite is only ~40s slower than at 11 workers.
    maxWorkers: 4,
    // Setup hooks create a database and a mock SSH host, which can take a while when
    // every test file runs at once on a busy machine.
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
