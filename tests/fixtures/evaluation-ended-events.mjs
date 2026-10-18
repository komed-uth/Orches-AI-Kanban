// End the actual authenticated event response after a partial output line,
// leaving the collector to reconcile durable cancellation through HTTP.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options);
  if (!String(url).includes("/api/events?")) return response;
  const reader = response.body.getReader();
  let tail = "";
  const body = new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) return controller.close();
      controller.enqueue(value);
      const text = tail + new TextDecoder().decode(value);
      tail = text.slice(-32);
      if (text.includes("cancel-tail-secret")) {
        controller.close();
        await reader.cancel();
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
};
