// Shared by readiness and both public browser suites.
export function chromiumLaunchOptions() {
  return {
    args: ["--no-sandbox"],
    ...(process.env.ORCHES_CHROMIUM
      ? { executablePath: process.env.ORCHES_CHROMIUM }
      : {}),
  };
}
