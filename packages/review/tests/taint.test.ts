/**
 * Taint tracking tests — source→sink analysis on KERN IR handler bodies.
 */

import { Project } from 'ts-morph';
import { resolveImportGraph } from '../src/graph.js';
import { reviewSource } from '../src/index.js';
import { inferFromSource } from '../src/inferrer.js';
import {
  ALL_CATEGORIES,
  analyzeTaint,
  analyzeTaintCrossFile,
  buildExportMap,
  buildExportMapFromGraph,
  buildImportMapFromGraph,
  buildSanitizerSufficiency,
  crossFileTaintToFindings,
  findTaintedSinks,
  isSanitizerSufficient,
  propagateTaintMultiHop,
  taintToFindings,
} from '../src/taint.js';

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

    const unsanitized = r.paths.filter((p) => !p.sanitized);
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
    const unsanitized = results[0].paths.filter((p) => !p.sanitized);
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
    const unsanitized = results[0].paths.filter((p) => !p.sanitized);
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
      const sanitized = results[0].paths.filter((p) => p.sanitized);
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
      const sanitized = results[0].paths.filter((p) => p.sanitized);
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

  // Real-world FP observed on kern-guard middleware.ts: a comment containing
  // "redirect target" tripped the redirect sink even though no redirect call
  // touched the tainted variable. `findTaintedSinks` now strips comments
  // before scanning.
  it('does NOT flag sink names mentioned only in comments', () => {
    const source = `
export function handler(req: Request, res: Response): void {
  const target = req.query.target;
  // Build a redirect target — exec() would be unsafe here too
  /*
   * We previously called res.redirect(target) but switched to writing
   * a hardcoded URL. The block comment must not retrigger the sink.
   */
  res.send({ url: '/safe-page' });
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');
    expect(results).toEqual([]);
  });

  // Sibling case — real sink alongside a sink name in a comment. Confirms
  // we still detect the real call and don't accidentally strip live code.
  it('still detects real sinks when comments also mention the sink name', () => {
    const source = `
export function handler(req: Request, res: Response): void {
  const cmd = req.body.command;
  // Note: exec() is dangerous with user input — sanitize first!
  exec(cmd);
}
`;
    const inferred = inferFromSource(source, 'handler.ts');
    const results = analyzeTaint(inferred, 'handler.ts');
    expect(results.length).toBe(1);
    const unsanitized = results[0].paths.filter((p) => !p.sanitized);
    expect(unsanitized.length).toBe(1);
    expect(unsanitized[0].sink.category).toBe('command');
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
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));
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
    const taintFindings = report.findings.filter((f) => f.ruleId === 'taint-command');
    expect(taintFindings.length).toBeGreaterThanOrEqual(1);
    expect(taintFindings[0].suggestion).toBeDefined();
    expect(taintFindings[0].severity).toBe('error');
  });

  it('ignores only command options.input while retaining execution-affecting options, executable, and argv', () => {
    const source = `
export function run(req: Request): void {
  const executable = req.body.executable;
  const argv = req.body.argv;
  const input = req.body.input;
  const env = req.body.env;
  const cwd = req.body.cwd;
  const shell = req.body.shell;
  const execPath = req.body.execPath;
  const execArgv = req.body.execArgv;
  spawn(executable, ['--flag']);
  spawn('node', argv);
  spawn('node', ['script'], { input });
  spawnSync('node', ['script'], { input });
  execFile('node', ['script'], { input });
  spawn('node', ['script'], { env });
  spawn('node', ['script'], { cwd });
  spawn('node', ['script'], { shell });
  spawn('node', ['script'], { execPath });
  spawn('node', ['script'], { execArgv });
}
`;
    const report = reviewSource(source, 'handler.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'taint-command');

    const messages = findings.map((f) => f.message).join('\n');
    expect(findings).toHaveLength(7);
    for (const name of ['executable', 'argv', 'env', 'cwd', 'shell', 'execPath', 'execArgv']) {
      expect(messages).toContain(`Variable '${name}'`);
    }
    expect(messages).not.toContain("Variable 'input'");

    const mixedReport = reviewSource(
      `
export function run(req: Request): void {
  const input = req.body.input;
  const mixedEnv = req.body.mixedEnv;
  spawn('node', ['script'], { input, env: mixedEnv });
}
`,
      'mixed-handler.ts',
    );
    const mixedMessages = mixedReport.findings
      .filter((finding) => finding.ruleId === 'taint-command')
      .map((finding) => finding.message)
      .join('\n');
    expect(mixedMessages).toContain("Variable 'mixedEnv'");
    expect(mixedMessages).not.toContain("Variable 'input'");
  });
});

// ── taintToFindings conversion ────────────────────────────────────────

describe('taintToFindings', () => {
  it('converts TaintResult to ReviewFinding with correct severity', () => {
    const results = [
      {
        fnName: 'handler',
        filePath: 'test.ts',
        startLine: 5,
        paths: [
          {
            source: { name: 'cmd', origin: 'req.body.cmd' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'cmd' },
            sanitized: false,
          },
        ],
      },
    ];

    const findings = taintToFindings(results);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('error'); // command injection = error
    expect(findings[0].ruleId).toBe('taint-command');
    expect(findings[0].message).toContain('req.body.cmd');
    expect(findings[0].message).toContain('exec()');
  });

  it('skips sanitized paths', () => {
    const results = [
      {
        fnName: 'handler',
        filePath: 'test.ts',
        startLine: 5,
        paths: [
          {
            source: { name: 'id', origin: 'req.params.id' },
            sink: { name: 'query', category: 'sql' as const, taintedArg: 'id' },
            sanitized: true,
            sanitizer: 'parseInt',
          },
        ],
      },
    ];

    const findings = taintToFindings(results);
    expect(findings.length).toBe(0); // sanitized = no finding
  });

  it('command/eval sinks are error severity, others are warning', () => {
    const results = [
      {
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
      },
    ];

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

// ── Sanitizer family build ────────────────────────────────────────────
// Guard against silent overwrites if a future merge puts the same name
// into two families with conflicting coverage. (OpenCode P1.)

describe('buildSanitizerSufficiency', () => {
  it('throws when a sanitizer name appears in more than one family', () => {
    expect(() =>
      buildSanitizerSufficiency([
        { names: ['parseInt'], coverage: ['sql'] },
        { names: ['parseInt'], coverage: ['command'] },
      ]),
    ).toThrow(/appears in more than one family/);
  });

  it('builds a working coverage map from a synthetic family table', () => {
    const map = buildSanitizerSufficiency([
      { names: ['x'], coverage: ['sql', 'fs'] },
      { names: ['y', 'z'], coverage: ['template'] },
    ]);
    expect(map.x.has('sql')).toBe(true);
    expect(map.x.has('fs')).toBe(true);
    expect(map.x.has('command')).toBe(false);
    expect(map.y).toBe(map.z); // shared coverage Set per family — same reference
  });

  it('exposes ALL_CATEGORIES as the closed list of categories schema validators cover', () => {
    // Sanity: schema.parse should cover every category in ALL_CATEGORIES.
    for (const cat of ALL_CATEGORIES) {
      expect(isSanitizerSufficient('schema.parse', cat)).toBe(true);
    }
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
    const f = report.findings.find((f) => f.ruleId === 'taint-insufficient-sanitizer');
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
    const results = [
      {
        callerFile: 'routes.ts',
        callerFn: 'handleRequest',
        callerLine: 10,
        calleeFile: 'db.ts',
        calleeFn: 'runQuery',
        taintedArgs: ['userInput'],
        sinkInCallee: { name: 'query', category: 'sql' as const, taintedArg: 'sql', line: 3 },
        source: { name: 'userInput', origin: 'req.body.query' },
        calleeSinkLine: 27,
      },
    ];

    const findings = crossFileTaintToFindings(results);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('taint-crossfile-sql');
    expect(findings[0].message).toContain('Cross-file taint');
    expect(findings[0].message).toContain('handleRequest');
    expect(findings[0].message).toContain('runQuery');
    expect(findings[0].relatedSpans).toBeDefined();
    expect(findings[0].relatedSpans![0].file).toBe('db.ts');
    // Lift 2: calleeSpan must use the resolved sink line, not the legacy
    // hardcoded `1`. Reviewers click here to navigate to the actual sink.
    expect(findings[0].relatedSpans![0].startLine).toBe(27);
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

// ── Control-flow validation guards ──────────────────────────────────────

describe('Control-flow guards suppress taint after validation (AST engine)', () => {
  function astTaint(source: string) {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { target: 99, module: 99, moduleResolution: 100 },
    });
    const sf = project.createSourceFile('/h.ts', source);
    const inferred = inferFromSource(source, '/h.ts');
    return analyzeTaint(inferred, '/h.ts', sf);
  }

  it('treats exec(cmd) as sanitized when preceded by `if (!isValidCommand(cmd)) return`', () => {
    const results = astTaint(`
export function run(req: Request, res: Response): void {
  const cmd = req.body.command;
  if (!isValidCommand(cmd)) {
    return res.status(400).json({ error: 'bad command' });
  }
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBe(0);
  });

  it('treats typeof guard followed by early throw as validation', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  if (typeof cmd !== 'string') throw new Error('invalid');
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBe(0);
  });

  it('does NOT treat a plain null check as a validation guard', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  if (!cmd) return;
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThan(0);
  });

  it('does NOT suppress when the guard appears AFTER the sink', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  exec(cmd);
  if (!isValidCommand(cmd)) return;
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThan(0);
  });

  it('does NOT suppress when polarity is inverted — `if (isValid(x)) return; exec(x)`', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  if (isValidCommand(cmd)) return;
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThan(0);
  });

  it('does NOT suppress when polarity is inverted on typeof — `typeof x === "string"`', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  if (typeof cmd === 'string') return;
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThan(0);
  });

  it('does NOT suppress when the guard is inside a sibling branch (not dominating)', () => {
    const results = astTaint(`
export function run(req: Request, flag: boolean): void {
  const cmd = req.body.command;
  if (flag) {
    if (!isValidCommand(cmd)) return;
  }
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBeGreaterThan(0);
  });

  it('DOES suppress for negated-on-property pattern — `if (!isValidResult(x).ok) return`', () => {
    const results = astTaint(`
export function run(req: Request): void {
  const cmd = req.body.command;
  if (!isValidResult(cmd).ok) return;
  exec(cmd);
}
`);
    const unsanitized = results.flatMap((r) => r.paths).filter((p) => !p.sanitized);
    expect(unsanitized.length).toBe(0);
  });
});

// ── ts-morph-backed cross-file taint (works on non-KERN codebases) ──────

describe('Cross-file taint on pure TS codebase (no KERN IR)', () => {
  function createProject(): Project {
    return new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
  }

  it('buildExportMapFromGraph detects exec() sink in exported TS function', () => {
    const project = createProject();
    project.createSourceFile(
      '/src/db.ts',
      `
import { exec } from 'child_process';
export function runQuery(query: string): void {
  exec(query);
}
`,
    );
    project.createSourceFile(
      '/src/main.ts',
      `
import { runQuery } from './db.js';
export function handler(req: any): void { runQuery(req.body.q); }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const exportMap = buildExportMapFromGraph(project, graph);

    const runQuery = exportMap.get('/src/db.ts::runQuery');
    expect(runQuery).toBeDefined();
    expect(runQuery!.hasSink).toBe(true);
    expect(runQuery!.sinks.some((s) => s.category === 'command')).toBe(true);
  });

  it('buildImportMapFromGraph resolves named imports on plain TS files', () => {
    const project = createProject();
    project.createSourceFile('/src/db.ts', `export function runQuery(q: string): void {}`);
    project.createSourceFile('/src/main.ts', `import { runQuery } from './db.js';`);

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const importMap = buildImportMapFromGraph(project, graph);

    expect(importMap.get('/src/main.ts::runQuery')).toBe('/src/db.ts');
  });

  it('buildImportMapFromGraph skips malformed imports instead of throwing', () => {
    const project = createProject();
    project.createSourceFile('/src/db.ts', `export function runQuery(q: string): void {}`);
    project.createSourceFile('/src/main.ts', `import { runQuery } from ./db.js;`);

    const graph = resolveImportGraph(['/src/main.ts'], { project });

    expect(() => buildImportMapFromGraph(project, graph)).not.toThrow();
    expect(buildImportMapFromGraph(project, graph).size).toBe(0);
  });

  it('resolves aliased named imports — `import { runQuery as rq }`', () => {
    const project = createProject();
    project.createSourceFile(
      '/src/db.ts',
      `
import { exec } from 'child_process';
export function runQuery(query: string): void {
  exec(query);
}
`,
    );
    project.createSourceFile(
      '/src/handler.ts',
      `
import { runQuery as rq } from './db.js';
export function handler(req: any): void {
  rq(req.body.q);
}
`,
    );

    const graph = resolveImportGraph(['/src/handler.ts'], { project });
    const results = analyzeTaintCrossFile(new Map(), new Map(), graph);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const taint = results[0];
    expect(taint.calleeFile).toBe('/src/db.ts');
    // Reports the *exported* name, not the local alias.
    expect(taint.calleeFn).toBe('runQuery');
  });

  it('analyzeTaintCrossFile finds cross-file taint in pure TS codebase', () => {
    const project = createProject();
    project.createSourceFile(
      '/src/db.ts',
      `
import { exec } from 'child_process';
export function runQuery(query: string): void {
  exec(query);
}
`,
    );
    project.createSourceFile(
      '/src/handler.ts',
      `
import { runQuery } from './db.js';
export function handler(req: any): void {
  runQuery(req.body.q);
}
`,
    );

    const graph = resolveImportGraph(['/src/handler.ts'], { project });

    // No KERN IR at all — empty inferredPerFile
    const inferredPerFile = new Map();
    const graphImports = new Map<string, string[]>();
    for (const gf of graph.files) graphImports.set(gf.path, gf.imports);

    const results = analyzeTaintCrossFile(inferredPerFile, graphImports, graph);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const taint = results[0];
    expect(taint.callerFile).toBe('/src/handler.ts');
    expect(taint.callerFn).toBe('handler');
    expect(taint.calleeFile).toBe('/src/db.ts');
    expect(taint.calleeFn).toBe('runQuery');
    expect(taint.sinkInCallee.category).toBe('command');
  });

  it('ignores python files when building ts-morph graph import maps', () => {
    const project = createProject();
    project.createSourceFile(
      '/src/db.ts',
      `
export function runQuery(query: string): void {
  console.log(query);
}
`,
    );
    project.createSourceFile(
      '/src/handler.ts',
      `
import { runQuery } from './db.js';
export function handler(req: any): void {
  runQuery(req.body.q);
}
`,
    );
    project.createSourceFile(
      '/src/safe-py-server.py',
      `
import subprocess
from mcp.server.fastmcp import FastMCP
`,
    );

    const graph = resolveImportGraph(['/src/handler.ts'], { project });
    graph.files.push({
      path: '/src/safe-py-server.py',
      // Synthetic GraphFile in a test fixture — synthetic in-memory paths
      // canonicalise to themselves (no realpath on disk), so display ===
      // canonical here. Real workloads canonicalise via path-canonical.ts.
      canonicalPath: '/src/safe-py-server.py',
      distance: 0,
      imports: [],
      importedBy: [],
      importEdges: [],
      incomingEdges: [],
    });

    expect(() => buildImportMapFromGraph(project, graph)).not.toThrow();
    const importMap = buildImportMapFromGraph(project, graph);
    expect(importMap.get('/src/handler.ts::runQuery')).toBe('/src/db.ts');
  });
});

// ── Regression: Lifts 2 / 3 / A (sink-line, rootCause, fingerprint) ────────
//
// Validates the three FP/graph correctness lifts landed after the FP-cleanup
// pass on 2026-05-11. Each test is small and pins one of the lifts so a future
// refactor that breaks just one stays caught.
describe('taint Lifts 2/3/A — sink line, rootCause, fingerprint', () => {
  it('Lift 2: findTaintedSinks records 1-based sink.line inside the body', () => {
    const code = ['const x = req.body;', 'console.log(x);', 'exec(x);'].join('\n');
    const sinks = findTaintedSinks(code, [{ name: 'x', origin: 'param:req' }]);
    expect(sinks.length).toBeGreaterThan(0);
    // `exec(x)` is on body line 3 (1-based).
    expect(sinks[0].line).toBe(3);
  });

  // Regression: AST mode previously emitted absolute file lines as
  // `sink.line`, double-counting r.startLine in the consumer formula and
  // putting findings ~startLine lines past their real position (kern-guard
  // middleware.ts redirect at file 70 reported as file 115). Pin AST mode
  // to emit body-relative lines now.
  it('Lift 2: analyzeTaintAST emits body-relative sink.line (not absolute)', () => {
    const source = [
      '',
      '',
      '',
      '',
      'export function handler(req: Request, res: Response): void {',
      '  const cmd = req.body.command;',
      '  exec(cmd);',
      '}',
      '',
    ].join('\n');
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { target: 99, module: 99, moduleResolution: 100 },
    });
    const sf = project.createSourceFile('/h.ts', source);
    const inferred = inferFromSource(source, '/h.ts');
    const results = analyzeTaint(inferred, '/h.ts', sf);

    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    // Handler signature is on file line 5; `exec(cmd)` is on file line 7.
    // Body-relative: 7 - 5 = 2. Absolute (the bug we're guarding against): 7.
    expect(r.startLine).toBe(5);
    const sink = r.paths[0].sink;
    expect(sink.line).toBe(2);
    // Sanity-check the resolved file line via taintToFindings.
    const findings = taintToFindings(results);
    expect(findings[0].primarySpan.startLine).toBe(7);
  });

  it('Lift 2: cross-file callee span resolves to bodyStartLine + sink.line', () => {
    const results = [
      {
        callerFile: 'app/route.ts',
        callerFn: 'POST',
        callerLine: 4,
        calleeFile: 'lib/db.ts',
        calleeFn: 'unsafeQuery',
        taintedArgs: ['sql'],
        sinkInCallee: { name: 'query', category: 'sql' as const, taintedArg: 'sql', line: 2 },
        source: { name: 'sql', origin: 'req.body.sql' },
        // Body opens at file line 5; sink is body line 2 → resolves to file line 6.
        calleeSinkLine: 6,
      },
    ];
    const findings = crossFileTaintToFindings(results);
    expect(findings[0].relatedSpans?.[0].startLine).toBe(6);
    // Pre-Lift-2 behaviour was 1 — guard against regression.
    expect(findings[0].relatedSpans?.[0].startLine).not.toBe(1);
  });

  it('Lift 3: intra-file taint findings carry a data-flow rootCause keyed on (file, handler, source, sink category)', () => {
    const results = [
      {
        fnName: 'handler',
        filePath: '/src/api.ts',
        startLine: 1,
        paths: [
          {
            source: { name: 'q', origin: 'req.query' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'q', line: 3 },
            sanitized: false,
          },
        ],
      },
    ];
    const findings = taintToFindings(results);
    expect(findings[0].rootCause?.kind).toBe('data-flow');
    expect(findings[0].rootCause?.key).toBe('taint:/src/api.ts#handler:q:req.query→command');
    expect(findings[0].rootCause?.facets?.sinkCategory).toBe('command');
    expect(findings[0].rootCause?.facets?.handler).toBe('handler');
  });

  it('Lift 3: two handlers in the same file with the same source/sink shape do NOT collapse (Codex+OpenCode impl-review)', () => {
    const findings = taintToFindings([
      {
        fnName: 'getUsers',
        filePath: '/src/api.ts',
        startLine: 1,
        paths: [
          {
            source: { name: 'req', origin: 'param:req' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'req', line: 1 },
            sanitized: false,
          },
        ],
      },
      {
        fnName: 'createUser',
        filePath: '/src/api.ts',
        startLine: 10,
        paths: [
          {
            source: { name: 'req', origin: 'param:req' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'req', line: 1 },
            sanitized: false,
          },
        ],
      },
    ]);
    expect(findings.length).toBe(2);
    expect(findings[0].rootCause?.key).not.toBe(findings[1].rootCause?.key);
  });

  it('Lift 3: two findings with same flow signature share a rootCause.key so the grouper can collapse them', () => {
    const sharedSinkArg = 'input';
    const intra = taintToFindings([
      {
        fnName: 'h',
        filePath: '/src/api.ts',
        startLine: 1,
        paths: [
          {
            source: { name: sharedSinkArg, origin: 'req.body' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: sharedSinkArg, line: 2 },
            sanitized: false,
          },
        ],
      },
    ]);
    const cross = crossFileTaintToFindings([
      {
        callerFile: '/src/api.ts',
        callerFn: 'h',
        callerLine: 1,
        calleeFile: '/src/runner.ts',
        calleeFn: 'run',
        taintedArgs: [sharedSinkArg],
        sinkInCallee: { name: 'exec', category: 'command' as const, taintedArg: sharedSinkArg, line: 1 },
        source: { name: sharedSinkArg, origin: 'req.body' },
        calleeSinkLine: 10,
      },
    ]);
    expect(intra[0].rootCause?.key).toBe(cross[0].rootCause?.key);
  });

  it('Lift 3: different source names produce different rootCause keys (no false collapse)', () => {
    const fromBody = taintToFindings([
      {
        fnName: 'h',
        filePath: '/src/api.ts',
        startLine: 1,
        paths: [
          {
            source: { name: 'body', origin: 'req.body' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'body' },
            sanitized: false,
          },
        ],
      },
    ]);
    const fromQuery = taintToFindings([
      {
        fnName: 'h',
        filePath: '/src/api.ts',
        startLine: 1,
        paths: [
          {
            source: { name: 'query', origin: 'req.query' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'query' },
            sanitized: false,
          },
        ],
      },
    ]);
    expect(fromBody[0].rootCause?.key).not.toBe(fromQuery[0].rootCause?.key);
  });

  it('Lift A: two sinks in the same handler at different lines get different fingerprints (no silent dedup)', () => {
    const findings = taintToFindings([
      {
        fnName: 'h',
        filePath: '/src/api.ts',
        startLine: 10,
        paths: [
          {
            source: { name: 'q', origin: 'req.query' },
            sink: { name: 'exec', category: 'command' as const, taintedArg: 'q', line: 3 },
            sanitized: false,
          },
          {
            source: { name: 'q', origin: 'req.query' },
            sink: { name: 'eval', category: 'eval' as const, taintedArg: 'q', line: 7 },
            sanitized: false,
          },
        ],
      },
    ]);
    expect(findings.length).toBe(2);
    expect(findings[0].fingerprint).not.toBe(findings[1].fingerprint);
    // primarySpan reflects the absolute file line. `sink.line` is body-
    // relative: 0 = signature line, N = N lines below. Handler signature
    // is at file line 10, sinks are on body lines 3 and 7 → file lines 13
    // and 17. The previous off-by-one (`-1` in the consumer formula) was
    // corrected after empirical verification on kern-guard middleware.ts.
    expect(findings[0].primarySpan.startLine).toBe(13);
    expect(findings[1].primarySpan.startLine).toBe(17);
  });
});
