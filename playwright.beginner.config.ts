import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "beginner-workflow.spec.ts",
  workers: 1,
  webServer: [
    { command: "BEGINNER_TEST_SERVER=true backend/node_modules/.bin/tsx backend/scripts/beginner-test-server.ts", url: "http://127.0.0.1:3101/health", reuseExistingServer: false, timeout: 30000 },
    { command: "BACKEND_API_TARGET=http://127.0.0.1:3101 npm run dev -- --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: false },
  ],
});
