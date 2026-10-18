import { spawnManaged, stopProcessGroup } from "./processes.mjs";
export { stopProcessGroup } from "./processes.mjs";

export async function runCommand(
  command,
  { cwd, tmpDir, port, signal, onOutput = () => {} } = {},
) {
  if (signal?.aborted) throw signal.reason || new Error("Cancelled");
  const child = spawnManaged(command, [], {
    cwd,
    shell: true,
    detached: true,
    env: {
      ...process.env,
      ...(tmpDir ? { TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir } : {}),
      ...(port ? { PORT: String(port) } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    stopping;
  const stop = () => (stopping ??= stopProcessGroup(child));
  signal?.addEventListener("abort", stop, { once: true });
  const capture = (data) => {
    const text = data.toString();
    output += text;
    onOutput(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) =>
        resolve({ exitCode, signal: exitSignal }),
      );
    });
    // Verification commands must not leave background writers after returning.
    await stop();
    if (signal?.aborted) throw signal.reason || new Error("Cancelled");
    return { command, output, ...result };
  } finally {
    signal?.removeEventListener("abort", stop);
    await stop();
  }
}
export async function verifyRun({
  project,
  run,
  cwd,
  tmpDir,
  port,
  signal,
  onEvent = () => {},
}) {
  const config = run?.config || {};
  const commands = [
    ["build", config.buildCommand ?? project.buildCommand],
    ["test", config.testCommand ?? project.testCommand],
  ];
  if (!commands[1][1]?.trim())
    throw new Error("A test command is required before verification.");
  const results = [];
  for (const [kind, command] of commands) {
    if (!command?.trim()) continue;
    onEvent({ type: "verification", kind, command, text: `$ ${command}\n` });
    const result = {
      kind,
      ...(await runCommand(command, {
        cwd,
        tmpDir,
        port,
        signal,
        onOutput: (text) => onEvent({ type: "verification", kind, text }),
      })),
    };
    results.push(result);
    if (result.exitCode !== 0) return { success: false, results };
  }
  return { success: true, results };
}
