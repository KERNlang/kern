/**
 * Confidence Layer — Phase B tests
 *
 * Tests parseConfidence, buildConfidenceGraph, propagateConfidence,
 * resolveBaseConfidence, cycles, missing sources, anonymous nodes.
 */

import type { IRNode } from '@kernlang/core';
import {
  parseConfidence,
  buildConfidenceGraph,
  resolveBaseConfidence,
  computeConfidenceSummary,
} from '../src/confidence.js';
import { formatReport, formatSARIF, checkEnforcement } from '../src/reporter.js';
import type { ReviewReport, ReviewConfig, ReviewFinding } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = [], line = 0): IRNode {
  return { type, props, children, loc: { line, col: 1 } };
}

// ── parseConfidence ──────────────────────────────────────────────────────

describe('parseConfidence', () => {
  it('parses literal "0.7"', () => {
    const spec = parseConfidence('0.7');
    expect(spec).toEqual({ kind: 'literal', value: 0.7, strategy: 'min' });
  });

  it('parses "from:authMethod"', () => {
    const spec = parseConfidence('from:authMethod');
    expect(spec).toEqual({ kind: 'inherited', strategy: 'min', sources: ['authMethod'] });
  });

  it('parses "min:a,b,c"', () => {
    const spec = parseConfidence('min:a,b,c');
    expect(spec).toEqual({ kind: 'inherited', strategy: 'min', sources: ['a', 'b', 'c'] });
  });

  it('returns undefined for "high" (malformed)', () => {
    expect(parseConfidence('high')).toBeUndefined();
  });

  it('returns undefined for "" (empty)', () => {
    expect(parseConfidence('')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseConfidence(undefined)).toBeUndefined();
  });

  it('parses "0" as literal', () => {
    const spec = parseConfidence('0');
    expect(spec).toEqual({ kind: 'literal', value: 0, strategy: 'min' });
  });

  it('parses "1" as literal', () => {
    const spec = parseConfidence('1');
    expect(spec).toEqual({ kind: 'literal', value: 1, strategy: 'min' });
  });
});

// ── buildConfidenceGraph ─────────────────────────────────────────────────

describe('buildConfidenceGraph', () => {
  it('registers named nodes', () => {
    const nodes = [
      makeNode('derive', { name: 'authMethod', confidence: '0.7' }, [], 10),
      makeNode('guard', { name: 'ownerCheck', confidence: 'from:authMethod' }, [], 20),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has('authMethod')).toBe(true);
    expect(graph.nodes.has('ownerCheck')).toBe(true);
  });

  it('uses type:line key for anonymous nodes', () => {
    const nodes = [
      makeNode('derive', { confidence: '0.5' }, [], 42),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.has('derive:42')).toBe(true);
  });

  it('wires edges from inherited specs', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('derive', { name: 'b', confidence: 'from:a' }, [], 2),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('b')!.dependsOn).toEqual(['a']);
    expect(graph.nodes.get('a')!.dependedBy).toEqual(['b']);
  });

  it('resolves literal nodes', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.8' }, [], 1),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('x')!.resolved).toBe(0.8);
  });

  it('inherits via min strategy (3 sources)', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.9' }, [], 1),
      makeNode('derive', { name: 'b', confidence: '0.7' }, [], 2),
      makeNode('derive', { name: 'c', confidence: '0.8' }, [], 3),
      makeNode('derive', { name: 'd', confidence: 'min:a,b,c' }, [], 4),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('d')!.resolved).toBe(0.7); // min(0.9, 0.7, 0.8)
  });

  it('detects cycles (resolved = null, inCycle = true)', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: 'from:y' }, [], 1),
      makeNode('derive', { name: 'y', confidence: 'from:x' }, [], 2),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('x')!.inCycle).toBe(true);
    expect(graph.nodes.get('y')!.inCycle).toBe(true);
    expect(graph.nodes.get('x')!.resolved).toBeNull();
    expect(graph.nodes.get('y')!.resolved).toBeNull();
    expect(graph.cycles.length).toBe(1);
  });

  it('missing source node gets resolved = null', () => {
    const nodes = [
      makeNode('derive', { name: 'orphan', confidence: 'from:nonexistent' }, [], 1),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('orphan')!.resolved).toBeNull();
  });

  it('skips nodes with malformed confidence', () => {
    const nodes = [
      makeNode('derive', { name: 'bad', confidence: 'high' }, [], 1),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.size).toBe(0);
  });

  it('collects needs entries from child nodes', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.7' }, [
        makeNode('needs', { what: 'auth config', 'would-raise-to': '0.95' }),
        makeNode('needs', { what: 'test coverage', resolved: 'true', 'would-raise-to': '0.9' }),
      ], 1),
    ];
    const graph = buildConfidenceGraph(nodes);
    const cnode = graph.nodes.get('x')!;
    expect(cnode.needs).toHaveLength(2);
    expect(cnode.needs[0]).toEqual({ what: 'auth config', wouldRaiseTo: 0.95, resolved: false });
    expect(cnode.needs[1]).toEqual({ what: 'test coverage', wouldRaiseTo: 0.9, resolved: true });
  });
});

// ── resolveBaseConfidence ────────────────────────────────────────────────

describe('resolveBaseConfidence', () => {
  it('applies resolved needs: max(declared, wouldRaiseTo)', () => {
    const cnode = {
      name: 'x',
      nodeRef: { type: 'derive', line: 1 },
      spec: { kind: 'literal' as const, value: 0.7, strategy: 'min' as const },
      resolved: null,
      dependsOn: [],
      dependedBy: [],
      needs: [
        { what: 'test', wouldRaiseTo: 0.95, resolved: true },
      ],
      inCycle: false,
    };
    expect(resolveBaseConfidence(cnode)).toBe(0.95);
  });

  it('handles needs with resolved=true but no would-raise-to', () => {
    const cnode = {
      name: 'x',
      nodeRef: { type: 'derive', line: 1 },
      spec: { kind: 'literal' as const, value: 0.7, strategy: 'min' as const },
      resolved: null,
      dependsOn: [],
      dependedBy: [],
      needs: [
        { what: 'test', wouldRaiseTo: undefined, resolved: true },
      ],
      inCycle: false,
    };
    expect(resolveBaseConfidence(cnode)).toBe(0.7); // No wouldRaiseTo, stays at declared
  });

  it('ignores unresolved needs', () => {
    const cnode = {
      name: 'x',
      nodeRef: { type: 'derive', line: 1 },
      spec: { kind: 'literal' as const, value: 0.5, strategy: 'min' as const },
      resolved: null,
      dependsOn: [],
      dependedBy: [],
      needs: [
        { what: 'test', wouldRaiseTo: 0.95, resolved: false },
      ],
      inCycle: false,
    };
    expect(resolveBaseConfidence(cnode)).toBe(0.5); // Unresolved, stays at declared
  });
});

// ── Phase D: Reporter + Enforcement ──────────────────────────────────────

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'test-rule',
    severity: 'warning',
    category: 'pattern',
    message: 'test message',
    primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    fingerprint: 'abc123',
    ...overrides,
  };
}

function makeReport(findings: ReviewFinding[], overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    filePath: 'test.ts',
    inferred: [],
    templateMatches: [],
    findings,
    stats: { totalLines: 100, coveredLines: 50, coveragePct: 50, totalTsTokens: 200, totalKernTokens: 100, reductionPct: 50, constructCount: 5 },
    ...overrides,
  };
}

describe('Reporter: confidence display', () => {
  it('shows confidence prefix when showConfidence is set', () => {
    const report = makeReport([
      makeFinding({ confidence: 0.72, ruleId: 'guard-without-else' }),
    ]);
    const config: ReviewConfig = { showConfidence: true };
    const output = formatReport(report, config);
    expect(output).toContain('[0.72]');
  });

  it('hides confidence when showConfidence is not set', () => {
    const report = makeReport([
      makeFinding({ confidence: 0.72, ruleId: 'guard-without-else' }),
    ]);
    const output = formatReport(report);
    expect(output).not.toContain('[0.72]');
  });

  it('shows confidence summary when present', () => {
    const report = makeReport([], {
      confidenceSummary: { high: 12, medium: 3, low: 1, unresolved: 0, unresolvedNeeds: 2 },
    });
    const config: ReviewConfig = { showConfidence: true };
    const output = formatReport(report, config);
    expect(output).toContain('12 high (>0.9)');
    expect(output).toContain('3 medium (0.7-0.9)');
    expect(output).toContain('1 low (<0.7)');
    expect(output).toContain('Unresolved needs: 2');
  });
});

describe('Reporter: SARIF rank', () => {
  it('includes rank field in SARIF output (0-100 scale per spec)', () => {
    const report = makeReport([
      makeFinding({ confidence: 0.72 }),
    ]);
    const sarif = JSON.parse(formatSARIF([report]));
    const result = sarif.runs[0].results[0];
    expect(result.rank).toBeCloseTo(72);
    expect(result.properties['kern/confidence']).toBe(0.72);
  });

  it('omits rank when no confidence', () => {
    const report = makeReport([
      makeFinding({}),
    ]);
    const sarif = JSON.parse(formatSARIF([report]));
    const result = sarif.runs[0].results[0];
    expect(result.rank).toBeUndefined();
  });
});

describe('Reporter: enforcement with minConfidence', () => {
  it('filters findings by minConfidence', () => {
    const report = makeReport([
      makeFinding({ severity: 'error', confidence: 0.3 }),
      makeFinding({ severity: 'error', confidence: 0.8, ruleId: 'other' }),
    ]);
    const config: ReviewConfig = { minConfidence: 0.5, maxErrors: 0 };
    const result = checkEnforcement(report, config);
    // Only the 0.8 confidence error should count
    expect(result.errors.actual).toBe(1);
  });

  it('defaults findings without confidence to 1.0 (fully trusted)', () => {
    const report = makeReport([
      makeFinding({ severity: 'error' }), // no confidence → 1.0
    ]);
    const config: ReviewConfig = { minConfidence: 0.5, maxErrors: 0 };
    const result = checkEnforcement(report, config);
    expect(result.errors.actual).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('minConfidence=0 counts all findings (backward compat)', () => {
    const report = makeReport([
      makeFinding({ severity: 'error', confidence: 0.1 }),
    ]);
    const config: ReviewConfig = { minConfidence: 0, maxErrors: 0 };
    const result = checkEnforcement(report, config);
    expect(result.errors.actual).toBe(1);
  });
});

describe('Confidence summary', () => {
  it('counts bands correctly', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.95' }, [], 1),
      makeNode('derive', { name: 'b', confidence: '0.8' }, [], 2),
      makeNode('derive', { name: 'c', confidence: '0.3' }, [], 3),
    ];
    const graph = buildConfidenceGraph(nodes);
    const summary = computeConfidenceSummary(graph);
    expect(summary.high).toBe(1);    // 0.95 > 0.9
    expect(summary.medium).toBe(1);  // 0.8 in [0.7, 0.9]
    expect(summary.low).toBe(1);     // 0.3 < 0.7
    expect(summary.unresolved).toBe(0);
  });
});
