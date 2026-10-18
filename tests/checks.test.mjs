import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url);
async function workspace(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "contributor-check-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL("scripts/", root), path.join(directory, "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(directory, "tests"));
  await mkdir(path.join(directory, "sample-game/tests"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { test: "node scripts/check-tests.mjs" },
    }),
  );
  return directory;
}
async function check(directory, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn("npm", ["test", "--silent"], {
    cwd: directory,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, output };
}
const passingBody = `import test from 'node:test'; test('fixture body executed', () => { console.log('body marker'); });\n`;

test("contributor command discovers selected files and proves actual test bodies per file", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "tests/first.test.mjs"), passingBody);
  const first = await check(directory);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /body marker/);
  assert.match(first.output, /tests\/first\.test\.mjs: 1 executed/);
  await writeFile(
    path.join(directory, "sample-game/tests/added.test.mjs"),
    passingBody,
  );
  const added = await check(directory);
  assert.equal(added.code, 0, added.output);
  assert.match(
    added.output,
    /sample-game\/tests\/added\.test\.mjs: 1 executed/,
  );
});

test("file-wrapper-only success cannot pass the contributor command", async (t) => {
  const directory = await workspace(t);
  await writeFile(
    path.join(directory, "tests/only-wrapper.test.mjs"),
    `console.log('wrapper ran without test bodies');\n`,
  );
  const result = await check(directory);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /wrapper ran without test bodies/);
  assert.match(
    result.output,
    /No completed test-body execution evidence.*only-wrapper/,
  );
});

test("each selected file must execute bodies even when another selected file succeeds", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "tests/passing.test.mjs"), passingBody);
  await writeFile(
    path.join(directory, "tests/missing.test.mjs"),
    `process.exit(0);\n`,
  );
  const result = await check(directory);
  assert.notEqual(result.code, 0);
  assert.match(
    result.output,
    /No completed test-body execution evidence.*missing/,
  );
});

test("wholly skipped execution is not proof of passing test bodies", async (t) => {
  const directory = await workspace(t);
  await writeFile(
    path.join(directory, "tests/skipped.test.mjs"),
    `import test from 'node:test'; test.skip('not executed', () => {});\n`,
  );
  const result = await check(directory);
  assert.notEqual(result.code, 0);
  assert.match(
    result.output,
    /No completed test-body execution evidence.*skipped/,
  );
});

test("an empty configured selection fails closed", async (t) => {
  const directory = await workspace(t);
  const result = await check(directory);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /No test files selected/);
});

test("real failures retain runner diagnostics and a failing exit status", async (t) => {
  const directory = await workspace(t);
  await writeFile(
    path.join(directory, "tests/failing.test.mjs"),
    `import test from 'node:test'; test('failing body', () => { throw new Error('meaningful failure diagnostic'); });\n`,
  );
  const result = await check(directory);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /meaningful failure diagnostic/);
  assert.match(result.output, /Test runner failed/);
});

test("cancelled test bodies and abrupt child termination remain failures", async (t) => {
  const directory = await workspace(t);
  await writeFile(
    path.join(directory, "tests/cancelled.test.mjs"),
    `import test from 'node:test'; test('cancelled body', { timeout: 25 }, () => new Promise(() => {}));\n`,
  );
  const cancelled = await check(directory);
  assert.notEqual(cancelled.code, 0);
  assert.match(cancelled.output, /cancelled|pending/);
  await writeFile(
    path.join(directory, "tests/cancelled.test.mjs"),
    `process.kill(process.pid, 'SIGTERM');\n`,
  );
  const terminated = await check(directory);
  assert.notEqual(terminated.code, 0);
  assert.match(terminated.output, /Test runner failed/);
});

test("an unavailable temporary filesystem fails with an actionable capability diagnostic", async (t) => {
  const directory = await workspace(t);
  const blocked = path.join(directory, "not-a-directory");
  await writeFile(blocked, "blocked");
  const result = await check(directory, { TMPDIR: blocked });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Temporary-filesystem capability unavailable/);
  assert.match(result.output, /supported host permission mechanism/);
  assert.doesNotMatch(result.output, /Execution evidence verified/);
});

// Control only Node's external process/listener boundary. Fixture commands still
// run as real subprocesses; application modules and checker helpers are untouched.
async function boundaryPreload(directory, source) {
  const filename = path.join(directory, "boundary-control.mjs");
  await writeFile(filename, source);
  return `--import=${filename}`;
}

test("subprocess preflight requires proof that child code actually ran", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "tests/body.test.mjs"), passingBody);
  const options = await boundaryPreload(
    directory,
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => spawn(command,
      args[0] === '-e' ? ['-e', 'process.exit(0)'] : args, options);
    syncBuiltinESMExports();
  `,
  );
  const result = await check(directory, { NODE_OPTIONS: options });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Subprocess capability unavailable/);
  assert.doesNotMatch(result.output, /body marker/);
});

test("listener denial is actionable and stops before the suite starts", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "tests/body.test.mjs"), passingBody);
  const options = await boundaryPreload(
    directory,
    `
    import { Server } from 'node:net';
    Server.prototype.listen = function () {
      queueMicrotask(() => this.emit('error', Object.assign(new Error('controlled EPERM'), { code: 'EPERM' })));
      return this;
    };
  `,
  );
  const result = await check(directory, { NODE_OPTIONS: options });
  assert.notEqual(result.code, 0);
  assert.match(
    result.output,
    /Loopback-listener capability unavailable.*controlled EPERM/,
  );
  assert.match(result.output, /supported host permission mechanism/);
  assert.doesNotMatch(result.output, /body marker/);
});

test("subprocess launch errors are actionable and never count as execution", async (t) => {
  const directory = await workspace(t);
  const options = await boundaryPreload(
    directory,
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => spawn(args[0] === '-e' ? '/nonexistent/contributor-node' : command, args, options);
    syncBuiltinESMExports();
  `,
  );
  const result = await check(directory, { NODE_OPTIONS: options });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Subprocess capability unavailable.*ENOENT/);
  assert.match(result.output, /supported host permission mechanism/);
});

test("an unresponsive subprocess capability probe is bounded and fails closed", async (t) => {
  const directory = await workspace(t);
  const options = await boundaryPreload(
    directory,
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => spawn(command,
      args[0] === '-e' ? ['-e', 'setInterval(() => {}, 1000)'] : args, options);
    syncBuiltinESMExports();
  `,
  );
  const result = await check(directory, { NODE_OPTIONS: options });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Subprocess capability unavailable.*SIGKILL/);
});

async function controlledRunner(directory, evidence) {
  const command = path.join(directory, "controlled-runner.mjs");
  await writeFile(
    command,
    `
    import { writeFileSync } from 'node:fs';
    const destination = process.argv.find((arg) => arg.startsWith('--test-reporter-destination=') && !arg.endsWith('=stdout')).split('=').slice(1).join('=');
    writeFileSync(destination, ${JSON.stringify(evidence)});
    console.log('controlled external runner diagnostic');
  `,
  );
  return boundaryPreload(
    directory,
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (node, args, options) => spawn(node,
      args[0] === '--test' ? [${JSON.stringify(command)}, ...args] : args, options);
    syncBuiltinESMExports();
  `,
  );
}

test("empty, malformed, and incomplete external runner evidence cannot turn a zero exit into success", async (t) => {
  for (const [name, evidence] of [
    ["empty evidence", ""],
    ["malformed evidence", "{not-json}\n"],
    [
      "unfinished reporter",
      JSON.stringify({ type: "test:summary", data: { success: true } }) + "\n",
    ],
    [
      "missing overall summary",
      JSON.stringify({ type: "execution:complete" }) + "\n",
    ],
  ]) {
    await t.test(name, async (t) => {
      const directory = await workspace(t);
      await writeFile(path.join(directory, "tests/body.test.mjs"), passingBody);
      const options = await controlledRunner(directory, evidence);
      const result = await check(directory, { NODE_OPTIONS: options });
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /controlled external runner diagnostic/);
      assert.match(result.output, /Contributor tests failed/);
      assert.doesNotMatch(result.output, /Execution evidence verified/);
    });
  }
});

test("incomplete or contradictory summary counts cannot certify successful runner output", async (t) => {
  for (const scenario of [
    "missing file count",
    "missing overall counts",
    "contradictory totals",
  ]) {
    await t.test(scenario, async (t) => {
      const directory = await workspace(t);
      const file = path.join(directory, "tests/body.test.mjs");
      await writeFile(file, passingBody);
      const fileCounts = {
        tests: 1,
        passed: 1,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        todo: 0,
      };
      const overallCounts = { ...fileCounts };
      if (scenario === "missing file count") delete fileCounts.tests;
      if (scenario === "contradictory totals") overallCounts.tests = 2;
      const evidence =
        [
          {
            type: "test:pass",
            data: { file, name: "fixture body", kind: "test" },
          },
          {
            type: "test:summary",
            data: { file, success: true, counts: fileCounts },
          },
          {
            type: "test:summary",
            data: {
              success: true,
              counts:
                scenario === "missing overall counts"
                  ? undefined
                  : overallCounts,
            },
          },
          { type: "execution:complete" },
        ]
          .map((record) => JSON.stringify(record))
          .join("\n") + "\n";
      const options = await controlledRunner(directory, evidence);
      const result = await check(directory, { NODE_OPTIONS: options });
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /Contributor tests failed/);
    });
  }
});
