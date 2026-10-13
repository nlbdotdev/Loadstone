const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { version } = require('../package.json');

class DownloadError extends Error {}
const blocked4 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked4.addSubnet(address, prefix, 'ipv4');
const global6 = new net.BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new net.BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  blocked6.addSubnet(address, prefix, 'ipv6');
function publicAddress(address) {
  const family = net.isIP(address);
  return family === 4
    ? !blocked4.check(address, 'ipv4')
    : family === 6 &&
        global6.check(address, 'ipv6') &&
        !blocked6.check(address, 'ipv6');
}
function downloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {}
  if (
    !url ||
    value.length > 16384 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new DownloadError(
      'Downloads require a public HTTPS address on port 443.',
    );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !publicAddress(host))
    throw new DownloadError(
      'Downloads cannot access local or reserved network addresses.',
    );
  return url;
}
// Keep the hostname for TLS verification, but pin this connection to an address
// from the checked DNS answer. A later lookup cannot rebind it to a private host.
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (
      error ||
      !addresses?.length ||
      addresses.some((v) => !publicAddress(v.address))
    )
      return callback(
        new DownloadError(
          'The download host did not resolve to public addresses.',
        ),
      );
    const selected = addresses.find((v) => v.family === 4) || addresses[0];
    callback(
      null,
      options.all ? [selected] : selected.address,
      options.all ? undefined : selected.family,
    );
  });
}
function openResponse(value, { signal, headers = {} } = {}) {
  const url = downloadUrl(value);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent: false,
        lookup: publicLookup,
        signal,
        headers: {
          'User-Agent': `Loadstone/${version}`,
          'Accept-Encoding': 'identity',
          ...headers,
        },
      },
      (response) => {
        clearTimeout(connectTimer);
        response.on('error', () => {});
        resolve(response);
      },
    );
    const connectTimer = setTimeout(
      () => request.destroy(new Error('timeout')),
      30000,
    );
    connectTimer.unref();
    request.setTimeout(30000, () => request.destroy(new Error('timeout')));
    request.once('error', () => {
      clearTimeout(connectTimer);
      reject(
        new DownloadError(
          'The download connection failed. Check your connection and retry.',
        ),
      );
    });
    request.once('close', () => clearTimeout(connectTimer));
  });
}
async function archiveResponse(value, signal, request = openResponse) {
  let url = downloadUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal?.throwIfAborted();
    const response = await request(url.href, { signal });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 5)
        throw new DownloadError(
          'The download has too many or invalid redirects.',
        );
      try {
        url = downloadUrl(new URL(location, url).href);
      } catch {
        throw new DownloadError(
          'The download redirected to an unsupported address.',
        );
      }
      continue;
    }
    if (
      response.statusCode !== 200 ||
      (response.headers['content-encoding'] &&
        response.headers['content-encoding'] !== 'identity')
    ) {
      response.destroy();
      throw new DownloadError(
        response.statusCode === 429
          ? 'The source is rate limiting downloads. Wait before retrying.'
          : 'The source refused this archive download. Download it manually or retry later.',
      );
    }
    return response;
  }
}
async function readJson(response, maxBytes, signal) {
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('size');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    response.destroy();
    throw new DownloadError(
      'The source returned an invalid download response.',
    );
  }
}
module.exports = {
  DownloadError,
  downloadUrl,
  publicAddress,
  publicLookup,
  openResponse,
  archiveResponse,
  readJson,
};
