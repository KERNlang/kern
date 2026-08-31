import { Project } from 'ts-morph';
import { reviewSource } from '../src/index.js';
import { buildInternalSinkMap } from '../src/taint-ast.js';

describe('AST-based Taint Analysis', () => {
  it('does not treat an object property name as an internal command sink value', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      '/helper.ts',
      `
function propertyName(env: string) { spawn('node', ['script'], { env: process.env }); }
function computedName(env: string) { spawn('node', ['script'], { [env]: process.env }); }
function shorthandValue(env: string) { spawn('node', ['script'], { env }); }
function propertyValue(env: string) { spawn('node', ['script'], { key: env }); }
`,
    );

    const sinks = buildInternalSinkMap(sourceFile);
    expect(sinks.has('propertyName')).toBe(false);
    for (const name of ['computedName', 'shorthandValue', 'propertyValue']) {
      expect(sinks.get(name)?.taintedParamIndices.has(0)).toBe(true);
    }
  });

  it('should detect simple taint flow from param to sink', () => {
    const source = `
      export function handler(req: any) {
        const cmd = req.body.command;
        exec(cmd);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    expect(taintFindings.length).toBeGreaterThan(0);
    expect(taintFindings[0].message).toContain('req (HTTP input)');
    expect(taintFindings[0].message).toContain('exec()');
  });

  it('should detect taint through destructuring', () => {
    const source = `
      export function handler(request: Request) {
        const { query } = request;
        const { id } = query;
        eval(id);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    expect(taintFindings.length).toBeGreaterThan(0);
    expect(taintFindings[0].message).toContain('request (HTTP input)');
    expect(taintFindings[0].message).toContain('eval()');
  });

  it('should handle sanitizers correctly', () => {
    const source = `
      export function handler(req: any) {
        const id = parseInt(req.query.id);
        db.query(\`SELECT * FROM users WHERE id = \${id}\`);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    // parseInt is sufficient for SQL injection on numeric IDs
    expect(taintFindings.length).toBe(0);
  });

  it('should detect insufficient sanitizers', () => {
    const source = `
      export function handler(req: any) {
        const cmd = parseInt(req.query.cmd);
        exec(cmd);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId === 'taint-insufficient-sanitizer');

    expect(taintFindings.length).toBe(1);
    expect(taintFindings[0].message).toContain("parseInt' does not protect against command injection");
  });

  // ── Arrow-callback coverage ──────────────────────────────────────────
  //
  // Express's most common handler shape passes the callback arrow directly
  // as an argument to `app.get(...)` / `app.post(...)`. Before the arrow-
  // callback walker, the taint engine only inspected top-level functions,
  // var-assigned arrows, and class methods — these inline arrows were
  // invisible. The cases below exercise different sink categories all
  // reached through the same handler shape.

  it('detects taint through Express inline arrow handler → res.redirect', () => {
    const source = `
import express from 'express';
const app = express();
app.get('/go', (req: any, res: any) => {
  res.redirect(req.query.url);
});
`;
    const report = reviewSource(source, 'routes.ts', { target: 'express' });
    const f = report.findings.find((f) => f.ruleId === 'taint-redirect');
    expect(f).toBeDefined();
  });

  it('detects taint through Express inline arrow handler → SQL template', () => {
    const source = `
import express from 'express';
const app = express();
app.post('/users', (req: any, res: any) => {
  db.query(\`SELECT * FROM users WHERE id = \${req.body.id}\`);
});
`;
    const report = reviewSource(source, 'routes.ts', { target: 'express' });
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('detects taint through router.use middleware arrow', () => {
    const source = `
import express from 'express';
const router = express.Router();
router.use((req: any, _res: any, _next: any) => {
  exec(req.headers['x-cmd']);
});
`;
    const report = reviewSource(source, 'mw.ts', { target: 'express' });
    const f = report.findings.find((f) => f.ruleId.startsWith('taint-'));
    expect(f).toBeDefined();
  });

  it('detects taint through deeply nested arrow inside an Express handler', () => {
    const source = `
import express from 'express';
const app = express();
app.post('/run', (req: any, _res: any) => {
  process.nextTick(() => {
    exec(req.body.cmd);
  });
});
`;
    const report = reviewSource(source, 'deep.ts', { target: 'express' });
    const f = report.findings.find((f) => f.ruleId.startsWith('taint-'));
    expect(f).toBeDefined();
  });

  it('does NOT fire when arrow callback receives a non-HTTP-typed param', () => {
    const source = `
const items = [1, 2, 3];
items.forEach((item) => {
  exec('echo ' + item);
});
`;
    const report = reviewSource(source, 'safe.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));
    expect(taintFindings).toHaveLength(0);
  });

  it('does NOT fire on non-HTTP callbacks where param is named req (Codex impl-review)', () => {
    // `queue.each((req) => …)` — `req` here is a queue request, not HTTP.
    // The route-handler gate must reject this without an HTTP type annotation.
    const source = `
declare const queue: { each(cb: (req: { command: string }) => void): void };
queue.each((req) => {
  exec(req.command);
});
`;
    const report = reviewSource(source, 'queue.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));
    expect(taintFindings).toHaveLength(0);
  });

  it('does NOT fire when an inner arrow shadows the outer tainted param (Gemini impl-review)', () => {
    // Outer's body walk previously matched `req` inside the inner arrow by
    // name even though the inner arrow's own param shadowed it. The
    // shadowing gate fixes this.
    const source = `
import express from 'express';
const app = express();
app.get('/safe', (req: any, res: any) => {
  const passthrough = (req: string) => exec(req);
  passthrough('ls -la');
});
`;
    const report = reviewSource(source, 'shadow.ts', { target: 'express' });
    // The inner arrow's exec(req) must not be flagged via outer's taint.
    // The outer's literal `req` body access is also not used in any sink here.
    const f = report.findings.find((f) => f.ruleId.startsWith('taint-'));
    expect(f).toBeUndefined();
  });

  it('still fires on closure capture when no shadowing occurs', () => {
    // Outer's `req` is captured by inner `process.nextTick` callback. Inner
    // does NOT shadow `req`, so the body walk legitimately finds the sink.
    const source = `
import express from 'express';
const app = express();
app.post('/run', (req: any, _res: any) => {
  process.nextTick(() => {
    exec(req.body.cmd);
  });
});
`;
    const report = reviewSource(source, 'closure.ts', { target: 'express' });
    const f = report.findings.find((f) => f.ruleId.startsWith('taint-'));
    expect(f).toBeDefined();
  });
});
