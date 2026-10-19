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
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const exec = promisify(execFile);
const script = path.resolve("scripts/github-pr.mjs");
async function fixture(t, message, restError) {
  const dir = await mkdtemp(path.join(tmpdir(), "orches-github-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "bin"));
  await writeFile(
    path.join(dir, "bin/gh"),
    `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
if(args[0]==='pr'){if(${JSON.stringify(message)}===null){console.log('PR updated');process.exit(0);}console.error(${JSON.stringify(message)});process.exit(1);}
if(${JSON.stringify(restError ?? null)}!==null){console.error(${JSON.stringify(restError ?? null)});process.exit(1);}
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{fs.writeFileSync('metadata.json',input);console.log('metadata updated');});
`,
  );
  await chmod(path.join(dir, "bin/gh"), 0o755);
  const body =
    "Resulting behavior\n\n- First change\n- Literal `code`, $HOME, and \\n\nCloses #64\n";
  const bodyFile = path.join(dir, "body.md");
  await writeFile(bodyFile, body);
  const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` };
  delete env.NODE_TEST_CONTEXT;
  return {
    dir,
    body,
    run: () =>
      exec(
        process.execPath,
        [
          script,
          "65",
          "--body-file",
          bodyFile,
          "--title",
          "Contributor readiness",
        ],
        { cwd: dir, env },
      ),
  };
}
test("PR metadata edit falls back only for the observed deprecated Projects API and preserves multiline content", async (t) => {
  const { dir, body, run } = await fixture(
    t,
    "GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience. (repository.pullRequest.projectCards)",
  );
  await run();
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, "metadata.json"))),
    { body, title: "Contributor readiness" },
  );
  const calls = (await readFile(path.join(dir, "calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(calls[1], [
    "api",
    "--silent",
    "--method",
    "PATCH",
    "repos/{owner}/{repo}/pulls/65",
    "--input",
    "-",
  ]);
});

test("authorization and network failures remain visible and do not select REST fallback", async (t) => {
  for (const message of [
    "HTTP 403: Resource not accessible by integration",
    "error connecting to api.github.com",
    "GraphQL: unrelated deprecated API error",
  ]) {
    await t.test(message, async (t) => {
      const { dir, run } = await fixture(t, message);
      await assert.rejects(run(), (error) => {
        assert.ok(error.stderr.includes(message));
        return error.code === 1;
      });
      const calls = (await readFile(path.join(dir, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n");
      assert.equal(calls.length, 1);
      await assert.rejects(readFile(path.join(dir, "metadata.json")), {
        code: "ENOENT",
      });
    });
  }
});

test("compatible GitHub CLI metadata success uses no REST write", async (t) => {
  const { dir, run } = await fixture(t, null);
  await run();
  assert.equal(
    (await readFile(path.join(dir, "calls.jsonl"), "utf8")).trim().split("\n")
      .length,
    1,
  );
  await assert.rejects(readFile(path.join(dir, "metadata.json")), {
    code: "ENOENT",
  });
});

test("failed compatibility REST write remains visible and failing", async (t) => {
  const { run } = await fixture(
    t,
    "GraphQL: Projects (classic) is being deprecated. (repository.pullRequest.projectCards)",
    "HTTP 403: REST permission denied",
  );
  await assert.rejects(run(), (error) => {
    assert.match(error.stderr, /HTTP 403: REST permission denied/);
    assert.doesNotMatch(error.stdout, /metadata updated/);
    return error.code === 1;
  });
});
