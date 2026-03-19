/**
 * Confidence Layer — Phase C tests
 *
 * Tests the 7 confidence lint rules.
 */

import type { IRNode } from '@kernlang/core';
import { lintConfidenceGraph } from '../src/rules/confidence.js';

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = [], line = 0): IRNode {
  return { type, props, children, loc: { line, col: 1 } };
}

describe('confidence-missing-source', () => {
  it('fires when from:X references non-existent node', () => {
    const nodes = [
      makeNode('derive', { name: 'orphan', confidence: 'from:nonexistent' }, [], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-missing-source')).toBe(true);
  });

  it('does not fire when source exists', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('derive', { name: 'b', confidence: 'from:a' }, [], 2),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-missing-source')).toBe(false);
  });
});

describe('confidence-cycle', () => {
  it('fires on circular dependency', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: 'from:y' }, [], 1),
      makeNode('derive', { name: 'y', confidence: 'from:x' }, [], 2),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-cycle')).toBe(true);
  });

  it('does not fire on acyclic graph', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('derive', { name: 'b', confidence: 'from:a' }, [], 2),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-cycle')).toBe(false);
  });
});

describe('confidence-needs-unresolved', () => {
  it('fires when needs are unresolved', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.7' }, [
        makeNode('needs', { what: 'auth config' }),
      ], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-needs-unresolved')).toBe(true);
  });

  it('does not fire when all needs resolved', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.7' }, [
        makeNode('needs', { what: 'auth config', resolved: 'true' }),
      ], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-needs-unresolved')).toBe(false);
  });
});

describe('confidence-low', () => {
  it('fires when resolved confidence is low', () => {
    const nodes = [
      makeNode('derive', { name: 'risky', confidence: '0.3' }, [], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-low')).toBe(true);
  });

  it('does not fire when confidence >= 0.5', () => {
    const nodes = [
      makeNode('derive', { name: 'ok', confidence: '0.7' }, [], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-low')).toBe(false);
  });

  it('does not fire on null/cycle nodes', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: 'from:y' }, [], 1),
      makeNode('derive', { name: 'y', confidence: 'from:x' }, [], 2),
    ];
    const findings = lintConfidenceGraph(nodes);
    // Should have confidence-cycle but NOT confidence-low
    expect(findings.some(f => f.ruleId === 'confidence-low')).toBe(false);
  });
});

describe('confidence-impossible', () => {
  it('fires when would-raise-to < current confidence', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.8' }, [
        makeNode('needs', { what: 'test', 'would-raise-to': '0.5' }),
      ], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-impossible')).toBe(true);
  });

  it('does not fire when would-raise-to > current', () => {
    const nodes = [
      makeNode('derive', { name: 'x', confidence: '0.5' }, [
        makeNode('needs', { what: 'test', 'would-raise-to': '0.9' }),
      ], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-impossible')).toBe(false);
  });
});

describe('confidence-anonymous-ref', () => {
  it('fires on anonymous node with inherited confidence', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('guard', { confidence: 'from:a', expr: 'x' }, [], 10), // no name
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-anonymous-ref')).toBe(true);
  });

  it('does not fire on named node', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('guard', { name: 'g', confidence: 'from:a', expr: 'x' }, [], 10),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings.some(f => f.ruleId === 'confidence-anonymous-ref')).toBe(false);
  });
});

describe('lintConfidenceGraph', () => {
  it('returns empty when no nodes have confidence', () => {
    const nodes = [
      makeNode('derive', { name: 'x', expr: '1' }, [], 1),
    ];
    const findings = lintConfidenceGraph(nodes);
    expect(findings).toEqual([]);
  });
});
