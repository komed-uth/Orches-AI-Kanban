import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
const exec = promisify(execFile);
const git = async (cwd, args) =>
  (await exec("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 }))
    .stdout;
export async function validateRepository(path, revision = "HEAD") {
  try {
    const root = (
      await git(resolve(path), ["rev-parse", "--show-toplevel"])
    ).trim();
    const commit = (
      await git(root, ["rev-parse", "--verify", `${revision}^{commit}`])
    ).trim();
    return { path: root, revision, commit };
  } catch {
    throw Object.assign(
      new Error(
        "Choose an existing local Git repository and a revision that resolves to a commit.",
      ),
      { status: 400 },
    );
  }
}
export async function ensureWorktree({ task, project, dataDir }) {
  if (task.worktree) {
    try {
      await access(task.worktree);
      await git(task.worktree, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      throw new Error(
        "The retained task working copy is missing. Restore it before retrying.",
      );
    }
    return {
      worktree: task.worktree,
      branch: task.branch,
      baseRevision: task.baseRevision,
    };
  }
  const repository = await validateRepository(
    project.path,
    project.revision || "HEAD",
  );
  const safeId = String(task.id).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) throw new Error("Task identifier is required.");
  const worktree = resolve(dataDir, "worktrees", safeId),
    branch = `orches/task-${safeId}`;
  await mkdir(resolve(dataDir, "worktrees"), { recursive: true });
  try {
    await git(repository.path, [
      "worktree",
      "add",
      "-b",
      branch,
      worktree,
      repository.commit,
    ]);
  } catch (error) {
    throw new Error(
      `Cannot create task working copy: ${error.stderr || error.message}`,
    );
  }
  return { worktree, branch, baseRevision: repository.commit };
}
export async function collectChanges({ task }) {
  if (!task.worktree) return { files: [], diff: "" };
  const base = task.baseRevision || "HEAD";
  const tracked = (
    await git(task.worktree, [
      "diff",
      "--no-renames",
      "--name-status",
      "-z",
      base,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (let i = 0; i < tracked.length; i += 2)
    files.push({ status: tracked[i], path: tracked[i + 1] });
  let diff = await git(task.worktree, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    base,
    "--",
  ]);
  const untracked = (
    await git(task.worktree, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  )
    .split("\0")
    .filter(Boolean);
  for (const path of untracked) {
    files.push({ status: "?", path });
    try {
      diff += await git(task.worktree, [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--",
        "/dev/null",
        path,
      ]);
    } catch (error) {
      if (error.code !== 1) throw error;
      diff += error.stdout || "";
    }
  }
  return { files, diff };
}
