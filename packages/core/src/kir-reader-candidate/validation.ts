import {
  KIR_READER_CANDIDATE_NODE_KINDS,
  type KirCandidateEntry,
  type KirCandidateExpression,
  type KirCandidateExpressionKind,
  type KirCandidateLocation,
  type KirCandidateNode,
  type KirCandidateNodeKind,
  type KirCandidateValue,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const VALUE_TAGS = new Set([
  'null',
  'bool',
  'text',
  'int',
  'negative-zero',
  'decimal',
  'regex',
  'list',
  'record',
  'expression',
]);
const NODE_KINDS = new Set<string>(KIR_READER_CANDIDATE_NODE_KINDS);
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const EXPRESSION_FIELDS: Readonly<Record<KirCandidateExpressionKind, readonly string[]>> = {
  identifier: ['name'],
  integer: ['value'],
  'negative-zero': [],
  decimal: ['value'],
  text: ['value'],
  boolean: ['value'],
  null: [],
  regex: ['value'],
  list: ['items'],
  record: ['entries'],
  member: ['object', 'property', 'optional'],
  index: ['object', 'index', 'optional'],
  call: ['callee', 'arguments', 'optional'],
  lambda: ['parameters', 'body'],
  binary: ['operator', 'left', 'right'],
  unary: ['operator', 'argument'],
  conditional: ['test', 'consequent', 'alternate'],
};

const NODE_PROPERTIES: Readonly<
  Record<
    KirCandidateNodeKind,
    {
      readonly allowed: readonly string[];
      readonly required: readonly string[];
    }
  >
> = {
  fn: { allowed: ['name', 'params', 'returns', 'async', 'stream', 'export', 'effects'], required: ['name'] },
  param: {
    allowed: ['name', 'type', 'value', 'required', 'optional', 'variadic', 'description', 'min', 'max'],
    required: ['name'],
  },
  handler: { allowed: ['lang', 'reason', 'review'], required: ['lang'] },
  return: { allowed: ['value', 'trailingComment'], required: [] },
  let: { allowed: ['name', 'value', 'type', 'kind', 'trailingComment'], required: ['name'] },
  capability: { allowed: ['namespace', 'operation', 'name', 'input'], required: ['namespace', 'operation', 'name'] },
  print: { allowed: ['value', 'trailingComment'], required: ['value'] },
};

const NODE_CHILDREN: Readonly<Record<KirCandidateNodeKind, ReadonlySet<KirCandidateNodeKind>>> = {
  fn: new Set(['param', 'handler']),
  param: new Set(),
  handler: new Set(['return', 'let', 'capability', 'print']),
  return: new Set(),
  let: new Set(),
  capability: new Set(),
  print: new Set(),
};

const IDENTIFIER_PROPERTIES: Readonly<Record<KirCandidateNodeKind, readonly string[]>> = {
  fn: ['name'],
  param: ['name'],
  handler: [],
  return: [],
  let: ['name'],
  capability: ['namespace', 'operation', 'name'],
  print: [],
};

const NODE_PROPERTY_TAGS: Readonly<Record<KirCandidateNodeKind, Readonly<Record<string, KirCandidateValue['tag']>>>> = {
  fn: { name: 'text', params: 'text', returns: 'text', async: 'bool', stream: 'bool', export: 'bool', effects: 'text' },
  param: {
    name: 'text',
    type: 'text',
    value: 'expression',
    required: 'bool',
    optional: 'bool',
    variadic: 'bool',
    description: 'text',
    min: 'int',
    max: 'int',
  },
  handler: { lang: 'text', reason: 'text', review: 'text' },
  return: { value: 'expression', trailingComment: 'text' },
  let: { name: 'text', value: 'expression', type: 'text', kind: 'text', trailingComment: 'text' },
  capability: { namespace: 'text', operation: 'text', name: 'text', input: 'expression' },
  print: { value: 'expression', trailingComment: 'text' },
};

export function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

export function asObject(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object');
  return value as UnknownRecord;
}

export function exactKeys(value: unknown, expected: readonly string[], path: string): UnknownRecord {
  const record = asObject(value, path);
  const actual = Object.keys(record).sort(compareCodePoints);
  const wanted = [...expected].sort(compareCodePoints);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `expected fields ${wanted.join(',')}; received ${actual.join(',')}`);
  }
  return record;
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected array');
  return value;
}

export function assertWellFormedText(value: unknown, path = 'text'): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(path, 'contains an unpaired high surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(path, 'contains an unpaired low surrogate');
    }
  }
  return value;
}

export function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const b = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function validateIdentifier(value: unknown, path: string): string {
  const identifier = assertWellFormedText(value, path);
  if (!IDENTIFIER_RE.test(identifier) || identifier.startsWith('__k') || identifier.startsWith('_kern')) {
    fail(path, 'expected portable identifier');
  }
  return identifier;
}

export function validateBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
}

export function validateLocation(value: unknown, path: string): KirCandidateLocation {
  const location = exactKeys(value, ['start', 'end'], path);
  const validatePoint = (point: unknown, pointPath: string, nullable: boolean) => {
    if (nullable && point === null) return null;
    const record = exactKeys(point, ['line', 'column'], pointPath);
    for (const key of ['line', 'column'] as const) {
      if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 1) {
        fail(`${pointPath}.${key}`, 'expected positive safe integer');
      }
    }
    return { line: record.line as number, column: record.column as number };
  };
  const start = validatePoint(location.start, `${path}.start`, false);
  const end = validatePoint(location.end, `${path}.end`, true);
  if (start === null) fail(`${path}.start`, 'expected point');
  if (end !== null && (end.line < start.line || (end.line === start.line && end.column < start.column))) {
    fail(`${path}.end`, 'end location precedes start location');
  }
  return { start, end };
}

function validateEntryKeys(
  entries: readonly KirCandidateEntry<KirCandidateValue>[],
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const keys = entries.map((entry) => entry.key);
  const allowedSet = new Set(allowed);
  for (const key of keys) if (!allowedSet.has(key)) fail(path, `unexpected semantic field ${key}`);
  for (const key of required) if (!keys.includes(key)) fail(path, `missing semantic field ${key}`);
}

function validateEntryArray(value: unknown, path: string): KirCandidateEntry<KirCandidateValue>[] {
  const entries: KirCandidateEntry<KirCandidateValue>[] = [];
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, rawEntry] of asArray(value, path).entries()) {
    const entryPath = `${path}[${index}]`;
    const entry = exactKeys(rawEntry, ['key', 'value'], entryPath);
    const key = assertWellFormedText(entry.key, `${entryPath}.key`);
    if (seen.has(key)) fail(entryPath, `duplicate key ${JSON.stringify(key)}`);
    if (previous !== undefined && compareCodePoints(previous, key) >= 0) {
      fail(entryPath, 'keys must be strictly code-point sorted');
    }
    entries.push({ key, value: validateValue(entry.value, `${entryPath}.value`) });
    seen.add(key);
    previous = key;
  }
  return entries;
}

function validateExpression(value: unknown, path: string): KirCandidateExpression {
  const expression = exactKeys(value, ['kind', 'fields'], path);
  const kind = assertWellFormedText(expression.kind, `${path}.kind`);
  if (!Object.hasOwn(EXPRESSION_FIELDS, kind)) fail(`${path}.kind`, `unknown expression kind ${kind}`);
  const typedKind = kind as KirCandidateExpressionKind;
  const fields = validateEntryArray(expression.fields, `${path}.fields`);
  const expected = EXPRESSION_FIELDS[typedKind];
  validateEntryKeys(fields, expected, expected, `${path}.fields`);
  const byName = new Map(fields.map((field) => [field.key, field.value]));
  const requireTag = (name: string, tag: KirCandidateValue['tag']) => {
    if (byName.get(name)?.tag !== tag) fail(`${path}.fields.${name}`, `expected ${tag} value`);
  };
  if (typedKind === 'identifier') {
    requireTag('name', 'text');
    const name = byName.get('name');
    if (name?.tag === 'text') validateIdentifier(name.value, `${path}.fields.name`);
  } else if (typedKind === 'integer') requireTag('value', 'int');
  else if (typedKind === 'decimal') requireTag('value', 'decimal');
  else if (typedKind === 'text') requireTag('value', 'text');
  else if (typedKind === 'boolean') requireTag('value', 'bool');
  else if (typedKind === 'regex') requireTag('value', 'regex');
  else if (typedKind === 'list') requireExpressionCollection(byName.get('items'), `${path}.fields.items`, 'list');
  else if (typedKind === 'record')
    requireExpressionCollection(byName.get('entries'), `${path}.fields.entries`, 'record');
  else if (typedKind === 'member') {
    requireTag('object', 'expression');
    requireTag('property', 'text');
    requireTag('optional', 'bool');
  } else if (typedKind === 'index') {
    requireTag('object', 'expression');
    requireTag('index', 'expression');
    requireTag('optional', 'bool');
  } else if (typedKind === 'call') {
    requireTag('callee', 'expression');
    requireExpressionCollection(byName.get('arguments'), `${path}.fields.arguments`, 'list');
    requireTag('optional', 'bool');
  } else if (typedKind === 'lambda') {
    const parameters = byName.get('parameters');
    if (parameters?.tag !== 'list' || parameters.value.some((item) => item.tag !== 'text')) {
      fail(`${path}.fields.parameters`, 'expected list of text values');
    }
    for (const [index, parameter] of parameters.value.entries()) {
      if (parameter.tag === 'text') validateIdentifier(parameter.value, `${path}.fields.parameters[${index}]`);
    }
    requireTag('body', 'expression');
  } else if (typedKind === 'binary') {
    requireTag('operator', 'text');
    requireTag('left', 'expression');
    requireTag('right', 'expression');
  } else if (typedKind === 'unary') {
    requireTag('operator', 'text');
    requireTag('argument', 'expression');
  } else if (typedKind === 'conditional') {
    requireTag('test', 'expression');
    requireTag('consequent', 'expression');
    requireTag('alternate', 'expression');
  }
  return { kind: typedKind, fields };
}

function requireExpressionCollection(value: KirCandidateValue | undefined, path: string, tag: 'list' | 'record'): void {
  if (value?.tag !== tag) fail(path, `expected ${tag} value`);
  if (value.tag === 'list') {
    if (value.value.some((item) => item.tag !== 'expression')) fail(path, 'expected list of expression values');
  } else if (value.value.some((item) => item.value.tag !== 'expression')) {
    fail(path, 'expected record of expression values');
  }
}

export function validateValue(value: unknown, path = 'value'): KirCandidateValue {
  const record = asObject(value, path);
  const tag = assertWellFormedText(record.tag, `${path}.tag`);
  if (!VALUE_TAGS.has(tag)) fail(`${path}.tag`, `unknown value tag ${tag}`);
  if (tag === 'null' || tag === 'negative-zero') {
    exactKeys(record, ['tag'], path);
    return { tag };
  }
  exactKeys(record, ['tag', 'value'], path);
  if (tag === 'bool') return { tag, value: validateBoolean(record.value, `${path}.value`) };
  if (tag === 'text') return { tag, value: assertWellFormedText(record.value, `${path}.value`) };
  if (tag === 'int') {
    const text = assertWellFormedText(record.value, `${path}.value`);
    if (!/^(?:0|-?[1-9][0-9]*)$/u.test(text)) fail(`${path}.value`, 'expected canonical base-10 integer text');
    if (!Number.isSafeInteger(Number(text))) fail(`${path}.value`, 'integer exceeds safe probe boundary');
    return { tag, value: text };
  }
  if (tag === 'decimal') {
    const text = assertWellFormedText(record.value, `${path}.value`);
    if (!/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(text)) fail(`${path}.value`, 'expected exact non-exponent decimal text');
    return { tag, value: text };
  }
  if (tag === 'regex') {
    const regex = exactKeys(record.value, ['pattern', 'flags'], `${path}.value`);
    const pattern = assertWellFormedText(regex.pattern, `${path}.value.pattern`);
    const flags = assertWellFormedText(regex.flags, `${path}.value.flags`);
    if (!/^(?!.*(.).*\1)[dgimsuvy]*$/u.test(flags)) fail(`${path}.value.flags`, 'invalid or duplicate flags');
    if ([...flags].sort().join('') !== flags) fail(`${path}.value.flags`, 'flags must be sorted');
    try {
      new RegExp(pattern, flags);
    } catch {
      fail(`${path}.value.pattern`, 'invalid regex pattern for declared flags');
    }
    return { tag, value: { pattern, flags } };
  }
  if (tag === 'list') {
    return {
      tag,
      value: asArray(record.value, `${path}.value`).map((item, index) =>
        validateValue(item, `${path}.value[${index}]`),
      ),
    };
  }
  if (tag === 'record') return { tag, value: validateEntryArray(record.value, `${path}.value`) };
  return { tag: 'expression', value: validateExpression(record.value, `${path}.value`) };
}

export function validateNode(value: unknown, path: string): KirCandidateNode {
  const record = exactKeys(value, ['kind', 'location', 'properties', 'children'], path);
  const kind = assertWellFormedText(record.kind, `${path}.kind`);
  if (!NODE_KINDS.has(kind)) fail(`${path}.kind`, `unknown probe node kind ${kind}`);
  const typedKind = kind as KirCandidateNodeKind;
  const location = validateLocation(record.location, `${path}.location`);
  const properties = validateEntryArray(record.properties, `${path}.properties`);
  const shape = NODE_PROPERTIES[typedKind];
  validateEntryKeys(properties, shape.allowed, shape.required, `${path}.properties`);
  for (const property of properties) {
    const expectedTag = NODE_PROPERTY_TAGS[typedKind][property.key];
    if (property.value.tag !== expectedTag) {
      fail(`${path}.properties.${property.key}`, `expected ${expectedTag} value`);
    }
  }
  for (const name of IDENTIFIER_PROPERTIES[typedKind]) {
    const property = properties.find((entry) => entry.key === name);
    if (property?.value.tag !== 'text') fail(`${path}.properties`, `${name} must be text`);
    validateIdentifier(property.value.value, `${path}.properties.${name}`);
  }
  const children = asArray(record.children, `${path}.children`).map((child, index) => {
    const validated = validateNode(child, `${path}.children[${index}]`);
    if (!NODE_CHILDREN[typedKind].has(validated.kind)) {
      fail(`${path}.children[${index}].kind`, `${validated.kind} is not allowed under ${typedKind}`);
    }
    return validated;
  });
  if (typedKind === 'fn') {
    let handlerCount = 0;
    let sawHandler = false;
    for (const [index, child] of children.entries()) {
      if (child.kind === 'handler') {
        handlerCount += 1;
        sawHandler = true;
      } else if (child.kind === 'param' && sawHandler) {
        fail(`${path}.children[${index}]`, 'params must precede the handler');
      }
    }
    if (handlerCount > 1) fail(`${path}.children`, 'fn may contain at most one handler');
  }
  return { kind: typedKind, location, properties, children };
}
