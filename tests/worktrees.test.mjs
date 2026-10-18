import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  ensureWorktree,
  collectChanges,
  validateRepository,
} from "../server/worktrees.mjs";
import { verifyRun } from "../server/verification.mjs";
const exec = promisify(execFile);
test("parallel worktrees preserve original files and expose new and committed task changes", async (t) => {
  const dir = await mkdtemp(tmpdir() + "/worktrees-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = dir + "/original";
  await mkdir(path);
  const git = (...args) => exec("git", ["-C", path, ...args]);
  await git("init");
  await git("config", "user.email", "test@example.test");
  await git("config", "user.name", "Test");
  await writeFile(path + "/shared.txt", "original\n");
  await git("add", ".");
  await git("commit", "-m", "baseline");
  const project = { path, revision: "HEAD" };
  const [a, b] = await Promise.all(
    ["a", "b"].map((id) =>
      ensureWorktree({ task: { id }, project, dataDir: dir }),
    ),
  );
  await writeFile(a.worktree + "/shared.txt", "first\n");
  await writeFile(b.worktree + "/shared.txt", "second\n");
  await writeFile(a.worktree + "/new.txt", "new content\n");
  const evidence = await collectChanges({ task: a });
  assert.equal(await readFile(path + "/shared.txt", "utf8"), "original\n");
  assert.equal(await readFile(b.worktree + "/shared.txt", "utf8"), "second\n");
  assert.deepEqual(evidence.files, [
    { status: "M", path: "shared.txt" },
    { status: "?", path: "new.txt" },
  ]);
  assert.match(evidence.diff, /first/);
  assert.match(evidence.diff, /new content/);
  await exec("git", ["-C", a.worktree, "add", "."]);
  await exec("git", ["-C", a.worktree, "commit", "-m", "result"]);
  assert.match((await collectChanges({ task: a })).diff, /new content/);
  assert.deepEqual(await ensureWorktree({ task: a, project, dataDir: dir }), a);
  await assert.rejects(validateRepository(path, "nonexistent"), {
    status: 400,
  });
});
test("verification records commands in their isolated working directory and stops at failure", async (t) => {
  const cwd = await mkdtemp(tmpdir() + "/verify-");
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const result = await verifyRun({
    project: {
      buildCommand: "echo build",
      testCommand: 'printf "$PORT:$TMPDIR"; exit 9',
    },
    cwd,
    tmpDir: cwd,
    port: 43123,
  });
  assert.equal(result.success, false);
  assert.equal(result.results[1].exitCode, 9);
  assert.equal(result.results[1].output, `43123:${cwd}`);
});
