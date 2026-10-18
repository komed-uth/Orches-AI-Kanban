import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { inspectCodexHost } from "../server/codex.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) =>
  args.includes(name) ? args[args.lastIndexOf(name) + 1] : fallback;
const dataDir = resolve(
  value("--data-dir", process.env.ORCHES_DATA_DIR ?? ".orches-data"),
);
const output = resolve(
  value("--output", join(dataDir, "evaluation-" + Date.now())),
);
const secretValues = Object.entries(process.env)
  .filter(
    ([key, val]) =>
      val && /password|secret|token|cookie|authorization|api.?key/i.test(key),
  )
  .map(([, val]) => val);
const redact = (value) =>
  secretValues
    .reduce(
      (text, secret) => text.split(secret).join("[REDACTED]"),
      String(value),
    )
    .replace(
      /((?:authorization|(?:set-)?cookie)\s*:\s*)[^\r\n\"]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(orches_session\s*=\s*)[^;\s\"]+/gi, "$1[REDACTED]")
    .replace(
      /(authorization\s*:\s*(?:bearer\s+)?|cookie\s*:\s*|(?:password|token|api[_-]?key)\s*[=:]\s*)[^\s\";,]+/gi,
      "$1[REDACTED]",
    );
const summary = {
  mode: flag("--fixture")
    ? "synthetic-fixture"
    : flag("--live")
      ? "live"
      : "diagnostic",
  dataDir,
  phases: {
    initialization: "not-attempted",
    connectivity: "unverified",
    humanAcceptance: "incomplete",
  },
  outcome: "incomplete",
};
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
} catch {
  console.log(
    JSON.stringify({
      mode: summary.mode,
      outcome: "blocked",
      blocker:
        "Cannot create evidence output directory. Select a writable --output path.",
    }),
  );
  process.exit(2);
}
try {
  if (flag("--fixture") && !flag("--live"))
    throw new Error(
      "--fixture requires --live; normal diagnostics never run a model.",
    );
  for (let i = 0; i < args.length; i++) {
    if (["--live", "--fixture"].includes(args[i])) continue;
    if (
      !["--data-dir", "--output", "--executable", "--deadline-ms"].includes(
        args[i],
      ) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error("Unknown or incomplete evaluation option: " + args[i]);
    i++;
  }
  let settings = {},
    persisted = {};
  if (existsSync(join(dataDir, "orches.sqlite"))) {
    const db = new DatabaseSync(join(dataDir, "orches.sqlite"), {
      readOnly: true,
    });
    try {
      persisted = JSON.parse(
        db.prepare("SELECT body FROM documents WHERE id=1").get()?.body ?? "{}",
      );
      settings = persisted.settings ?? {};
    } finally {
      db.close();
    }
  }
  const executable = value("--executable", settings.executable ?? "codex");
  summary.host = await inspectCodexHost({ executable });
  const [major, minor] = process.versions.node.split(".").map(Number);
  summary.host.supported =
    process.platform === "linux" &&
    (major > 22 || (major === 22 && minor >= 13));
  summary.host.version = redact(summary.host.version ?? "").slice(0, 256);
  const writable = async (directory) => {
    let probe;
    try {
      await mkdir(directory, { recursive: true });
      probe = await mkdtemp(join(directory, ".orches-write-probe-"));
      await writeFile(join(probe, "probe"), "writable");
      return true;
    } catch {
      return false;
    } finally {
      if (probe) await rm(probe, { recursive: true, force: true });
    }
  };
  summary.host.codexRuntimeWritable = await writable(
    resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex")),
  );
  summary.host.temporaryWritable = await writable(tmpdir());
  summary.host.runtimeWritable = await writable(dataDir);
  summary.outcome =
    summary.host.installed &&
    summary.host.loggedIn &&
    summary.host.supported &&
    summary.host.runtimeWritable &&
    summary.host.codexRuntimeWritable &&
    summary.host.temporaryWritable
      ? "diagnostic-ready"
      : "blocked";
  if (flag("--live") && summary.outcome === "diagnostic-ready") {
    summary.outcome = "incomplete";
    if (
      persisted.runs?.some((r) =>
        ["queued", "starting", "running", "waiting", "verifying"].includes(
          r.state,
        ),
      )
    )
      throw new Error(
        "Runtime contains active work. Stop its host and recover deliberately, or use a dedicated evaluation runtime.",
      );
    const { evaluateLive } = await import("./evaluate-live.mjs");
    try {
      await evaluateLive({
        summary,
        dataDir,
        output,
        executable,
        deadlineMs: Number(value("--deadline-ms", "60000")),
        redact,
        addSecret: (secret) => {
          if (secret) secretValues.push(secret);
        },
      });
    } catch (error) {
      summary.outcome = "blocked";
      summary.blocker = redact(error.message);
    }
  }
} catch (error) {
  summary.outcome = "blocked";
  summary.blocker = redact(error.message).slice(0, 2000);
}
const sanitize = (data) =>
  typeof data === "string"
    ? redact(data)
    : Array.isArray(data)
      ? data.map(sanitize)
      : data && typeof data === "object"
        ? Object.fromEntries(
            Object.entries(data).map(([key, val]) => [key, sanitize(val)]),
          )
        : data;
let serialized = JSON.stringify(sanitize(summary), null, 2) + "\n";
if (Buffer.byteLength(serialized) > 65536) {
  summary.outcome = "incomplete-evidence";
  serialized =
    JSON.stringify({
      mode: summary.mode,
      outcome: summary.outcome,
      phases: summary.phases,
      evidence: {
        missing: true,
        reason: "Summary exceeded 64 KiB; inspect retained runtime.",
      },
    }) + "\n";
}
await writeFile(join(output, "summary.json"), serialized, { mode: 0o600 });
console.log(
  JSON.stringify(
    sanitize({
      mode: summary.mode,
      outcome: summary.outcome,
      host: summary.host,
      phases: summary.phases,
      blocker: summary.blocker?.slice(0, 512),
      artifact: join(output, "summary.json").slice(0, 1024),
    }),
  ),
);
process.exitCode = summary.outcome === "diagnostic-ready" ? 0 : 2;
