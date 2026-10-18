import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import { stopProcessGroup } from "./verification.mjs";

export function createCodexRunner({
  run = {},
  task,
  project = {},
  cwd,
  tmpDir,
  port,
  signal,
  onEvent = () => {},
  onRequest = () => {},
  onConversation = () => {},
}) {
  let child,
    seq = 0,
    threadId,
    turnId,
    finished = false,
    stopping;
  const pending = new Map(),
    requests = new Map();
  let complete, fail;
  const turn = new Promise((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  // Initialization can fail before run() awaits the turn.
  turn.catch(() => {});
  const write = (value) => {
    if (!child?.stdin.writable) throw new Error("Codex connection is closed.");
    child.stdin.write(JSON.stringify(value) + "\n");
  };
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try {
        write({ id, method, params });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  const stop = () => (stopping ??= stopProcessGroup(child));
  const abort = () => {
    if (threadId && turnId) {
      try {
        write({
          id: ++seq,
          method: "turn/interrupt",
          params: { threadId, turnId },
        });
      } catch {}
    }
    fail(signal?.reason || new Error("Cancelled"));
    void stop();
  };
  const fatal = (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    fail(error);
  };
  const handle = (message) => {
    if (message.id !== undefined && !message.method) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      message.error
        ? entry.reject(
            new Error(message.error.message || "Codex protocol error"),
          )
        : entry.resolve(message.result);
      return;
    }
    const p = message.params || {};
    if (p.threadId && threadId && p.threadId !== threadId) return;
    if (message.id !== undefined && message.method) {
      const kinds = {
        "item/commandExecution/requestApproval": "command",
        "item/fileChange/requestApproval": "file",
        "item/permissions/requestApproval": "permission",
        "item/tool/requestUserInput": "question",
      };
      const kind = kinds[message.method];
      if (!kind) {
        write({
          id: message.id,
          error: { code: -32601, message: "Unsupported client request" },
        });
        return;
      }
      const id = String(message.id);
      requests.set(id, { wireId: message.id, kind, params: p });
      onRequest({ id, method: message.method, kind, params: p });
      return;
    }
    switch (message.method) {
      case "item/agentMessage/delta":
        onEvent({ type: "assistant", text: p.delta || "", itemId: p.itemId });
        break;
      case "item/commandExecution/outputDelta":
        onEvent({ type: "command", text: p.delta || "", itemId: p.itemId });
        break;
      case "item/started":
        if (p.item?.type === "commandExecution")
          onEvent({
            type: "command",
            text: `$ ${p.item.command}\n`,
            itemId: p.item.id,
          });
        break;
      case "turn/started":
        turnId = p.turn?.id;
        break;
      case "error":
        onEvent({
          type: "error",
          text: p.error?.message || "Codex error",
          willRetry: p.willRetry,
        });
        if (!p.willRetry) fail(new Error(p.error?.message || "Codex error"));
        break;
      case "turn/completed":
        if (p.turn?.status === "completed") {
          finished = true;
          complete();
        } else
          fail(
            new Error(
              p.turn?.error?.message ||
                `Codex turn ${p.turn?.status || "failed"}`,
            ),
          );
        break;
    }
  };
  return {
    async run() {
      if (signal?.aborted) throw signal.reason || new Error("Cancelled");
      const config = run.config || {};
      child = spawn(
        config.executable || "codex",
        ["app-server", "--listen", "stdio://"],
        {
          cwd,
          detached: true,
          env: {
            ...process.env,
            ...(tmpDir ? { TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir } : {}),
            ...(port ? { PORT: String(port) } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          handle(JSON.parse(line));
        } catch (error) {
          fatal(new Error(`Codex protocol failure: ${error.message}`));
          void stop();
        }
      });
      child.stderr.on("data", (data) =>
        onEvent({ type: "diagnostic", text: data.toString() }),
      );
      child.on("error", (error) =>
        fatal(new Error(`Cannot start Codex executable: ${error.message}`)),
      );
      child.on("close", (code) => {
        if (!finished)
          fatal(
            new Error(
              `Codex disconnected before completion (exit ${code}). Check host login and connectivity.`,
            ),
          );
      });
      signal?.addEventListener("abort", abort, { once: true });
      let timer;
      try {
        // A dead or incompatible executable must not occupy a slot indefinitely.
        timer = setTimeout(() => {
          fatal(
            new Error(
              "Codex initialization timed out. Check executable compatibility and host login.",
            ),
          );
          void stop();
        }, 30000);
        await rpc("initialize", {
          clientInfo: {
            name: "orches_ai_kanban",
            title: "Orches AI Kanban",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: true },
        });
        write({ method: "initialized", params: {} });
        const conversation = task.conversationId;
        const params = {
          cwd,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          ...(config.model ? { model: config.model } : {}),
        };
        const result = await rpc(
          conversation ? "thread/resume" : "thread/start",
          { ...params, ...(conversation ? { threadId: conversation } : {}) },
        );
        threadId = result.thread?.id;
        if (!threadId)
          throw new Error("Codex did not return a conversation identifier.");
        onConversation(threadId);
        clearTimeout(timer);
        const text =
          run.prompt ||
          [
            task.title,
            task.description,
            task.acceptanceCriteria,
            config.instructions ?? project.rule?.instructions,
            ...(task.messages || [])
              .filter((m) => m.role === "human" || m.role === "user")
              .map((m) => m.text),
          ]
            .filter(Boolean)
            .join("\n\n");
        const started = await rpc("turn/start", {
          threadId,
          cwd,
          input: [{ type: "text", text, text_elements: [] }],
          ...(config.model ? { model: config.model } : {}),
        });
        turnId = started.turn?.id;
        await turn;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        await stop();
        lines.close();
        for (const entry of pending.values())
          entry.reject(new Error("Codex connection closed"));
        pending.clear();
      }
    },
    respond(requestId, response) {
      const request = requests.get(String(requestId));
      if (!request)
        throw Object.assign(
          new Error(
            "The Codex request is stale or does not belong to this run.",
          ),
          { status: 409 },
        );
      let result;
      if (request.kind === "question") {
        const answers = response?.answers;
        if (
          !answers ||
          !(request.params.questions || []).every(
            (q) =>
              Array.isArray(answers[q.id]?.answers) &&
              answers[q.id].answers.every((a) => typeof a === "string"),
          )
        )
          throw Object.assign(
            new Error("Answer every question with an answers array."),
            { status: 400 },
          );
        result = { answers };
      } else if (request.kind === "permission") {
        if (!response?.permissions || typeof response.permissions !== "object")
          throw Object.assign(
            new Error("A permissions response is required."),
            { status: 400 },
          );
        result = { permissions: response.permissions, scope: "turn" };
      } else {
        const decision =
          typeof response === "string" ? response : response?.decision;
        if (
          !["accept", "acceptForSession", "decline", "cancel"].includes(
            decision,
          )
        )
          throw Object.assign(
            new Error("Choose accept or decline for this request."),
            { status: 400 },
          );
        result = { decision };
      }
      write({ id: request.wireId, result });
      requests.delete(String(requestId));
    },
  };
}
export async function inspectCodexHost({ executable = "codex" } = {}) {
  const exec = promisify(execFile);
  try {
    const version = await exec(executable, ["--version"], { timeout: 10000 });
    try {
      await exec(executable, ["login", "status"], { timeout: 10000 });
      return {
        installed: true,
        loggedIn: true,
        version: version.stdout.trim(),
        connectivity: "not-checked",
      };
    } catch {
      return {
        installed: true,
        loggedIn: false,
        version: version.stdout.trim(),
        connectivity: "not-checked",
        message: "Run codex login on the host.",
      };
    }
  } catch {
    return {
      installed: false,
      loggedIn: false,
      connectivity: "not-checked",
      message: "Install Codex CLI or correct the configured executable path.",
    };
  }
}
