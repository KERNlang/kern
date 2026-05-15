/**
 * Target-aware fixture-IR lowering for the differential harness.
 *
 * Phase 1 PR-3b: extracted from `ts-leg.ts` so the Python leg can reuse the
 * same primitive translations with target-appropriate runtime syntax.
 *
 * Three fixture-only IR nodes get translated into KERN-native shapes before
 * codegen — production emitters never see them:
 *
 *   - `__trace {event:E}` → `do value="<trace-call>(<value-literal>)"`
 *   - `return {value:V}`  → `throw value="new __KernReturn(<value-literal>)"` (TS)
 *                          / `throw value="_KernReturn(<value-literal>)"`    (Python)
 *   - `throw  {errorKind:K}` → `throw value="new __KernThrow(<kind>)"` (TS)
 *                            / `throw value="_KernThrow(<kind>)"`    (Python)
 *
 * `break` and `continue` pass through (they are real KERN body-stmts in both
 * targets).
 *
 * The two targets MUST use identifiers compatible with their host language's
 * literal/identifier syntax:
 *   - TS uses `new` for instantiation; Python does not.
 *   - TS booleans are `true/false`; Python is `True/False`.
 *   - TS uses `null`; Python uses `None`.
 *   - JSON object key order is non-deterministic in some engines; we sort
 *     keys to keep the inlined literal stable across runs.
 */

import type { IRNode } from '../../types.js';

export type LowerTarget = 'ts' | 'python';

/**
 * Serialize a fixture-supplied value as a TARGET-language literal that can
 * be embedded inside `do value="..."` or `throw value="..."`. Deterministic:
 * object keys are sorted; arrays preserve order; nested values recurse.
 *
 * Restricted to a JSON-shaped subset (primitive / array / plain object)
 * plus `null`/`undefined`. Any unsupported type (functions, symbols,
 * Map, Set, RegExp, etc.) throws — fixture authors must keep values in
 * the cross-language portable subset.
 */
export function serializeValue(value: unknown, target: LowerTarget): string {
  if (value === null) return target === 'ts' ? 'null' : 'None';
  if (value === undefined) {
    // TS: `undefined` is a real identifier; Python: map to `None`.
    return target === 'ts' ? 'undefined' : 'None';
  }
  if (typeof value === 'boolean') {
    if (target === 'ts') return value ? 'true' : 'false';
    return value ? 'True' : 'False';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`serializeValue: ${value} is not cross-target portable; use a finite number`);
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeValue(v, target)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const pairs = entries.map(([k, v]) => `${JSON.stringify(k)}: ${serializeValue(v, target)}`);
    return `{${pairs.join(', ')}}`;
  }
  throw new Error(`serializeValue: unsupported type "${typeof value}"`);
}

interface LowerRefs {
  readonly traceFn: string;
  readonly returnSentinel: string;
  readonly throwSentinel: string;
  readonly newKeyword: '' | 'new ';
}

function refsFor(target: LowerTarget): LowerRefs {
  return target === 'ts'
    ? {
        traceFn: '__kernTrace',
        returnSentinel: '__KernReturn',
        throwSentinel: '__KernThrow',
        newKeyword: 'new ',
      }
    : {
        traceFn: '_kern_trace',
        returnSentinel: '_KernReturn',
        throwSentinel: '_KernThrow',
        newKeyword: '',
      };
}

/**
 * Target-aware lowering. Pure: returns a fresh tree (props + children
 * cloned shallowly) so caller mutations cannot leak into the result.
 *
 * @throws when a fixture node carries malformed props (missing `event`,
 *         non-string `errorKind`). Fail loud, not silently.
 */
export function lowerFixtureForTarget(node: IRNode, target: LowerTarget): IRNode {
  const refs = refsFor(target);

  if (node.type === '__trace') {
    const event = node.props?.event;
    if (event === undefined) {
      throw new Error('lowerFixtureForTarget: __trace node requires a non-undefined `event` prop');
    }
    return {
      type: 'do',
      props: { value: `${refs.traceFn}(${serializeValue(event, target)})` },
    };
  }
  if (node.type === 'return') {
    const value = node.props?.value;
    return {
      type: 'throw',
      props: { value: `${refs.newKeyword}${refs.returnSentinel}(${serializeValue(value, target)})` },
    };
  }
  if (node.type === 'throw') {
    const errorKind = node.props?.errorKind;
    if (typeof errorKind !== 'string') {
      throw new Error('lowerFixtureForTarget: throw node requires a string `errorKind` prop');
    }
    return {
      type: 'throw',
      props: { value: `${refs.newKeyword}${refs.throwSentinel}(${serializeValue(errorKind, target)})` },
    };
  }
  // Preserve `children: []` (instead of stripping it) so emit paths that
  // distinguish "no body" from "body present but empty" stay accurate.
  if (Array.isArray(node.children)) {
    return {
      ...node,
      props: node.props ? { ...node.props } : node.props,
      children: node.children.map((c) => lowerFixtureForTarget(c, target)),
    };
  }
  return node;
}
