import {
  supportedRuntime,
  gitWorktreeSupported,
} from "./host-requirements.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { command, requireSuccess } from "./contributor-process.mjs";
import { cacheLocation, probeCache } from "./contributor-cache.mjs";

let blocked = false;
let temporary;
let probeEnv;
let interrupted = false;
const onInterrupt = () => {
  interrupted = true;
};
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onInterrupt);
async function check(label, action, operation) {
  if (interrupted) throw new Error("readiness interrupted");
  try {
    await operation();
    console.log(`PASS ${label}`);
  } catch (error) {
    blocked = true;
    // External commands may print account details; expose only a short reason.
    const reason = error.message
      .replaceAll(/[\r\n]+/g, " ")
      .slice(0, 400)
      .replace(
        /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
        "[redacted]",
      );
    console.log(`BLOCKED ${label}: ${reason}. Action: ${action}`);
  }
}
const run = async (args, evidence) => {
  const output = requireSuccess(
    await command(process.execPath, args, { env: probeEnv }),
  );
  if (!output.includes(evidence))
    throw new Error("probe returned no execution evidence");
};
try {
  temporary = await mkdtemp(path.join(tmpdir(), "orches-readiness-"));
  probeEnv = {
    ...process.env,
    TMPDIR: temporary,
    NODE_COMPILE_CACHE: path.join(temporary, "node-compile-cache"),
  };
  await check(
    "Linux / Node 22.13+ / Git worktree host",
    "Use the supported Linux host, Node >=22.13 and Git >=2.5 on PATH",
    async () => {
      if (!supportedRuntime())
        throw new Error("unsupported application runtime");
      if (
        !gitWorktreeSupported(
          requireSuccess(await command("git", ["--version"])),
        )
      )
        throw new Error("Git worktree support unavailable");
    },
  );
  await check(
    "dependency install (npm run setup)",
    "Run node scripts/setup.mjs with a writable --cache PATH",
    async () => {
      await probeCache(cacheLocation());
      requireSuccess(
        await command("npm", ["ls", "--depth=0"], { limit: 4096 }),
      );
    },
  );
  await check(
    "npm test capabilities",
    "Use the supported host grant for subprocesses, loopback listeners and temporary files; rerun npm test",
    () => run(["scripts/check-capabilities.mjs"], "Test capabilities:"),
  );
  await check(
    "npm run skills:setup -- --check",
    "Run npm run skills:setup; inspect the pinned source or network policy",
    () => run(["scripts/skills.mjs", "--check"], "Skills verified:"),
  );
  await check(
    "npm run test:browser / npm run test:pages Chromium",
    "Run npx playwright install chromium, or set ORCHES_CHROMIUM to the supported executable; install host browser libraries",
    () =>
      run(
        ["scripts/probe-browser.mjs"],
        "Chromium launched and executed a local page.",
      ),
  );
  await check(
    "GitHub read access and repository push permission (PR publication)",
    "Use gh auth status and the supported host network/authentication tooling; obtain repository write access",
    async () => {
      const output = requireSuccess(
        await command("gh", [
          "api",
          "repos/{owner}/{repo}",
          "--jq",
          ".permissions.push",
        ]),
      );
      if (output !== "true")
        throw new Error("repository push permission is unavailable");
    },
  );
  console.log(
    "UNVERIFIED model connectivity and provider grants beyond these probes; no model called. Code checks/build/browser suites and actual GitHub writes remain unverified; run the relevant checks before pushing.",
  );
  process.exitCode = blocked ? 1 : 0;
} catch (error) {
  console.error(
    `BLOCKED readiness: ${error.message}. Check temporary file access and execution grants; rerun npm run ready.`,
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
