/**
 * Security rules tests — OWASP top 10 for TypeScript.
 */

import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const expressConfig: ReviewConfig = { target: 'express' };
const nextConfig: ReviewConfig = { target: 'nextjs' };

// ── xss-unsafe-html ──────────────────────────────────────────────────

describe('xss-unsafe-html', () => {
  it('detects dangerouslySetInnerHTML in JSX', () => {
    const source = `
export function Unsafe({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;
    const report = reviewSource(source, 'comp.tsx', { target: 'web' });
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects .innerHTML assignment', () => {
    const source = `
export function render(el: HTMLElement, content: string): void {
  el.innerHTML = content;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
  });

  it('does NOT fire on textContent assignment', () => {
    const source = `
export function render(el: HTMLElement, text: string): void {
  el.textContent = text;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on .innerHTML with a pure string literal', () => {
    const source = `
export function reset(el: HTMLElement): void {
  el.innerHTML = '<div class="empty"></div>';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeUndefined();
  });

  it('demotes .innerHTML with escaped concat to advisory (info)', () => {
    const source = `
declare function kswEscapeHtml(s: string): string;
export function render(el: HTMLElement, x: string): void {
  el.innerHTML = '<span>' + kswEscapeHtml(x) + '</span>';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('demotes .innerHTML with escaped template literal to advisory (info)', () => {
    const source = `
declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, x: string): void {
  el.innerHTML = \`<span>\${escapeHtml(x)}</span>\`;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('fires at error on .innerHTML with mixed escaped + unescaped interpolation', () => {
    const source = `
declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, safe: string, raw: string): void {
  el.innerHTML = '<span>' + escapeHtml(safe) + raw + '</span>';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  // Escape-awareness through a same-function `const` (Agon webview FP class #1).
  it('demotes .innerHTML assigned an escaped const variable to advisory (info)', () => {
    const source = `
declare function kswEscapeHtml(s: string): string;
export function render(el: HTMLElement, x: string): void {
  const safe = kswEscapeHtml(x);
  el.innerHTML = safe;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('resolves short escaped const-alias chains to advisory (info)', () => {
    const source = `
declare function kswEscapeHtml(s: string): string;
export function render(el: HTMLElement, x: string): void {
  const safe = kswEscapeHtml(x);
  const html = safe;
  el.innerHTML = html;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  // Map/join HTML-builder idiom with escaped callback (Agon webview FP class #2).
  it('demotes .innerHTML from items.map(escape).join("") to advisory (info)', () => {
    const source = `
declare function kswEscapeHtml(s: string): string;
export function render(el: HTMLElement, items: string[]): void {
  el.innerHTML = items.map((i) => \`<li>\${kswEscapeHtml(i)}</li>\`).join('');
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  // False-negative guards — these must stay 'error'. A security rule must never
  // infer safety from mutable bindings, unknown sources, params, helper
  // callbacks, unescaped interpolation, or a bare map without join.
  it.each([
    [
      'let reassigned after escape',
      `declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, x: string, raw: string): void {
  let safe = escapeHtml(x);
  safe = raw;
  el.innerHTML = safe;
}`,
    ],
    [
      'const aliasing an unknown property source',
      `export function render(el: HTMLElement, props: { safeHtml: string }): void {
  const safe = props.safeHtml;
  el.innerHTML = safe;
}`,
    ],
    [
      'a function parameter',
      `export function render(el: HTMLElement, safe: string): void {
  el.innerHTML = safe;
}`,
    ],
    [
      'map with an unescaped param interpolation',
      `export function render(el: HTMLElement, items: string[]): void {
  el.innerHTML = items.map((i) => \`<li>\${i}</li>\`).join('');
}`,
    ],
    [
      'map with a helper (non-inline) callback',
      `declare function renderItem(i: string): string;
export function render(el: HTMLElement, items: string[]): void {
  el.innerHTML = items.map(renderItem).join('');
}`,
    ],
    [
      'a bare map without join (implicit comma coercion)',
      `declare function escapeHtml(s: string): string;
export function render(el: { innerHTML: unknown }, items: string[]): void {
  el.innerHTML = items.map((i) => \`<li>\${escapeHtml(i)}</li>\`);
}`,
    ],
  ])('keeps .innerHTML from %s at error', (_label, source) => {
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('recognizes DOMPurify.sanitize as an escape helper', () => {
    const source = `
declare const DOMPurify: { sanitize(s: string): string };
export function render(el: HTMLElement, html: string): void {
  el.innerHTML = DOMPurify.sanitize(html);
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('fires at error on .innerHTML = JSON.stringify(x) (not an HTML escaper)', () => {
    const source = `
export function render(el: HTMLElement, data: unknown): void {
  el.innerHTML = JSON.stringify(data);
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires at error on .innerHTML = escape(x) (URI-encoding, not HTML escape)', () => {
    const source = `
export function render(el: HTMLElement, raw: string): void {
  el.innerHTML = escape(raw);
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires at error on .innerHTML = myObj.sanitize(x) (unknown root, method name alone is not enough)', () => {
    const source = `
declare const myDataStore: { sanitize(s: string): string };
export function render(el: HTMLElement, raw: string): void {
  el.innerHTML = myDataStore.sanitize(raw);
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('demotes ternary with both branches escaped to advisory (info)', () => {
    const source = `
declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, cond: boolean, x: string): void {
  el.innerHTML = cond ? escapeHtml(x) : '<span></span>';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('fires at error on ternary with one unescaped branch', () => {
    const source = `
declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, cond: boolean, safe: string, raw: string): void {
  el.innerHTML = cond ? escapeHtml(safe) : raw;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('handles logical-or fallback: escapeHtml(x) || "" → info', () => {
    const source = `
declare function escapeHtml(s: string): string;
export function render(el: HTMLElement, x: string): void {
  el.innerHTML = escapeHtml(x) || '';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('fires at error on logical-or with unsafe left side: x || "default"', () => {
    const source = `
export function render(el: HTMLElement, x: string): void {
  el.innerHTML = x || '<div></div>';
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find((f) => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });
});

// ── hardcoded-secret ─────────────────────────────────────────────────

describe('hardcoded-secret', () => {
  it('detects variable named apiKey with string value', () => {
    const source = `
export const apiKey = 'my-super-secret-key-12345';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects GitHub token pattern', () => {
    const source = `
export const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
  });

  it('detects AWS access key pattern', () => {
    const source = `
export const awsKey = 'AKIAIOSFODNN7EXAMPLE';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
  });

  it('does NOT fire on env variable references', () => {
    const source = `
export const apiKey = process.env.API_KEY || '';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on non-secret variable names', () => {
    const source = `
export const appName = 'my-cool-app';
export const version = '2.0.0';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(f).toBeUndefined();
  });
});

// ── command-injection ────────────────────────────────────────────────

describe('command-injection', () => {
  it('detects exec() with template literal', () => {
    const source = `
import { exec } from 'child_process';
export function run(userInput: string): void {
  exec(\`ls \${userInput}\`);
}
`;
    const report = reviewSource(source, 'run.ts');
    const f = report.findings.find((f) => f.ruleId === 'command-injection');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects execSync() with string concatenation', () => {
    const source = `
import { execSync } from 'child_process';
export function run(cmd: string): void {
  execSync('ls ' + cmd);
}
`;
    const report = reviewSource(source, 'run.ts');
    const f = report.findings.find((f) => f.ruleId === 'command-injection');
    expect(f).toBeDefined();
  });

  it('does NOT fire on static string argument', () => {
    const source = `
import { execSync } from 'child_process';
export function run(): void {
  execSync('ls -la');
}
`;
    const report = reviewSource(source, 'run.ts');
    const f = report.findings.find((f) => f.ruleId === 'command-injection');
    expect(f).toBeUndefined();
  });
});

// ── no-eval ──────────────────────────────────────────────────────────

describe('no-eval', () => {
  it('detects eval()', () => {
    const source = `
export function dangerous(code: string): unknown {
  return eval(code);
}
`;
    const report = reviewSource(source, 'eval.ts');
    const f = report.findings.find((f) => f.ruleId === 'no-eval');
    expect(f).toBeDefined();
  });

  it('detects new Function()', () => {
    const source = `
export function createFn(body: string): Function {
  return new Function('x', body);
}
`;
    const report = reviewSource(source, 'fn.ts');
    const f = report.findings.find((f) => f.ruleId === 'no-eval');
    expect(f).toBeDefined();
  });
});

// ── insecure-random ──────────────────────────────────────────────────

describe('insecure-random', () => {
  it('detects Math.random() in token generation', () => {
    const source = `
export function generateToken(): string {
  return Math.random().toString(36).substring(2);
}
`;
    const report = reviewSource(source, 'auth.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeDefined();
  });

  it('does NOT fire on Math.random() in non-security context', () => {
    const source = `
export function getRandomColor(): string {
  return Math.random() > 0.5 ? 'red' : 'blue';
}
`;
    const report = reviewSource(source, 'ui.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on substring matches like `valid` / `paid` / `inside`', () => {
    const source = `
export function isValid(): boolean {
  return Math.random() > 0.5;
}
export function paidJitter(): number {
  return Math.random();
}
const inside = Math.random();
`;
    const report = reviewSource(source, 'jitter.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeUndefined();
  });

  it('still fires on camelCase identifiers like apiKey', () => {
    const source = `
export function makeApiKey(): string {
  return Math.random().toString(36);
}
`;
    const report = reviewSource(source, 'auth.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeDefined();
  });

  it('fires on PascalCase identifiers like SecretToken', () => {
    const source = `
export function SecretToken(): string {
  return Math.random().toString(36);
}
`;
    const report = reviewSource(source, 'auth.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeDefined();
  });

  it('fires on acronym-prefixed identifiers like APIKey', () => {
    // Gemini impl-review: a single camelCase regex misses APIKey because
    // the runs-of-uppercase boundary needs its own pre-pass.
    const source = `
export function APIKey(): string {
  return Math.random().toString(36);
}
`;
    const report = reviewSource(source, 'auth.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeDefined();
  });

  it('does NOT fire in test files', () => {
    const source = `
export function generateToken(): string {
  return Math.random().toString(36);
}
`;
    const report = reviewSource(source, 'auth.test.ts');
    const f = report.findings.find((f) => f.ruleId === 'insecure-random');
    expect(f).toBeUndefined();
  });
});

// ── cors-wildcard ────────────────────────────────────────────────────

describe('cors-wildcard', () => {
  it('detects cors() with no args', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors());
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard');
    expect(f).toBeDefined();
  });

  it('detects cors({ origin: "*" })', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: '*' }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard');
    expect(f).toBeDefined();
  });

  it('does NOT fire on restricted cors', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: 'https://mysite.com' }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard');
    expect(f).toBeUndefined();
  });
});

// ── cors-wildcard-credentials ────────────────────────────────────────

describe('cors-wildcard-credentials', () => {
  it("fires on origin: '*' + credentials: true (CRITICAL)", () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: '*', credentials: true }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on origin: true + credentials: true (reflects any origin)', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: true, credentials: true }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeDefined();
  });

  it('does NOT fire on wildcard origin without credentials', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: '*' }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on credentials: true with restricted origin', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: 'https://app.example.com', credentials: true }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on bare cors() — handled by cors-wildcard', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors());
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeUndefined();
  });

  it('does NOT fire when credentials is false / absent', () => {
    const source = `
import cors from 'cors';
import express from 'express';
const app = express();
app.use(cors({ origin: '*', credentials: false }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'cors-wildcard-credentials');
    expect(f).toBeUndefined();
  });
});

// ── helmet-missing ───────────────────────────────────────────────────

describe('helmet-missing', () => {
  it('detects Express app without helmet', () => {
    const source = `
import express from 'express';
const app = express();
app.get('/', (req: any, res: any) => res.json({ ok: true }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'helmet-missing');
    expect(f).toBeDefined();
  });

  it('does NOT fire when helmet is used', () => {
    const source = `
import express from 'express';
import helmet from 'helmet';
const app = express();
app.use(helmet());
app.get('/', (req: any, res: any) => res.json({ ok: true }));
`;
    const report = reviewSource(source, 'server.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'helmet-missing');
    expect(f).toBeUndefined();
  });
});

// ── open-redirect ────────────────────────────────────────────────────

describe('open-redirect', () => {
  it('detects res.redirect with req.query', () => {
    const source = `
import express from 'express';
const app = express();
app.get('/go', (req: any, res: any) => {
  res.redirect(req.query.url);
});
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'open-redirect');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('does NOT fire on static redirect', () => {
    const source = `
import express from 'express';
const app = express();
app.get('/home', (req: any, res: any) => {
  res.redirect('/dashboard');
});
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'open-redirect');
    expect(f).toBeUndefined();
  });
});

// ── error-leak ───────────────────────────────────────────────────────

describe('error-leak', () => {
  it('detects raw error object in res.json(err)', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.status(500).json(err);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('stack traces');
  });

  it('detects err.stack in object literal', () => {
    const source = `
try {
  doWork();
} catch (error) {
  res.send({ error: error.stack, message: 'failed' });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects stack in template literal', () => {
    const source = `
try {
  doWork();
} catch (e) {
  res.send(\`Error: \${e.stack}\`);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  it('flags err.message as warning', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.json({ message: err.message });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('does NOT fire on console.error or next(err)', () => {
    const source = `
try {
  doWork();
} catch (err) {
  console.error(err);
  next(err);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('does NOT fire when guarded by NODE_ENV !== production', () => {
    const source = `
try {
  doWork();
} catch (err) {
  if (process.env.NODE_ENV !== 'production') {
    res.json(err);
  } else {
    res.status(500).send('Internal Server Error');
  }
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('DOES fire when leak is explicitly in the production branch', () => {
    const source = `
try {
  doWork();
} catch (err) {
  if (process.env.NODE_ENV === 'production') {
    res.json(err);
  }
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  it('does NOT fire when leak is in the else branch of a production check', () => {
    const source = `
try {
  doWork();
} catch (err) {
  if (process.env.NODE_ENV === 'production') {
    res.send('error');
  } else {
    res.json(err);
  }
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on short name collision in strings (e.g. "e")', () => {
    const source = `
try {
  doWork();
} catch (e) {
  res.send("An error occurred: e");
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on property key collision', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.json({ err: 'some constant' });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('detects nested catch shadowing correctly', () => {
    const source = `
try {
  doWork();
} catch (err) {
  try {
    inner();
  } catch (err) {
    res.json(err.message); // Safe for inner err, rule for outer err should skip
  }
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const findings = report.findings.filter((f) => f.ruleId === 'error-leak');
    // It might still fire for the inner catch (as a warning), but it shouldn't
    // fire for the outer catch as an error.
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('flags err.message in complex object as warning', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.json({ success: false, error: err.message, code: 500 });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('flags complex object with both err and err.message as error', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.json({ success: false, error: err.message, raw: err });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects leak in Fastify/Koa-like context names', () => {
    const source = `
try {
  doWork();
} catch (err) {
  ctx.send(err);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  // ── Plan-review additions ──────────────────────────────────────────

  it('does NOT fire when an inner arrow shadows the catch param (Codex plan-review)', () => {
    const source = `
try {
  doWork();
} catch (err) {
  ((err: string) => res.json(err))('safe');
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('fires on next(err) followed by direct leak (per-call non-sink, not catch-level suppress)', () => {
    const source = `
try {
  doWork();
} catch (err) {
  next(err);
  res.json(err);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  it('fires on spread of error object', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.json({ ...err });
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on JSON.stringify(err)', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.send(JSON.stringify(err));
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  it('fires through deep response chain (res.type().status().send())', () => {
    const source = `
try {
  doWork();
} catch (err) {
  res.type('json').status(500).send(err.stack);
}
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
  });

  it('does NOT fire when receiver is a non-allowlisted name (e.g. `c` is too greedy)', () => {
    // OpenCode plan-review: dropped `c` from RESPONSE_OBJECTS to prevent
    // unrelated `c.send(err)` callers (queue clients, sockets, etc.) from
    // firing without an HTTP boundary.
    const source = `
try {
  doWork();
} catch (err) {
  c.send(err);
}
`;
    const report = reviewSource(source, 'noise.ts', expressConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeUndefined();
  });

  it('detects raw error object in Web Response.json(error)', () => {
    const source = `
export async function POST() {
  try {
    await doWork();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(error, { status: 500 });
  }
}
`;
    const report = reviewSource(source, 'app/api/work/route.ts', nextConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects exception messages in NextResponse.json(...) as warning', () => {
    const source = `
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    await doWork();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ message: err.message }, { status: 500 });
  }
}
`;
    const report = reviewSource(source, 'app/api/work/route.ts', nextConfig);
    const f = report.findings.find((f) => f.ruleId === 'error-leak');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });
});

// ── bearer-token-literal ──────────────────────────────────────────────

describe('bearer-token-literal', () => {
  it('fires on hardcoded JWT in fetch Authorization header (error severity)', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature_here' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on Stripe key in axios Authorization header (case-insensitive)', () => {
    const source = `
async function call(): Promise<void> {
  await axios.get('/users', {
    headers: { authorization: 'Bearer sk_live_abcdefghijklmnopqrstuv' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on GitHub token in headers.set call', () => {
    const source = `
async function call(req: Request): Promise<void> {
  req.headers.set('Authorization', 'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789');
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on no-substitution template literal Bearer header', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: \`Bearer eyJhbGciOiJIUzI1NiJ9.zzzzzzzzzzzzzzzz.signature\` },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
  });

  it('fires on string concatenation of literals', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: 'Bearer ' + 'sk_live_abcdefghijklmnopqrstuv' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
  });

  it('fires on template with literal-only substitution (Codex impl-review)', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: \`Bearer \${'sk_live_xxxxxxxxxxxxxxxxxxxx'}\` },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
  });

  it('fires on opaque-token Bearer with warning severity (not a known pattern)', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: 'Bearer randomopaquetoken_abcdef123456' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('does NOT fire when token comes from process.env interpolation', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: \`Bearer \${process.env.TOKEN}\` },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on Basic auth scheme', () => {
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: 'Basic ' + 'dXNlcjpwYXNz' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on Bearer literal outside header context', () => {
    const source = `
const comment: string = 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
console.log(comment);
`;
    const report = reviewSource(source, 'doc.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on placeholder values', () => {
    const placeholders = [
      "'Bearer '",
      "'Bearer <token>'",
      "'Bearer YOUR_TOKEN'",
      "'Bearer TODO'",
      "'Bearer example'",
      "'Bearer xxx'",
      "'Bearer <YOUR-API-KEY>'",
    ];
    for (const literal of placeholders) {
      const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: ${literal} },
  });
}
`;
      const report = reviewSource(source, 'api.ts');
      const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
      expect(f).toBeUndefined();
    }
  });

  it('does NOT fire on unknown identifier interpolation (FN class — alias tracing deferred)', () => {
    const source = `
const TOKEN = 'sk_live_abcdefghijklmnopqrstuv';
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: \`Bearer \${TOKEN}\` },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeUndefined();
  });

  // ── Impl-review fixes ──────────────────────────────────────────────

  it('does NOT fire on Bearer-shaped value under a non-Authorization header key (Codex impl-review FP fix)', () => {
    // Original bug: any `headers` ancestor accepted the literal even when
    // the literal lived under a different header key like X-Comment. We now
    // require the nearest enclosing PropertyAssignment to be Authorization.
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { 'X-Note': 'Bearer tokens are documented at /docs' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeUndefined();
  });

  it('fires on case-insensitive bearer scheme (Codex impl-review FN fix)', () => {
    // HTTP auth schemes are case-insensitive — `bearer ` lowercase is
    // equivalent to `Bearer `.
    const source = `
async function call(): Promise<void> {
  await fetch('/api', {
    headers: { Authorization: 'bearer sk_live_abcdefghijklmnopqrstuv' },
  });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on new Headers tuple form (Codex impl-review + Gemini FN fix)', () => {
    const source = `
async function call(): Promise<void> {
  const h = new Headers([['Authorization', 'Bearer sk_live_abcdefghijklmnopqrstuv']]);
  await fetch('/api', { headers: h });
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
  });

  it('fires on headers.append (verifying append works alongside set)', () => {
    const source = `
async function call(req: Request): Promise<void> {
  req.headers.append('Authorization', 'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789');
}
`;
    const report = reviewSource(source, 'api.ts');
    const f = report.findings.find((f) => f.ruleId === 'bearer-token-literal');
    expect(f).toBeDefined();
  });
});

// ── redirect-non-3xx-status ────────────────────────────────────────────

describe('redirect-non-3xx-status', () => {
  it('fires on Express and Next pages API redirect calls with a non-3xx status', () => {
    const source = `
export default function handler(req: any, res: any): void {
  res.redirect(401, '/login');
}
`;
    const report = reviewSource(source, 'pages/api/login.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('401');
  });

  it('fires when a redirect helper receives a non-3xx second status argument', () => {
    const source = `
import { NextResponse } from 'next/server';
export function GET(): Response {
  return NextResponse.redirect('/login', 401);
}
`;
    const report = reviewSource(source, 'route.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeDefined();
  });

  it('fires on standard Response.redirect with a non-3xx status', () => {
    const source = `
export function loader(): Response {
  return Response.redirect('/login', 401);
}
`;
    const report = reviewSource(source, 'loader.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeDefined();
  });

  it('fires when a redirect helper receives a non-3xx status init object', () => {
    const source = `
import { redirect } from '@remix-run/node';
export function loader(): Response {
  return redirect('/login', { status: 401 });
}
`;
    const report = reviewSource(source, 'loader.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeDefined();
  });

  it('does not fire on redirect calls with 3xx statuses or implicit defaults', () => {
    const source = `
export function handler(req: any, res: any): void {
  res.redirect(302, '/login');
  res.redirect('/dashboard');
  NextResponse.redirect('/new-url', 308);
  redirect('/login', { status: 303 });
}
`;
    const report = reviewSource(source, 'redirects.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeUndefined();
  });

  it('does not fire on unrelated redirect-named APIs', () => {
    const source = `
import { redirect } from './state-machine';
export function update(machine: any): void {
  machine.redirect('archived', 409);
  redirect('archived', { status: 409 });
}
`;
    const report = reviewSource(source, 'workflow.ts');
    const f = report.findings.find((f) => f.ruleId === 'redirect-non-3xx-status');
    expect(f).toBeUndefined();
  });
});

// ── electron-open-external-unvalidated ─────────────────────────────────

describe('electron-open-external-unvalidated', () => {
  it('flags dynamic shell.openExternal without host allowlist', () => {
    const source = `
import { shell } from 'electron';
export async function open(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
  await shell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeDefined();
  });

  it('does not flag dynamic shell.openExternal with host allowlist', () => {
    const source = `
import { shell } from 'electron';
const allowedHosts = new Set(['audiofacets.com']);
export async function open(url: string) {
  const parsed = new URL(url);
  if (!allowedHosts.has(parsed.hostname)) throw new Error('bad host');
  await shell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeUndefined();
  });

  it('still flags when allowlist check does not guard openExternal', () => {
    const source = `
import { shell } from 'electron';
const allowedHosts = new Set(['audiofacets.com']);
export async function open(url: string) {
  const parsed = new URL(url);
  if (allowedHosts.has(parsed.hostname)) console.log('known host');
  await shell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeDefined();
  });

  it('still flags when an allowlist variable exists but is not checked', () => {
    const source = `
import { shell } from 'electron';
const allowedHosts = new Set(['audiofacets.com']);
export async function open(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('bad protocol');
  await shell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeDefined();
  });

  it('flags aliased Electron shell.openExternal calls', () => {
    const source = `
import { shell as electronShell } from 'electron';
export async function open(url: string) {
  await electronShell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeDefined();
  });

  it('does not treat unrelated local shell bindings as Electron shell', () => {
    const source = `
import { app } from 'electron';
const shell = makeShell();
export async function open(url: string) {
  await shell.openExternal(url);
}
`;
    const report = reviewSource(source, 'apps/electron/src/main/shell.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-open-external-unvalidated')).toBeUndefined();
  });
});

// ── electron-localhost-wildcard-cors ───────────────────────────────────

describe('electron-localhost-wildcard-cors', () => {
  it('flags wildcard CORS on localhost server with mutating route', () => {
    const source = `
const HOST = '127.0.0.1';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.post('/voice', async (req, res) => {
  res.json({ ok: true });
});
server.listen(8787, HOST);
`;
    const report = reviewSource(source, 'apps/electron/src/main/renderer-http-server/server.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-localhost-wildcard-cors')).toBeDefined();
  });

  it('does not flag when a nonce guard is present', () => {
    const source = `
const HOST = '127.0.0.1';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.post('/voice', requireNonce, async (req, res) => {
  res.json({ ok: true });
});
server.listen(8787, HOST);
`;
    const report = reviewSource(source, 'apps/electron/src/main/renderer-http-server/server.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-localhost-wildcard-cors')).toBeUndefined();
  });

  it('still flags when guard words only appear in comments', () => {
    const source = `
const HOST = '127.0.0.1';
// TODO: add nonce later.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.post('/voice', async (req, res) => {
  res.json({ ok: true });
});
server.listen(8787, HOST);
`;
    const report = reviewSource(source, 'apps/electron/src/main/renderer-http-server/server.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-localhost-wildcard-cors')).toBeDefined();
  });

  it('still flags when route-local guard names only appear in comments', () => {
    const source = `
const HOST = '127.0.0.1';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.post('/voice', async (req, res) => {
  // requireNonce will be added later.
  res.json({ ok: true });
});
server.listen(8787, HOST);
`;
    const report = reviewSource(source, 'apps/electron/src/main/renderer-http-server/server.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-localhost-wildcard-cors')).toBeDefined();
  });

  it('does not flag when shared auth middleware protects mutating routes', () => {
    const source = `
const HOST = '127.0.0.1';
app.use(requireAuth);
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.post('/voice', async (req, res) => {
  res.json({ ok: true });
});
server.listen(8787, HOST);
`;
    const report = reviewSource(source, 'apps/electron/src/main/renderer-http-server/server.ts');
    expect(report.findings.find((f) => f.ruleId === 'electron-localhost-wildcard-cors')).toBeUndefined();
  });
});

// ── inline-json-script-escape ──────────────────────────────────────────

describe('inline-json-script-escape', () => {
  it('flags JSON.stringify inside executable inline script', () => {
    const source = `
export function render(data: unknown) {
  return \`<script>window.__DATA__ = \${JSON.stringify(data)}</script>\`;
}
`;
    const report = reviewSource(source, 'src/server/render.ts');
    expect(report.findings.find((f) => f.ruleId === 'inline-json-script-escape')).toBeDefined();
  });

  it('does not flag application/json script blocks', () => {
    const source = `
export function render(data: unknown) {
  return \`<script type="application/json">\${JSON.stringify(data)}</script>\`;
}
`;
    const report = reviewSource(source, 'src/server/render.ts');
    expect(report.findings.find((f) => f.ruleId === 'inline-json-script-escape')).toBeUndefined();
  });

  it('does not treat unrelated replace calls as JSON escaping', () => {
    const source = `
export function render(data: unknown, title: string) {
  return \`<script>window.__TITLE__ = "\${title.replace(/</g, '')}"; window.__DATA__ = \${JSON.stringify(data)}</script>\`;
}
`;
    const report = reviewSource(source, 'src/server/render.ts');
    expect(report.findings.find((f) => f.ruleId === 'inline-json-script-escape')).toBeDefined();
  });

  it('flags JSON.stringify in inline script string concatenation', () => {
    const source = `
export function render(data: unknown) {
  return '<script>window.__DATA__ = ' + JSON.stringify(data) + '</script>';
}
`;
    const report = reviewSource(source, 'src/server/render.ts');
    expect(report.findings.find((f) => f.ruleId === 'inline-json-script-escape')).toBeDefined();
  });

  it('does not treat ampersand escaping as script-breakout protection', () => {
    const source = `
export function render(data: unknown) {
  return \`<script>window.__DATA__ = \${JSON.stringify(data).replace(/&/g, '&amp;')}</script>\`;
}
`;
    const report = reviewSource(source, 'src/server/render.ts');
    expect(report.findings.find((f) => f.ruleId === 'inline-json-script-escape')).toBeDefined();
  });
});

// ── sensitive-console-log ──────────────────────────────────────────────

describe('sensitive-console-log', () => {
  it('flags runtime logs of request headers and body', () => {
    const source = `
export function logRequest(requestHeaders: Headers, body: unknown) {
  console.log('request', requestHeaders, JSON.stringify(body));
}
`;
    const report = reviewSource(source, 'src/api/client.ts');
    expect(report.findings.find((f) => f.ruleId === 'sensitive-console-log')).toBeDefined();
  });

  it('does not flag logs that use an explicit redaction helper', () => {
    const source = `
export function logRequest(requestHeaders: Headers) {
  console.log('request', redact(requestHeaders));
}
`;
    const report = reviewSource(source, 'src/api/client.ts');
    expect(report.findings.find((f) => f.ruleId === 'sensitive-console-log')).toBeUndefined();
  });

  it('does not flag generic health-check status logs', () => {
    const source = `
export function logHealth(status: string) {
  console.log('health', status);
}
`;
    const report = reviewSource(source, 'src/api/client.ts');
    expect(report.findings.find((f) => f.ruleId === 'sensitive-console-log')).toBeUndefined();
  });

  it('does not flag sensitive words that only appear in a log message string', () => {
    const source = `
export function logProgress(status: string) {
  console.log('processing request body', status);
}
`;
    const report = reviewSource(source, 'src/api/client.ts');
    expect(report.findings.find((f) => f.ruleId === 'sensitive-console-log')).toBeUndefined();
  });

  it('does not let unrelated redacted values hide raw sensitive arguments', () => {
    const source = `
export function logAuth(redactedCount: number, authorization: string) {
  console.log(redactedCount, authorization);
}
`;
    const report = reviewSource(source, 'src/api/client.ts');
    expect(report.findings.find((f) => f.ruleId === 'sensitive-console-log')).toBeDefined();
  });
});
