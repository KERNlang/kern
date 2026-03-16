import { reviewSource, formatReport } from '../src/index.js';

describe('Review Pipeline (end-to-end)', () => {
  it('reviews a complete TypeScript file', () => {
    const source = `
import type { Plan } from './types.js';

export type PlanState = 'draft' | 'approved' | 'running' | 'completed' | 'failed';

export interface PlanStep {
  id: string;
  action: string;
  result?: string;
}

export interface Plan {
  id: string;
  state: PlanState;
  steps: PlanStep[];
}

export class PlanStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    super(\`Invalid state\`);
    this.name = 'PlanStateError';
  }
}

export function createPlan(action: string): Plan {
  return { id: crypto.randomUUID(), state: 'draft', steps: [{ id: '1', action }] };
}

export function approvePlan<T extends { state: PlanState }>(entity: T): T {
  if (entity.state !== 'draft') throw new PlanStateError('draft', entity.state);
  return { ...entity, state: 'approved' as PlanState };
}

export const MAX_STEPS = 10;
`;
    const report = reviewSource(source, 'plan.ts');

    // Should find multiple constructs
    expect(report.inferred.length).toBeGreaterThanOrEqual(5);

    // Should find type, interface, fn, error, const, import
    const types = report.inferred.map(r => r.node.type);
    expect(types).toContain('type');
    expect(types).toContain('interface');
    expect(types).toContain('fn');
    expect(types).toContain('error');
    expect(types).toContain('const');
    expect(types).toContain('import');

    // Should detect machine composite
    expect(types).toContain('machine');

    // Stats should be calculated
    expect(report.stats.constructCount).toBeGreaterThan(0);
    expect(report.stats.coveragePct).toBeGreaterThan(0);
    expect(report.stats.reductionPct).toBeGreaterThanOrEqual(0);

    // v2: unified findings array (replaces separate quality + diff arrays)
    expect(report.findings).toBeDefined();
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('produces nodeIds and promptAliases', () => {
    const source = `
export type Status = 'active' | 'inactive';
export interface User { name: string; status: Status; }
`;
    const report = reviewSource(source, 'user.ts');

    for (const r of report.inferred) {
      // nodeId: file#type:name@offset
      expect(r.nodeId).toContain('#');
      expect(r.nodeId).toContain(':');
      expect(r.nodeId).toContain('@');

      // promptAlias: N1, N2, etc.
      expect(r.promptAlias).toMatch(/^N\d+$/);

      // sourceSpans should have at least one entry
      expect(r.sourceSpans.length).toBeGreaterThanOrEqual(1);
      expect(r.sourceSpans[0].file).toBeDefined();
      expect(r.sourceSpans[0].startLine).toBeGreaterThan(0);
    }

    // Aliases should be sequential
    const aliases = report.inferred.map(r => r.promptAlias);
    for (let i = 0; i < aliases.length; i++) {
      expect(aliases[i]).toBe(`N${i + 1}`);
    }
  });

  it('formats a readable report', () => {
    const source = `
export type Status = 'active' | 'inactive';
export interface User { name: string; status: Status; }
`;
    const report = reviewSource(source, 'user.ts');
    const formatted = formatReport(report);

    expect(formatted).toContain('@kern/review');
    expect(formatted).toContain('user.ts');
    expect(formatted).toContain('KERN-expressible');
    expect(formatted).toContain('Summary');
  });

  it('handles empty file', () => {
    const report = reviewSource('', 'empty.ts');
    expect(report.inferred.length).toBe(0);
    expect(report.stats.coveragePct).toBe(0);
  });

  it('handles file with only comments', () => {
    const source = `
// This is a comment
/* Block comment */
`;
    const report = reviewSource(source, 'comments.ts');
    expect(report.inferred.length).toBe(0);
  });

  it('produces correct file path in report', () => {
    const report = reviewSource('export type X = string;', 'my-file.ts');
    expect(report.filePath).toBe('my-file.ts');
  });

  it('produces JSON-serializable output', () => {
    const source = `export interface Foo { bar: string; }`;
    const report = reviewSource(source, 'foo.ts');
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.filePath).toBe('foo.ts');
    expect(parsed.inferred.length).toBeGreaterThan(0);
  });

  it('findings have unified structure', () => {
    const source = `
export type PlanState = 'draft' | 'approved' | 'running' | 'completed' | 'failed';

export class PlanStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    super(\`Invalid state\`);
    this.name = 'PlanStateError';
  }
}

export function createPlan(action: string) {
  return { id: crypto.randomUUID(), state: 'draft', steps: [{ id: '1', action }] };
}

export function approvePlan<T extends { state: PlanState }>(entity: T): T {
  if (entity.state !== 'draft') throw new PlanStateError('draft', entity.state);
  return { ...entity, state: 'approved' as PlanState };
}
`;
    const report = reviewSource(source, 'plan.ts');

    for (const f of report.findings) {
      // Every finding should have unified structure
      expect(f.source).toMatch(/^(kern|eslint|tsc|llm)$/);
      expect(f.ruleId).toBeDefined();
      expect(f.severity).toMatch(/^(error|warning|info)$/);
      expect(f.category).toMatch(/^(bug|type|pattern|style|structure)$/);
      expect(f.message).toBeTruthy();
      expect(f.primarySpan).toBeDefined();
      expect(f.fingerprint).toBeDefined();
    }
  });
});
