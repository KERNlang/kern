/**
 * Tests for the self-suppress post-pass. Two layers:
 *
 *   (1) Unit: feed handcrafted findings whose provenance steps point at
 *       known-stable React constructs; verify they are routed to `suppressed`.
 *
 *   (2) Integration: review real React code where a rule's provenance chain
 *       lands on useMemo/useCallback/useRef/useState-setter, verify the
 *       finding ends up in `suppressedFindings` with the expected reason.
 */
import { reviewSource } from '../src/index.js';
import { suppressFindingsOnStableReactConstructs } from '../src/react-stable-suppress.js';
import type { ReviewConfig, ReviewFinding } from '../src/types.js';

const FILE = 'C.tsx';

function makeFinding(provenanceLine: number, provenanceCol: number, category: string): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'exhaustive-deps',
    severity: 'warning',
    category: 'bug',
    message: 'missing dep',
    primarySpan: { file: FILE, startLine: provenanceLine, startCol: 1, endLine: provenanceLine, endCol: 1 },
    fingerprint: `exhaustive-deps:${provenanceLine}:1`,
    confidence: 80,
    provenance: {
      steps: [
        {
          kind: 'source',
          category,
          location: {
            file: FILE,
            startLine: provenanceLine,
            startCol: provenanceCol,
            endLine: provenanceLine,
            endCol: provenanceCol + 1,
          },
          label: 'cited',
        },
      ],
    },
  };
}

describe('suppressFindingsOnStableReactConstructs — unit', () => {
  it('keeps a finding whose chain lands on an ordinary object literal', () => {
    const src = `
function C() {
  const x = { a: 1 };
  return x;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(3, 9, 'value-decl')], src, FILE);
    expect(r.kept).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it('suppresses a finding whose value-decl step lands on a useRef binding', () => {
    // Codex review: useMemo is NOT lifetime-stable (re-allocates on dep change)
    // so it's no longer considered stable. useRef is the canonical example
    // of a lifetime-stable binding whose identity never changes across renders.
    const src = `
import { useRef } from 'react';
function C() {
  const value = useRef<number>(0);
  return value;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 9, 'value-decl')], src, FILE);
    expect(r.kept).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
    expect(r.suppressed[0].suppressionReason).toBe('stable-react-construct');
  });

  it('does NOT suppress when chain step lands on a useMemo (NOT lifetime-stable)', () => {
    // Codex review 2026-05-13: useMemo re-allocates when deps change. A rule
    // claiming a useMemo result is unstable might be RIGHT — don't suppress.
    const src = `
import { useMemo } from 'react';
function C() {
  const value = useMemo(() => ({ a: 1 }), []);
  return value;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 9, 'value-decl')], src, FILE);
    expect(r.kept).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it('does NOT suppress a finding whose ref-decl step lands on useRef (rule premise IS about the ref)', () => {
    // ref-in-deps emits chain with category=ref-decl pointing at the useRef
    // declaration. The rule's whole point is "this ref is stable, don't put
    // it in deps" — self-suppressing would silently kill the rule.
    const src = `
import { useRef } from 'react';
function C() {
  const r = useRef(null);
  return r;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 9, 'ref-decl')], src, FILE);
    expect(r.kept).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it('suppresses a finding whose closure-capture step lands on a useRef binding', () => {
    // A rule citing a captured value as unstable — but the value is actually
    // a useRef result, so it IS stable. Self-suppress should drop it.
    const src = `
import { useRef } from 'react';
function C() {
  const r = useRef(null);
  return r;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 9, 'closure-capture')], src, FILE);
    expect(r.suppressed).toHaveLength(1);
  });

  it('suppresses when hook-dep step lands on a useState SETTER (setter is stable)', () => {
    const src = `
import { useState } from 'react';
function C() {
  const [count, setCount] = useState(0);
  return setCount;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 17, 'hook-dep')], src, FILE);
    expect(r.suppressed).toHaveLength(1);
    expect(r.suppressed[0].suppressionReason).toBe('stable-react-construct');
  });

  it('does NOT suppress when hook-dep step lands on a useState VALUE (value half changes)', () => {
    const src = `
import { useState } from 'react';
function C() {
  const [count, setCount] = useState(0);
  return count;
}
`;
    const r = suppressFindingsOnStableReactConstructs([makeFinding(4, 10, 'hook-dep')], src, FILE);
    expect(r.kept).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it('keeps findings without provenance untouched', () => {
    const f: ReviewFinding = {
      source: 'kern',
      ruleId: 'random',
      severity: 'warning',
      category: 'bug',
      message: 'no chain',
      primarySpan: { file: FILE, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      fingerprint: 'random:1:1',
      confidence: 80,
    };
    const r = suppressFindingsOnStableReactConstructs([f], 'x', FILE);
    expect(r.kept).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it('only considers steps in the same file (cross-file step is ignored)', () => {
    const src = `
import { useRef } from 'react';
function C() {
  const value = useRef(null);
  return value;
}
`;
    // Chain step points at a DIFFERENT file — must be ignored
    const f = makeFinding(4, 9, 'value-decl');
    f.provenance!.steps[0].location.file = 'OTHER.tsx';
    const r = suppressFindingsOnStableReactConstructs([f], src, FILE);
    expect(r.kept).toHaveLength(1);
  });
});

describe('suppressFindingsOnStableReactConstructs — integration via reviewSource', () => {
  const cfg: ReviewConfig = { target: 'web' };

  it('does NOT self-suppress ref-in-deps (rule denylist preserves intent)', () => {
    // Codex review 2026-05-13: ref-in-deps is on the denylist precisely
    // because its premise is "this ref is stable, don't put it in deps."
    // Self-suppressing it would silently kill the rule.
    const src = `
import { useEffect, useRef } from 'react';
export function C() {
  const r = useRef(null);
  useEffect(() => {
    console.log(r.current);
  }, [r]);
  return null;
}
`;
    const out = reviewSource(src, FILE, cfg);
    const refInDeps = out.findings.find((f: ReviewFinding) => f.ruleId === 'ref-in-deps');
    expect(refInDeps).toBeDefined();
    expect(refInDeps?.provenance).toBeDefined();
    // And it MUST NOT have been routed to the self-suppressed bucket.
    const selfSuppressed = out.selfSuppressedFindings?.find((f: ReviewFinding) => f.ruleId === 'ref-in-deps');
    expect(selfSuppressed).toBeUndefined();
  });

  it('preserves exhaustive-deps when the missing dep is itself a useMemo (Codex blocker fix)', () => {
    // Codex review 2026-05-13 (confidence 0.96): useMemo with non-empty deps
    // changes identity when deps change. An exhaustive-deps finding citing
    // a useMemo result as a missing dep is LEGITIMATE and must NOT be
    // self-suppressed. This test enforces that contract.
    const src = `
import { useEffect, useMemo } from 'react';
export function C({ id }: { id: string }) {
  const v = useMemo(() => ({ id }), [id]);
  useEffect(() => {
    console.log(v);
  }, []);
  return null;
}
`;
    const out = reviewSource(src, FILE, cfg);
    const exhaustive = out.findings.find((f: ReviewFinding) => f.ruleId === 'exhaustive-deps');
    expect(exhaustive).toBeDefined();
    // Must NOT have been routed to the self-suppressed bucket.
    const selfSuppressed = out.selfSuppressedFindings?.find((f: ReviewFinding) => f.ruleId === 'exhaustive-deps');
    expect(selfSuppressed).toBeUndefined();
  });
});
