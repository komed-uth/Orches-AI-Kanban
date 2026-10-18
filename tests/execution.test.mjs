import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createApplication } from "../server/app.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "orches-execution-"));
  const repo = join(root, "source");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "test@example.test",
  ]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(join(repo, "shared.txt"), "original\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "initial"]);
  const sessions = new Map();
  const arrivals = new Map();
  const runnerFactory = (context) => {
    const gate = deferred();
    const session = { ...context, gate, responses: [] };
    sessions.set(context.task.id, session);
    arrivals.get(context.task.id)?.resolve(session);
    context.signal.addEventListener(
      "abort",
      () => gate.reject(new Error("stopped")),
      { once: true },
    );
    return {
      async run() {
        context.onConversation(`conversation-${context.task.id}`);
        await gate.promise;
      },
      respond(id, response) {
        session.responses.push({ id, response });
      },
    };
  };
  let application, server, base, cookie, opened;
  async function open() {
    application = await createApplication({
      dataDir: join(root, "data"),
      runnerFactory,
    });
    server = createServer(application.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    opened = true;
  }
  async function close() {
    if (!opened) return;
    await application.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    opened = false;
  }
  await open();
  t.after(async () => {
    await close();
    await rm(root, { recursive: true, force: true });
  });
  async function api(path, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  }
  assert.equal(
    (await api("/setup", { username: "owner", password: "safe-password-123" }))
      .status,
    201,
  );
  const created = await api("/projects", {
    name: "Fixture",
    path: repo,
    revision: "HEAD",
    testCommand: "node -e \"console.log('verified')\"",
  });
  assert.equal(created.status, 201);
  const project = created.body.project;
  async function task(title = "Change a file") {
    const result = await api("/tasks", {
      projectId: project.id,
      title,
      description: "Implement it",
      acceptanceCriteria: "Tests pass",
    });
    assert.equal(result.status, 201);
    return result.body.task;
  }
  async function started(id, afterRunId) {
    if (sessions.has(id) && sessions.get(id).run.id !== afterRunId)
      return sessions.get(id);
    const arrival = deferred();
    arrivals.set(id, arrival);
    let timeout;
    try {
      return await Promise.race([
        arrival.promise,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("runner did not start")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function until(id, state) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = (await api(`/tasks/${id}`)).body;
      if (result.runs.at(-1)?.state === state) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(
      `Task did not reach ${state}: ${JSON.stringify((await api(`/tasks/${id}`)).body)}`,
    );
  }
  return { api, task, started, until, project, repo, sessions, close, open };
}

test("a task streams attributed evidence, verifies actual isolated changes and reaches Review", async (t) => {
  const f = await fixture(t);
  const task = await f.task();
  const result = await f.api(`/tasks/${task.id}/run`, {
    requestKey: "start-once",
  });
  assert.equal(result.status, 200);
  const session = await f.started(task.id);
  await writeFile(join(session.cwd, "shared.txt"), "task change\n");
  await writeFile(join(session.cwd, "new.txt"), "new file\n");
  session.onEvent({ type: "assistant", text: "Implemented the change." });
  session.onEvent({ type: "command", text: "editing shared.txt" });
  session.gate.resolve();
  const finished = await f.until(task.id, "completed");
  assert.equal(
    finished.task.statusId,
    f.project.statuses.find((s) => s.kind === "review").id,
  );
  assert.equal(finished.task.conversationId, `conversation-${task.id}`);
  const run = finished.runs.at(-1);
  assert.ok(run.verification.results.every((entry) => entry.exitCode === 0));
  assert.match(run.diff, /task change/);
  assert.match(run.diff, /new file/);
  assert.ok(
    run.files.some(
      (entry) => (typeof entry === "string" ? entry : entry.path) === "new.txt",
    ),
  );
  assert.equal(
    await readFile(join(f.repo, "shared.txt"), "utf8"),
    "original\n",
  );
  const snapshot = (await f.api("/snapshot")).body;
  assert.ok(
    snapshot.events.some(
      (event) =>
        event.runId === run.id &&
        event.taskId === task.id &&
        event.text === "Implemented the change.",
    ),
  );
});

test("capacity admits three isolated writers, deduplicates racing starts and cancels only the selected attempt", async (t) => {
  const f = await fixture(t);
  const tasks = await Promise.all(
    ["one", "two", "three", "overflow"].map((title) => f.task(title)),
  );
  const races = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.api(`/tasks/${tasks[0].id}/run`, { requestKey: "one-click" }),
    ),
  );
  assert.ok(races.every((result) => result.status === 200));
  assert.equal(new Set(races.map((result) => result.body.run.id)).size, 1);
  assert.equal((await f.api(`/tasks/${tasks[0].id}/run`, {})).status, 409);
  for (const task of tasks.slice(1))
    assert.equal((await f.api(`/tasks/${task.id}/run`, {})).status, 200);
  const [first, second, third] = await Promise.all(
    tasks.slice(0, 3).map((task) => f.started(task.id)),
  );
  assert.equal(
    (await f.api(`/tasks/${tasks[3].id}`)).body.runs[0].state,
    "queued",
  );
  assert.equal(new Set([first.cwd, second.cwd, third.cwd]).size, 3);
  assert.equal(new Set([first.tmpDir, second.tmpDir, third.tmpDir]).size, 3);
  assert.equal(new Set([first.port, second.port, third.port]).size, 3);
  await writeFile(join(first.cwd, "shared.txt"), "first partial\n");
  await writeFile(join(second.cwd, "shared.txt"), "second independent\n");
  first.onEvent({ type: "assistant", text: "first-output" });
  second.onEvent({ type: "assistant", text: "second-output" });
  assert.equal(
    (await f.api("/settings", { capacity: 1 }, "PATCH")).status,
    200,
  );
  assert.equal((await f.api(`/runs/${first.run.id}/cancel`, {})).status, 200);
  const cancelled = await f.until(tasks[0].id, "cancelled");
  assert.match(cancelled.runs[0].diff, /first partial/);
  assert.equal(second.signal.aborted, false);
  assert.equal(third.signal.aborted, false);
  assert.equal(
    (await f.api(`/tasks/${tasks[3].id}`)).body.runs[0].state,
    "queued",
  );
  second.gate.resolve();
  third.gate.resolve();
  await Promise.all([
    f.until(tasks[1].id, "completed"),
    f.until(tasks[2].id, "completed"),
  ]);
  const fourth = await f.started(tasks[3].id);
  assert.equal(
    await readFile(join(fourth.cwd, "shared.txt"), "utf8"),
    "original\n",
  );
  assert.equal(
    await readFile(join(second.cwd, "shared.txt"), "utf8"),
    "second independent\n",
  );
  assert.equal(
    await readFile(join(f.repo, "shared.txt"), "utf8"),
    "original\n",
  );
  const snapshot = (await f.api("/snapshot")).body;
  assert.equal(
    snapshot.runs.filter((run) => run.taskId === tasks[0].id).length,
    1,
  );
  assert.ok(
    snapshot.events.some(
      (event) =>
        event.text === "first-output" &&
        event.taskId === tasks[0].id &&
        event.runId === first.run.id,
    ),
  );
  assert.ok(
    snapshot.events.some(
      (event) =>
        event.text === "second-output" &&
        event.taskId === tasks[1].id &&
        event.runId === second.run.id,
    ),
  );
  fourth.gate.resolve();
  await f.until(tasks[3].id, "completed");
});

test("an actual workflow entry queues one atomic attempt with its updated task and rule snapshot", async (t) => {
  const f = await fixture(t);
  await f.api("/settings", { capacity: 1 }, "PATCH");
  const holder = await f.task("holder");
  await f.api(`/tasks/${holder.id}/run`, {});
  const holding = await f.started(holder.id);
  const task = await f.task("old title");
  const rule = {
    ...f.project.rule,
    enabled: true,
    instructions: "captured instructions",
  };
  assert.equal(
    (
      await f.api(
        `/projects/${f.project.id}/workflow`,
        { statuses: f.project.statuses, rule },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.api(
        `/tasks/${task.id}`,
        {
          statusId: rule.triggerStatus,
          title: "updated title",
          acceptanceCriteria: "updated criteria",
        },
        "PATCH",
      )
    ).status,
    200,
  );
  const queued = (await f.api(`/tasks/${task.id}`)).body;
  assert.equal(queued.runs.length, 1);
  assert.equal(queued.runs[0].state, "queued");
  assert.equal(queued.runs[0].input.title, "updated title");
  assert.equal(queued.runs[0].input.acceptanceCriteria, "updated criteria");
  await f.api(
    `/projects/${f.project.id}/workflow`,
    {
      statuses: f.project.statuses,
      rule: { ...rule, instructions: "future instructions" },
    },
    "PUT",
  );
  assert.equal(
    (
      await f.api(
        `/tasks/${task.id}`,
        { statusId: rule.triggerStatus },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.api(
        `/tasks/${task.id}`,
        { statusId: "backlog", title: "rejected mutation" },
        "PATCH",
      )
    ).status,
    409,
  );
  const unchanged = (await f.api(`/tasks/${task.id}`)).body;
  assert.equal(unchanged.task.title, "updated title");
  assert.equal(unchanged.task.statusId, rule.triggerStatus);
  assert.equal(unchanged.runs.length, 1);
  assert.equal(unchanged.runs[0].config.instructions, "captured instructions");
  holding.gate.resolve();
  await f.until(holder.id, "completed");
  const active = await f.started(task.id);
  assert.equal(active.task.title, "updated title");
  assert.equal(active.run.config.instructions, "captured instructions");
  active.gate.resolve();
  await f.until(task.id, "completed");
});

test("waiting requests stay scoped to their run while follow-ups queue visibly for a deliberate resumed attempt", async (t) => {
  const f = await fixture(t);
  const [one, two, three] = await Promise.all(
    ["waiting", "independent", "spare slot"].map((title) => f.task(title)),
  );
  await f.api(`/tasks/${one.id}/run`, {});
  await f.api(`/tasks/${two.id}/run`, {});
  const first = await f.started(one.id),
    second = await f.started(two.id);
  first.onRequest({
    id: "approval-a",
    kind: "command",
    method: "item/commandExecution/requestApproval",
    params: { command: "node tests.mjs" },
  });
  second.onRequest({
    id: "question-b",
    kind: "question",
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "color", question: "Which color?" }] },
  });
  await Promise.all([f.until(one.id, "waiting"), f.until(two.id, "waiting")]);
  const queuedMessage = await f.api(`/tasks/${one.id}/messages`, {
    text: "Please add keyboard support next.",
  });
  assert.equal(queuedMessage.status, 200);
  assert.equal(queuedMessage.body.queued, true);
  assert.equal(queuedMessage.body.message.queuedForNextAttempt, true);
  assert.equal((await f.api(`/tasks/${one.id}`)).body.runs.length, 1);
  await f.api(`/tasks/${three.id}/run`, {});
  const spare = await f.started(three.id);
  assert.equal(spare.signal.aborted, false);
  assert.equal(
    (
      await f.api(`/runs/${second.run.id}/requests/approval-a`, {
        response: { decision: "accept" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.api(`/runs/${first.run.id}/requests/approval-a`, {
        response: { decision: "accept" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.api(`/runs/${first.run.id}/requests/approval-a`, {
        response: { decision: "accept" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.api(`/runs/${second.run.id}/requests/question-b`, {
        response: { answers: { color: { answers: ["blue"] } } },
      })
    ).status,
    200,
  );
  assert.deepEqual(first.responses, [
    { id: "approval-a", response: { decision: "accept" } },
  ]);
  assert.deepEqual(second.responses, [
    {
      id: "question-b",
      response: { answers: { color: { answers: ["blue"] } } },
    },
  ]);
  first.gate.resolve();
  second.gate.resolve();
  spare.gate.resolve();
  const completed = await f.until(one.id, "completed");
  await Promise.all([
    f.until(two.id, "completed"),
    f.until(three.id, "completed"),
  ]);
  assert.equal(completed.runs[0].requests[0].state, "answered");
  assert.ok(completed.runs[0].requests[0].actorId);
  assert.ok(
    completed.task.messages.some(
      (message) =>
        message.role === "decision" && message.requestId === "approval-a",
    ),
  );
  await f.api(`/tasks/${one.id}/run`, {});
  const resumed = await f.started(one.id, first.run.id);
  assert.equal(resumed.task.conversationId, `conversation-${one.id}`);
  assert.equal(resumed.cwd, first.cwd);
  assert.equal(
    resumed.task.messages.filter(
      (message) => message.text === "Please add keyboard support next.",
    ).length,
    1,
  );
  assert.equal(
    (await f.api(`/tasks/${one.id}`)).body.task.messages.find(
      (message) => message.text === "Please add keyboard support next.",
    ).queuedForNextAttempt,
    false,
  );
  resumed.gate.resolve();
  await f.until(one.id, "completed");
});

test("failed verification retains evidence and a new rework attempt must verify before attributed human acceptance", async (t) => {
  const f = await fixture(t);
  const failedRule = {
    ...f.project.rule,
    testCommand:
      "node -e \"console.error('expected failure');process.exit(7)\"",
  };
  await f.api(
    `/projects/${f.project.id}/workflow`,
    { statuses: f.project.statuses, rule: failedRule },
    "PUT",
  );
  const task = await f.task("review gate");
  await f.api(`/tasks/${task.id}/run`, {});
  const first = await f.started(task.id);
  await writeFile(join(first.cwd, "shared.txt"), "first attempt\n");
  assert.equal((await f.api(`/tasks/${task.id}/accept`, {})).status, 409);
  assert.equal(
    (await f.api(`/tasks/${task.id}`, { statusId: "done" }, "PATCH")).status,
    409,
  );
  first.gate.resolve();
  const failed = await f.until(task.id, "failed");
  assert.equal(failed.task.statusId, "blocked");
  assert.match(failed.task.error, /Verification failed/);
  assert.equal(failed.runs[0].verification.success, false);
  assert.equal(failed.runs[0].verification.results[0].exitCode, 7);
  assert.match(
    failed.runs[0].verification.results[0].output,
    /expected failure/,
  );
  assert.match(failed.runs[0].diff, /first attempt/);
  assert.equal((await f.api(`/tasks/${task.id}/accept`, {})).status, 409);
  await f.api(
    `/projects/${f.project.id}/workflow`,
    { statuses: f.project.statuses, rule: f.project.rule },
    "PUT",
  );
  assert.equal(
    (
      await f.api(`/tasks/${task.id}/messages`, {
        text: "Fix the failing case and add a new file.",
      })
    ).status,
    200,
  );
  const second = await f.started(task.id, first.run.id);
  assert.equal(second.cwd, first.cwd);
  assert.equal(second.task.conversationId, `conversation-${task.id}`);
  await writeFile(join(second.cwd, "shared.txt"), "second corrected attempt\n");
  await writeFile(join(second.cwd, "review-file.txt"), "review evidence\n");
  second.gate.resolve();
  const verified = await f.until(task.id, "completed");
  assert.equal(verified.runs.length, 2);
  assert.equal(verified.runs[0].diff, failed.runs[0].diff);
  assert.equal(verified.runs[0].verification.results[0].exitCode, 7);
  assert.match(verified.runs[1].diff, /second corrected attempt/);
  assert.match(verified.runs[1].diff, /review evidence/);
  assert.equal(
    (await f.api(`/tasks/${task.id}`, { statusId: "done" }, "PATCH")).status,
    409,
  );
  const accepted = await f.api(`/tasks/${task.id}/accept`, {});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.task.statusId, "done");
  assert.equal(
    accepted.body.task.acceptedBy,
    (await f.api("/me")).body.user.id,
  );
  assert.ok(accepted.body.task.acceptedAt);
  assert.equal(
    accepted.body.task.branch,
    first.task.branch ?? second.task.branch,
  );
  assert.equal(
    await readFile(join(f.repo, "shared.txt"), "utf8"),
    "original\n",
  );
  await f.api("/settings", { capacity: 1 }, "PATCH");
  const holder = await f.task("hold capacity");
  await f.api(`/tasks/${holder.id}/run`, {});
  const holding = await f.started(holder.id);
  await f.api(`/tasks/${task.id}/messages`, { text: "One more correction." });
  const rework = (await f.api(`/tasks/${task.id}`)).body;
  assert.equal(rework.runs.at(-1).state, "queued");
  assert.notEqual(rework.task.statusId, "done");
  assert.equal(rework.task.acceptedBy, null);
  holding.gate.resolve();
});

test("restart retains interrupted work, conversations and queue evidence without spontaneous execution", async (t) => {
  const f = await fixture(t);
  await f.api("/settings", { capacity: 1 }, "PATCH");
  const active = await f.task("active before stop"),
    queued = await f.task("queued before stop");
  await f.api(`/tasks/${active.id}/run`, {});
  const session = await f.started(active.id);
  await writeFile(join(session.cwd, "shared.txt"), "partial before shutdown\n");
  session.onEvent({ type: "assistant", text: "persisted before shutdown" });
  session.onRequest({
    id: "pending-at-shutdown",
    kind: "command",
    params: { command: "node test.mjs" },
  });
  await f.until(active.id, "waiting");
  await f.api(`/tasks/${queued.id}/run`, {});
  const prior = (await f.api("/snapshot")).body;
  assert.equal(
    prior.runs.find((run) => run.taskId === queued.id).state,
    "queued",
  );
  await f.close();
  assert.equal(session.signal.aborted, true);
  await f.open();
  const recovered = (await f.api("/snapshot")).body;
  assert.equal(
    recovered.runs.find((run) => run.taskId === active.id).state,
    "interrupted",
  );
  assert.equal(
    recovered.runs.find((run) => run.taskId === queued.id).state,
    "interrupted",
  );
  assert.match(
    recovered.runs.find((run) => run.taskId === active.id).diff,
    /partial before shutdown/,
  );
  assert.equal(
    recovered.tasks.find((task) => task.id === active.id).conversationId,
    `conversation-${active.id}`,
  );
  assert.ok(
    recovered.events.some(
      (event) =>
        event.text === "persisted before shutdown" &&
        event.runId === session.run.id,
    ),
  );
  assert.equal(f.sessions.size, 1);
  assert.equal(
    (
      await f.api(`/runs/${session.run.id}/requests/pending-at-shutdown`, {
        response: { decision: "accept" },
      })
    ).status,
    409,
  );
  assert.equal((await f.api(`/tasks/${active.id}/run`, {})).status, 200);
  const resumed = await f.started(active.id, session.run.id);
  assert.equal(resumed.cwd, session.cwd);
  assert.equal(resumed.task.conversationId, `conversation-${active.id}`);
  assert.equal(
    await readFile(join(resumed.cwd, "shared.txt"), "utf8"),
    "partial before shutdown\n",
  );
  resumed.gate.resolve();
  const completed = await f.until(active.id, "completed");
  assert.equal(completed.runs.length, 2);
  assert.equal(completed.runs[0].state, "interrupted");
  assert.equal((await f.api(`/tasks/${queued.id}`)).body.runs.length, 1);
});
