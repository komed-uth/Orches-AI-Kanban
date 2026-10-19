import { readFile } from "node:fs/promises";
import { command, requireSuccess } from "./contributor-process.mjs";
try {
  const [number, ...args] = process.argv.slice(2);
  if (!/^[1-9][0-9]*$/.test(number ?? ""))
    throw new Error(
      "Usage: npm run pr:edit -- NUMBER [--body-file PATH] [--title TITLE]",
    );
  const metadata = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--body-file", "--title"].includes(args[i]) || !args[i + 1])
      throw new Error("Expected --body-file PATH or --title TITLE");
    if (args[i] === "--body-file")
      metadata.body = await readFile(args[i + 1], "utf8");
    else metadata.title = args[i + 1];
  }
  if (!Object.keys(metadata).length)
    throw new Error("Provide --body-file PATH or --title TITLE");
  const result = await command("gh", ["pr", "edit", number, ...args], {
    timeout: 15000,
  });
  // gh 2.46's metadata query reads removed classic projectCards. Only this
  // observed incompatibility permits a REST retry; auth/network failures surface.
  if (
    result.code !== 0 &&
    !result.timedOut &&
    !result.truncated &&
    /GraphQL: Projects \(classic\) is being deprecated[^\n]*\(repository\.pullRequest\.projectCards\)/.test(
      result.stderr,
    )
  ) {
    console.log(
      "GitHub CLI classic Projects incompatibility; applying the same metadata through REST.",
    );
    requireSuccess(
      await command(
        "gh",
        [
          "api",
          "--silent",
          "--method",
          "PATCH",
          `repos/{owner}/{repo}/pulls/${number}`,
          "--input",
          "-",
        ],
        { input: JSON.stringify(metadata), timeout: 15000 },
      ),
    );
    console.log(`PR #${number} metadata updated through REST.`);
  } else {
    requireSuccess(result);
    console.log(`PR #${number} metadata updated.`);
  }
} catch (error) {
  console.error(`GitHub PR edit failed: ${error.message}`);
  process.exitCode = 1;
}
