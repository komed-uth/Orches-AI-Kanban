import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnManaged, stopProcessGroup } from "../server/processes.mjs";
import { chromiumLaunchOptions } from "./chromium.mjs";

// Own Chromium before its protocol handshake. Playwright launch detaches the
// browser before returning a public handle, which misses partial startup when
// this probe is killed abruptly. Connecting to a managed browser avoids that gap.
const markup =
  '<main id="probe">pending</main><script>document.querySelector("main").textContent="orches-readiness-executed";</script>';
let profile, child, browser;
try {
  profile = await mkdtemp(path.join(tmpdir(), "orches-chromium-profile-"));
  const options = chromiumLaunchOptions();
  child = spawnManaged(
    options.executablePath,
    [
      ...options.args,
      "--headless",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--disable-sync",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    let diagnostic = "";
    const deadline = setTimeout(
      () => reject(new Error("Chromium startup timed out")),
      5000,
    );
    const fail = (error) => {
      clearTimeout(deadline);
      reject(error);
    };
    child.once("error", fail);
    child.once("close", () =>
      fail(new Error(`Chromium exited before its handshake: ${diagnostic}`)),
    );
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(0, 8192);
      const match =
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(
          diagnostic,
        );
      if (match) {
        clearTimeout(deadline);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint, { timeout: 3000 });
  const page = await browser.newPage();
  await page.setContent(markup, { timeout: 3000 });
  if (
    (await page.locator("#probe").textContent()) !== "orches-readiness-executed"
  )
    throw new Error("Chromium returned no page execution evidence");
  console.log("Chromium launched and executed a local page.");
} finally {
  // Stop the managed target even if protocol shutdown stalls. The supervisor
  // also performs this cleanup through lifetime EOF after an abrupt probe death.
  if (child) await stopProcessGroup(child);
  if (browser) await browser.close();
  if (profile) await rm(profile, { recursive: true, force: true });
}
