// node harness/live/probe.cjs <file.js> [jsonArg]: runs a file's body in the live-check Obsidian (after phase1.cjs's page helpers) and prints the result.
const fs = require('fs');
const { connect } = require('./obs.cjs');
(async () => {
  const o = await connect(9311);
  const r = await o.ev(fs.readFileSync(process.argv[2], 'utf8'), process.argv[3] ? JSON.parse(process.argv[3]) : null).catch((e) => 'ERR ' + e.message);
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  process.exit(0);
})();
