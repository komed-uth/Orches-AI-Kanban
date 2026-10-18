import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createCodexRunner } from "../server/codex.mjs";
const executable = resolve("tests/fixtures/codex-protocol.mjs");
test("Codex subprocess streams a turn, captures its conversation and writes only its cwd", async (t) => {
  const cwd = await mkdtemp(tmpdir() + "/protocol-");
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const events = [],
    conversations = [];
  const runner = createCodexRunner({
    run: { config: { executable } },
    task: { title: "implement" },
    project: {},
    cwd,
    onEvent: (e) => events.push(e),
    onConversation: (id) => conversations.push(id),
  });
  await runner.run();
  assert.equal(
    await readFile(cwd + "/new-file.txt", "utf8"),
    "fixture change\n",
  );
  assert.deepEqual(conversations, ["fixture-thread"]);
  assert.ok(events.some((e) => e.type === "assistant" && e.text === "Working"));
  assert.ok(
    events.some((e) => e.type === "command" && e.text === "command output\n"),
  );
});
for (const title of ["wait approval", "wait question"])
  test(`Codex ${title} remains pending and accepts a validated response`, async (t) => {
    const cwd = await mkdtemp(tmpdir() + "/protocol-");
    t.after(() => rm(cwd, { recursive: true, force: true }));
    let ready;
    const requestReady = new Promise((resolve) => (ready = resolve));
    const runner = createCodexRunner({
      run: { config: { executable } },
      task: { title, conversationId: "retained-thread" },
      cwd,
      onRequest: ready,
      onConversation: (id) => assert.equal(id, "retained-thread"),
    });
    const execution = runner.run();
    const request = await requestReady;
    assert.throws(() => runner.respond(request.id, {}), { status: 400 });
    runner.respond(
      request.id,
      title.includes("question")
        ? { answers: { color: { answers: ["blue"] } } }
        : { decision: "accept" },
    );
    assert.throws(() => runner.respond(request.id, { decision: "accept" }), {
      status: 409,
    });
    await execution;
    assert.equal(
      await readFile(cwd + "/new-file.txt", "utf8"),
      "fixture change\n",
    );
  });
for (const title of ["failure", "disconnect"])
  test(`Codex ${title} does not report completion`, async (t) => {
    const cwd = await mkdtemp(tmpdir() + "/protocol-");
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await assert.rejects(
      createCodexRunner({
        run: { config: { executable } },
        task: { title },
        cwd,
      }).run(),
      /failure|disconnected/,
    );
  });
test("cancellation stops a held Codex turn before the run settles", async (t) => {
  const cwd = await mkdtemp(tmpdir() + "/protocol-");
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const controller = new AbortController();
  let started;
  const active = new Promise((resolve) => (started = resolve));
  const running = createCodexRunner({
    run: { config: { executable } },
    task: { title: "hold" },
    cwd,
    signal: controller.signal,
    onEvent: started,
  }).run();
  await active;
  controller.abort(new Error("Chosen cancellation"));
  await assert.rejects(running, /Chosen cancellation/);
});
