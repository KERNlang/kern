import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const expressConfig: ReviewConfig = { target: 'express' };

describe('Express Rules', () => {
  // ── unvalidated-input ──────────────────────────────────────────────────

  describe('unvalidated-input', () => {
    it('detects req.body access without validation', () => {
      const source = `
import express from 'express';
const app = express();
app.post('/users', (req: any, res: any) => {
  const name = req.body.name;
  res.json({ name });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
    });

    it('detects req.params access without validation', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/users/:id', (req: any, res: any) => {
  const id = req.params.id;
  res.json({ id });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
    });

    it('detects req.query access without validation', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/search', (req: any, res: any) => {
  const q = req.query.q;
  res.json({ q });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
    });

    it('does not flag handler that uses .parse() on request data', () => {
      const source = `
import express from 'express';
import { z } from 'zod';
const userSchema = z.object({ name: z.string() });
const app = express();
app.post('/users', (req: any, res: any) => {
  const data = userSchema.parse(req.body);
  res.json(data);
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeUndefined();
    });

    it('still flags unvalidated handler even when another handler uses zod', () => {
      const source = `
import express from 'express';
import { z } from 'zod';
const userSchema = z.object({ name: z.string() });
const app = express();
app.post('/users', (req: any, res: any) => {
  const data = userSchema.parse(req.body);
  res.json(data);
});
app.post('/orders', (req: any, res: any) => {
  const item = req.body.item;
  res.json({ item });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
      expect(f!.message).toContain('req.body');
    });

    it('detects request.body when param is named request', () => {
      const source = `
import express from 'express';
const app = express();
app.post('/users', (request: any, response: any) => {
  const name = request.body.name;
  response.json({ name });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
      expect(f!.message).toContain('request.body');
    });

    it('detects destructured req.body without validation', () => {
      const source = `
import express from 'express';
const app = express();
app.post('/users', (req: any, res: any) => {
  const { name, email } = req.body;
  res.json({ name, email });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input' && f.message.includes('Destructured'));
      expect(f).toBeDefined();
    });

    it('still flags when JSON.parse is used (not a request validator)', () => {
      const source = `
import express from 'express';
const app = express();
app.post('/data', (req: any, res: any) => {
  const raw = req.body.data;
  const parsed = JSON.parse(raw);
  res.json(parsed);
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeDefined();
    });

    it('does not flag when handler uses .validate()', () => {
      const source = `
import express from 'express';
const app = express();
app.post('/users', (req: any, res: any) => {
  const result = schema.validate(req.body);
  res.json(result);
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'unvalidated-input');
      expect(f).toBeUndefined();
    });
  });

  // ── missing-error-middleware ────────────────────────────────────────────

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
      const f = report.findings.find(f => f.ruleId === 'missing-error-middleware');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('does not flag when 4-param error middleware exists', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/', (req: any, res: any) => {
  res.json({ hello: 'world' });
});
app.use((err: any, req: any, res: any, next: any) => {
  res.status(500).json({ error: err.message });
});
app.listen(3000);
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-error-middleware');
      expect(f).toBeUndefined();
    });

    it('does not flag when errorHandler is referenced', () => {
      const source = `
import express from 'express';
import { errorHandler } from './middleware';
const app = express();
app.get('/', (req: any, res: any) => { res.json({}); });
app.use(errorHandler);
app.listen(3000);
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-error-middleware');
      expect(f).toBeUndefined();
    });

    it('does not flag files without express() call', () => {
      const source = `
import { Router } from 'express';
const router = Router();
router.get('/', (req: any, res: any) => { res.json({}); });
export default router;
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-error-middleware');
      expect(f).toBeUndefined();
    });
  });

  // ── sync-in-handler ────────────────────────────────────────────────────

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
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeDefined();
      expect(f!.message).toContain('readFileSync');
    });

    it('detects writeFileSync in route handler', () => {
      const source = `
import express from 'express';
import { writeFileSync } from 'fs';
const app = express();
app.post('/save', (req: any, res: any) => {
  writeFileSync('/tmp/data.json', JSON.stringify(req.body));
  res.json({ ok: true });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeDefined();
      expect(f!.message).toContain('writeFileSync');
    });

    it('detects crypto sync operations', () => {
      const source = `
import express from 'express';
import crypto from 'crypto';
const app = express();
app.post('/hash', (req: any, res: any) => {
  const hash = crypto.pbkdf2Sync('password', 'salt', 100000, 64, 'sha512');
  res.json({ hash: hash.toString('hex') });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeDefined();
      expect(f!.message).toContain('pbkdf2Sync');
    });

    it('does not flag files without route handlers', () => {
      const source = `
import { readFileSync } from 'fs';
const config = readFileSync('/etc/config.json', 'utf-8');
export default JSON.parse(config);
`;
      const report = reviewSource(source, 'config.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeUndefined();
    });

    it('detects fs.readFileSync() namespace call in handler', () => {
      const source = `
import express from 'express';
import * as fs from 'fs';
const app = express();
app.get('/config', (req: any, res: any) => {
  const data = fs.readFileSync('/etc/config.json', 'utf-8');
  res.json(JSON.parse(data));
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeDefined();
      expect(f!.message).toContain('readFileSync');
    });

    it('does not flag module-scope sync ops in a route file', () => {
      const source = `
import express from 'express';
import { readFileSync } from 'fs';
const config = JSON.parse(readFileSync('/etc/config.json', 'utf-8'));
const app = express();
app.get('/config', (req: any, res: any) => {
  res.json(config);
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'sync-in-handler');
      expect(f).toBeUndefined();
    });
  });

  // ── double-response ────────────────────────────────────────────────────

  describe('double-response', () => {
    it('detects double res.json() without return', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/users/:id', (req: any, res: any) => {
  if (!req.params.id) {
    res.status(400).json({ error: 'missing id' });
  }
  res.json({ id: req.params.id });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'double-response');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
    });

    it('does not flag when return follows first response', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/users/:id', (req: any, res: any) => {
  if (!req.params.id) {
    res.status(400).json({ error: 'missing id' });
    return;
  }
  res.json({ id: req.params.id });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'double-response');
      expect(f).toBeUndefined();
    });

    it('detects double response with res.send and res.end', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/data', (req: any, res: any) => {
  res.send('hello');
  res.end();
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'double-response');
      expect(f).toBeDefined();
    });

    it('does not flag single response in handler', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/health', (req: any, res: any) => {
  res.json({ status: 'ok' });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'double-response');
      expect(f).toBeUndefined();
    });

    it('does not flag response in nested callback', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/data', (req: any, res: any) => {
  fetchData((err: any, data: any) => {
    if (err) { res.status(500).json({ error: err }); return; }
    res.json(data);
  });
});
`;
      const report = reviewSource(source, 'routes.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'double-response');
      expect(f).toBeUndefined();
    });
  });

  // ── express-missing-next ───────────────────────────────────────────────

  describe('express-missing-next', () => {
    it('detects middleware that neither calls next() nor sends response', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  console.log('request received');
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
      expect(f!.message).toContain('hang');
    });

    it('does not flag middleware that calls next()', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  console.log('request received');
  next();
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });

    it('does not flag middleware that unconditionally sends a response', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  res.status(200).json({ status: 'ok' });
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });

    it('does not flag when response param is named "response"', () => {
      const source = `
import express from 'express';
const app = express();
app.use((request: any, response: any, next: any) => {
  response.status(403).json({ error: 'forbidden' });
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });

    it('flags conditional throw without next on other path (warning)', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  if (!req.headers.authorization) throw new Error('unauthorized');
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('does not flag middleware that unconditionally throws', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  throw new Error('not implemented');
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });

    it('flags middleware where response is only in one branch (conditional hang)', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'unauthorized' });
  }
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
      expect(f!.message).toContain('conditional');
    });

    it('does not flag middleware with response in if and next in else', () => {
      const source = `
import express from 'express';
const app = express();
app.use((req: any, res: any, next: any) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'unauthorized' });
  } else {
    next();
  }
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });

    it('does not flag 2-param route handlers (no next param)', () => {
      const source = `
import express from 'express';
const app = express();
app.get('/health', (req: any, res: any) => {
  console.log('health check');
});
`;
      const report = reviewSource(source, 'app.ts', expressConfig);
      const f = report.findings.find(f => f.ruleId === 'express-missing-next');
      expect(f).toBeUndefined();
    });
  });
});
