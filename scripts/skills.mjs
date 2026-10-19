import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { command, requireSuccess } from "./contributor-process.mjs";

const digest = (content) => createHash("sha256").update(content).digest("hex");
let temporary;
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--check"))
    throw new Error("Usage: npm run skills:setup [-- --check]");
  const lockText = await readFile("contributor/skills-lock.json", "utf8");
  const lock = JSON.parse(lockText);
  if (
    !/^[0-9a-f]{40}$/.test(lock.revision) ||
    !lock.skills ||
    !Object.keys(lock.skills).length ||
    Object.entries(lock.skills).some(
      ([name, source]) =>
        !/^[-a-z0-9]+$/.test(name) ||
        !/^[-a-z0-9/]+$/.test(source) ||
        source.startsWith("/"),
    )
  )
    throw new Error(
      "skills-lock.json must name selected skills and an immutable 40-character revision",
    );
  const destination = path.resolve(".agents/skills");
  async function hashes(directory, prefix = "") {
    const result = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".orches-lock.json") continue;
      const relative = path.posix.join(prefix, entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory())
        Object.assign(result, await hashes(file, relative));
      else if (entry.isFile()) result[relative] = digest(await readFile(file));
      else throw new Error(`unsupported skill source entry ${relative}`);
    }
    return result;
  }
  if (args[0] === "--check") {
    const installed = JSON.parse(
      await readFile(path.join(destination, ".orches-lock.json"), "utf8"),
    );
    if (installed.lock !== digest(lockText))
      throw new Error("skill lock changed; rerun npm run skills:setup");
    for (const skill of Object.keys(lock.skills))
      await readFile(path.join(destination, skill, "SKILL.md"));
    const actual = await hashes(destination);
    for (const [file, hash] of Object.entries(installed.files))
      if (actual[file] !== hash)
        throw new Error(
          `${actual[file] ? "changed" : "missing"} skill file ${file}`,
        );
    if (Object.keys(actual).length !== Object.keys(installed.files).length)
      throw new Error("unrecorded files in skill bundle");
  } else {
    await mkdir(".agents", { recursive: true });
    temporary = await mkdtemp(path.resolve(".agents/.skills-setup-"));
    const source = path.join(temporary, "source");
    await mkdir(source);
    const git = async (...args) =>
      requireSuccess(
        await command("git", args, { cwd: source, timeout: 30000 }),
      );
    await git("init", "--quiet");
    await git("remote", "add", "origin", lock.repository);
    await git("fetch", "--quiet", "--depth=1", "origin", lock.revision);
    if ((await git("rev-parse", "FETCH_HEAD")) !== lock.revision)
      throw new Error("source returned a different revision");
    await git(
      "checkout",
      "--quiet",
      lock.revision,
      "--",
      ...Object.values(lock.skills),
      "LICENSE",
    );
    const bundle = path.join(temporary, "bundle");
    await mkdir(bundle);
    for (const skill of Object.keys(lock.skills)) {
      await readFile(path.join(source, lock.skills[skill], "SKILL.md"));
      await cp(
        path.join(source, lock.skills[skill]),
        path.join(bundle, skill),
        { recursive: true },
      );
    }
    await cp(path.join(source, "LICENSE"), path.join(bundle, "LICENSE"));
    await writeFile(
      path.join(bundle, ".orches-lock.json"),
      JSON.stringify(
        {
          lock: digest(lockText),
          revision: lock.revision,
          files: await hashes(bundle),
        },
        null,
        2,
      ) + "\n",
    );
    // Download and validate first: a failed source leaves the previous bundle intact.
    const old = path.join(temporary, "previous");
    let previous = false;
    try {
      await lstat(destination);
      await rename(destination, old);
      previous = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(bundle, destination);
    } catch (error) {
      if (previous) await rename(old, destination);
      throw error;
    }
  }
  console.log(
    `Skills ${args[0] === "--check" ? "verified" : "installed"}: ${Object.keys(lock.skills).join(", ")} @ ${lock.revision}. Discover .agents/skills/<name>/SKILL.md.`,
  );
} catch (error) {
  console.error(
    `Skill setup blocked: ${error.code === "ENOENT" ? "missing skill bundle or source file; " : ""}${error.message}. Run npm run skills:setup; check the locked source, network access and Git installation. No alternate revision was selected.`,
  );
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
