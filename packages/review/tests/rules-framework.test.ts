import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const expressConfig: ReviewConfig = { target: 'express' };

describe('Express Rules', () => {
  // ── unvalidated-input ──

  describe('unvalidated-input', () => {
    it('detects req.body access without validation', () => {
      const source = `
import express from 'express';

const app = express();

app.post('/users', (req: any, res: any) => {
  const name = req.body.name;
  const email = req.body.email;
  res.json({ name, email });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const finding = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('does not flag when validation library is imported', () => {
      const source = `
import express from 'express';
import { z } from 'zod';

const userSchema = z.object({ name: z.string(), email: z.string().email() });

const app = express();

app.post('/users', (req: any, res: any) => {
  const data = userSchema.parse(req.body);
  res.json(data);
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const finding = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(finding).toBeUndefined();
    });
  });

  // ── sync-in-handler ──

  describe('sync-in-handler', () => {
    it('detects readFileSync in route handler', () => {
      const source = `
import express from 'express';
import { readFileSync } from 'fs';

const app = express();

app.get('/config', (req: any, res: any) => {
  const config = readFileSync('/etc/config.json', 'utf-8');
  res.json(JSON.parse(config));
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const finding = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('readFileSync');
    });
  });

  // ── missing-error-middleware ──

  describe('missing-error-middleware', () => {
    it('detects Express app without error handler', () => {
      const source = `
import express from 'express';

const app = express();

app.get('/', (req: any, res: any) => {
  res.json({ hello: 'world' });
});

app.listen(3000);
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const finding = report.findings.find(f => f.ruleId === 'missing-error-middleware');
      expect(finding).toBeDefined();
    });
  });
});

describe('Rule Layer Activation', () => {
  it('base rules always run', () => {
    const source = `
export function foo(): void {
  try {
    riskyOp();
  } catch (e) {
  }
}
function riskyOp(): void {}
`;
    // No target — base rules still apply. ignored-error (concept) suppresses empty-catch.
    const report = reviewSource(source, 'test.ts');
    const finding = report.findings.find(f => f.ruleId === 'ignored-error' || f.ruleId === 'empty-catch');
    expect(finding).toBeDefined();
  });

  it('react rules only run for react targets', () => {
    const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(async () => { await fetch('/api'); }, []);
  return null;
}
`;
    // No target → no react rules
    const report1 = reviewSource(source, 'comp.tsx');
    const reactRule1 = report1.findings.find(f => f.ruleId === 'async-effect');
    expect(reactRule1).toBeUndefined();

    // With web target → react rules active
    const report2 = reviewSource(source, 'comp.tsx', { target: 'web' });
    const reactRule2 = report2.findings.find(f => f.ruleId === 'async-effect');
    expect(reactRule2).toBeDefined();
  });
});
