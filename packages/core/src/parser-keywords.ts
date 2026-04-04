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

export const KEYWORD_HANDLERS = new Map<string, KeywordHandler>([
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
