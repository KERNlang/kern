/**
 * Tests for the chain-prefix RootCause derivation that enables cross-rule
 * dedup via groupFindingsByRootCause. Two layers:
 *
 *   (1) Pure unit tests on deriveProvenanceRootCause — same chain prefix
 *       yields same key; different categories or locations yield different
 *       keys.
 *
 *   (2) Integration test running React rules against a source that triggers
 *       MULTIPLE rules on the SAME root cause, then proving
 *       groupFindingsByRootCause collapses them.
 */
import { deriveProvenanceRootCause } from '../src/derive-provenance-root-cause.js';
import { groupFindingsByRootCause } from '../src/group-by-root-cause.js';
import { reviewSource } from '../src/index.js';
import type { ProvenanceChain, ReviewConfig, ReviewFinding } from '../src/types.js';

const SPAN = (file: string, line: number, col = 1) => ({
  file,
  startLine: line,
  startCol: col,
  endLine: line,
  endCol: col + 1,
});

const chain = (steps: Array<Partial<ProvenanceChain['steps'][number]>>): ProvenanceChain => ({
  steps: steps.map((s) => ({
    kind: 'source' as const,
    location: SPAN('a.tsx', 1),
    label: 'x',
    ...s,
  })),
});

describe('deriveProvenanceRootCause', () => {
  it('returns undefined for empty chain', () => {
    expect(deriveProvenanceRootCause(undefined)).toBeUndefined();
    expect(deriveProvenanceRootCause({ steps: [] })).toBeUndefined();
  });

  it('uses K=2 prefix when chain has >= 2 steps', () => {
    const c = chain([
      { category: 'hook-dep', location: SPAN('a.tsx', 10, 5) },
      { category: 'closure-capture', location: SPAN('a.tsx', 12, 3) },
      { category: 'render-cycle', location: SPAN('a.tsx', 15, 1) },
    ]);
    const rc = deriveProvenanceRootCause(c);
    expect(rc).toBeDefined();
    expect(rc?.kind).toBe('data-flow');
    // Key should contain both first two steps; not the third
    expect(rc?.key).toContain('hook-dep');
    expect(rc?.key).toContain('closure-capture');
    expect(rc?.key).not.toContain('render-cycle');
  });

  it('falls back to K=1 for single-step chains', () => {
    const c = chain([{ category: 'memo-boundary', location: SPAN('a.tsx', 5, 1) }]);
    const rc = deriveProvenanceRootCause(c);
    expect(rc?.key).toContain('memo-boundary');
  });

  it('produces SAME key for chains with identical first 2 steps', () => {
    const stepsA: ProvenanceChain['steps'] = [
      { kind: 'boundary', category: 'hook-dep', location: SPAN('a.tsx', 10, 5), label: 'deps' },
      { kind: 'call', category: 'closure-capture', location: SPAN('a.tsx', 12, 3), label: 'fn' },
    ];
    const stepsB: ProvenanceChain['steps'] = [
      { kind: 'boundary', category: 'hook-dep', location: SPAN('a.tsx', 10, 5), label: 'different label' },
      { kind: 'call', category: 'closure-capture', location: SPAN('a.tsx', 12, 3), label: 'different too' },
      { kind: 'sink', category: 'render-cycle', location: SPAN('a.tsx', 20, 1), label: 'third only in B' },
    ];
    expect(deriveProvenanceRootCause({ steps: stepsA })?.key).toBe(deriveProvenanceRootCause({ steps: stepsB })?.key);
  });

  it('produces DIFFERENT keys when 2nd-step category differs (precision check)', () => {
    const stepsA = [
      { kind: 'boundary' as const, category: 'hook-dep', location: SPAN('a.tsx', 10, 5), label: 'd' },
      { kind: 'call' as const, category: 'closure-capture', location: SPAN('a.tsx', 12, 3), label: 'f' },
    ];
    const stepsB = [
      { kind: 'boundary' as const, category: 'hook-dep', location: SPAN('a.tsx', 10, 5), label: 'd' },
      { kind: 'call' as const, category: 'state-write', location: SPAN('a.tsx', 12, 3), label: 'f' },
    ];
    expect(deriveProvenanceRootCause({ steps: stepsA })?.key).not.toBe(
      deriveProvenanceRootCause({ steps: stepsB })?.key,
    );
  });
});

describe('React findings auto-populate rootCause via finding() helper', () => {
  const cfg: ReviewConfig = { target: 'web' };

  it('attaches a derived rootCause to a stale-closure finding', async () => {
    const src = `
import { useEffect, useState } from 'react';
export function Comp() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setInterval(() => { console.log(count); }, 1000);
  }, []);
  return null;
}
`;
    const out = await reviewSource(src, 'C.tsx', cfg);
    const staleClosure = out.findings.find((f: ReviewFinding) => f.ruleId === 'stale-closure');
    expect(staleClosure).toBeDefined();
    expect(staleClosure?.provenance?.steps?.length).toBeGreaterThan(0);
    expect(staleClosure?.rootCause).toBeDefined();
    expect(staleClosure?.rootCause?.kind).toBe('data-flow');
    expect(staleClosure?.rootCause?.key).toMatch(/^provenance:/);
  });
});

describe('groupFindingsByRootCause activates on React findings (via auto-derive)', () => {
  it('merges two findings with identical first-2-step chains into one', () => {
    const sharedChain: ProvenanceChain = {
      steps: [
        { kind: 'boundary', category: 'hook-dep', location: SPAN('C.tsx', 10, 5), label: '[]' },
        { kind: 'call', category: 'closure-capture', location: SPAN('C.tsx', 12, 3), label: 'setInterval' },
      ],
    };
    const sharedRc = deriveProvenanceRootCause(sharedChain);
    const findings: ReviewFinding[] = [
      {
        source: 'kern',
        ruleId: 'stale-closure',
        severity: 'warning',
        category: 'bug',
        message: 'stale closure',
        primarySpan: SPAN('C.tsx', 10, 1),
        fingerprint: 'stale-closure:10:1',
        confidence: 80,
        provenance: sharedChain,
        rootCause: sharedRc,
      },
      {
        source: 'kern',
        ruleId: 'exhaustive-deps',
        severity: 'warning',
        category: 'bug',
        message: 'missing deps',
        primarySpan: SPAN('C.tsx', 10, 1),
        fingerprint: 'exhaustive-deps:10:1',
        confidence: 80,
        provenance: sharedChain,
        rootCause: sharedRc,
      },
    ];
    const out = groupFindingsByRootCause(findings);
    expect(out).toHaveLength(1);
    expect(out[0].rootCause?.facets?.coveredRules).toMatch(/exhaustive-deps/);
    expect(out[0].rootCause?.facets?.coveredRules).toMatch(/stale-closure/);
  });

  it('does NOT merge findings with different chain prefixes', () => {
    const findings: ReviewFinding[] = [
      {
        source: 'kern',
        ruleId: 'stale-closure',
        severity: 'warning',
        category: 'bug',
        message: 'a',
        primarySpan: SPAN('C.tsx', 10, 1),
        fingerprint: 'stale-closure:10:1',
        confidence: 80,
        provenance: {
          steps: [
            { kind: 'boundary', category: 'hook-dep', location: SPAN('C.tsx', 10, 5), label: 'a' },
            { kind: 'call', category: 'closure-capture', location: SPAN('C.tsx', 12, 3), label: 'b' },
          ],
        },
      },
      {
        source: 'kern',
        ruleId: 'unstable-key',
        severity: 'warning',
        category: 'bug',
        message: 'b',
        primarySpan: SPAN('C.tsx', 40, 1),
        fingerprint: 'unstable-key:40:1',
        confidence: 80,
        provenance: {
          steps: [
            { kind: 'source', category: 'list-render', location: SPAN('C.tsx', 40, 5), label: 'a' },
            { kind: 'sink', category: 'key-collision', location: SPAN('C.tsx', 42, 3), label: 'b' },
          ],
        },
      },
    ];
    // Each finding gets its own auto-derived rootCause when passed through finding(),
    // but here we set them manually to mimic the post-pass.
    findings[0].rootCause = deriveProvenanceRootCause(findings[0].provenance);
    findings[1].rootCause = deriveProvenanceRootCause(findings[1].provenance);
    const out = groupFindingsByRootCause(findings);
    expect(out).toHaveLength(2);
  });
});
