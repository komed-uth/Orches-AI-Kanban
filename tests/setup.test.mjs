import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const script = path.resolve("scripts/setup.mjs");
async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "orches-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  const npm = path.join(bin, "npm");
  await writeFile(
    npm,
    `#!/usr/bin/env node\nrequire('node:fs').writeFileSync('installed.json', JSON.stringify({args:process.argv.slice(2),cache:process.env.npm_config_cache}));\n`,
  );
  await chmod(npm, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: path.join(dir, "missing-home"),
  };
  delete env.npm_config_cache;
  delete env.NPM_CONFIG_CACHE;
  delete env.NODE_TEST_CONTEXT;
  return { dir, env };
}
test("setup installs with a writable workspace cache without creating a home directory", async (t) => {
  const { dir, env } = await workspace(t);
  await exec(process.execPath, [script], { cwd: dir, env });
  const installed = JSON.parse(
    await readFile(path.join(dir, "installed.json")),
  );
  assert.deepEqual(installed.args, ["ci"]);
  assert.equal(installed.cache, path.join(dir, ".cache/npm"));
  await assert.rejects(readFile(path.join(env.HOME, ".npm")), {
    code: "ENOENT",
  });
});

test("setup respects explicit cache overrides and fails before installation for an unusable cache", async (t) => {
  const { dir, env } = await workspace(t);
  const override = path.join(dir, "chosen-cache");
  await exec(process.execPath, [script], {
    cwd: dir,
    env: { ...env, NPM_CONFIG_CACHE: override },
  });
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "installed.json"))).cache,
    override,
  );
  await rm(path.join(dir, "installed.json"));
  const blocked = path.join(dir, "blocked-cache");
  await writeFile(blocked, "not a directory");
  await assert.rejects(
    exec(process.execPath, [script, "--cache", blocked], { cwd: dir, env }),
    (error) => {
      assert.match(error.stderr, /npm cache unavailable.*Choose a writable/);
      return error.code === 1;
    },
  );
  await assert.rejects(readFile(path.join(dir, "installed.json")), {
    code: "ENOENT",
  });
});
