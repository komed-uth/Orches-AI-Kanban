import { createApplication } from "../../server/app.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const application = await createApplication({
  dataDir: process.argv[2],
  runnerFactory: ({
    cwd,
    signal,
    onConversation,
    onEvent,
    onInputAccepted,
  }) => ({
    async run() {
      onConversation("retained-crash-conversation");
      onInputAccepted();
      writeFileSync(
        join(cwd, "shared.txt"),
        "partial from abruptly stopped agent\n",
      );
      writeFileSync(
        join(cwd, "new-recovery.txt"),
        "untracked recovery evidence\n",
      );
      onEvent({ type: "assistant", text: "Partial changes written." });
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("stopped")), {
          once: true,
        }),
      );
    },
  }),
});
const server = application.app.listen(0, "127.0.0.1", () =>
  process.send({ port: server.address().port }),
);
process.on("SIGTERM", async () => {
  await application.close();
  process.exit(0);
});
