import { applySuppression } from '../src/suppression/apply-suppression.js';
import { configDirectives, isConceptRule, parseDirectives } from '../src/suppression/parse-directives.js';
import type { ReviewConfig, ReviewFinding } from '../src/types.js';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'floating-promise',
    severity: 'error',
    category: 'bug',
    message: 'Async call not awaited',
    primarySpan: { file: 'test.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 30 },
    fingerprint: 'fp-1',
    ...overrides,
  };
}

// ── parseDirectives ──────────────────────────────────────────────────────

describe('parseDirectives', () => {
  it('parses same-line kern-ignore', () => {
    const source = `const x = 1;\nconst y = fetch('/api'); // kern-ignore floating-promise\nconst z = 2;`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe('line');
    expect(directives[0].ruleIds).toEqual(['floating-promise']);
    expect(directives[0].line).toBe(2); // same line as the code
    expect(warnings).toHaveLength(0);
  });

  it('parses next-line kern-ignore (comment-only line)', () => {
    const source = `const x = 1;\n// kern-ignore floating-promise\nconst y = fetch('/api');\nconst z = 2;`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe('line');
    expect(directives[0].line).toBe(3); // next non-comment line
  });

  it('parses multiple rule IDs', () => {
    const source = `// kern-ignore floating-promise, empty-catch\nconst y = fetch('/api');`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].ruleIds).toEqual(['floating-promise', 'empty-catch']);
  });

  it('parses file-level directive', () => {
    const source = `// kern-ignore-file unguarded-effect\nimport { fetch } from 'node-fetch';`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe('file');
    expect(directives[0].ruleIds).toEqual(['unguarded-effect']);
  });

  it('warns on bare kern-ignore (no rule ID)', () => {
    const source = `// kern-ignore\nconst x = 1;`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe('kern-ignore-bare');
  });

  it('warns when file-level directive is after line 5', () => {
    const source = `line1\nline2\nline3\nline4\nline5\n// kern-ignore-file floating-promise\nline7`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe('kern-ignore-position');
  });

  it('warns on concept rule with line-level suppression', () => {
    const source = `// kern-ignore unguarded-effect\nconst x = 1;`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(0); // concept rule stripped
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe('kern-ignore-concept');
  });

  it('parses Python comments', () => {
    const source = `# kern-ignore floating-promise\nx = fetch('/api')`;
    const { directives } = parseDirectives(source, 'test.py');
    expect(directives).toHaveLength(1);
    expect(directives[0].ruleIds).toEqual(['floating-promise']);
  });

  it('skips blank lines when resolving next-line', () => {
    const source = `// kern-ignore floating-promise\n\n\nconst y = fetch('/api');`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].line).toBe(4); // skipped 2 blank lines
  });

  it('parses [reason: false-positive] suffix and stores it on the directive', () => {
    const source = `// kern-ignore dead-export [reason: false-positive]\nexport const x = 1;`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].reason).toBe('false-positive');
    expect(warnings).toEqual([]);
  });

  it('parses each closed-enum reason value', () => {
    for (const reason of ['false-positive', 'wont-fix', 'intentional', 'not-applicable']) {
      const source = `// kern-ignore dead-export [reason: ${reason}]\nexport const x = 1;`;
      const { directives, warnings } = parseDirectives(source, 'test.ts');
      expect(directives[0].reason).toBe(reason);
      expect(warnings).toEqual([]);
    }
  });

  it('SECURITY: rejects free-text reason and warns (no JSON/SARIF injection)', () => {
    const source = `// kern-ignore dead-export [reason: my-custom-reason]\nexport const x = 1;`;
    const { directives, warnings } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].reason).toBeUndefined(); // rejected
    expect(warnings).toHaveLength(1);
    expect(warnings[0].ruleId).toBe('kern-ignore-reason');
    expect(warnings[0].message).toContain('my-custom-reason');
  });

  it('reason works with file-level directive', () => {
    const source = `// kern-ignore-file dead-export [reason: intentional]\nexport const x = 1;`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives[0].type).toBe('file');
    expect(directives[0].reason).toBe('intentional');
  });

  it('reason works with Python directive', () => {
    const source = `# kern-ignore floating-promise [reason: wont-fix]\nawait fetch('/x')`;
    const { directives } = parseDirectives(source, 'test.py');
    expect(directives[0].reason).toBe('wont-fix');
  });

  it('SECURITY: skips comment lines longer than 4096 chars (ReDoS guard)', () => {
    const long = `// kern-ignore dead-export ${'a'.repeat(5000)}`;
    const source = `${long}\nexport const x = 1;`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toEqual([]); // entire line skipped
  });

  it('directive without reason still works (backward compatible)', () => {
    const source = `// kern-ignore dead-export\nexport const x = 1;`;
    const { directives } = parseDirectives(source, 'test.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0].reason).toBeUndefined();
  });
});

// ── configDirectives ─────────────────────────────────────────────────────

describe('configDirectives', () => {
  it('creates file-level directive with wildcard', () => {
    const dirs = configDirectives(['floating-promise', 'empty-catch']);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].type).toBe('file');
    expect(dirs[0].file).toBe('*');
    expect(dirs[0].ruleIds).toEqual(['floating-promise', 'empty-catch']);
    expect(dirs[0].source).toBe('config');
  });

  it('returns empty for empty array', () => {
    expect(configDirectives([])).toHaveLength(0);
  });
});

// ── isConceptRule ────────────────────────────────────────────────────────

describe('isConceptRule', () => {
  it('identifies concept rules', () => {
    expect(isConceptRule('unguarded-effect')).toBe(true);
    expect(isConceptRule('boundary-mutation')).toBe(true);
    expect(isConceptRule('floating-promise')).toBe(false);
  });
});

// ── applySuppression ─────────────────────────────────────────────────────

describe('applySuppression', () => {
  const source = `const x = 1;\n// kern-ignore floating-promise\nconst y = fetch('/api');\nconst z = fetch('/other');`;

  it('suppresses matching inline finding', () => {
    const findings = [
      makeFinding({ primarySpan: { file: 'test.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 30 } }),
    ];
    const result = applySuppression(findings, source, 'test.ts');
    // Finding on line 3 should be suppressed
    const nonMeta = result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'));
    expect(nonMeta).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
  });

  it('does not suppress non-matching line', () => {
    const findings = [
      makeFinding({ primarySpan: { file: 'test.ts', startLine: 4, startCol: 1, endLine: 4, endCol: 30 } }),
    ];
    const result = applySuppression(findings, source, 'test.ts');
    const nonMeta = result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'));
    expect(nonMeta).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it('does not suppress wrong rule ID', () => {
    const findings = [
      makeFinding({
        ruleId: 'empty-catch',
        primarySpan: { file: 'test.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 30 },
      }),
    ];
    const result = applySuppression(findings, source, 'test.ts');
    const nonMeta = result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'));
    expect(nonMeta).toHaveLength(1);
  });

  it('respects config-level disabledRules', () => {
    const plainSource = `const x = fetch('/api');`;
    const findings = [
      makeFinding({ primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 30 } }),
    ];
    const config: ReviewConfig = { disabledRules: ['floating-promise'] };
    const result = applySuppression(findings, plainSource, 'test.ts', config);
    expect(result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'))).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
  });

  it('strict mode ignores inline but respects config', () => {
    const findings = [
      makeFinding({ primarySpan: { file: 'test.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 30 } }),
    ];
    const config: ReviewConfig = { disabledRules: [] };
    const result = applySuppression(findings, source, 'test.ts', config, 'inline');
    // Inline suppression ignored in strict mode
    const nonMeta = result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'));
    expect(nonMeta).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it('strict=all ignores everything', () => {
    const findings = [
      makeFinding({ primarySpan: { file: 'test.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 30 } }),
    ];
    const config: ReviewConfig = { disabledRules: ['floating-promise'] };
    const result = applySuppression(findings, source, 'test.ts', config, 'all');
    const nonMeta = result.findings.filter((f) => !f.ruleId.startsWith('kern-ignore'));
    expect(nonMeta).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it('reports unused directives', () => {
    const findings: ReviewFinding[] = []; // no findings to match
    const result = applySuppression(findings, source, 'test.ts');
    const unusedWarnings = result.findings.filter((f) => f.ruleId === 'kern-ignore-unused');
    expect(unusedWarnings).toHaveLength(1);
    expect(unusedWarnings[0].message).toContain('floating-promise');
  });

  it('does not report unused directives in strict mode', () => {
    const findings: ReviewFinding[] = [];
    const result = applySuppression(findings, source, 'test.ts', undefined, 'inline');
    const unusedWarnings = result.findings.filter((f) => f.ruleId === 'kern-ignore-unused');
    expect(unusedWarnings).toHaveLength(0);
  });
});
