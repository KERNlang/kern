const UINT = /^(?:0|[1-9][0-9]*)$/u;

function fail(detail) {
  throw new Error(`F5 projection decoder: ${detail}`);
}

export function decodeInstructionStream(source, limits) {
  if (typeof source !== 'string') fail('instruction text');
  const points = Array.from(source);
  let cursor = 0;
  let nodes = 0;

  function take() {
    if (cursor >= points.length) fail('instruction end');
    return points[cursor++];
  }

  function count(delimiter) {
    let text = '';
    while (cursor < points.length && points[cursor] !== delimiter) text += take();
    if (take() !== delimiter || !UINT.test(text)) fail('instruction count');
    const result = Number(text);
    if (!Number.isSafeInteger(result)) fail('instruction count range');
    return result;
  }

  function payload() {
    const length = count(':');
    if (length > limits.maxStringCodePoints || cursor + length > points.length) fail('instruction payload');
    const result = points.slice(cursor, cursor + length).join('');
    cursor += length;
    return result;
  }

  function value(depth) {
    if (depth > limits.maxDepth) fail('instruction depth');
    nodes += 1;
    if (nodes > limits.maxNodes) fail('instruction nodes');
    const tag = take();
    if (tag === 'N') return { tag: 'null' };
    if (tag === 'T') return { tag: 'text', value: payload() };
    if (tag === 'I') {
      const raw = payload();
      if (!/^(?:0|-?[1-9][0-9]*)$/u.test(raw)) fail('instruction integer');
      return { tag: 'int', value: raw };
    }
    if (tag === 'D') {
      const raw = payload();
      if (!/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(raw) || /^-0\.0+$/u.test(raw)) fail('instruction decimal');
      return { tag: 'decimal', value: raw };
    }
    if (tag === 'B') {
      const raw = take();
      if (raw !== '0' && raw !== '1') fail('instruction boolean');
      return { tag: 'bool', value: raw === '1' };
    }
    if (tag === 'L') {
      const length = count('[');
      if (length > limits.maxCollectionLength) fail('instruction list limit');
      const items = Array.from({ length }, () => value(depth + 1));
      if (take() !== ']') fail('instruction list boundary');
      return { tag: 'list', value: items };
    }
    if (tag === 'R') {
      const length = count('{');
      if (length > limits.maxCollectionLength) fail('instruction record limit');
      const entries = [];
      let previous;
      for (let index = 0; index < length; index += 1) {
        if (take() !== 'K') fail('instruction record key');
        const key = payload();
        if (previous !== undefined && previous >= key) fail('instruction record order');
        previous = key;
        entries.push({ key, value: value(depth + 1) });
      }
      if (take() !== '}') fail('instruction record boundary');
      return { tag: 'record', value: entries };
    }
    fail(`instruction tag ${tag}`);
  }

  const result = value(0);
  if (cursor !== points.length) fail('instruction trailing data');
  return result;
}

export function decodeResult(fields, policy) {
  if (!Array.isArray(fields) || fields.length !== 6 || fields.some((field) => typeof field !== 'string') ||
      fields[0] !== policy.resultFormat || !['projected', 'fatal'].includes(fields[1])) fail('result shape');
  if (!UINT.test(fields[4])) fail('result work');
  if (fields[1] === 'fatal') {
    if (!['F5_AUTHORITY_DRIFT', 'F5_F4_DRIFT', 'F5_LIMIT'].includes(fields[2]) || fields[3] !== '' ||
        fields[5] !== 'failure') fail('fatal atomicity');
    return { status: 'fatal', code: fields[2], instructions: null, workSteps: Number(fields[4]), seal: fields[5] };
  }
  if (fields[2] !== '' || fields[3] === '' || fields[5] !== 'projection:closed') fail('projected atomicity');
  return {
    status: 'projected', code: null,
    instructions: decodeInstructionStream(fields[3], policy.profileLimits),
    workSteps: Number(fields[4]), seal: fields[5],
  };
}
