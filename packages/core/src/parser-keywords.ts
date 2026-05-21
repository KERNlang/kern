/** @internal Keyword-specific parsing handlers for KERN node types. */
import type { TokenStream } from './parser-token-stream.js';

type KeywordHandler = (s: TokenStream, props: Record<string, unknown>, content: string) => void;
const ISLAND_KIND_WORDS = new Set(['capability', 'engine', 'provider', 'service', 'sidecar']);

/** Consume a bare identifier into props if it's not a key=value pair. */
function consumeBareIdent(s: TokenStream, props: Record<string, unknown>, propName: string): void {
  s.skipWS();
  if (s.isKeyValue()) return;
  const id = s.tryIdent();
  if (id) props[propName] = id;
}

type ParamItem = { name: string; type: string; default?: string };

/** Strip a single layer of matching wrapping quotes ("", '', ``), if present. */
function stripWrappingQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'" || t[0] === '`') && t[t.length - 1] === t[0]) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Parse the documented array form `items="[{name:page,type:number,default:1}]"`.
 * Keys and values may be bare identifiers/numbers or quoted; whitespace is
 * tolerated. Objects missing name or type are skipped (defensive, not garbage).
 */
function parseParamItemsArray(raw: string): ParamItem[] {
  let body = stripWrappingQuotes(raw);
  if (body.startsWith('[')) body = body.slice(1);
  if (body.endsWith(']')) body = body.slice(0, -1);
  const items: ParamItem[] = [];
  for (const objRaw of splitTopLevel(body, ',')) {
    let obj = objRaw.trim();
    if (obj.startsWith('{')) obj = obj.slice(1);
    if (obj.endsWith('}')) obj = obj.slice(0, -1);
    const fields: Record<string, string> = {};
    for (const fieldRaw of splitTopLevel(obj, ',')) {
      const idx = fieldRaw.indexOf(':');
      if (idx === -1) continue;
      const key = stripWrappingQuotes(fieldRaw.slice(0, idx));
      if (!key) continue;
      const rawVal = fieldRaw.slice(idx + 1).trim();
      // name/type are KERN identifiers (unquote them); default is a target-language
      // literal that the generators interpolate verbatim, so its quotes are
      // semantic — keep `default:'relevance'` as `'relevance'`, not `relevance`
      // (which would emit an unbound `sort: str = relevance`).
      fields[key] = key === 'default' ? rawVal : stripWrappingQuotes(rawVal);
    }
    if (fields.name && fields.type) {
      const item: ParamItem = { name: fields.name, type: fields.type };
      if (fields.default !== undefined) item.default = fields.default;
      items.push(item);
    }
  }
  return items;
}

/** Parse the bare comma-list form `page:number=1, limit:number=20`. */
function parseBareParams(raw: string): ParamItem[] {
  const items: ParamItem[] = [];
  // splitTopLevel (not raw.split) so a default value carrying a comma —
  // e.g. `tags:string[]=["a","b"]` — stays in one part.
  for (const part of splitTopLevel(raw, ',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = part.match(/^([A-Za-z_]\w*):([A-Za-z_]\w*(?:\[\])?)(?:\s*=\s*(.+))?$/);
    if (m) {
      const item: ParamItem = { name: m[1], type: m[2] };
      if (m[3] !== undefined) item.default = m[3].trim();
      items.push(item);
    }
  }
  return items;
}

function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += input[++i] ?? '';
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '<') angleDepth++;
    else if (ch === '>' && input[i - 1] !== '=' && angleDepth > 0) angleDepth--;

    if (ch === delimiter && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function findMatching(input: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && !(close === '>' && input[i - 1] === '=')) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelWhitespace(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === '\\') current += input[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '<') angleDepth++;
    else if (ch === '>' && input[i - 1] !== '=' && angleDepth > 0) angleDepth--;
    if (/\s/u.test(ch) && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function splitReturnAndTrailingProps(input: string): { returns: string; trailing: string } {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '<') angleDepth++;
    else if (ch === '>' && input[i - 1] !== '=' && angleDepth > 0) angleDepth--;
    if (
      /\s/u.test(ch) &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0 &&
      /^[A-Za-z_][\w-]*=/.test(input.slice(i).trimStart())
    ) {
      return { returns: input.slice(0, i).trim(), trailing: input.slice(i).trim() };
    }
  }
  return { returns: input.trim(), trailing: '' };
}

function assignBareProps(raw: string, props: Record<string, unknown>): void {
  for (const part of splitTopLevelWhitespace(raw)) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (value === 'true') props[key] = true;
    else if (value === 'false') props[key] = false;
    else if (/^".*"$/.test(value) || /^'.*'$/.test(value)) props[key] = value.slice(1, -1);
    else props[key] = value;
  }
}

function findTopLevelAssignment(input: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '<') angleDepth++;
    else if (ch === '>' && input[i - 1] !== '=' && angleDepth > 0) angleDepth--;
    else if (
      ch === '=' &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0 &&
      input[i - 1] !== '=' &&
      input[i - 1] !== '!' &&
      input[i - 1] !== '<' &&
      input[i - 1] !== '>' &&
      input[i + 1] !== '=' &&
      input[i + 1] !== '>'
    ) {
      return i;
    }
  }
  return -1;
}

function hasLegacyLetPropTail(input: string): boolean {
  return splitTopLevelWhitespace(input).some((part) => /^(name|value|expr|type|kind)=(?![=>])/u.test(part));
}

function parseFirstClassFnSignature(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === '' || /^\w+\s*=/.test(trimmed)) return null;
  const nameMatch = /^([A-Za-z_$][\w$]*)/u.exec(trimmed);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  let i = name.length;
  while (/\s/u.test(trimmed[i] ?? '')) i++;
  const out: Record<string, unknown> = { name };

  if (trimmed[i] === '<') {
    const close = findMatching(trimmed, i, '<', '>');
    if (close === -1) return null;
    out.generics = trimmed.slice(i, close + 1);
    i = close + 1;
    while (/\s/u.test(trimmed[i] ?? '')) i++;
  }

  if (trimmed[i] !== '(') return null;
  const paramsClose = findMatching(trimmed, i, '(', ')');
  if (paramsClose === -1) return null;
  const paramsRaw = trimmed.slice(i + 1, paramsClose);
  i = paramsClose + 1;
  while (/\s/u.test(trimmed[i] ?? '')) i++;

  const params = splitTopLevel(paramsRaw, ',')
    .map((part) => part.replace(/\s*:\s*/u, ':').replace(/\s*=\s*/u, '='))
    .join(',');
  if (params) out.params = params;

  let trailing = trimmed.slice(i).trim();
  if (trailing.startsWith(':')) {
    const split = splitReturnAndTrailingProps(trailing.slice(1).trim());
    if (split.returns) out.returns = split.returns;
    trailing = split.trailing;
  }
  if (trailing) assignBareProps(trailing, out);
  return out;
}

function stripQuotedModuleSpecifier(raw: string): string | null {
  const trimmed = raw.trim();
  const match = /^(["'])([\s\S]+)\1$/u.exec(trimmed);
  return match ? match[2] : null;
}

function parseImportBindings(raw: string): Array<{ name: string; as?: string }> | null {
  const bindings: Array<{ name: string; as?: string }> = [];
  for (const part of splitTopLevel(raw, ',')) {
    const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(part.trim());
    if (!match) return null;
    bindings.push({ name: match[1], ...(match[2] ? { as: match[2] } : {}) });
  }
  return bindings.length > 0 ? bindings : null;
}

function parseFirstClassImport(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === '' || /^\w+\s*=/.test(trimmed)) return null;

  const foreign = parseForeignRegistryImport(trimmed);
  if (foreign) return foreign;

  const sideEffect = /^from\s+/.test(trimmed) ? null : stripQuotedModuleSpecifier(trimmed);
  if (sideEffect) {
    return { from: sideEffect, __firstClassImport: true };
  }

  const match = /^(type\s+)?\{\s*([\s\S]*?)\s*\}\s+from\s+([\s\S]+)$/u.exec(trimmed);
  if (!match) return null;
  const bindings = parseImportBindings(match[2]);
  const from = stripQuotedModuleSpecifier(match[3]);
  if (!bindings || !from) return null;

  return {
    from,
    names: bindings.map((binding) => (binding.as ? `${binding.name} as ${binding.as}` : binding.name)).join(','),
    ...(match[1] ? { types: true } : {}),
    __firstClassImport: true,
    __firstClassBindings: bindings,
  };
}

function parseForeignRegistryImport(raw: string): Record<string, unknown> | null {
  const match = /^(npm|py|python|pypi)\s+(["'])([\s\S]*?)\2(?:\s+as\s+([A-Za-z_$][\w$]*))?(?:\s+([\s\S]+))?$/u.exec(
    raw,
  );
  if (!match) return null;

  const keyword = match[1];
  const packageName = match[3].trim();
  if (!packageName) return null;

  const registry = keyword === 'npm' ? 'npm' : 'pypi';
  const props: Record<string, unknown> = {
    from: packageName,
    package: packageName,
    registry,
    target: registry === 'npm' ? 'ts' : 'python',
    __firstClassImport: true,
  };
  if (match[4]) props.default = match[4];
  if (match[5]) assignBareProps(match[5], props);
  return props;
}

export const KEYWORD_HANDLERS = new Map<string, KeywordHandler>([
  [
    'fn',
    (s, props, content) => {
      const pos = s.position();
      s.skipWS();
      const parsed = parseFirstClassFnSignature(s.remainingRaw(content));
      if (!parsed) {
        s.setPosition(pos);
        return;
      }
      Object.assign(props, parsed);
      props.__firstClassSyntax = true;
    },
  ],

  [
    'let',
    (s, props, content) => {
      s.skipWS();
      const pos = s.position();
      const raw = s.remainingRaw(content).trim();
      const eq = findTopLevelAssignment(raw);
      if (eq === -1) {
        s.setPosition(pos);
        return;
      }
      const lhs = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1).trim();
      if (/^(name|value|expr|type|kind)$/u.test(lhs) && hasLegacyLetPropTail(value)) {
        s.setPosition(pos);
        return;
      }
      const match = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([\s\S]+))?$/u.exec(lhs);
      if (!match) {
        s.setPosition(pos);
        return;
      }
      props.name = match[1];
      if (match[2]?.trim()) props.type = match[2].trim();
      props.value = value;
    },
  ],

  [
    'return',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue() || !s.hasMore()) return;
      props.value = s.remainingRaw(content).trim();
    },
  ],

  [
    'throw',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue() || !s.hasMore()) return;
      props.value = s.remainingRaw(content).trim();
    },
  ],

  [
    'do',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue() || !s.hasMore()) return;
      props.value = s.remainingRaw(content).trim();
    },
  ],

  [
    'if',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue() || !s.hasMore()) return;
      props.cond = s.remainingRaw(content).trim();
    },
  ],

  [
    'while',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue() || !s.hasMore()) return;
      props.cond = s.remainingRaw(content).trim();
    },
  ],

  [
    'doc',
    (s, props, content) => {
      s.skipWS();
      if (s.isKeyValue()) return;

      const start = s.position();
      const tok = s.consumeAnyValue();
      if (tok) {
        s.skipWS();
        if (s.done()) {
          props.text = tok.value;
          return;
        }
        s.setPosition(start);
      }

      const remaining = s.remainingRaw(content).trim();
      if (remaining.length > 0) {
        props.text = remaining;
        while (!s.done()) s.next();
      }
    },
  ],

  [
    'theme',
    (s, props) => {
      consumeBareIdent(s, props, 'name');
    },
  ],

  [
    'import',
    (s, props, content) => {
      s.skipWS();
      // remainingRaw() intentionally consumes the stream on probe; rewind if
      // this is legacy `import from=...` syntax.
      const firstClassPos = s.position();
      const firstClass = parseFirstClassImport(s.remainingRaw(content));
      if (firstClass) {
        Object.assign(props, firstClass);
        return;
      }
      s.setPosition(firstClassPos);

      const pos = s.position();
      const id = s.tryIdent();
      if (id === 'default') {
        if (!s.done() && s.peek()?.kind !== 'equals') {
          props.default = true;
          s.skipWS();
        } else if (s.peek()?.kind === 'equals') {
          s.setPosition(pos);
          return;
        } else {
          props.default = true;
          return;
        }
      } else if (id) {
        s.setPosition(pos);
      }
      if (!s.isKeyValue()) {
        s.skipWS();
        const name = s.tryIdent();
        if (name) props.name = name;
      }
    },
  ],

  [
    'island',
    (s, props) => {
      s.skipWS();
      if (s.isKeyValue()) return;
      const first = s.tryIdent();
      s.skipWS();
      if (s.isKeyValue()) {
        if (first && ISLAND_KIND_WORDS.has(first)) props.kind = first;
        else if (first) props.name = first;
        return;
      }
      const second = s.tryIdent();
      if (first && second) {
        props.kind = first;
        props.name = second;
      } else if (first && ISLAND_KIND_WORDS.has(first)) {
        props.kind = first;
      } else if (first) {
        props.name = first;
      }
    },
  ],

  [
    'route',
    (s, props) => {
      s.skipWS();
      const pos = s.position();
      const verb = s.tryIdent();
      if (verb && /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i.test(verb)) {
        props.method = verb.toLowerCase();
        s.skipWS();
        const tok = s.peek();
        if (tok && tok.kind === 'slash') {
          props.path = tok.value;
          s.next();
        }
      } else if (verb) {
        s.setPosition(pos);
      }
    },
  ],

  [
    'params',
    (s, props, content) => {
      s.skipWS();
      const remaining = s.remainingRaw(content).trim();
      if (remaining.length === 0) return;
      // Two accepted forms: the documented `items="[{name,type,default?}]"`
      // array, and the bare comma-list `page:number=1, limit:number=20`.
      const m = remaining.match(/^items\s*=\s*(.+)$/s);
      props.items = m ? parseParamItemsArray(m[1]) : parseBareParams(remaining);
    },
  ],

  [
    'auth',
    (s, props) => {
      consumeBareIdent(s, props, 'mode');
    },
  ],
  [
    'validate',
    (s, props) => {
      consumeBareIdent(s, props, 'schema');
    },
  ],

  [
    'error',
    (s, props) => {
      s.skipWS();
      const num = s.tryNumber();
      if (num) {
        props.status = parseInt(num, 10);
        s.skipWS();
        const tok = s.peek();
        if (tok && tok.kind === 'quoted') {
          props.message = tok.value;
          s.next();
        }
      }
    },
  ],

  [
    'derive',
    (s, props) => {
      consumeBareIdent(s, props, 'name');
    },
  ],
  [
    'guard',
    (s, props) => {
      consumeBareIdent(s, props, 'name');
    },
  ],
  [
    'effect',
    (s, props) => {
      consumeBareIdent(s, props, 'name');
    },
  ],
  [
    'strategy',
    (s, props) => {
      consumeBareIdent(s, props, 'name');
    },
  ],
  [
    'trigger',
    (s, props) => {
      consumeBareIdent(s, props, 'kind');
    },
  ],

  [
    'respond',
    (s, props) => {
      s.skipWS();
      const num = s.tryNumber();
      if (num) props.status = parseInt(num, 10);
    },
  ],

  [
    'expect',
    (s, props) => {
      s.skipWS();
      if (s.isKeyValue()) return;
      const pos = s.position();
      const id = s.tryIdent();
      if (id === 'codegen' || id === 'decompile' || id === 'roundtrip') {
        props[id] = true;
      } else {
        s.setPosition(pos);
      }
    },
  ],

  // Rule syntax — native .kern lint rules
  [
    'rule',
    (s, props) => {
      // rule id severity=error category=bug confidence=0.9
      consumeBareIdent(s, props, 'id');
    },
  ],

  [
    'message',
    (s, props) => {
      // message "template with {{interpolation}}"
      s.skipWS();
      const tok = s.peek();
      if (tok && tok.kind === 'quoted') {
        props.template = tok.value;
        s.next();
      }
    },
  ],

  [
    'middleware',
    (s, props, content) => {
      s.skipWS();
      if (!s.hasMore()) return;
      if (s.hasEquals()) return;
      const remaining = s.remainingRaw(content).trim();
      if (remaining.length > 0) {
        const names = remaining
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        if (names.length > 1) {
          props.names = names;
        } else if (names.length === 1) {
          props.name = names[0];
        }
      }
    },
  ],
]);
