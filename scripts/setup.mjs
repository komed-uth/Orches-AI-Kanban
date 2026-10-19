import { spawn } from "node:child_process";
import { cacheLocation, probeCache } from "./contributor-cache.mjs";
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--cache" || !args[1]))
    throw new Error("Usage: node scripts/setup.mjs [--cache PATH]");
  const cache = cacheLocation(args[1]);
  try {
    await probeCache(cache);
  } catch (error) {
    throw new Error(
      `npm cache unavailable at ${cache}: ${error.message}. Choose a writable --cache PATH or npm_config_cache; the explicit cache is never silently replaced.`,
    );
  }
  console.log(`Installing dependencies with npm cache ${cache}`);
  const child = spawn("npm", ["ci"], {
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: cache },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(`Contributor setup blocked: ${error.message}`);
  process.exitCode = 1;
}
