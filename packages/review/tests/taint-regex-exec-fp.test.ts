import { reviewSource } from '../src/index.js';

// Regression: kern-guard PR #316 fired a 95%-confidence command-injection
// finding on `/^Bearer\s+(.+)$/i.exec(header)` because the bare base name
// 'exec' matched both the child_process sink table and the
// RegExp.prototype.exec call. Receiver-aware scoping in `taint-ast.ts`
// now rejects regex receivers (literal or regex-initialized var) before
// the command-class fallback fires.

describe('taint-ast — RegExp.prototype.exec false positive (kern-guard PR #316)', () => {
  function commandFindings(source: string) {
    return reviewSource(source, 'test.ts').findings.filter(
      (f) => f.ruleId.startsWith('taint-') && /command/i.test(`${f.ruleId} ${f.message}`),
    );
  }

  it('does NOT flag /regex/.exec(header) on a request handler', () => {
    const source = `
      export function handler(req: any) {
        const header = req.headers.authorization;
        const match = /^Bearer\\s+(.+)$/i.exec(header);
        return match?.[1];
      }
    `;
    expect(commandFindings(source)).toHaveLength(0);
  });

  it('does NOT flag pre-stored regex .exec(s) on a request handler', () => {
    const source = `
      const pat = /foo/;
      export function handler(req: any) {
        const s = req.body.s;
        return pat.exec(s);
      }
    `;
    expect(commandFindings(source)).toHaveLength(0);
  });

  it('does NOT flag new RegExp(...).exec(s) on a request handler', () => {
    const source = `
      export function handler(req: any) {
        const s = req.body.s;
        return new RegExp('foo').exec(s);
      }
    `;
    expect(commandFindings(source)).toHaveLength(0);
  });

  it('does NOT flag aliased regex var .exec(s) (one alias hop)', () => {
    const source = `
      const pat = /foo/;
      const pat2 = pat;
      export function handler(req: any) {
        const s = req.body.s;
        return pat2.exec(s);
      }
    `;
    expect(commandFindings(source)).toHaveLength(0);
  });

  it('STILL flags bare exec(userInput) on a request handler', () => {
    const source = `
      export function handler(req: any) {
        const cmd = req.body.command;
        exec(cmd);
      }
    `;
    expect(commandFindings(source).length).toBeGreaterThan(0);
  });

  it('STILL flags exec with string concat', () => {
    const source = `
      export function handler(req: any) {
        exec('rm -rf ' + req.body.target);
      }
    `;
    expect(commandFindings(source).length).toBeGreaterThan(0);
  });

  it('STILL flags cp.exec(userInput) where cp aliases child_process', () => {
    const source = `
      import * as cp from 'child_process';
      export function handler(req: any) {
        const cmd = req.body.command;
        cp.exec(cmd);
      }
    `;
    expect(commandFindings(source).length).toBeGreaterThan(0);
  });

  it('STILL flags execSync(userInput) on a request handler', () => {
    const source = `
      import { execSync } from 'child_process';
      export function handler(req: any) {
        const cmd = req.body.command;
        execSync(cmd);
      }
    `;
    expect(commandFindings(source).length).toBeGreaterThan(0);
  });

  it('does NOT mis-mark a helper as a command sink when its only call is /regex/.exec(param)', () => {
    const source = `
      function parseAuth(header: string) {
        return /^Bearer\\s+(.+)$/i.exec(header);
      }
      export function handler(req: any) {
        const h = req.headers.authorization;
        return parseAuth(h);
      }
    `;
    expect(commandFindings(source)).toHaveLength(0);
  });
});

// Type-based detection covers cases the syntactic walk can't see.
// Reuses the top-level `reviewSource` import (this test file is ESM —
// `require` is not defined in the test runtime).
describe('taint-ast — RegExp via TS type (opencode-flagged)', () => {
  function findings(source: string) {
    return reviewSource(source, 'test.ts').findings.filter(
      (f) => f.ruleId.startsWith('taint-') && /command/i.test(`${f.ruleId} ${f.message}`),
    );
  }

  it('does NOT flag a chained .compile().exec() — receiver type is RegExp', () => {
    const source = `
      export function handler(req: any) {
        const s = req.body.s;
        return /foo/.compile().exec(s);
      }
    `;
    expect(findings(source)).toHaveLength(0);
  });

  it('does NOT flag function-returning-regex .exec() — return type is RegExp', () => {
    const source = `
      function getPattern(): RegExp {
        return /^Bearer\\s+(.+)$/i;
      }
      export function handler(req: any) {
        const h = req.headers.authorization;
        return getPattern().exec(h);
      }
    `;
    expect(findings(source)).toHaveLength(0);
  });
});

// Cross-file path: helpers exported from another file go through
// taint-crossfile.ts -> findTaintedSinks (regex SINK_PATTERNS), bypassing
// the AST symbol resolution. Codex flagged this as a separate FP path —
// SINK_PATTERNS now uses negative lookbehinds to reject dotted .exec()
// receivers regardless of receiver type.
describe('taint regex pattern — rejects dotted exec receivers', () => {
  it('SINK_PATTERNS exec patterns reject dotted property-access receivers', async () => {
    const { SINK_PATTERNS } = await import('../src/taint-types.js');
    const execPatterns = SINK_PATTERNS.filter(
      (p: { name: string; category: string }) => p.category === 'command' && /^exec/.test(p.name),
    );
    expect(execPatterns.length).toBeGreaterThan(0);
    for (const sink of execPatterns) {
      const pattern = (sink as { pattern: RegExp }).pattern;
      // Must NOT match dotted .exec(...) — the regex.exec FP root cause
      expect(pattern.test('header.match(re); /^Bearer/.exec(header)')).toBe(false);
      expect(pattern.test('myRegex.exec(input)')).toBe(false);
      // Must STILL match bare exec(
      const bareName = `${sink.name}(`;
      expect(pattern.test(`${bareName}cmd)`)).toBe(true);
    }
  });
});
