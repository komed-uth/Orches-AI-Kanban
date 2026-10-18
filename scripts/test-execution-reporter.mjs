// Separate from the human reporter: only machine execution evidence goes here.
export default async function* executionEvidence(source) {
  for await (const { type, data } of source) {
    if (type === "test:pass" || type === "test:fail") {
      yield JSON.stringify({
        type,
        data: {
          file: data.file,
          name: data.name,
          kind: data.details?.type,
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
