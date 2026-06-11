/**
 * @kernlang/check — package-internal shared helpers.
 *
 * The call-agnostic primitives slices 3 (`calls.ts`) and 4 (`returns.ts`)
 * both need: prop-text coercion (mirroring core's `expressionPropText`),
 * non-empty string-prop reads (mirroring core's `stringProp`), and the
 * `new ClassName(...)` literal → class-name extraction (the ONLY argument /
 * return shape whose nominal type is known without use-def analysis).
 *
 * These were originally module-private in `calls.ts` (slice 3); they are
 * lifted here VERBATIM so `returns.ts` REUSES them rather than duplicating the
 * logic. `calls.ts` re-imports them from this module — there is exactly one
 * definition of each in the package.
 */

import type { ValueIR } from '../../core/dist/value-ir.js';

/** A structural IR node — kept narrow so the package carries no compile-time
 *  dependency on core's `IRNode` (core's real node is assignable to it). This
 *  is the same shape `walk.ts` exports; redeclared here to avoid a cycle. */
export interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  children?: readonly IRNode[];
  props?: Record<string, unknown>;
}

/**
 * Extract the nominal class name of an expression IFF it is literally
 * `new ClassName(...)`, else `undefined`. `new ClassName()` parses to
 * `{ kind: 'new', argument: { kind: 'call', callee: { kind: 'ident', name } } }`;
 * `new ClassName` (no call) parses with an ident argument. No other shape
 * yields a known type (nero C1/C4 — no use-def / ident / member resolution).
 */
export function newClassName(value: ValueIR): string | undefined {
  if (value.kind !== 'new') return undefined;
  const inner = value.argument;
  if (inner.kind === 'call' && inner.callee.kind === 'ident') return inner.callee.name;
  if (inner.kind === 'ident') return inner.name;
  return undefined;
}

/** Read a non-empty string prop, mirroring core's `stringProp`. */
export function stringProp(node: IRNode, prop: string): string | undefined {
  const value = node.props?.[prop];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Coerce an expression-bearing prop to its source text, mirroring core's
 *  `expressionPropText` (bare string, `{ __expr, code }` object, or scalar). */
export function expressionPropText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isExpressionObject(value)) return value.code;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function isExpressionObject(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly __expr?: unknown }).__expr === true &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  );
}
