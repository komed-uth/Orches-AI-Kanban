import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("host SIGKILL terminates an isolated writer that ignores SIGTERM", async (t) => {
  const parent = spawn(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/managed-parent.mjs", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => parent.kill("SIGKILL"));
  const [data] = await once(parent.stdout, "data");
  const { pid } = JSON.parse(data.toString());
  parent.kill("SIGKILL");
  await once(parent, "exit");
  const alive = async () => {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return stat.split(" ")[2] !== "Z";
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  const deadline = Date.now() + 3000;
  while ((await alive()) && Date.now() < deadline) await delay(25);
  assert.equal(await alive(), false, "task process survived host death");
});
