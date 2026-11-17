// A node:test reporter for tests/run.mjs: the files any of whose tests failed, and those any of whose tests skipped
// themselves, as JSON.
export default async function* fileReporter(source) {
  const failed = new Set(), skipped = new Set();
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data?.file) failed.add(event.data.file);
    if (event.type === 'test:pass' && event.data?.file && (event.data.skip || event.data.todo)) skipped.add(event.data.file);
  }
  yield JSON.stringify({ failed: [...failed], skipped: [...skipped] });
}
