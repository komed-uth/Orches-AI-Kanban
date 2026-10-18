// This process outlives an abruptly killed application long enough to reap its
// target group. fd 3 is owned only by the application; EOF signals host death.
import { spawn } from "node:child_process";
import { Socket } from "node:net";
const [command, args, options] = JSON.parse(process.argv[2]);
let target,
  stopping = false;
const terminate = (exitCode = 1, hostDied = false) => {
  if (stopping) return;
  stopping = true;
  const kill = (signal) => {
    try {
      process.kill(-target.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  if (!target?.pid) {
    process.exit(exitCode);
    return;
  }
  if (hostDied) {
    kill("SIGKILL");
    process.exit(exitCode);
    return;
  }
  kill("SIGTERM");
  setTimeout(() => {
    kill("SIGKILL");
    process.exit(exitCode);
  }, 250);
};
const lifetime = new Socket({ fd: 3, readable: true, writable: false });
lifetime.on("end", () => terminate(1, true));
lifetime.on("error", () => terminate(1, true));
lifetime.resume();
process.on("SIGTERM", () => terminate());
process.on("SIGINT", () => terminate());
target = spawn(command, args, {
  ...options,
  detached: true,
  stdio: ["inherit", "inherit", "inherit"],
});
target.on("error", (error) => {
  process.stderr.write(
    `Cannot start configured executable: ${error.message}\n`,
  );
  terminate(127);
});
target.on("exit", (code) => terminate(code ?? 1));
