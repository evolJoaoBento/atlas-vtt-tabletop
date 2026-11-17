// A node:test reporter for tests/run.mjs: the files any of whose tests failed, as a JSON list.
export default async function* fileReporter(source) {
  const failed = new Set();
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data?.file) failed.add(event.data.file);
  }
  yield JSON.stringify([...failed]);
}
