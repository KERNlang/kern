/**
 * Canonical constructor-super analysis — the SINGLE source of truth for the one
 * question every KERN layer must answer the same way: does a constructor contain
 * a direct `super(...)` constructor call?
 *
 * KERN's constructor semantic (Option C): a derived constructor MAY omit
 * `super(...)`. When it does, KERN implicitly initializes the base first; when it
 * writes an explicit `super(...)`, the author owns its placement and the strict
 * discipline (no double/conditional super, no `this` before super) applies. The
 * fork between those two modes is decided by exactly this predicate, and it MUST
 * be decided identically by the semantic validator, the in-process core runtime,
 * and BOTH codegen targets (TS + Python) — otherwise a program is legal in one
 * layer and rejected/divergent in another (the precise bug this module exists to
 * prevent). Previously each layer answered it differently: the validator walked
 * the IR, while both codegens scanned EMITTED text (`/\bsuper\s*\(/` /
 * `"super().__init__"`), which false-matched `super(` inside string literals and
 * comments. One structural predicate, consumed everywhere, removes that drift.
 *
 * "Direct" mirrors the validator's long-standing rule precisely:
 *  - a `super(...)` call where the callee is the bare `super` identifier counts;
 *  - `super.method()` (a super MEMBER call) does NOT — it never initializes base;
 *  - a `super(...)` inside a lambda/arrow body does NOT — it never runs at
 *    construction time;
 *  - calls inside `if`/`else` branches DO count (the call is structurally present;
 *    whether it runs on every path is a separate discipline concern).
 */

import { parseExpression } from './parser-expression.js';
import type { IRNode } from './types.js';

// Props on a body statement whose value is an expression we must scan. Kept in
// sync with the validator's BODY_EXPRESSION_PROPS — a `super(...)` can appear in
// a `do value=...`, a `return value=...`, an `if cond=...`, etc.
const SUPER_SCAN_PROPS = [
  'value',
  'expr',
  'target',
  'cond',
  'on',
  'in',
  'from',
  'to',
  'initial',
  'source',
  'sources',
  'cleanup',
  'min',
  'max',
] as const;

/** True when `value` is the parser's wrapped-expression object `{__expr:true, code}`. */
function expressionCode(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly __expr?: unknown }).__expr === true &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  ) {
    return (value as { readonly code: string }).code;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Structural recursion over a parsed expression looking for a direct `super(...)`
 * constructor call. Equivalent to the validator's `valueIRCallsSuperConstructor`
 * (super-ident callee => yes; lambda => stop, never descend; else recurse), but
 * self-contained so this module depends only on the parser + node types.
 */
function valueContainsSuperCtorCall(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as { kind?: string; callee?: { kind?: string; name?: string } };
  // A lambda body that calls super never runs during construction — do not descend.
  if (node.kind === 'lambda') return false;
  if (node.kind === 'call' && node.callee?.kind === 'ident' && node.callee.name === 'super') {
    return true;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      if (child.some(valueContainsSuperCtorCall)) return true;
    } else if (child && typeof child === 'object') {
      if (valueContainsSuperCtorCall(child)) return true;
    }
  }
  return false;
}

/** The constructor's executable statements (handler body, minus params/decorators). */
function constructorBodyStatements(ctor: IRNode): readonly IRNode[] {
  const handler = ctor.children?.find((child) => child.type === 'handler');
  const body = handler ? (handler.children ?? []) : (ctor.children ?? []);
  return body.filter((child) => child.type !== 'param' && child.type !== 'decorator');
}

/** Walk a statement subtree, stopping at a nested `class` (its super belongs to it). */
function statementContainsSuperCtorCall(node: IRNode, isRoot: boolean): boolean {
  if (!isRoot && node.type === 'class') return false;
  for (const prop of SUPER_SCAN_PROPS) {
    const code = expressionCode(node.props?.[prop]);
    if (code === undefined) continue;
    try {
      if (valueContainsSuperCtorCall(parseExpression(code))) return true;
    } catch {
      // Unparseable expression text can't be a structural super call — ignore.
    }
  }
  return (node.children ?? []).some((child) => statementContainsSuperCtorCall(child, false));
}

/**
 * Does this constructor contain a direct `super(...)` constructor call anywhere
 * in its body (including inside `if`/`else` branches, but not inside lambdas or
 * nested classes)? `true` => explicit-super mode (author owns placement, strict
 * discipline applies). `false` => implicit-super mode (KERN injects base init).
 */
export function hasDirectSuperCtorCall(ctor: IRNode): boolean {
  return constructorBodyStatements(ctor).some((stmt) => statementContainsSuperCtorCall(stmt, true));
}
