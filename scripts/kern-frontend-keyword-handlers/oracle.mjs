function scalars(value) {
  return [...value];
}
function rawFrom(content, startScalar) {
  return scalars(content).slice(startScalar).join('');
}

class OracleCursor {
  constructor(tokens, position) {
    this.tokens = tokens;
    this.idx = position;
  }
  peek() { return this.tokens[this.idx]; }
  next() { return this.tokens[this.idx++]; }
  done() { return this.idx >= this.tokens.length; }
  position() { return this.idx; }
  setPosition(position) { this.idx = position; }
  skipWS() {
    while (this.tokens[this.idx]?.kind === 'whitespace') this.idx += 1;
  }
  tryIdent() {
    if (this.tokens[this.idx]?.kind !== 'identifier') return null;
    return this.tokens[this.idx++].value;
  }
  tryNumber() {
    if (this.tokens[this.idx]?.kind !== 'number') return null;
    return this.tokens[this.idx++].value;
  }
  isKeyValue() {
    let cursor = this.idx;
    while (this.tokens[cursor]?.kind === 'whitespace') cursor += 1;
    return this.tokens[cursor]?.kind === 'identifier' && this.tokens[cursor + 1]?.kind === 'equals';
  }
  hasEquals() {
    return this.tokens.slice(this.idx).some(({ kind }) => kind === 'equals');
  }
  hasMore() {
    let cursor = this.idx;
    while (this.tokens[cursor]?.kind === 'whitespace') cursor += 1;
    return cursor < this.tokens.length;
  }
  remainingRaw(content) {
    if (this.done()) return '';
    const raw = rawFrom(content, this.tokens[this.idx].startScalar);
    this.idx = this.tokens.length;
    return raw;
  }
  consumeAnyValue() {
    this.skipWS();
    return this.done() ? undefined : this.next();
  }
}

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && ['"', "'", '`'].includes(trimmed[0]) && trimmed.at(-1) === trimmed[0]
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function splitTopLevel(input, delimiter) {
  const parts = [];
  let current = '';
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (char === '\\') current += input[++index] ?? '';
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '<') angle += 1;
    else if (char === '>' && input[index - 1] !== '=' && angle > 0) angle -= 1;
    if (char === delimiter && paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function findMatching(input, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === open) depth += 1;
    else if (char === close && !(close === '>' && input[index - 1] === '=')) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelWhitespace(input) {
  const parts = [];
  let current = '';
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (char === '\\') current += input[++index] ?? '';
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '<') angle += 1;
    else if (char === '>' && input[index - 1] !== '=' && angle > 0) angle -= 1;
    if (/\s/u.test(char) && paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function splitReturnAndTrailingProps(input) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '<') angle += 1;
    else if (char === '>' && input[index - 1] !== '=' && angle > 0) angle -= 1;
    if (
      /\s/u.test(char) && paren === 0 && bracket === 0 && brace === 0 && angle === 0 &&
      /^[A-Za-z_][\w-]*=/.test(input.slice(index).trimStart())
    ) return { returns: input.slice(0, index).trim(), trailing: input.slice(index).trim() };
  }
  return { returns: input.trim(), trailing: '' };
}

function assignBareProps(raw, write) {
  for (const part of splitTopLevelWhitespace(raw)) {
    const equals = part.indexOf('=');
    if (equals <= 0) continue;
    const name = part.slice(0, equals);
    const rawValue = part.slice(equals + 1);
    let value = rawValue;
    if (rawValue === 'true') value = true;
    else if (rawValue === 'false') value = false;
    else if (/^".*"$/u.test(rawValue) || /^'.*'$/u.test(rawValue)) value = rawValue.slice(1, -1);
    write(name, value);
  }
}

function parseFirstClassFnSignature(raw, write) {
  const trimmed = raw.trim();
  if (trimmed === '' || /^\w+\s*=/u.test(trimmed)) return false;
  const nameMatch = /^([A-Za-z_$][\w$]*)/u.exec(trimmed);
  if (!nameMatch) return false;
  let cursor = nameMatch[1].length;
  while (/\s/u.test(trimmed[cursor] ?? '')) cursor += 1;
  const pending = [['name', nameMatch[1]]];
  if (trimmed[cursor] === '<') {
    const close = findMatching(trimmed, cursor, '<', '>');
    if (close === -1) return false;
    pending.push(['generics', trimmed.slice(cursor, close + 1)]);
    cursor = close + 1;
    while (/\s/u.test(trimmed[cursor] ?? '')) cursor += 1;
  }
  if (trimmed[cursor] !== '(') return false;
  const close = findMatching(trimmed, cursor, '(', ')');
  if (close === -1) return false;
  const params = splitTopLevel(trimmed.slice(cursor + 1, close), ',')
    .map((part) => part.replace(/\s*:\s*/u, ':').replace(/\s*=\s*/u, '='))
    .join(',');
  if (params) pending.push(['params', params]);
  cursor = close + 1;
  while (/\s/u.test(trimmed[cursor] ?? '')) cursor += 1;
  let trailing = trimmed.slice(cursor).trim();
  if (trailing.startsWith(':')) {
    const split = splitReturnAndTrailingProps(trailing.slice(1).trim());
    if (split.returns) pending.push(['returns', split.returns]);
    trailing = split.trailing;
  }
  for (const [name, value] of pending) write(name, value);
  if (trailing) assignBareProps(trailing, write);
  return true;
}

function findTopLevelAssignment(input) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '<') angle += 1;
    else if (char === '>' && input[index - 1] !== '=' && angle > 0) angle -= 1;
    else if (
      char === '=' && paren === 0 && bracket === 0 && brace === 0 && angle === 0 &&
      !['=', '!', '<', '>'].includes(input[index - 1]) && !['=', '>'].includes(input[index + 1])
    ) return index;
  }
  return -1;
}

function parseBareParams(raw) {
  return splitTopLevel(raw, ',').flatMap((part) => {
    const match = /^([A-Za-z_]\w*):([A-Za-z_]\w*(?:\[\])?)(?:\s*=\s*(.+))?$/u.exec(part.trim());
    return match ? [{ name: match[1], type: match[2], ...(match[3] === undefined ? {} : { default: match[3].trim() }) }] : [];
  });
}

function parseParamItemsArray(raw) {
  let body = stripWrappingQuotes(raw);
  if (body.startsWith('[')) body = body.slice(1);
  if (body.endsWith(']')) body = body.slice(0, -1);
  return splitTopLevel(body, ',').flatMap((objectRaw) => {
    let object = objectRaw.trim();
    if (object.startsWith('{')) object = object.slice(1);
    if (object.endsWith('}')) object = object.slice(0, -1);
    const fields = {};
    for (const field of splitTopLevel(object, ',')) {
      const colon = field.indexOf(':');
      if (colon === -1) continue;
      const name = stripWrappingQuotes(field.slice(0, colon));
      if (name) fields[name] = name === 'default' ? field.slice(colon + 1).trim() : stripWrappingQuotes(field.slice(colon + 1));
    }
    return fields.name && fields.type
      ? [{ name: fields.name, type: fields.type, ...(fields.default === undefined ? {} : { default: fields.default }) }]
      : [];
  });
}

function parseImportBindings(raw) {
  const bindings = [];
  for (const part of splitTopLevel(raw, ',')) {
    const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(part.trim());
    if (!match) return null;
    bindings.push({ name: match[1], ...(match[2] ? { as: match[2] } : {}) });
  }
  return bindings.length > 0 ? bindings : null;
}

function quotedModule(raw) {
  const match = /^(?:"([^\n]+)"|'([^\n]+)')$/u.exec(raw.trim());
  return match ? match[1] ?? match[2] : null;
}

function parseFirstClassImport(raw, write) {
  const trimmed = raw.trim();
  if (trimmed === '' || /^\w+\s*=/u.test(trimmed)) return false;
  const foreign = /^(npm|py|python|pypi)\s+(["'])([\s\S]*?)\2(?:\s+as\s+([A-Za-z_$][\w$]*))?(?:\s+([\s\S]+))?$/u.exec(trimmed);
  if (foreign && foreign[3].trim()) {
    const registry = foreign[1] === 'npm' ? 'npm' : 'pypi';
    write('from', foreign[3].trim());
    write('package', foreign[3].trim());
    write('registry', registry);
    write('target', registry === 'npm' ? 'ts' : 'python');
    write('__firstClassImport', true);
    if (foreign[4]) write('default', foreign[4]);
    if (foreign[5]) assignBareProps(foreign[5], write);
    return true;
  }
  const sideEffect = /^from\s+/u.test(trimmed) ? null : quotedModule(trimmed);
  if (sideEffect) {
    write('from', sideEffect);
    write('__firstClassImport', true);
    return true;
  }
  const named = /^(type\s+)?\{\s*([\s\S]*?)\s*\}\s+from\s+([\s\S]+)$/u.exec(trimmed);
  if (!named) return false;
  const bindings = parseImportBindings(named[2]);
  const from = quotedModule(named[3]);
  if (!bindings || !from) return false;
  write('from', from);
  write('names', bindings.map((binding) => binding.as ? `${binding.name} as ${binding.as}` : binding.name).join(','));
  if (named[1]) write('types', true);
  write('__firstClassImport', true);
  write('__firstClassBindings', bindings);
  return true;
}

const BARE_PROPS = new Map([
  ['theme', 'name'], ['auth', 'mode'], ['validate', 'schema'], ['derive', 'name'], ['guard', 'name'],
  ['effect', 'name'], ['strategy', 'name'], ['trigger', 'kind'], ['rule', 'id'],
]);
const RAW_VALUE = new Set(['return', 'throw', 'do']);
const RAW_COND = new Set(['if', 'while']);
const ISLAND_KINDS = new Set(['capability', 'engine', 'provider', 'service', 'sidecar']);

export function normalizeKeywordHandlerOracle(content, type, stream, startCursor) {
  const cursor = new OracleCursor(stream.tokens, startCursor);
  const initialCursor = startCursor;
  const writes = [];
  const props = {};
  const write = (name, value) => {
    props[name] = value;
    writes.push({ name, value });
  };
  const bare = (name) => {
    cursor.skipWS();
    if (cursor.isKeyValue()) return;
    const value = cursor.tryIdent();
    if (value) write(name, value);
  };

  if (type === 'fn') {
    const position = cursor.position();
    cursor.skipWS();
    if (!parseFirstClassFnSignature(cursor.remainingRaw(content), write)) cursor.setPosition(position);
    else write('__firstClassSyntax', true);
  } else if (type === 'let') {
    cursor.skipWS();
    const position = cursor.position();
    const raw = cursor.remainingRaw(content).trim();
    const equals = findTopLevelAssignment(raw);
    const lhs = equals === -1 ? '' : raw.slice(0, equals).trim();
    const value = equals === -1 ? '' : raw.slice(equals + 1).trim();
    const legacy = /^(name|value|expr|type|kind)$/u.test(lhs) &&
      splitTopLevelWhitespace(value).some((part) => /^(name|value|expr|type|kind)=(?![=>])/u.test(part));
    const match = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([\s\S]+))?$/u.exec(lhs);
    if (equals === -1 || legacy || !match) cursor.setPosition(position);
    else {
      write('name', match[1]);
      if (match[2]?.trim()) write('type', match[2].trim());
      write('value', value);
    }
  } else if (RAW_VALUE.has(type) || RAW_COND.has(type)) {
    cursor.skipWS();
    if (!cursor.isKeyValue() && cursor.hasMore()) write(RAW_COND.has(type) ? 'cond' : 'value', cursor.remainingRaw(content).trim());
  } else if (type === 'doc') {
    cursor.skipWS();
    if (!cursor.isKeyValue()) {
      const position = cursor.position();
      const token = cursor.consumeAnyValue();
      cursor.skipWS();
      if (token && cursor.done()) write('text', token.value);
      else {
        cursor.setPosition(position);
        const remaining = cursor.remainingRaw(content).trim();
        if (remaining) write('text', remaining);
      }
    }
  } else if (BARE_PROPS.has(type)) bare(BARE_PROPS.get(type));
  else if (type === 'import') {
    cursor.skipWS();
    const firstClassPosition = cursor.position();
    if (!parseFirstClassImport(cursor.remainingRaw(content), write)) {
      cursor.setPosition(firstClassPosition);
      const position = cursor.position();
      const identifier = cursor.tryIdent();
      if (identifier === 'default') {
        if (!cursor.done() && cursor.peek()?.kind !== 'equals') {
          write('default', true);
          cursor.skipWS();
        } else if (cursor.peek()?.kind === 'equals') cursor.setPosition(position);
        else write('default', true);
      } else if (identifier) cursor.setPosition(position);
      if (!cursor.isKeyValue()) {
        cursor.skipWS();
        const name = cursor.tryIdent();
        if (name) write('name', name);
      }
    }
  } else if (type === 'island') {
    cursor.skipWS();
    if (!cursor.isKeyValue()) {
      const first = cursor.tryIdent();
      cursor.skipWS();
      if (cursor.isKeyValue()) {
        if (first) write(ISLAND_KINDS.has(first) ? 'kind' : 'name', first);
      } else {
        const second = cursor.tryIdent();
        if (first && second) {
          write('kind', first);
          write('name', second);
        } else if (first) write(ISLAND_KINDS.has(first) ? 'kind' : 'name', first);
      }
    }
  } else if (type === 'route') {
    cursor.skipWS();
    const position = cursor.position();
    const verb = cursor.tryIdent();
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/iu.test(verb ?? '')) {
      write('method', verb.toLowerCase());
      cursor.skipWS();
      if (cursor.peek()?.kind === 'slash') write('path', cursor.next().value);
    } else if (verb) cursor.setPosition(position);
  } else if (type === 'params') {
    cursor.skipWS();
    const remaining = cursor.remainingRaw(content).trim();
    if (remaining) {
      const match = /^items\s*=\s*(.+)$/su.exec(remaining);
      write('items', match ? parseParamItemsArray(match[1]) : parseBareParams(remaining));
    }
  } else if (type === 'error') {
    cursor.skipWS();
    const number = cursor.tryNumber();
    if (number) {
      write('status', Number.parseInt(number, 10));
      cursor.skipWS();
      if (cursor.peek()?.kind === 'quoted') write('message', cursor.next().value);
    }
  } else if (type === 'respond') {
    cursor.skipWS();
    const number = cursor.tryNumber();
    if (number) write('status', Number.parseInt(number, 10));
  } else if (type === 'expect') {
    cursor.skipWS();
    if (!cursor.isKeyValue()) {
      const position = cursor.position();
      const mode = cursor.tryIdent();
      if (['codegen', 'decompile', 'roundtrip'].includes(mode)) write(mode, true);
      else cursor.setPosition(position);
    }
  } else if (type === 'message') {
    cursor.skipWS();
    if (cursor.peek()?.kind === 'quoted') write('template', cursor.next().value);
  } else if (type === 'middleware') {
    cursor.skipWS();
    if (cursor.hasMore() && !cursor.hasEquals()) {
      const names = cursor.remainingRaw(content).trim().split(',').map((name) => name.trim()).filter(Boolean);
      if (names.length > 1) write('names', names);
      else if (names.length === 1) write('name', names[0]);
    }
  }

  return { finalCursor: cursor.position(), initialCursor, props, type, writes };
}
