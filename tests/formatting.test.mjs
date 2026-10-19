import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

test("public formatter rejects drift without edits, fixes scoped sources, and preserves legacy Pages", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "orches-format-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await cp(join(root, "package.json"), join(workspace, "package.json"));
  await cp(join(root, ".prettierignore"), join(workspace, ".prettierignore"));
  await symlink(
    join(root, "node_modules"),
    join(workspace, "node_modules"),
    "dir",
  );
  for (const dir of ["server", "docs", "tests"])
    await mkdir(join(workspace, dir));
  await mkdir(join(workspace, "docs/trial"));
  const trial = join(workspace, "docs/trial", "fixture.mjs");
  const unrelated = join(workspace, "unrelated.mjs.bak");
  const source = join(workspace, "server", "fixture.mjs");
  const pages = join(workspace, "docs", "board.mjs");
  const boardTest = join(workspace, "tests", "board.test.mjs");
  const unformatted = "export const value={message:'hello'}\n";
  for (const file of [source, trial, pages, boardTest, unrelated])
    await writeFile(file, unformatted);
  const run = (script) => exec("npm", ["run", script], { cwd: workspace });
  await assert.rejects(run("format:check"), (error) => error.code === 1);
  assert.equal(await readFile(source, "utf8"), unformatted);
  assert.equal(await readFile(trial, "utf8"), unformatted);
  await run("format");
  await run("format:check");
  assert.equal(
    await readFile(source, "utf8"),
    'export const value = { message: "hello" };\n',
  );
  assert.equal(
    await readFile(trial, "utf8"),
    'export const value = { message: "hello" };\n',
  );
  // With every other included file clean, trial drift alone must fail the check.
  await writeFile(trial, unformatted);
  await assert.rejects(run("format:check"), (error) => error.code === 1);
  assert.equal(await readFile(trial, "utf8"), unformatted);
  await run("format");
  await run("format:check");
  assert.equal(await readFile(unrelated, "utf8"), unformatted);
  assert.equal(await readFile(pages, "utf8"), unformatted);
  assert.equal(await readFile(boardTest, "utf8"), unformatted);
});
