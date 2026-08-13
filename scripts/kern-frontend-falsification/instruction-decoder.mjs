const UINT = /^(?:0|[1-9][0-9]*)$/u;

function reject(detail) {
  throw new Error(`instruction rejection: ${detail}`);
}

function codePoints(value) {
  return [...value];
}

export function decodeInstructionStream(source, limits = {}) {
  if (typeof source !== 'string') reject('stream must be text');
  const scalars = codePoints(source);
  const maxDepth = limits.maxDepth ?? 64;
  const maxNodes = limits.maxNodes ?? 4096;
  const maxCollectionLength = limits.maxCollectionLength ?? 1024;
  const maxStringCodePoints = limits.maxStringCodePoints ?? 65536;
  let cursor = 0;
  let nodes = 0;

  function take() {
    if (cursor >= scalars.length) reject('unexpected end of stream');
    const value = scalars[cursor];
    cursor += 1;
    return value;
  }

  function count(until) {
    let raw = '';
    while (cursor < scalars.length && scalars[cursor] !== until) raw += take();
    if (take() !== until || !UINT.test(raw)) reject('invalid canonical count');
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) reject('count exceeds safe integer');
    return value;
  }

  function payload() {
    const length = count(':');
    if (length > maxStringCodePoints || cursor + length > scalars.length) {
      reject('payload exceeds its declared boundary');
    }
    const value = scalars.slice(cursor, cursor + length).join('');
    cursor += length;
    return value;
  }

  function value(depth) {
    if (depth > maxDepth) reject('depth limit');
    nodes += 1;
    if (nodes > maxNodes) reject('node limit');
    const tag = take();
    if (tag === 'T') return { tag: 'text', value: payload() };
    if (tag === 'I') {
      const raw = payload();
      if (!/^(?:0|-?[1-9][0-9]*)$/u.test(raw)) reject('invalid canonical integer');
      return { tag: 'int', value: raw };
    }
    if (tag === 'D') {
      const raw = payload();
      if (!/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(raw)) reject('invalid canonical decimal');
      return { tag: 'decimal', value: raw };
    }
    if (tag === 'B') {
      const raw = take();
      if (raw !== '0' && raw !== '1') reject('invalid boolean');
      return { tag: 'bool', value: raw === '1' };
    }
    if (tag === 'L') {
      const length = count('[');
      if (length > maxCollectionLength) reject('list limit');
      const items = Array.from({ length }, () => value(depth + 1));
      if (take() !== ']') reject('list boundary');
      return { tag: 'list', value: items };
    }
    if (tag === 'R') {
      const length = count('{');
      if (length > maxCollectionLength) reject('record limit');
      const entries = [];
      let previous;
      for (let index = 0; index < length; index += 1) {
        if (take() !== 'K') reject('record entry tag');
        const key = payload();
        if (previous !== undefined && previous >= key) reject('record keys must be canonical and unique');
        previous = key;
        entries.push({ key, value: value(depth + 1) });
      }
      if (take() !== '}') reject('record boundary');
      return { tag: 'record', value: entries };
    }
    reject(`unknown value tag ${tag}`);
  }

  const decoded = value(0);
  if (cursor !== scalars.length) reject('trailing instructions');
  return decoded;
}
