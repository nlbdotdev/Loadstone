// Decode the string and UTF-8 QByteArray forms used for MO2 paths and titles.
// This is not a general QSettings variant/list parser. Other variants remain
// literal strings and cannot silently become filesystem paths or commands.
function decodeMo2Value(value) {
  let raw = value.replace(/^"(.*)"$/, '$1');
  if (raw.startsWith('@ByteArray(') && raw.endsWith(')')) {
    raw = raw.slice(11, -1);
    const parts = [];
    let start = 0;
    const escapes = /\\(x[0-9a-fA-F]{1,2}|\\|"|0|n|r|t)/g;
    for (const match of raw.matchAll(escapes)) {
      parts.push(Buffer.from(raw.slice(start, match.index), 'utf8'));
      const code = match[1];
      parts.push(
        code.startsWith('x')
          ? Buffer.from([parseInt(code.slice(1), 16)])
          : Buffer.from(
              { 0: '\0', n: '\n', r: '\r', t: '\t' }[code] ?? code,
              'utf8',
            ),
      );
      start = match.index + match[0].length;
    }
    parts.push(Buffer.from(raw.slice(start), 'utf8'));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(parts),
      );
    } catch {
      throw new Error(
        'MO2 configuration contains an invalid UTF-8 byte array.',
      );
    }
  }
  return raw.replace(/\\(\\|")/g, '$1').replace(/^@@/, '@');
}
module.exports = { decodeMo2Value };
