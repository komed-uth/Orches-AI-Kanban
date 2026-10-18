import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../../server/app.mjs";
const dataDir = await mkdtemp(join(tmpdir(), "orches-browser-"));
const attempts = new Map();
// This test-only runner is deterministic. It never invokes Codex or a model.
function runnerFactory({
  task,
  run,
  cwd,
  signal,
  onEvent,
  onRequest,
  onConversation,
}) {
  const answers = new Map();
  const ask = (request) =>
    new Promise((resolve, reject) => {
      answers.set(request.id, resolve);
      signal.addEventListener(
        "abort",
        () => reject(new Error("Fixture cancelled")),
        { once: true },
      );
      onRequest(request);
    });
  return {
    async run() {
      const attempt = (attempts.get(task.id) || 0) + 1;
      attempts.set(task.id, attempt);
      if (task.title.includes("retry") && attempt === 1)
        throw new Error(
          "Intentional browser fixture failure; retry explicitly.",
        );
      onConversation(task.conversationId || `fixture-${task.id}`);
      onEvent({
        type: "assistant",
        text: "DETERMINISTIC TEST FIXTURE — no model execution.",
      });
      if (task.title.includes("cancel")) {
        await new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("Fixture cancelled")),
            { once: true },
          ),
        );
        return;
      }
      await ask({
        id: "approval",
        kind: "command",
        method: "item/commandExecution/requestApproval",
        params: { command: "Create fixture evidence" },
      });
      await ask({
        id: "question",
        kind: "question",
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            { id: "color", question: "What color should the gem be?" },
          ],
        },
      });
      await writeFile(
        join(cwd, "browser-evidence.txt"),
        `Verified fixture evidence for ${run.id}\n`,
      );
      onEvent({
        type: "assistant",
        text: "Fixture work is ready for verification.",
      });
    },
    respond(id, response) {
      if (!answers.has(id)) throw new Error("Unknown fixture request");
      answers.get(id)(response);
      answers.delete(id);
    },
  };
}
const application = await createApplication({ dataDir, runnerFactory });
application.app.listen(4319, "127.0.0.1");
async function shutdown() {
  await application.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
