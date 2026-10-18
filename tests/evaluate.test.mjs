import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
const exec = promisify(execFile);
const command = resolve("scripts/evaluate.mjs");
async function fixture(t, mode = "success") {
  const root = await mkdtemp(join(tmpdir(), "orches-evaluate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(root, "codex");
  await writeFile(
    cli,
    `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('fixture-cli');\nelse if (process.argv.includes('login')) process.exit(${mode === "login" ? 1 : 0});\nelse { console.error('DIAGNOSTIC STARTED A MODEL'); process.exit(9); }\n`,
    { mode: 0o755 },
  );
  const output = join(root, "evidence");
  const runtime = join(root, "runtime");
  async function run(args = [], env = {}) {
    try {
      return {
        code: 0,
        ...(await exec(
          process.execPath,
          [
            command,
            "--data-dir",
            runtime,
            "--output",
            output,
            "--executable",
            cli,
            ...args,
          ],
          {
            env: {
              ...process.env,
              CODEX_HOME: join(root, "codex-home"),
              ...env,
            },
            timeout: 15000,
          },
        )),
      };
    } catch (e) {
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  }
  return {
    root,
    cli,
    output,
    runtime,
    run,
    summary: async () =>
      JSON.parse(await readFile(join(output, "summary.json"), "utf8")),
  };
}
test("diagnostics use host readiness without starting a model and leave connectivity unverified", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  const summary = await f.summary();
  assert.equal(summary.mode, "diagnostic");
  assert.equal(summary.host.installed, true);
  assert.equal(summary.host.loggedIn, true);
  assert.equal(summary.phases.connectivity, "unverified");
  assert.equal(summary.phases.initialization, "not-attempted");
  assert.doesNotMatch(result.stderr, /STARTED A MODEL/);
});
for (const mode of ["missing", "login", "unwritable"])
  test(`diagnostics distinguish ${mode} host blocker`, async (t) => {
    const f = await fixture(t, mode);
    if (mode === "missing") await rm(f.cli);
    if (mode === "unwritable") await writeFile(f.runtime, "not a directory");
    const result = await f.run();
    assert.equal(result.code, 2);
    const s = await f.summary();
    assert.equal(s.outcome, "blocked");
    assert.equal(s.phases.connectivity, "unverified");
    assert.equal(s.host.installed, mode !== "missing");
    assert.equal(s.host.loggedIn, !["missing", "login"].includes(mode));
    assert.equal(s.host.runtimeWritable, mode !== "unwritable");
  });
test("live execution requires credentials and never silently falls back to diagnostics", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.run(["--live"], {
        ORCHES_EVAL_USERNAME: "",
        ORCHES_EVAL_PASSWORD: "",
      })
    ).code,
    2,
  );
  const s = await f.summary();
  assert.equal(s.outcome, "blocked");
  assert.match(s.blocker, /ORCHES_EVAL_USERNAME/);
});
test("explicit synthetic live execution uses both seeded tasks and retains attributable review evidence", async (t) => {
  const f = await fixture(t);
  const result = await f.run(
    [
      "--live",
      "--fixture",
      "--executable",
      resolve("tests/fixtures/evaluation-codex.mjs"),
      "--deadline-ms",
      "5000",
    ],
    {
      ORCHES_EVAL_USERNAME: "evaluator",
      ORCHES_EVAL_PASSWORD: "test-password-123",
    },
  );
  assert.equal(result.code, 2, result.stderr);
  const s = await f.summary();
  assert.equal(s.mode, "synthetic-fixture");
  assert.equal(s.outcome, "awaiting-human-review");
  assert.equal(s.phases.initialization, "verified");
  assert.equal(s.phases.connectivity, "synthetic-only");
  assert.equal(s.phases.verification, "passed");
  assert.equal(s.phases.humanAcceptance, "incomplete");
  assert.equal(s.runs.length, 2);
  assert.equal(s.concurrent, true);
  for (const run of s.runs) {
    assert.equal(run.state, "completed");
    assert.ok(run.worktree);
    assert.ok(run.branch);
    await readFile(join(run.worktree, "fixture-pid.txt"));
  }
  const events = (await readFile(join(f.output, "events.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.ok(events.every((e) => e.mode === "synthetic-fixture" && e.taskId));
  for (const run of s.runs) assert.ok(events.some((e) => e.runId === run.id));
});
for (const mode of ["blocked", "mixed", "timeout", "noisy"])
  test(`synthetic ${mode} preserves honest bounded evidence and stops owned processes`, async (t) => {
    const f = await fixture(t);
    const result = await f.run(
      [
        "--live",
        "--fixture",
        "--executable",
        resolve("tests/fixtures/evaluation-codex.mjs"),
        "--deadline-ms",
        mode === "timeout" ? "1500" : "8000",
      ],
      {
        ORCHES_EVAL_USERNAME: "evaluator",
        ORCHES_EVAL_PASSWORD: "test-password-123",
        EVALUATION_FIXTURE: mode,
        SECRET_TOKEN: "synthetic-secret",
      },
    );
    assert.equal(result.code, 2, result.stderr);
    const summaryText = await readFile(join(f.output, "summary.json"), "utf8");
    const s = JSON.parse(summaryText);
    const evidence = await readFile(join(f.output, "events.ndjson"), "utf8");
    assert.ok(
      Buffer.byteLength(evidence) + Buffer.byteLength(summaryText) <= 1048576,
    );
    assert.ok(Buffer.byteLength(result.stdout) < 4096);
    assert.equal(s.phases.humanAcceptance, "incomplete");
    assert.doesNotMatch(
      evidence + summaryText,
      /synthetic-secret|test-password-123|orches_session=/,
    );
    for (const run of s.runs) {
      assert.ok(run.worktree);
      const pid = Number(
        await readFile(join(run.worktree, "fixture-pid.txt"), "utf8"),
      );
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.ok(
        ["failed", "cancelled", "interrupted", "completed"].includes(run.state),
        run.state,
      );
    }
    if (mode === "blocked" || mode === "mixed") {
      assert.equal(s.outcome, "blocked");
      assert.equal(s.phases.connectivity, "blocked");
      assert.equal(s.phases.initialization, "verified");
    }
    if (mode === "timeout") {
      assert.equal(s.outcome, "incomplete");
      assert.equal(s.termination, "deadline");
      assert.equal(s.phases.connectivity, "unverified");
    }
    if (mode === "noisy") {
      assert.equal(s.outcome, "incomplete-evidence");
      assert.equal(s.evidence.missing, true);
      assert.ok(s.evidence.truncatedEvents > 0);
      assert.ok(s.evidence.omittedEvents > 0);
    }
  });
test("diagnostics check the configured Codex runtime without reading credential contents", async (t) => {
  const f = await fixture(t);
  const codexHome = join(f.root, "read-only-runtime");
  await writeFile(codexHome, "synthetic credential contents");
  const result = await f.run([], { CODEX_HOME: codexHome });
  assert.equal(result.code, 2);
  const s = await f.summary();
  assert.equal(s.host.runtimeWritable, true);
  assert.equal(s.host.codexRuntimeWritable, false);
  assert.equal(s.phases.initialization, "not-attempted");
  assert.doesNotMatch(
    await readFile(join(f.output, "summary.json"), "utf8"),
    /synthetic credential contents/,
  );
});
test("fixture labeling requires explicit live opt-in", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run(["--fixture"])).code, 2);
  assert.match((await f.summary()).blocker, /--live/);
});

test("termination retains interrupted work and a second live command cannot interrupt an active runtime", async (t) => {
  const f = await fixture(t);
  const env = {
    ...process.env,
    CODEX_HOME: join(f.root, "codex-home"),
    ORCHES_EVAL_USERNAME: "evaluator",
    ORCHES_EVAL_PASSWORD: "test-password-123",
    EVALUATION_FIXTURE: "timeout",
  };
  const child = spawn(
    process.execPath,
    [
      command,
      "--live",
      "--fixture",
      "--data-dir",
      f.runtime,
      "--output",
      f.output,
      "--executable",
      resolve("tests/fixtures/evaluation-codex.mjs"),
      "--deadline-ms",
      "10000",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill("SIGKILL"));
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => (stdout += data));
  child.stderr.on("data", (data) => (stderr += data));
  const exited = once(child, "exit");
  let started = false;
  for (let n = 0; n < 150; n++) {
    const events = await readFile(
      join(f.output, "events.ndjson"),
      "utf8",
    ).catch(() => "");
    if (events.split("fixture output").length === 3) {
      started = true;
      break;
    }
    await delay(20);
  }
  assert.ok(started, stderr);
  const second = await f.run(
    ["--live", "--fixture", "--output", join(f.root, "second-evidence")],
    env,
  );
  assert.equal(second.code, 2);
  const blocked = JSON.parse(
    await readFile(join(f.root, "second-evidence", "summary.json"), "utf8"),
  );
  assert.match(blocked.blocker, /active work/);
  assert.equal(child.exitCode, null);
  child.kill("SIGTERM");
  assert.equal((await exited)[0], 2, stderr);
  const s = await f.summary();
  assert.equal(s.termination, "terminated");
  assert.equal(s.outcome, "incomplete");
  assert.equal(s.runs.length, 2);
  for (const run of s.runs) {
    assert.ok(["cancelled", "interrupted"].includes(run.state));
    const pid = Number(
      await readFile(join(run.worktree, "fixture-pid.txt"), "utf8"),
    );
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.ok(run.branch);
  }
  assert.ok(Buffer.byteLength(stdout) < 4096);
});
