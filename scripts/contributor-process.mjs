import { spawn } from "node:child_process";

// Own a process group so a deadline also stops browser/helper descendants.
export function command(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    input,
    timeout = 10000,
    limit = 4096,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      timedOut = false,
      truncated = false;
    const stop = (signal = "SIGKILL") => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    let hardDeadline;
    const terminate = () => {
      stop("SIGTERM");
      hardDeadline ??= setTimeout(() => stop(), 500);
    };
    process.on("SIGINT", terminate);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(hardDeadline);
      process.off("SIGINT", terminate);
      process.off("SIGTERM", terminate);
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    const collect = (stream, chunk) => {
      const remaining = limit - stdout.length - stderr.length;
      if (stream === "stdout")
        stdout += chunk.toString().slice(0, Math.max(0, remaining));
      else stderr += chunk.toString().slice(0, Math.max(0, remaining));
      if (chunk.length > remaining) {
        truncated = true;
        terminate();
      }
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      stop();
      resolve({ code, signal, stdout, stderr, timedOut, truncated });
    });
    child.stdin.end(input);
  });
}
export function requireSuccess(result) {
  if (result.timedOut)
    throw new Error(
      "command timed out; inspect host capability or network policy",
    );
  if (result.truncated)
    throw new Error("command exceeded bounded diagnostic output");
  if (result.code !== 0 || result.signal)
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        `command exited ${result.signal ?? result.code}`
      ).trim(),
    );
  return result.stdout.trim();
}
