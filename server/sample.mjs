import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const source = fileURLToPath(new URL("../sample-game/", import.meta.url));
const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Seed an independent repository; existing pilot work is never replaced. */
export async function seedSampleProject(dataDir) {
  const projectPath = path.resolve(dataDir, "sample-project");
  if (
    projectPath === path.resolve(source) ||
    projectPath.startsWith(path.resolve(source) + path.sep)
  ) {
    throw new Error(
      "Sample runtime data must be outside the bundled sample source.",
    );
  }
  await mkdir(projectPath, { recursive: true });
  let existing = false;
  try {
    existing = (await stat(path.join(projectPath, ".git"))).isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!existing) {
    const { readdir } = await import("node:fs/promises");
    if ((await readdir(projectPath)).length)
      throw new Error(
        "Sample runtime directory is not empty; refusing to overwrite it.",
      );
    await cp(source, projectPath, { recursive: true });
    git(projectPath, ["init", "-b", "main"]);
    git(projectPath, ["add", "."]);
    git(projectPath, [
      "-c",
      "user.name=Orches Pilot",
      "-c",
      "user.email=pilot@localhost",
      "commit",
      "-m",
      "Initialize Gem Trail sample",
    ]);
  }
  // Verify the destination itself is the repository, rather than accepting an ancestor checkout.
  if (
    path.resolve(git(projectPath, ["rev-parse", "--show-toplevel"])) !==
    projectPath
  ) {
    throw new Error(
      "Sample runtime directory must be an independent Git repository.",
    );
  }
  return {
    name: "Gem Trail sample",
    path: projectPath,
    revision: git(projectPath, ["rev-parse", "HEAD"]),
    buildCommand: "",
    testCommand: "node --test tests/*.test.mjs",
    tasks: JSON.parse(await readFile(path.join(source, "tasks.json"), "utf8")),
  };
}
