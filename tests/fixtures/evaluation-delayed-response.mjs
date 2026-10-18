// Keep the real authenticated HTTP admission and durable state, but withhold
// its acknowledgment until the evaluation deadline aborts the request.
const originalFetch = globalThis.fetch;
let delayed = false;
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options);
  if (!delayed && String(url).endsWith("/run")) {
    delayed = true;
    await response.text();
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
    });
  }
  return response;
};
