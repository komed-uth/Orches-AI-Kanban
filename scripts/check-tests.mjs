import { preflight, childResult } from "./test-capabilities.mjs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This is the existing application/sample-game selection, shared by discovery
// and the actual runner invocation. New files require no expected-count update.
const testDirectories = ["tests", "sample-game/tests"];
const root = process.cwd();
const reporter = fileURLToPath(
  new URL("./test-execution-reporter.mjs", import.meta.url),
);
let temporary;

const countNames = [
  "tests",
  "passed",
  "failed",
  "cancelled",
  "skipped",
  "todo",
];
function successfulCounts(summary) {
  const counts = summary?.counts;
  return (
    summary?.success === true &&
    counts &&
    countNames.every(
      (name) => Number.isSafeInteger(counts[name]) && counts[name] >= 0,
    ) &&
    counts.failed === 0 &&
    counts.cancelled === 0 &&
    counts.tests === counts.passed + counts.skipped + counts.todo
  );
}

async function verifyEvidence(file, selected) {
  const records = (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (records.at(-1)?.type !== "execution:complete")
    throw new Error("Incomplete execution evidence (reporter did not finish).");
  const summaries = records.filter((record) => record.type === "test:summary");
  const overall = summaries.filter((record) => !record.data.file);
  if (overall.length !== 1 || !successfulCounts(overall[0].data))
    throw new Error("Missing or unsuccessful overall execution summary.");
  if (records.some((record) => record.type === "test:fail"))
    throw new Error("Test failures reported in execution evidence.");
  const totals = Object.fromEntries(countNames.map((name) => [name, 0]));
  for (const selectedFile of selected) {
    const absolute = path.resolve(root, selectedFile);
    const completed = summaries.filter(
      (record) =>
        record.data.file && path.resolve(record.data.file) === absolute,
    );
    const bodies = records.filter(
      (record) =>
        record.type === "test:pass" &&
        record.data.file &&
        path.resolve(record.data.file) === absolute &&
        record.data.kind === "test" &&
        !record.data.skip &&
        !record.data.todo,
    );
    if (
      completed.length !== 1 ||
      completed[0].data.success !== true ||
      bodies.length === 0
    ) {
      throw new Error(
        `No completed test-body execution evidence for ${selectedFile} (file wrappers and wholly skipped files are insufficient).`,
      );
    }
    const counts = completed[0].data.counts;
    if (!successfulCounts(completed[0].data) || counts.passed < bodies.length) {
      throw new Error(`Incomplete or failed execution for ${selectedFile}.`);
    }
    for (const name of countNames) totals[name] += counts[name];
    console.log(`  ${selectedFile}: ${bodies.length} executed`);
  }
  if (
    countNames.some((name) => overall[0].data.counts[name] !== totals[name])
  ) {
    throw new Error(
      "Overall execution summary disagrees with selected-file evidence.",
    );
  }
  console.log(
    `Execution evidence verified for ${selected.length} selected test files.`,
  );
}

try {
  await preflight();
  temporary = await mkdtemp(path.join(tmpdir(), "orches-test-check-"));
  const selected = [];
  for (const directory of testDirectories) {
    for (const entry of await readdir(path.join(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.isFile() && entry.name.endsWith(".test.mjs"))
        selected.push(`${directory}/${entry.name}`);
    }
  }
  selected.sort();
  if (!selected.length) throw new Error("No test files selected.");
  const evidence = path.join(temporary, "execution.jsonl");
  const result = await childResult(
    process.execPath,
    [
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${reporter}`,
      `--test-reporter-destination=${evidence}`,
      ...selected,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.code !== 0 || result.signal) {
    throw new Error(
      `Test runner failed (${result.signal ?? `exit ${result.code}`}).`,
    );
  }
  await verifyEvidence(evidence, selected);
} catch (error) {
  console.error(`Contributor tests failed: ${error.message}`);
  if (/capability unavailable/.test(error.message)) {
    console.error(
      "Use the supported host permission mechanism to enable subprocesses, loopback listeners, and temporary file access, then rerun npm test. These checks require no general Internet access.",
    );
  }
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
