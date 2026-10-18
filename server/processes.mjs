import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function spawnManaged(command, args, options = {}) {
  return spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./process-supervisor.mjs", import.meta.url)),
      JSON.stringify([
        command,
        args,
        { cwd: options.cwd, shell: options.shell ?? false },
      ]),
    ],
    {
      ...options,
      detached: true,
      shell: false,
      stdio: [...(options.stdio || ["pipe", "pipe", "pipe"]), "pipe"],
    },
  );
}
// The supervisor owns cleanup of the actual target process group. Keeping the
// lifetime pipe open until it exits lets it handle an abrupt application death.
export async function stopProcessGroup(child) {
  if (!child?.pid) return;
  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  kill("SIGTERM");
  if (child.exitCode === null && child.signalCode === null) {
    let timer;
    try {
      await new Promise((resolve) => {
        child.once("close", resolve);
        timer = setTimeout(() => kill("SIGKILL"), 1000);
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
