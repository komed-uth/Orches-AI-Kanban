import { chromium } from "@playwright/test";
// Shared by readiness and both public browser suites.
export function chromiumLaunchOptions() {
  return {
    args: ["--no-sandbox"],
    executablePath: process.env.ORCHES_CHROMIUM || chromium.executablePath(),
  };
}
