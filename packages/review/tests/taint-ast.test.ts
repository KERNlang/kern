import { reviewSource } from '../src/index.js';

describe('AST-based Taint Analysis', () => {
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

  it('distinguishes spawnSync argv data from executable and shell command injection', () => {
    const safeArgv = reviewSource(
      `
import { spawn } from 'node:child_process';
export function isolatedExecute(bytes, request, reply) {
  const node22 = process.env.KERN_NODE22 ?? process.execPath;
  const driver = './driver.mjs';
  const run = spawn(node22, [driver], { stdio: ['pipe', 'pipe', 'pipe'] });
  run.stdin.end(JSON.stringify({ request, reply }));
}
`,
      'safe-spawn.ts',
    );
    expect(safeArgv.findings.filter((f) => f.ruleId === 'taint-command')).toHaveLength(0);

    const taintedExecutable = reviewSource(
      `
import { spawn } from 'node:child_process';
export function isolatedExecute(request: Request) {
  spawn(request.headers.get('x-runtime')!, ['--version']);
}
`,
      'tainted-executable.ts',
    );
    expect(taintedExecutable.findings.some((f) => f.ruleId === 'taint-command')).toBe(true);

    const shellEnabled = reviewSource(
      `
import { spawnSync } from 'node:child_process';
export function isolatedExecute(request: Request) {
  spawnSync('/usr/bin/printf', [request.headers.get('x-value')!], { shell: true });
}
`,
      'shell-enabled.ts',
    );
    expect(shellEnabled.findings.some((f) => f.ruleId === 'taint-command')).toBe(true);
  });

  it('keeps interpreter code and ambiguous shell options command-tainted', () => {
    const dangerousSources = [
      `spawn('/bin/sh', ['-c', request.body.command])`,
      `spawnSync(process.execPath, ['--eval', request.body.code], { shell: false })`,
      `spawnSync('node', ['-e', request.body.code])`,
      `spawn('/usr/bin/printf', [request.body.value], { shell: false, shell: true })`,
      `spawn('/usr/bin/printf', [request.body.value], { ['shell']: true })`,
      `spawn('/usr/bin/printf', [request.body.value], { [request.query.option]: true })`,
      `spawn('/usr/bin/printf', [request.body.value], { get shell() { return true } })`,
      `spawn('/usr/bin/printf', [request.body.value], { shell: Boolean(request.query.shell) })`,
    ];

    for (const [index, call] of dangerousSources.entries()) {
      const report = reviewSource(
        `
import { spawn, spawnSync } from 'node:child_process';
export function handler(request: Request) {
  ${call};
}
`,
        `dangerous-command-${index}.ts`,
      );
      expect(report.findings.some((f) => f.ruleId === 'taint-command')).toBe(true);
    }
  });

  it('keeps ambiguous executables, forwarders, and execFile argv command-tainted', () => {
    const dangerousCalls = [
      `spawn(process.env.RUNTIME, ['./driver.mjs', request.body.value], { shell: false })`,
      `spawn('/usr/bin/env', ['node', './driver.mjs', request.body.value], { shell: false })`,
      `spawn('npx', ['tool', request.body.value], { shell: false })`,
      `spawn('ssh', ['host', request.body.value], { shell: false })`,
      `spawn('git', ['status', request.body.value], { shell: false })`,
      `execFile('/usr/bin/printf', [request.body.value], { shell: false })`,
      `execFileSync('/usr/bin/printf', [request.body.value])`,
      `execFile('/bin/sh', ['-c', request.body.command])`,
      `execFileSync(process.execPath, ['-e', request.body.code], { shell: false })`,
    ];
    for (const [index, call] of dangerousCalls.entries()) {
      const dangerous = reviewSource(
        `
import { execFile, execFileSync, spawn } from 'node:child_process';
export function handler(request: Request) {
  ${call};
}
`,
        `conservative-command-${index}.ts`,
      );
      expect(dangerous.findings.some((f) => f.ruleId === 'taint-command')).toBe(true);
    }
  });

  it('suppresses only direct Node data after a literal local JavaScript module', () => {
    const safeSources = [
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.argv[0], ['./driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
import { execPath as nodeExecPath } from 'node:process';
export function handler(request: Request) {
  spawn(nodeExecPath, ['./driver.js', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
import process from 'node:process';
export function handler(request: Request) {
  spawn(process.execPath, ['./driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
import * as process from 'node:process';
export function handler(request: Request) {
  spawn(process.argv[0], ['./driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn('/usr/bin/node', ['./driver.cjs', '-e', request.body.value], { shell: false });
}
`,
    ];
    for (const [index, source] of safeSources.entries()) {
      const report = reviewSource(source, `proven-node-data-${index}.ts`);
      expect(report.findings.filter((f) => f.ruleId === 'taint-command')).toHaveLength(0);
    }

    const dangerousSources = [
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.argv[0], ['-e', request.body.code], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
import { execPath as nodeExecPath } from 'node:process';
export function handler(request: Request) {
  spawn(nodeExecPath, ['--eval', request.body.code], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.execPath, ['--require', './hook.mjs', request.body.script], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.execPath, ['-r', './hook.mjs', request.body.script], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.execPath, ['--import', './hook.mjs', request.body.script], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  let script = './driver.mjs';
  script = './replacement.mjs';
  spawn(process.execPath, [script, request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  const runtime = process.execPath;
  spawn(runtime, ['./driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  let runtime = process.execPath;
  runtime = process.argv[0];
  spawn(runtime, ['./driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  let optionName = 'encoding';
  optionName = 'shell';
  spawn(process.execPath, ['./driver.mjs', request.body.value], { [optionName]: true });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.execPath, ['../driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request) {
  spawn(process.execPath, ['/tmp/driver.mjs', request.body.value], { shell: false });
}
`,
      `
import { spawn } from 'node:child_process';
export function handler(request: Request, process: { execPath: string }) {
  spawn(process.execPath, ['./driver.mjs', request.body.value], { shell: false });
}
`,
    ];
    for (const [index, source] of dangerousSources.entries()) {
      const report = reviewSource(source, `proven-node-code-${index}.ts`);
      expect(report.findings.some((f) => f.ruleId === 'taint-command')).toBe(true);
    }
  });
});
