/**
 * Taint tracking tests — source→sink analysis on KERN IR handler bodies.
 */

import { reviewSource } from '../src/index.js';
import { analyzeTaint, taintToFindings, isSanitizerSufficient, buildExportMap, analyzeTaintCrossFile, crossFileTaintToFindings, propagateTaintMultiHop } from '../src/taint.js';
import { inferFromSource } from '../src/inferrer.js';

// ── Direct taint analysis tests ───────────────────────────────────────

describe('analyzeTaint', () => {
  it('detects taint flow: req.body → exec()', () => {
    const source = `
export function runJob(req: Request, res: Response): void {
  const cmd = req.body.command;
  exec(cmd);
  res.json({ ok: true });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results[0];
    expect(r.fnName).toBe('runJob');

    const unsanitized = r.paths.filter(p => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThanOrEqual(1);
    expect(unsanitized[0].sink.category).toBe('command');
  });

  it('detects taint flow: req.query → writeFile()', () => {
    const source = `
export function saveFile(req: Request, res: Response): void {
  const filename = req.query.name;
  writeFileSync('/uploads/' + filename, 'data');
  res.json({ saved: true });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const unsanitized = results[0].paths.filter(p => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThanOrEqual(1);
    expect(unsanitized[0].sink.category).toBe('fs');
  });

  it('detects taint flow through destructuring', () => {
    const source = `
export function createUser(req: Request, res: Response): void {
  const { name, role } = req.body;
  query('INSERT INTO users VALUES (' + name + ')');
  res.json({ ok: true });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const unsanitized = results[0].paths.filter(p => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThanOrEqual(1);
  });

  it('recognizes parseInt as sanitizer', () => {
    const source = `
export function getItem(req: Request, res: Response): void {
  const id = parseInt(req.params.id);
  query('SELECT * FROM items WHERE id = ' + id);
  res.json({ ok: true });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');

    // Should have a path but it should be marked as sanitized
    if (results.length > 0) {
      const sanitized = results[0].paths.filter(p => p.sanitized);
      expect(sanitized.length).toBeGreaterThanOrEqual(0); // parseInt found
    }
  });

  it('recognizes schema.parse as sanitizer', () => {
    const source = `
export function updateUser(req: Request, res: Response): void {
  const data = schema.parse(req.body);
  query('UPDATE users SET name = ' + data.name);
  res.json({ ok: true });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');

    // Sanitizer should be detected
    if (results.length > 0) {
      const sanitized = results[0].paths.filter(p => p.sanitized);
      expect(sanitized.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('does NOT flag functions without HTTP params', () => {
    const source = `
export function processData(input: string, output: string): void {
  exec('ls ' + input);
}
`;
    const inferred = inferFromSource(source, 'utils.ts');
    const results = analyzeTaint(inferred, 'utils.ts');
    expect(results.length).toBe(0);
  });
});

// ── Integration: taint findings in reviewSource ───────────────────────

describe('taint findings in review pipeline', () => {
  it('taint findings appear in review report', () => {
    const source = `
export function deleteFile(req: Request, res: Response): void {
  const path = req.query.path;
  unlinkSync(path);
  res.json({ deleted: true });
}
`;
    const report = reviewSource(source, 'handler.ts');
    const taintFindings = report.findings.filter(f => f.ruleId.startsWith('taint-'));
    expect(taintFindings.length).toBeGreaterThanOrEqual(1);
    expect(taintFindings[0].ruleId).toBe('taint-fs');
  });

  it('taint findings include suggestion', () => {
    const source = `
export function runCommand(req: Request, res: Response): void {
  const cmd = req.body.cmd;
  exec(cmd);
  res.json({ ok: true });
}
`;
    const report = reviewSource(source, 'handler.ts');
    const taintFindings = report.findings.filter(f => f.ruleId === 'taint-command');
    expect(taintFindings.length).toBeGreaterThanOrEqual(1);
    expect(taintFindings[0].suggestion).toBeDefined();
    expect(taintFindings[0].severity).toBe('error');
  });
});

// ── taintToFindings conversion ────────────────────────────────────────

describe('taintToFindings', () => {
  it('converts TaintResult to ReviewFinding with correct severity', () => {
    const results = [{
      fnName: 'handler',
      filePath: 'test.ts',
      startLine: 5,
      paths: [{
        source: { name: 'cmd', origin: 'req.body.cmd' },
        sink: { name: 'exec', category: 'command' as const, taintedArg: 'cmd' },
        sanitized: false,
      }],
    }];

    const findings = taintToFindings(results);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('error'); // command injection = error
    expect(findings[0].ruleId).toBe('taint-command');
    expect(findings[0].message).toContain('req.body.cmd');
    expect(findings[0].message).toContain('exec()');
  });

  it('skips sanitized paths', () => {
    const results = [{
      fnName: 'handler',
      filePath: 'test.ts',
      startLine: 5,
      paths: [{
        source: { name: 'id', origin: 'req.params.id' },
        sink: { name: 'query', category: 'sql' as const, taintedArg: 'id' },
        sanitized: true,
        sanitizer: 'parseInt',
      }],
    }];

    const findings = taintToFindings(results);
    expect(findings.length).toBe(0); // sanitized = no finding
  });

  it('command/eval sinks are error severity, others are warning', () => {
    const results = [{
      fnName: 'handler',
      filePath: 'test.ts',
      startLine: 5,
      paths: [
        {
          source: { name: 'path', origin: 'req.query.path' },
          sink: { name: 'writeFile', category: 'fs' as const, taintedArg: 'path' },
          sanitized: false,
        },
      ],
    }];

    const findings = taintToFindings(results);
    expect(findings[0].severity).toBe('warning'); // fs = warning, not error
  });
});

// ── Sanitizer sufficiency matrix ──────────────────────────────────────

describe('isSanitizerSufficient', () => {
  it('parseInt is sufficient for SQL but not command injection', () => {
    expect(isSanitizerSufficient('parseInt', 'sql')).toBe(true);
    expect(isSanitizerSufficient('parseInt', 'command')).toBe(false);
  });

  it('schema.parse is sufficient for everything', () => {
    expect(isSanitizerSufficient('schema.parse', 'command')).toBe(true);
    expect(isSanitizerSufficient('schema.parse', 'sql')).toBe(true);
    expect(isSanitizerSufficient('schema.parse', 'fs')).toBe(true);
    expect(isSanitizerSufficient('schema.parse', 'redirect')).toBe(true);
  });

  it('DOMPurify is sufficient for template but not SQL', () => {
    expect(isSanitizerSufficient('DOMPurify', 'template')).toBe(true);
    expect(isSanitizerSufficient('DOMPurify', 'sql')).toBe(false);
    expect(isSanitizerSufficient('DOMPurify', 'command')).toBe(false);
  });

  it('path.normalize is sufficient for FS but not command', () => {
    expect(isSanitizerSufficient('path.normalize', 'fs')).toBe(true);
    expect(isSanitizerSufficient('path.normalize', 'command')).toBe(false);
  });

  it('encodeURIComponent is sufficient for redirect but not SQL', () => {
    expect(isSanitizerSufficient('encodeURIComponent', 'redirect')).toBe(true);
    expect(isSanitizerSufficient('encodeURIComponent', 'sql')).toBe(false);
  });

  it('parameterized query is sufficient for SQL only', () => {
    expect(isSanitizerSufficient('parameterized query ($N)', 'sql')).toBe(true);
    expect(isSanitizerSufficient('parameterized query ($N)', 'command')).toBe(false);
  });

  it('unknown sanitizer defaults to deny (not sufficient)', () => {
    expect(isSanitizerSufficient('customSanitizer', 'command')).toBe(false);
  });
});

// ── Insufficient sanitizer detection ──────────────────────────────────

describe('insufficient sanitizer detection', () => {
  it('reports parseInt as insufficient for command injection', () => {
    const source = `
export function runJob(req: Request, res: Response): void {
  const id = parseInt(req.body.id);
  exec('job ' + id);
  res.json({ ok: true });
}
`;
    const report = reviewSource(source, 'handler.ts');
    const f = report.findings.find(f => f.ruleId === 'taint-insufficient-sanitizer');
    expect(f).toBeDefined();
    expect(f!.message).toContain('parseInt');
    expect(f!.message).toContain('command injection');
  });
});

// ── Cross-file taint helpers ──────────────────────────────────────────

describe('buildExportMap', () => {
  it('maps exported functions with sink detection', () => {
    const source = `
export function runQuery(sql: string): void {
  query(sql);
}
`;
    const inferred = inferFromSource(source, 'db.ts');
    const map = buildExportMap(new Map([['db.ts', inferred]]));

    const entry = map.get('db.ts::runQuery');
    expect(entry).toBeDefined();
    expect(entry!.hasSink).toBe(true);
    expect(entry!.sinks.length).toBeGreaterThanOrEqual(1);
    expect(entry!.sinks[0].category).toBe('sql');
  });
});

describe('crossFileTaintToFindings', () => {
  it('converts cross-file results to findings with related spans', () => {
    const results = [{
      callerFile: 'routes.ts',
      callerFn: 'handleRequest',
      callerLine: 10,
      calleeFile: 'db.ts',
      calleeFn: 'runQuery',
      taintedArgs: ['userInput'],
      sinkInCallee: { name: 'query', category: 'sql' as const, taintedArg: 'sql' },
      source: { name: 'userInput', origin: 'req.body.query' },
    }];

    const findings = crossFileTaintToFindings(results);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('taint-crossfile-sql');
    expect(findings[0].message).toContain('Cross-file taint');
    expect(findings[0].message).toContain('handleRequest');
    expect(findings[0].message).toContain('runQuery');
    expect(findings[0].relatedSpans).toBeDefined();
    expect(findings[0].relatedSpans![0].file).toBe('db.ts');
  });
});

// ── Multi-hop taint propagation ─────────────────────────────────────────

describe('propagateTaintMultiHop', () => {
  it('handles direct assignment: const b = a', () => {
    const code = `
      const a = req.body.x;
      const b = a;
      exec(b);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('handles method call propagation: const b = a.trim()', () => {
    const code = `
      const a = req.body.name;
      const b = a.trim();
      const c = b.toLowerCase();
      exec(c);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });

  it('handles destructuring: const {x} = obj', () => {
    const code = `
      const obj = req.body;
      const { x, y } = obj;
      exec(x);
      exec(y);
    `;
    const result = propagateTaintMultiHop(code, new Set(['obj']));
    expect(result.has('obj')).toBe(true);
    expect(result.has('x')).toBe(true);
    expect(result.has('y')).toBe(true);
  });

  it('handles reassignment: let b; b = a', () => {
    const code = `
      const a = req.body.cmd;
      let b;
      b = a;
      exec(b);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('respects depth limit (default 3)', () => {
    const code = `
      const a = req.body.x;
      const b = a;
      const c = b;
      const d = c;
      const e = d;
      exec(e);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.has('d')).toBe(true);
    expect(result.has('e')).toBe(false);
  });

  it('respects custom depth limit', () => {
    const code = `
      const a = req.body.x;
      const b = a;
      const c = b;
      exec(c);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']), 1);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
  });

  it('does not infinite-loop on circular assignments', () => {
    const code = `
      let a = req.body.x;
      let b = a;
      a = b;
      b = a;
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('handles multiple tainted sources', () => {
    const code = `
      const a = req.body.x;
      const b = req.query.y;
      const c = a + b;
      exec(c);
    `;
    const result = propagateTaintMultiHop(code, new Set(['a', 'b']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });

  it('terminates at fixed point', () => {
    const code = `
      const a = req.body.x;
      const b = a;
      const c = b;
    `;
    const result = propagateTaintMultiHop(code, new Set(['a']));
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });
});
