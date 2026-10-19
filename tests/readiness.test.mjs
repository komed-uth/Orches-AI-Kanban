import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  cp,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const exec = promisify(execFile);
const root = path.resolve(".");
async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "orches-ready-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), {
    recursive: true,
  });
  await cp(path.join(root, "package.json"), path.join(dir, "package.json"));
  await cp(path.join(root, ".npmrc"), path.join(dir, ".npmrc"));
  await symlink(
    path.join(root, "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );
  await mkdir(path.join(dir, "bin"));
  await writeFile(
    path.join(dir, "bin/gh"),
    `#!/usr/bin/env node\nconsole.log('true');\n`,
  );
  await chmod(path.join(dir, "bin/gh"), 0o755);
  const env = {
    ...process.env,
    PATH: `${dir}/bin:${process.env.PATH}`,
    ORCHES_CHROMIUM: process.env.ORCHES_CHROMIUM || "/usr/bin/chromium",
    TMPDIR: path.join(dir, "temp"),
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.npm_config_cache;
  delete env.NPM_CONFIG_CACHE;
  await mkdir(env.TMPDIR);
  const run = async (extra = {}) => {
    try {
      const result = await exec("npm", ["run", "ready", "--silent"], {
        cwd: dir,
        env: { ...env, ...extra },
        timeout: 60000,
      });
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  return { dir, env, run };
}
test("readiness reports actionable missing skills and browser prerequisites without application state or leaked probes", async (t) => {
  const { dir, env, run } = await workspace(t);
  const result = await run({
    ORCHES_CHROMIUM: path.join(dir, "missing-chromium"),
  });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS.*npm test/);
  assert.match(result.stdout, /BLOCKED.*skills:setup/);
  assert.match(result.stdout, /BLOCKED.*test:browser.*test:pages/);
  assert.match(result.stdout, /playwright install chromium|ORCHES_CHROMIUM/);
  assert.match(result.stdout, /PASS.*GitHub/);
  assert.match(result.stdout, /UNVERIFIED.*model/);
  await assert.rejects(readFile(path.join(dir, ".orches-data")), {
    code: "ENOENT",
  });
  assert.deepEqual(
    (await readdir(env.TMPDIR)).filter((name) => name !== "node-compile-cache"),
    [],
  );
  assert.equal(
    (await readdir(path.join(dir, ".cache/npm"))).some((name) =>
      name.startsWith(".orches-probe-"),
    ),
    false,
  );
});

test("readiness surfaces denied loopback capability before running suites and cleans its probes", async (t) => {
  const { dir, env, run } = await workspace(t);
  const preload = path.join(dir, "deny-listener.mjs");
  await writeFile(
    preload,
    `import {Server} from 'node:net'; Server.prototype.listen=function(){queueMicrotask(()=>this.emit('error',Object.assign(new Error('controlled listener EPERM'),{code:'EPERM'})));return this;};`,
  );
  const result = await run({
    NODE_OPTIONS: `--import=${preload}`,
    ORCHES_CHROMIUM: path.join(dir, "missing-browser"),
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /BLOCKED npm test capabilities:.*Loopback-listener capability unavailable.*controlled listener EPERM/,
  );
  assert.match(result.stdout, /supported host grant/);
  assert.deepEqual(
    (await readdir(env.TMPDIR)).filter((name) => name !== "node-compile-cache"),
    [],
  );
});

test("readiness bounds an unresponsive GitHub service and stops its descendant processes", async (t) => {
  const { dir, run } = await workspace(t);
  const pidfile = path.join(dir, "descendant.pid");
  await writeFile(
    path.join(dir, "bin/gh"),
    `#!/usr/bin/env node
import {spawn} from 'node:child_process';import fs from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(pidfile)},String(child.pid));setInterval(()=>{},1000);
`,
  );
  const started = Date.now();
  const result = await run({
    ORCHES_CHROMIUM: path.join(dir, "missing-browser"),
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /BLOCKED GitHub.*command timed out/);
  assert.ok(
    Date.now() - started < 20000,
    "readiness service deadline must be bounded",
  );
  const pid = Number(await readFile(pidfile, "utf8"));
  // A killed descendant can briefly remain a zombie until its parent is reaped.
  try {
    const status = await readFile(`/proc/${pid}/stat`, "utf8");
    assert.match(status, /^\d+ \(.+\) Z /);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
});

test("a zero-exit capability wrapper without probe execution cannot report readiness", async (t) => {
  const { dir, run } = await workspace(t);
  const preload = path.join(dir, "wrapper-only.mjs");
  await writeFile(
    preload,
    `
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    const spawn=childProcess.spawn;
    childProcess.spawn=(command,args,options)=>spawn(command,
      args[0]==='scripts/check-capabilities.mjs'?['-e','process.exit(0)']:args,options);
    syncBuiltinESMExports();
  `,
  );
  const result = await run({
    NODE_OPTIONS: `--import=${preload}`,
    ORCHES_CHROMIUM: path.join(dir, "missing-browser"),
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /BLOCKED npm test capabilities: probe returned no execution evidence/,
  );
  assert.doesNotMatch(result.stdout, /PASS npm test capabilities/);
});

test("interrupting readiness during Chromium startup stops its detached browser and removes probes", async (t) => {
  const { dir, env } = await workspace(t);
  const executable = path.join(dir, "bin/held-chromium");
  const pidfile = path.join(dir, "browser.pid");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(pidfile)},String(process.pid));
setInterval(()=>{},1000);
`,
  );
  await chmod(executable, 0o755);
  const child = spawn(process.execPath, ["scripts/ready.mjs"], {
    cwd: dir,
    env: { ...env, ORCHES_CHROMIUM: executable },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  t.after(() => {
    child.kill("SIGKILL");
  });
  const deadline = Date.now() + 10000;
  let pid;
  while (Date.now() < deadline) {
    try {
      pid = Number(await readFile(pidfile, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(pid, `controlled Chromium did not start: ${output}`);
  t.after(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  const code = await completion;
  clearTimeout(timeout);
  assert.equal(code, 1, output);
  assert.match(output, /readiness interrupted/);
  try {
    const status = await readFile(`/proc/${pid}/stat`, "utf8");
    assert.match(status, /^\d+ \(.+\) Z /);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert.deepEqual(
    (await readdir(env.TMPDIR)).filter((name) => name !== "node-compile-cache"),
    [],
  );
});
