#!/usr/bin/env node
import readline from "node:readline";
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("synthetic-evaluation-fixture");
  process.exit(0);
}
if (process.argv.includes("login")) process.exit(0);
writeFileSync("fixture-pid.txt", String(process.pid));
const send = (x) => process.stdout.write(JSON.stringify(x) + "\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    send({ id: m.id, result: { userAgent: "synthetic-fixture" } });
  if (m.method === "thread/start" || m.method === "thread/resume")
    send({ id: m.id, result: { thread: { id: "fixture-" + process.pid } } });
  if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn" } } });
    send({
      method: "item/agentMessage/delta",
      params: { delta: "fixture output" },
    });
    if (
      process.env.EVALUATION_FIXTURE === "blocked" ||
      (process.env.EVALUATION_FIXTURE === "mixed" &&
        m.params.input[0].text.includes("Show the remaining gem count"))
    )
      send({
        method: "error",
        params: {
          error: { message: "proxy HTTP CONNECT 403 forbidden" },
          willRetry: false,
        },
      });
    else if (process.env.EVALUATION_FIXTURE !== "timeout")
      setTimeout(() => {
        if (process.env.EVALUATION_FIXTURE === "noisy")
          for (let i = 0; i < 160; i++)
            send({
              method: "item/agentMessage/delta",
              params: {
                delta:
                  `event-${i} Authorization: Bearer synthetic-secret\n` +
                  "x".repeat(10000),
              },
            });
        send({
          method: "turn/completed",
          params: { turn: { id: "turn", status: "completed" } },
        });
      }, 150);
  }
}
