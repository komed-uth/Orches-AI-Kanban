// Separate from the human reporter: only machine execution evidence goes here.
export default async function* executionEvidence(source) {
  for await (const { type, data } of source) {
    if (type === "test:pass" || type === "test:fail") {
      yield JSON.stringify({
        type,
        data: {
          file: data.file,
          name: data.name,
          // Node 22.13 leaves the ordinary test type undefined; suites
          // explicitly carry "suite". File wrappers still need a real file summary.
          kind: data.details?.type ?? "test",
          skip: data.skip,
          todo: data.todo,
        },
      }) + "\n";
    } else if (type === "test:summary") {
      yield JSON.stringify({ type, data }) + "\n";
    }
  }
  yield JSON.stringify({ type: "execution:complete" }) + "\n";
}
