/**
 * Fitness test for the stable-react-constructs resolver.
 *
 * Forge target: src/stable-react-constructs.ts must export
 *   isStableReactConstruct(opts: { sourceCode: string, file: string, line: number, col: number }):
 *     { stable: true, kind: 'useMemo' | 'useCallback' | 'useRef' | 'useState-setter' } | { stable: false }
 *
 * Decides whether the identifier (or expression) at file:line:col is bound to
 * a stable React construct — i.e. one whose identity does NOT change across
 * renders, so any rule citing it as "unstable" is a false positive.
 *
 * Stable constructs:
 *   - const x = useMemo(() => ..., []);                    -> stable: useMemo
 *   - const x = useMemo(() => ..., [a, b]);                -> stable: useMemo (we don't assess inner deps here)
 *   - const x = useCallback(() => ..., []);                -> stable: useCallback
 *   - const x = useRef(...);                               -> stable: useRef
 *   - const [_, setX] = useState(...);                     -> the SETTER (setX) is stable: useState-setter
 *
 * NOT stable:
 *   - const x = { a: 1 };
 *   - const [x, _] = useState(...);    // the value half changes across renders
 *   - const x = computeSomething();
 *   - useRef itself called inline (the call expression) — the LHS binding is stable, not the call site
 *
 * The resolver uses ts-morph to parse and walk the source.
 *
 * Location semantics: line/col are 1-indexed and identify the START of the
 * identifier or expression of interest. The resolver should find the smallest
 * Identifier (or relevant node) containing that position.
 */

import { isStableReactConstruct } from '../src/stable-react-constructs.js';

describe('isStableReactConstruct', () => {
  it('returns stable=false for useMemo (NOT lifetime-stable — re-allocates when deps change)', () => {
    // Codex review 2026-05-13: useMemo / useCallback change identity when deps
    // change, so they cannot be treated as stable for self-suppress purposes
    // — would drop legitimate exhaustive-deps findings.
    const src = `
import { useMemo } from 'react';
function C() {
  const value = useMemo(() => ({ a: 1 }), []);
  return value;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(false);
  });

  it('returns stable=false for useCallback (NOT lifetime-stable)', () => {
    const src = `
import { useCallback } from 'react';
function C() {
  const handler = useCallback(() => {}, []);
  return handler;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(false);
  });

  it('returns stable=useRef for a useRef-bound identifier', () => {
    const src = `
import { useRef } from 'react';
function C() {
  const ref = useRef<number>(0);
  return ref;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useRef');
  });

  it('returns stable=useState-setter for the setter half of useState', () => {
    const src = `
import { useState } from 'react';
function C() {
  const [count, setCount] = useState(0);
  return { count, setCount };
}
`;
    // 'setCount' identifier in the destructuring pattern: line 4, col 17
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 17 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useState-setter');
  });

  it('returns stable=false for the value half of useState (not the setter)', () => {
    const src = `
import { useState } from 'react';
function C() {
  const [count, setCount] = useState(0);
  return count;
}
`;
    // 'count' identifier: line 4, col 10
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 10 });
    expect(r.stable).toBe(false);
  });

  it('returns stable=false for a plain object literal binding', () => {
    const src = `
function C() {
  const opts = { a: 1 };
  return opts;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 3, col: 9 });
    expect(r.stable).toBe(false);
  });

  it('returns stable=false for an identifier bound to an arbitrary function call', () => {
    const src = `
function C() {
  const result = computeSomething();
  return result;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 3, col: 9 });
    expect(r.stable).toBe(false);
  });

  it('returns stable=false when location does not resolve to any identifier', () => {
    const src = `
function C() {
  return 1;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 99, col: 99 });
    expect(r.stable).toBe(false);
  });

  it('useMemo with non-empty deps is NOT stable (re-allocates when deps change)', () => {
    const src = `
import { useMemo } from 'react';
function C(props: { id: string }) {
  const value = useMemo(() => ({ a: props.id }), [props.id]);
  return value;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(false);
  });

  it('handles renamed-import useRef (import { useRef as ur })', () => {
    const src = `
import { useRef as ur } from 'react';
function C() {
  const r = ur(0);
  return r;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useRef');
  });

  it('does NOT mark a useMemo-INNER-binding as stable (it is captured inside the callback)', () => {
    const src = `
import { useMemo } from 'react';
function C() {
  const value = useMemo(() => {
    const inner = { a: 1 };
    return inner;
  }, []);
  return value;
}
`;
    // 'inner' on line 5 is a local binding inside the useMemo callback
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 5, col: 11 });
    expect(r.stable).toBe(false);
  });

  it('resolves a location pointing at a USAGE of a stable identifier (not just the declaration)', () => {
    const src = `
import { useRef } from 'react';
function C() {
  const r = useRef(null);
  console.log(r);
  return r;
}
`;
    // 'r' usage at line 5, col 15
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 5, col: 15 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useRef');
  });

  it('returns stable=useReducer-dispatch for the dispatch half of useReducer', () => {
    // Codex review 2026-05-13: useReducer's dispatch is identity-stable per
    // React's contract — same as useState's setter. Add it to the resolver
    // so rules don't false-positive on dispatch-in-deps cases.
    const src = `
import { useReducer } from 'react';
function C() {
  const [state, dispatch] = useReducer((s: number, a: number) => s + a, 0);
  return { state, dispatch };
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 17 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useReducer-dispatch');
  });

  it('handles namespace usage: React.useRef()', () => {
    // Codex review 2026-05-13 (confidence 0.91): namespace-style hook calls
    // were silently treated as unknown. Now resolved.
    const src = `
import * as React from 'react';
function C() {
  const ref = React.useRef(null);
  return ref;
}
`;
    const r = isStableReactConstruct({ sourceCode: src, file: 'C.tsx', line: 4, col: 9 });
    expect(r.stable).toBe(true);
    if (r.stable) expect(r.kind).toBe('useRef');
  });
});
