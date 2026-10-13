const fs = require('node:fs');
const waitCell = new Int32Array(new SharedArrayBuffer(4));
// A Windows scanner/indexer can briefly deny replacement. Preserve the existing
// destination: retry the atomic rename, never unlink it or copy over its bytes.
function replaceStateFile(source, destination, options = {}) {
  const platform = options.platform || process.platform;
  const rename = options.rename || ((from, to) => fs.renameSync(from, to));
  const sleep = options.sleep || ((ms) => Atomics.wait(waitCell, 0, 0, ms));
  const delays = [10, 20, 40, 80, 160];
  for (let attempt = 0; ; attempt++) {
    try {
      return rename(source, destination);
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        attempt >= delays.length
      )
        throw error;
      sleep(delays[attempt]);
    }
  }
}
module.exports = { replaceStateFile };
