/** @internal Keyword-specific parsing handlers for KERN node types. */
import type { TokenStream } from './parser-token-stream.js';

type KeywordHandler = (s: TokenStream, props: Record<string, unknown>, content: string) => void;

/** Consume a bare identifier into props if it's not a key=value pair. */
function consumeBareIdent(s: TokenStream, props: Record<string, unknown>, propName: string): void {
  s.skipWS();
  if (s.isKeyValue()) return;
  const id = s.tryIdent();
  if (id) props[propName] = id;
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
    (s, props) => {
      s.skipWS();
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
      const remaining = s.remainingRaw(content);
      if (remaining.length > 0) {
        const items: Array<{ name: string; type: string; default?: string }> = [];
        const parts = remaining
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const part of parts) {
          const m = part.match(/^([A-Za-z_]\w*):([A-Za-z_]\w*(?:\[\])?)(?:\s*=\s*(.+))?$/);
          if (m) {
            const item: { name: string; type: string; default?: string } = { name: m[1], type: m[2] };
            if (m[3] !== undefined) item.default = m[3].trim();
            items.push(item);
          }
        }
        props.items = items;
      }
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
