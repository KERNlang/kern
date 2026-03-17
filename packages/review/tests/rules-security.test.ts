/**
 * Security rules tests — OWASP top 10 for TypeScript.
 */

import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const expressConfig: ReviewConfig = { target: 'express' };

// ── xss-unsafe-html ──────────────────────────────────────────────────

describe('xss-unsafe-html', () => {
  it('detects dangerouslySetInnerHTML in JSX', () => {
    const source = `
export function Unsafe({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;
    const report = reviewSource(source, 'comp.tsx', { target: 'web' });
    const f = report.findings.find(f => f.ruleId === 'xss-unsafe-html');
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
    const f = report.findings.find(f => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeDefined();
  });

  it('does NOT fire on textContent assignment', () => {
    const source = `
export function render(el: HTMLElement, text: string): void {
  el.textContent = text;
}
`;
    const report = reviewSource(source, 'dom.ts');
    const f = report.findings.find(f => f.ruleId === 'xss-unsafe-html');
    expect(f).toBeUndefined();
  });
});

// ── hardcoded-secret ─────────────────────────────────────────────────

describe('hardcoded-secret', () => {
  it('detects variable named apiKey with string value', () => {
    const source = `
export const apiKey = 'my-super-secret-key-12345';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('detects GitHub token pattern', () => {
    const source = `
export const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
  });

  it('detects AWS access key pattern', () => {
    const source = `
export const awsKey = 'AKIAIOSFODNN7EXAMPLE';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'hardcoded-secret');
    expect(f).toBeDefined();
  });

  it('does NOT fire on env variable references', () => {
    const source = `
export const apiKey = process.env.API_KEY || '';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'hardcoded-secret');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on non-secret variable names', () => {
    const source = `
export const appName = 'my-cool-app';
export const version = '2.0.0';
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'hardcoded-secret');
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
    const f = report.findings.find(f => f.ruleId === 'command-injection');
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
    const f = report.findings.find(f => f.ruleId === 'command-injection');
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
    const f = report.findings.find(f => f.ruleId === 'command-injection');
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
    const f = report.findings.find(f => f.ruleId === 'no-eval');
    expect(f).toBeDefined();
  });

  it('detects new Function()', () => {
    const source = `
export function createFn(body: string): Function {
  return new Function('x', body);
}
`;
    const report = reviewSource(source, 'fn.ts');
    const f = report.findings.find(f => f.ruleId === 'no-eval');
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
    const f = report.findings.find(f => f.ruleId === 'insecure-random');
    expect(f).toBeDefined();
  });

  it('does NOT fire on Math.random() in non-security context', () => {
    const source = `
export function getRandomColor(): string {
  return Math.random() > 0.5 ? 'red' : 'blue';
}
`;
    const report = reviewSource(source, 'ui.ts');
    const f = report.findings.find(f => f.ruleId === 'insecure-random');
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
    const f = report.findings.find(f => f.ruleId === 'cors-wildcard');
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
    const f = report.findings.find(f => f.ruleId === 'cors-wildcard');
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
    const f = report.findings.find(f => f.ruleId === 'cors-wildcard');
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
    const f = report.findings.find(f => f.ruleId === 'helmet-missing');
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
    const f = report.findings.find(f => f.ruleId === 'helmet-missing');
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
    const f = report.findings.find(f => f.ruleId === 'open-redirect');
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
    const f = report.findings.find(f => f.ruleId === 'open-redirect');
    expect(f).toBeUndefined();
  });
});
