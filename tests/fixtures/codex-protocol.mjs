#!/usr/bin/env node
import readline from "node:readline";
import { writeFileSync } from "node:fs";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let mode, threadId;
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    send({ id: m.id, result: { userAgent: "fixture" } });
  else if (m.method === "thread/start" || m.method === "thread/resume") {
    threadId = m.params.threadId || "fixture-thread";
    send({ id: m.id, result: { thread: { id: threadId } } });
  } else if (m.method === "turn/start") {
    mode = m.params.input[0].text;
    writeFileSync("prompt.txt", mode);
    if (mode.includes("diagnostics"))
      process.stderr.write(
        "logging=" + process.env.RUST_LOG + "\n" + "x".repeat(100000),
      );
    send({ id: m.id, result: { turn: { id: "turn", status: "inProgress" } } });
    send({
      method: "item/agentMessage/delta",
      params: { threadId, turnId: "turn", delta: "Working" },
    });
    if (mode.includes("disconnect")) process.exit(2);
    else if (mode.includes("failure"))
      send({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: "turn",
            status: "failed",
            error: { message: "fixture failure" },
          },
        },
      });
    else if (mode.includes("wait"))
      send({
        id: 100,
        method: mode.includes("question")
          ? "item/tool/requestUserInput"
          : "item/commandExecution/requestApproval",
        params: mode.includes("question")
          ? {
              threadId,
              questions: [
                {
                  id: "color",
                  question: "Choose?",
                  options: [{ label: "blue" }],
                },
              ],
            }
          : { threadId, command: "echo approved" },
      });
    else if (!mode.includes("hold")) finish();
  } else if (m.id === 100) {
    if (
      !m.result ||
      (mode.includes("question")
        ? !m.result.answers?.color?.answers?.includes("blue")
        : m.result.decision !== "accept")
    )
      process.exit(3);
    finish();
  }
}
function finish() {
  writeFileSync("new-file.txt", "fixture change\n");
  send({
    method: "item/commandExecution/outputDelta",
    params: { threadId, delta: "command output\n" },
  });
  send({
    method: "turn/completed",
    params: { threadId, turn: { id: "turn", status: "completed" } },
  });
}
