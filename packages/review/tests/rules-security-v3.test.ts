/**
 * Security v3 rules tests — ReDoS, input validation, prototype pollution, info exposure.
 */

import { reviewSource } from '../src/index.js';

// ── regex-dos ─────────────────────────────────────────────────────────

describe('regex-dos', () => {
  it('detects nested quantifier: (a+)+', () => {
    const source = `
export function validate(input: string): boolean {
  return /^(a+)+$/.test(input);
}
`;
    const report = reviewSource(source, 'validator.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('nested quantifier');
  });

  it('detects nested quantifier: (.*a)+', () => {
    const source = `
export const emailRegex = /(.*@.*)+/;
`;
    const report = reviewSource(source, 'regex.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeDefined();
    expect(f!.message).toContain('backtracking');
  });

  it('detects overlapping alternation with quantifier', () => {
    const source = `
export const pattern = /(a|ab)+/;
`;
    const report = reviewSource(source, 'regex.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeDefined();
    expect(f!.message).toContain('overlapping alternation');
  });

  it('detects ReDoS in new RegExp() constructor', () => {
    const source = `
export const regex = new RegExp('(a+)+');
`;
    const report = reviewSource(source, 'regex.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeDefined();
  });

  it('does NOT fire on safe regex', () => {
    const source = `
export const safe = /^[a-z0-9]+$/;
export const alsoSafe = /^\\d{3}-\\d{4}$/;
`;
    const report = reviewSource(source, 'regex.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on non-overlapping alternation', () => {
    const source = `
export const safe = /(cat|dog)+/;
`;
    const report = reviewSource(source, 'regex.ts');
    const f = report.findings.find(f => f.ruleId === 'regex-dos');
    expect(f).toBeUndefined();
  });
});

// ── missing-input-validation ──────────────────────────────────────────

describe('missing-input-validation', () => {
  it('detects req.body used without validation', () => {
    const source = `
import express from 'express';
const app = express();
app.post('/users', (req: any, res: any) => {
  const user = req.body;
  db.insert(user);
  res.json({ ok: true });
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'missing-input-validation');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('req.body');
  });

  it('detects req.query used without validation', () => {
    const source = `
app.get('/search', (req: any, res: any) => {
  const q = req.query.q;
  const results = search(q);
  res.json(results);
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'missing-input-validation');
    expect(f).toBeDefined();
    expect(f!.message).toContain('req.query');
  });

  it('does NOT fire when zod schema.parse is used', () => {
    const source = `
import { z } from 'zod';
const UserSchema = z.object({ name: z.string(), age: z.number() });
app.post('/users', (req: any, res: any) => {
  const user = UserSchema.parse(req.body);
  db.insert(user);
  res.json({ ok: true });
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'missing-input-validation');
    expect(f).toBeUndefined();
  });

  it('does NOT fire when parseInt is used', () => {
    const source = `
app.get('/items', (req: any, res: any) => {
  const limit = parseInt(req.query.limit);
  const items = db.getItems(limit);
  res.json(items);
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'missing-input-validation');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on non-HTTP handler functions', () => {
    const source = `
export function processData(data: string, config: object): void {
  console.log(data);
}
`;
    const report = reviewSource(source, 'utils.ts');
    const f = report.findings.find(f => f.ruleId === 'missing-input-validation');
    expect(f).toBeUndefined();
  });
});

// ── prototype-pollution ───────────────────────────────────────────────

describe('prototype-pollution', () => {
  it('detects Object.assign with req.body', () => {
    const source = `
export function updateSettings(req: any): object {
  const settings = { theme: 'light' };
  Object.assign(settings, req.body);
  return settings;
}
`;
    const report = reviewSource(source, 'settings.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('Object.assign');
  });

  it('detects spread from req.body', () => {
    const source = `
export function createUser(req: any): object {
  const user = { role: 'user', ...req.body };
  return user;
}
`;
    const report = reviewSource(source, 'users.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeDefined();
    expect(f!.message).toContain('Spread from user input');
  });

  it('detects merge() with JSON.parse', () => {
    const source = `
export function loadConfig(raw: string): object {
  const base = { debug: false };
  return merge(base, JSON.parse(raw));
}
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeDefined();
    expect(f!.message).toContain('merge');
  });

  it('detects _.defaultsDeep with user input', () => {
    const source = `
import _ from 'lodash';
export function applyDefaults(req: any): object {
  return _.defaultsDeep({}, req.body);
}
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeDefined();
  });

  it('does NOT fire on Object.assign with safe sources', () => {
    const source = `
export function mergeConfig(): object {
  const a = { x: 1 };
  const b = { y: 2 };
  return Object.assign(a, b);
}
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on spread from safe source', () => {
    const source = `
export function clone(config: { a: number }): object {
  return { ...config, b: 2 };
}
`;
    const report = reviewSource(source, 'config.ts');
    const f = report.findings.find(f => f.ruleId === 'prototype-pollution');
    expect(f).toBeUndefined();
  });
});

// ── information-exposure ──────────────────────────────────────────────

describe('information-exposure', () => {
  it('detects stack trace in response', () => {
    const source = `
app.get('/data', (req: any, res: any) => {
  try {
    doWork();
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('Stack trace');
  });

  it('detects raw error object in response', () => {
    const source = `
app.get('/data', (req: any, res: any) => {
  try {
    doWork();
  } catch (err: any) {
    res.status(500).json({ error: err });
  }
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('Raw error object');
  });

  it('detects process.env in response', () => {
    const source = `
app.get('/debug', (req: any, res: any) => {
  res.json({ env: process.env });
});
`;
    const report = reviewSource(source, 'debug.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeDefined();
    expect(f!.message).toContain('environment variable');
  });

  it('detects __dirname in response', () => {
    const source = `
app.get('/info', (req: any, res: any) => {
  res.json({ path: __dirname });
});
`;
    const report = reviewSource(source, 'info.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeDefined();
  });

  it('does NOT fire on err.message only (safe pattern)', () => {
    const source = `
app.get('/data', (req: any, res: any) => {
  try {
    doWork();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on generic error string', () => {
    const source = `
app.get('/data', (req: any, res: any) => {
  try {
    doWork();
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
`;
    const report = reviewSource(source, 'routes.ts');
    const f = report.findings.find(f => f.ruleId === 'information-exposure');
    expect(f).toBeUndefined();
  });
});
