import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  cp,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const exec = promisify(execFile);
const root = path.resolve(".");
test("skill setup installs only the locked bundle, repeats safely, and detects missing or changed skills", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "orches-skills-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "upstream");
  await mkdir(source);
  for (const skill of ["tdd", "implement-spec", "unrelated"]) {
    await mkdir(path.join(source, "skills/engineering", skill), {
      recursive: true,
    });
    await writeFile(
      path.join(source, "skills/engineering", skill, "SKILL.md"),
      `# ${skill}\n`,
    );
  }
  await writeFile(path.join(source, "LICENSE"), "fixture license\n");
  const git = (...args) => exec("git", args, { cwd: source });
  await git("init", "-q");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "skill source",
  );
  const { stdout } = await git("rev-parse", "HEAD");
  await mkdir(path.join(dir, "scripts"));
  await cp(path.join(root, "scripts"), path.join(dir, "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(dir, "contributor"));
  await writeFile(
    path.join(dir, "contributor/skills-lock.json"),
    JSON.stringify({
      repository: source,
      revision: stdout.trim(),
      skills: {
        "implement-spec": "skills/engineering/implement-spec",
        tdd: "skills/engineering/tdd",
      },
    }),
  );
  const run = (...args) =>
    exec(process.execPath, ["scripts/skills.mjs", ...args], {
      cwd: dir,
      env: { ...process.env, NODE_TEST_CONTEXT: "" },
    });
  await run();
  await run();
  await run("--check");
  assert.match(
    await readFile(path.join(dir, ".agents/skills/tdd/SKILL.md"), "utf8"),
    /# tdd/,
  );
  await assert.rejects(
    readFile(path.join(dir, ".agents/skills/unrelated/SKILL.md")),
    { code: "ENOENT" },
  );
  await writeFile(path.join(dir, ".agents/skills/tdd/SKILL.md"), "changed");
  await assert.rejects(run("--check"), (error) => {
    assert.match(error.stderr, /changed.*tdd/);
    return error.code === 1;
  });
  await run();
  await rm(path.join(dir, ".agents/skills/tdd/SKILL.md"));
  await assert.rejects(run("--check"), (error) => {
    assert.match(error.stderr, /missing.*tdd/);
    return error.code === 1;
  });
  await run();
  const installed = await readFile(
    path.join(dir, ".agents/skills/tdd/SKILL.md"),
    "utf8",
  );
  const lockPath = path.join(dir, "contributor/skills-lock.json");
  const lock = JSON.parse(await readFile(lockPath));
  lock.revision = "0000000000000000000000000000000000000001";
  await writeFile(lockPath, JSON.stringify(lock));
  await assert.rejects(run(), (error) => {
    assert.match(
      error.stderr,
      /Skill setup blocked.*No alternate revision was selected/s,
    );
    return error.code === 1;
  });
  assert.equal(
    await readFile(path.join(dir, ".agents/skills/tdd/SKILL.md"), "utf8"),
    installed,
  );
  assert.deepEqual(await readdir(path.join(dir, ".agents")), ["skills"]);
  lock.repository = path.join(dir, "missing-upstream");
  await writeFile(lockPath, JSON.stringify(lock));
  await assert.rejects(run(), (error) => {
    assert.match(error.stderr, /locked source, network access and Git/);
    return error.code === 1;
  });
  assert.equal(
    await readFile(path.join(dir, ".agents/skills/tdd/SKILL.md"), "utf8"),
    installed,
  );
});
