import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../server/app.mjs";

export const policy = {
  eventBytes: 8192,
  artifactBytes: 1048576,
  summaryBytes: 65536,
  consoleBytes: 4096,
  defaultDeadlineMs: 60000,
  maxDeadlineMs: 1800000,
};

export async function evaluateLive({
  summary,
  dataDir,
  output,
  executable,
  deadlineMs,
  redact,
  addSecret,
}) {
  const username = process.env.ORCHES_EVAL_USERNAME,
    password = process.env.ORCHES_EVAL_PASSWORD;
  if (!username || !password)
    throw new Error(
      "Set ORCHES_EVAL_USERNAME and ORCHES_EVAL_PASSWORD for authenticated application operations.",
    );
  if (
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 100 ||
    deadlineMs > policy.maxDeadlineMs
  )
    throw new Error("Use --deadline-ms from 100 to 1800000.");
  summary.policy = policy;
  summary.deadline = new Date(Date.now() + deadlineMs).toISOString();
  summary.runs = [];
  summary.concurrent = false;
  summary.evidence = {
    bytes: 0,
    events: 0,
    lastCursor: 0,
    truncatedEvents: 0,
    omittedEvents: 0,
    missing: false,
    affectedRuns: [],
  };
  summary.phases.verification = "incomplete";
  summary.phases.review = "incomplete";
  summary.phases.conversationResume = "unverified";
  summary.phases.taskIndependence = "human-review-required";
  const eventFile = join(output, "events.ndjson");
  writeFileSync(eventFile, "", { mode: 0o600, flag: "wx" });
  const controller = new AbortController();
  let interrupted,
    application,
    stream,
    streamTask,
    cookie = "",
    base,
    taskIds = new Set();
  const states = new Map();
  const stop = (reason) => {
    interrupted ??= reason;
    controller.abort();
  };
  const term = () => stop("terminated"),
    int = () => stop("interrupted");
  process.on("SIGTERM", term);
  process.on("SIGINT", int);
  const timer = setTimeout(() => stop("deadline"), deadlineMs);
  const api = async (
    path,
    body,
    method = body === undefined ? "GET" : "POST",
    signal = controller.signal,
  ) => {
    const response = await fetch(base + "/api" + path, {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const next = response.headers.get("set-cookie");
    if (next) {
      cookie = next.split(";")[0];
      addSecret(cookie);
      addSecret(cookie.slice(cookie.indexOf("=") + 1));
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        `Application HTTP ${response.status}: ${data.error ?? "operation failed"}`,
      );
    return data;
  };
  const record = (event) => {
    if (event.id <= summary.evidence.lastCursor) return;
    summary.evidence.lastCursor = event.id;
    if (!taskIds.has(event.taskId)) return;
    if (event.runId && event.state) states.set(event.runId, event.state);
    summary.concurrent ||=
      [...states.values()].filter((s) =>
        ["starting", "running", "waiting", "verifying"].includes(s),
      ).length >= 2;
    if (/proxy|CONNECT|403|forbidden/i.test(event.text ?? ""))
      summary.phases.connectivity = "blocked";
    const safe = {
      mode: summary.mode,
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      taskId: event.taskId,
      runId: event.runId,
      state: event.state,
    };
    if (event.text) safe.text = redact(event.text);
    if (event.verification)
      safe.verification = { success: event.verification.success };
    if (event.type === "run.evidence")
      safe.reviewEvidence = "retained in application";
    let line = JSON.stringify(safe) + "\n";
    if (Buffer.byteLength(line) > policy.eventBytes) {
      safe.text = Buffer.from(safe.text ?? "")
        .subarray(0, 4000)
        .toString();
      safe.truncated = true;
      summary.evidence.truncatedEvents++;
      if (event.runId && !summary.evidence.affectedRuns.includes(event.runId))
        summary.evidence.affectedRuns.push(event.runId);
      line = JSON.stringify(safe) + "\n";
      // JSON escaping can expand text; retain identity even for pathological output.
      if (Buffer.byteLength(line) > policy.eventBytes) {
        delete safe.text;
        line = JSON.stringify(safe) + "\n";
      }
    }
    if (
      summary.evidence.bytes + Buffer.byteLength(line) >
      policy.artifactBytes - policy.summaryBytes
    ) {
      summary.evidence.omittedEvents++;
      if (event.runId && !summary.evidence.affectedRuns.includes(event.runId))
        summary.evidence.affectedRuns.push(event.runId);
      return;
    }
    appendFileSync(eventFile, line);
    summary.evidence.bytes += Buffer.byteLength(line);
    summary.evidence.events++;
  };
  const readEvents = async () => {
    const response = await fetch(
      base + "/api/events?after=" + summary.evidence.lastCursor,
      { headers: { Cookie: cookie }, signal: controller.signal },
    );
    if (!response.ok)
      throw new Error("Authenticated event stream unavailable.");
    stream = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "",
      dropping = false;
    while (true) {
      const { value, done } = await stream.read();
      if (done) break;
      let chunk = decoder.decode(value, { stream: true });
      if (dropping) {
        const end = chunk.indexOf("\n\n");
        if (end < 0) continue;
        chunk = chunk.slice(end + 2);
        dropping = false;
      }
      pending += chunk;
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const line = frame.split("\n").find((x) => x.startsWith("data: "));
        if (line) record(JSON.parse(line.slice(6)));
      }
      if (pending.length > 131072) {
        pending = "";
        dropping = true;
        summary.evidence.missing = true;
        summary.evidence.omittedEvents++;
      }
    }
  };
  const refresh = async (signal = controller.signal) => {
    for (const id of taskIds) {
      const { task, runs } = await api(
        "/tasks/" + id,
        undefined,
        "GET",
        signal,
      );
      const owned = summary.runs.find((r) => r.taskId === id);
      const run = runs.find((r) => r.id === owned?.id);
      if (!run) continue;
      Object.assign(owned, {
        state: run.state,
        worktree: task.worktree,
        branch: task.branch,
        baseRevision: task.baseRevision,
        conversationId: run.conversationId,
        error: run.error ? redact(run.error) : undefined,
        verification: run.verification
          ? {
              success: run.verification.success,
              results: run.verification.results.map((x) => ({
                kind: x.kind,
                exitCode: x.exitCode,
                signal: x.signal,
              })),
            }
          : null,
        statusId: task.statusId,
      });
      owned.initialization = run.conversationId ? "verified" : "unverified";
      owned.connectivity =
        run.verification || ["verifying", "completed"].includes(run.state)
          ? summary.mode === "synthetic-fixture"
            ? "synthetic-only"
            : "verified"
          : /proxy|CONNECT|403|forbidden/i.test(run.error ?? "")
            ? "blocked"
            : "unverified";
      if (/proxy|CONNECT|403|forbidden/i.test(run.error ?? ""))
        summary.phases.connectivity = "blocked";
      if (["verifying", "completed"].includes(run.state) || run.verification)
        summary.phases.connectivity =
          summary.mode === "synthetic-fixture" ? "synthetic-only" : "verified";
    }
  };
  try {
    application = await createApplication({ dataDir });
    if (controller.signal.aborted) throw new Error(interrupted);
    const server = application.app.listen(0, "127.0.0.1");
    await new Promise((yes, no) => {
      server.once("listening", yes);
      server.once("error", no);
    });
    base = "http://127.0.0.1:" + server.address().port;
    const { needsSetup } = await api("/setup");
    await api(needsSetup ? "/setup" : "/login", { username, password });
    const snapshot = await api("/snapshot");
    if (
      snapshot.runs.some((r) =>
        ["queued", "starting", "running", "waiting", "verifying"].includes(
          r.state,
        ),
      )
    )
      throw new Error(
        "Runtime contains active work. Use a separate stopped evaluation runtime.",
      );
    const project = snapshot.projects.find(
      (p) => resolve(p.path) === join(dataDir, "sample-project"),
    );
    const tasks = snapshot.tasks.filter((t) => t.projectId === project?.id);
    if (tasks.length !== 2)
      throw new Error(
        "Expected the two independent seeded sample tasks. Use a dedicated evaluation runtime.",
      );
    if (tasks.some((t) => t.statusId === "done"))
      throw new Error(
        "Seeded tasks already accepted; use a new evaluation runtime.",
      );
    taskIds = new Set(tasks.map((t) => t.id));
    summary.evidence.lastCursor = snapshot.cursor;
    await api(
      "/settings",
      { executable, capacity: Math.max(2, snapshot.settings.capacity) },
      "PATCH",
    );
    streamTask = readEvents().catch((error) => {
      if (!controller.signal.aborted) {
        summary.evidence.missing = true;
        stop("event-stream-failed");
      }
    });
    // Separate requests retain each acknowledged run even if a later start fails.
    for (const task of tasks) {
      const { run } = await api("/tasks/" + task.id + "/run", {});
      summary.runs.push({ id: run.id, taskId: task.id, state: run.state });
    }
    while (!controller.signal.aborted) {
      await refresh();
      if (
        summary.runs.every((r) =>
          ["completed", "failed", "cancelled", "interrupted"].includes(r.state),
        )
      )
        break;
      await delay(50, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!interrupted) summary.blocker = redact(error.message);
  } finally {
    // Cleanup requests have a separate bounded budget after the live deadline.
    if (application) {
      for (const run of summary.runs)
        if (
          !["completed", "failed", "cancelled", "interrupted"].includes(
            run.state,
          )
        ) {
          try {
            await api(
              "/runs/" + run.id + "/cancel",
              {},
              "POST",
              AbortSignal.timeout(2000),
            );
          } catch {}
        }
      await application.scheduler.close();
      try {
        await refresh(AbortSignal.timeout(2000));
      } catch {
        summary.evidence.missing = true;
      }
      try {
        await api("/logout", {}, "POST", AbortSignal.timeout(2000));
      } catch {}
      await application.close();
    }
    controller.abort();
    await stream?.cancel().catch(() => {});
    await streamTask;
    clearTimeout(timer);
    process.off("SIGTERM", term);
    process.off("SIGINT", int);
  }
  if (interrupted) summary.termination = interrupted;
  const complete =
    summary.runs.length === 2 &&
    summary.runs.every(
      (r) => r.state === "completed" && r.verification?.success,
    );
  summary.phases.initialization =
    summary.runs.length === 2 &&
    summary.runs.every((r) => r.initialization === "verified")
      ? "verified"
      : summary.runs.some((r) => r.initialization === "verified")
        ? "partial"
        : "unverified";
  summary.phases.connectivity = summary.runs.some(
    (r) => r.connectivity === "blocked",
  )
    ? "blocked"
    : summary.runs.length === 2 &&
        summary.runs.every((r) =>
          ["verified", "synthetic-only"].includes(r.connectivity),
        )
      ? summary.mode === "synthetic-fixture"
        ? "synthetic-only"
        : "verified"
      : summary.runs.some((r) =>
            ["verified", "synthetic-only"].includes(r.connectivity),
          )
        ? "partial"
        : "unverified";
  summary.phases.concurrentExecution = summary.concurrent
    ? "observed"
    : "unverified";
  summary.phases.output =
    summary.evidence.missing ||
    summary.evidence.truncatedEvents ||
    summary.evidence.omittedEvents
      ? "incomplete"
      : "recorded";
  summary.phases.verification = complete ? "passed" : "incomplete";
  summary.phases.review = complete ? "awaiting-human-review" : "incomplete";
  summary.evidence.missing ||=
    summary.evidence.truncatedEvents > 0 || summary.evidence.omittedEvents > 0;
  summary.outcome =
    summary.phases.connectivity === "blocked" || summary.blocker
      ? "blocked"
      : interrupted
        ? "incomplete"
        : summary.evidence.missing
          ? "incomplete-evidence"
          : complete
            ? "awaiting-human-review"
            : "incomplete";
}
