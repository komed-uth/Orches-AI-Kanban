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
      params: { delta: "fixture output\n" },
    });
    if (process.env.EVALUATION_FIXTURE === "stream-limit") {
      const first = m.params.input[0].text.includes(
        "Show the remaining gem count",
      );
      setTimeout(
        () => {
          for (let index = 0; index < (first ? 60 : 3); index++)
            send({
              method: "item/agentMessage/delta",
              params: {
                delta: "Cookie: session=stream-limit-secret",
                itemId: `stream-${index}`,
              },
            });
        },
        first ? 0 : 50,
      );
      if (!first)
        setTimeout(
          () =>
            send({
              method: "item/agentMessage/delta",
              params: {
                delta: "stream-limit-continuation\n",
                itemId: "stream-2",
              },
            }),
          800,
        );
      setTimeout(
        () =>
          send({
            method: "turn/completed",
            params: { turn: { id: "turn", status: "completed" } },
          }),
        first ? 150 : 1000,
      );
      continue;
    }
    if (process.env.EVALUATION_FIXTURE === "split-secrets") {
      const marker = m.params.input[0].text.includes(
        "Show the remaining gem count",
      )
        ? "gem"
        : "restart";
      const chunks = [
        `\n${marker}-before\nCoo`,
        "kie: session=",
        "split-cookie-secret\nconfigured-cross-",
        "fragment-secret\nmulti-line-head\nmulti-",
        "line-tail\n",
        `${marker}-after\nAuthorization: Bearer terminal-secret`,
      ];
      setTimeout(
        () =>
          send({
            method: "item/agentMessage/delta",
            params: {
              delta: `${marker}-independent\n`,
              itemId: `${marker}-parallel`,
            },
          }),
        10,
      );
      chunks.forEach((delta, index) =>
        setTimeout(
          () =>
            send({
              method: "item/agentMessage/delta",
              params: { delta, itemId: `${marker}-message` },
            }),
          index * 20,
        ),
      );
    }
    if (process.env.EVALUATION_FIXTURE === "bounded-text") {
      for (const delta of [
        "Cookie: session=" + "x".repeat(10000) + "oversized-secret",
        "oversized-continuation-secret\nretained-after-oversize\nCookie: session=cancel-tail-secret",
      ])
        send({
          method: "item/agentMessage/delta",
          params: { delta, itemId: "bounded-message" },
        });
    }
    if (process.env.EVALUATION_FIXTURE === "interrupted-proxy")
      send({
        method: "item/agentMessage/delta",
        params: { delta: "proxy HTTP CONNECT 407 denied; private-proxy-tail" },
      });
    if (process.env.EVALUATION_FIXTURE === "split-proxy") {
      for (const [index, delta] of [
        "proxy HTTP CON",
        "NECT 403 forbidden\n",
      ].entries())
        setTimeout(
          () => send({ method: "item/agentMessage/delta", params: { delta } }),
          index * 10,
        );
    }
    if (process.env.EVALUATION_FIXTURE === "json-secrets")
      send({
        method: "item/agentMessage/delta",
        params: {
          delta:
            JSON.stringify({
              Authorization: "Bearer json-bearer-secret",
              Cookie: 'session="escaped-json-cookie-secret"',
              orches_session: "json-session-secret",
            }) +
            '\nCookie: session="quoted-cookie-secret"\nAuthorization: Digest username="alice", response="digest-secret"\n' +
            "\norches_session=\"standalone-session-secret\"; Path=/\norches_session='single-session-secret'; Path=/\n" +
            'token="quoted-token-secret"\napi_key="quoted-api-key-secret"\n' +
            JSON.stringify(
              JSON.stringify({ Authorization: "Bearer escaped-header-secret" }),
            ),
        },
      });
    if (process.env.EVALUATION_FIXTURE === "connected-timeout")
      send({
        method: "item/agentMessage/delta",
        params: { delta: "Successfully connected; awaiting model output." },
      });
    if (process.env.EVALUATION_FIXTURE === "retry-blocked")
      send({
        method: "error",
        params: {
          error: { message: "proxy HTTP CONNECT 403 forbidden" },
          willRetry: true,
        },
      });
    else if (
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
    else if (
      ![
        "timeout",
        "connected-timeout",
        "bounded-text",
        "split-proxy",
        "interrupted-proxy",
      ].includes(process.env.EVALUATION_FIXTURE)
    )
      setTimeout(() => {
        if (process.env.EVALUATION_FIXTURE === "noisy")
          for (let i = 0; i < 160; i++)
            send({
              method: "item/agentMessage/delta",
              params: {
                delta:
                  `event-${i} Authorization: Bearer synthetic-secret\n` +
                  ("x".repeat(100) + "\n").repeat(100),
              },
            });
        send({
          method: "turn/completed",
          params: { turn: { id: "turn", status: "completed" } },
        });
      }, 150);
  }
}
