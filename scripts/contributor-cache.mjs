import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";

export function cacheLocation(override) {
  return path.resolve(
    override ??
      process.env.npm_config_cache ??
      process.env.NPM_CONFIG_CACHE ??
      ".cache/npm",
  );
}
export async function probeCache(cache) {
  let probe;
  try {
    await mkdir(cache, { recursive: true });
    probe = await mkdtemp(path.join(cache, ".orches-probe-"));
    await writeFile(path.join(probe, "token"), "writable");
    if ((await readFile(path.join(probe, "token"), "utf8")) !== "writable")
      throw new Error("readback failed");
  } finally {
    if (probe) await rm(probe, { recursive: true, force: true });
  }
}
