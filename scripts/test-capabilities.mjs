import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
export function childResult(command, args, options) {
  return new Promise((resolve, reject) => {
    const { timeout, ...spawnOptions } = options;
    const child = spawn(command, args, spawnOptions);
    const deadline = timeout
      ? setTimeout(() => child.kill("SIGKILL"), timeout)
      : undefined;
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal, stdout });
    });
  });
}

export async function preflight() {
  let temporary;
  try {
    try {
      temporary = await mkdtemp(path.join(tmpdir(), "orches-test-check-"));
      const probe = path.join(temporary, "filesystem-probe");
      await writeFile(probe, "writable");
      if ((await readFile(probe, "utf8")) !== "writable")
        throw new Error("temporary file readback failed");
      await rm(probe);
    } catch (error) {
      throw new Error(
        `Temporary-filesystem capability unavailable: ${error.message}`,
        { cause: error },
      );
    }
    try {
      const token = randomUUID();
      const result = await childResult(
        process.execPath,
        ["-e", `process.stdout.write(${JSON.stringify(token)})`],
        { stdio: ["ignore", "pipe", "inherit"], timeout: 5000 },
      );
      if (result.code !== 0 || result.signal)
        throw new Error(`child exited ${result.code ?? result.signal}`);
      if (result.stdout !== token)
        throw new Error("child did not return its execution token");
    } catch (error) {
      throw new Error(`Subprocess capability unavailable: ${error.message}`, {
        cause: error,
      });
    }
    try {
      await new Promise((resolve, reject) => {
        const server = createServer();
        const deadline = setTimeout(() => {
          server.close(() => {});
          reject(new Error("listener probe timed out after 5000ms"));
        }, 5000);
        server.once("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
        server.listen(0, "127.0.0.1", () =>
          server.close((error) => {
            clearTimeout(deadline);
            error ? reject(error) : resolve();
          }),
        );
      });
    } catch (error) {
      throw new Error(
        `Loopback-listener capability unavailable: ${error.message}`,
        { cause: error },
      );
    }
    console.log(
      "Test capabilities: subprocess, loopback listener, temporary filesystem available.",
    );
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
