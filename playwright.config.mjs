import { chromiumLaunchOptions } from "./scripts/chromium.mjs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4319",
    launchOptions: chromiumLaunchOptions(),
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/server.mjs",
    url: "http://127.0.0.1:4319/api/setup",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
