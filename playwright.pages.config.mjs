import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/pages",
  use: {
    baseURL: "http://127.0.0.1:4320",
    launchOptions: {
      args: ["--no-sandbox"],
      ...(process.env.ORCHES_CHROMIUM
        ? { executablePath: process.env.ORCHES_CHROMIUM }
        : {}),
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/pages/server.mjs",
    url: "http://127.0.0.1:4320/",
    reuseExistingServer: false,
  },
});
