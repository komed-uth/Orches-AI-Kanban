import { chromium } from "@playwright/test";
import { chromiumLaunchOptions } from "./chromium.mjs";

// Playwright owns a separate browser process group. Retain its public server
// handle so interruption of this probe also stops that group.
let server;
function stopBrowser() {
  const pid = server?.process().pid;
  if (pid)
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
}
// Allow Playwright's launch-time signal handlers to begin cleanup. A bounded
// exit then triggers its registered exit cleanup if a partial launch has no
// usable protocol connection yet; killing this worker with SIGKILL cannot.
process.once("SIGTERM", () => {
  if (server) {
    stopBrowser();
    process.exit(1);
  } else setTimeout(() => process.exit(1), 250);
});
try {
  server = await chromium.launchServer({
    ...chromiumLaunchOptions(),
    timeout: 5000,
  });
  const browser = await chromium.connect(server.wsEndpoint(), {
    timeout: 3000,
  });
  const page = await browser.newPage();
  await page.setContent("<title>orches-readiness</title>", { timeout: 3000 });
  if ((await page.title()) !== "orches-readiness")
    throw new Error("Chromium page execution failed");
  console.log("Chromium launched and executed a local page.");
} finally {
  if (server) {
    const deadline = setTimeout(stopBrowser, 1000);
    try {
      await server.close();
    } finally {
      clearTimeout(deadline);
      stopBrowser();
    }
  }
}
