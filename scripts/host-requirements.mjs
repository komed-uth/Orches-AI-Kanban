export function supportedRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return (
    process.platform === "linux" &&
    (major > 22 || (major === 22 && minor >= 13))
  );
}
export function gitWorktreeSupported(output) {
  const version = /^git version (\d+)\.(\d+)/.exec(output);
  return Boolean(
    version &&
    (Number(version[1]) > 2 ||
      (Number(version[1]) === 2 && Number(version[2]) >= 5)),
  );
}
