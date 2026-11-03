import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "backend-integration.spec.ts",
  workers: 1,
  webServer: [
    { command: "PHASE5_TEST_SERVER=true npm --prefix backend run test:phase5-server", url: "http://127.0.0.1:3001/health", reuseExistingServer: false, timeout: 30000 },
    { command: "npm run dev -- --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: false },
  ],
});
