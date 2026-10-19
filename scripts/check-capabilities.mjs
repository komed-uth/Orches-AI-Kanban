import { preflight } from "./test-capabilities.mjs";
try {
  await preflight();
} catch (error) {
  console.error(
    `${error.message}. Enable subprocesses, loopback listeners and temporary file access using the supported host permission mechanism, then rerun npm test.`,
  );
  process.exitCode = 1;
}
