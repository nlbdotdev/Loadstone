const fail = () => {
  throw new Error(
    'Unsupported or damaged Steam shortcuts file. No changes were made.',
  );
};
function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 16_000_000) fail();
  let offset = 0,
    count = 0;
  const string = () => {
    const end = buffer.indexOf(0, offset);
    if (end < 0 || end - offset > 1_000_000) fail();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(offset, end),
    );
    offset = end + 1;
    return value;
  };
  function object(depth) {
    if (depth > 16) fail();
    const nodes = [],
      keys = new Set();
    while (offset < buffer.length) {
      const start = offset,
        type = buffer[offset++];
      if (type === 8) return nodes;
      if (++count > 100000) fail();
      const key = string();
      if (key.length > 4096 || keys.has(key.toLowerCase())) fail();
      keys.add(key.toLowerCase());
      let value;
      if (type === 0) value = object(depth + 1);
      else if (type === 1) value = string();
      else if ([2, 3, 4, 6, 7, 10].includes(type)) {
        const size = [7, 10].includes(type) ? 8 : 4;
        if (offset + size > buffer.length) fail();
        if (type === 2) value = buffer.readUInt32LE(offset);
        offset += size;
      } else fail();
      nodes.push({ type, key, value, raw: buffer.subarray(start, offset) });
    }
    fail();
  }
  const nodes = object(0);
  if (offset !== buffer.length) fail();
  return nodes;
}
function encode(nodes) {
  return Buffer.concat([
    ...nodes.map((node) => {
      if (node.raw) return node.raw;
      const header = Buffer.concat([
        Buffer.from([node.type]),
        Buffer.from(node.key + '\0'),
      ]);
      if (node.type === 0) return Buffer.concat([header, encode(node.value)]);
      if (node.type === 1)
        return Buffer.concat([header, Buffer.from(node.value + '\0')]);
      if (node.type === 2) {
        const integer = Buffer.alloc(4);
        integer.writeUInt32LE(node.value >>> 0);
        return Buffer.concat([header, integer]);
      }
      fail();
    }),
    Buffer.from([8]),
  ]);
}
const field = (nodes, key) =>
  nodes.find((node) => node.key.toLowerCase() === key.toLowerCase());
module.exports = { decode, encode, field };
