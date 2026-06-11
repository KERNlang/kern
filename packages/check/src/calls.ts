/**
 * @kernlang/check — direct call-site assignability (slice 3).
 *
 * `checkCalls` walks a parsed KERN program's expression bodies and reports two
 * call-site rules against top-level `fn` declarations:
 *
 *   - check-call-arity   — a call passes the wrong number of arguments.
 *   - check-call-arg-type — an argument's nominal type is not assignable to the
 *                           corresponding parameter type (per slice-1
 *                           `assignable`: subclass ACCEPT, sibling/unrelated
 *                           REJECT, unknown SKIP).
 *
 * NERO-NARROWED SCOPE (the v1 that cannot false-positive). The whole point of
 * this slice is zero false positives, so it deliberately resolves only the two
 * shapes whose meaning is unambiguous WITHOUT use-def / this-context analysis:
 *
 *   - Callees: BARE-IDENT only (`{ kind: 'call', callee: { kind: 'ident' } }`)
 *     resolving to a top-level `fn` of that name. Member callees
 *     (`obj.f(...)`, `this.f(...)`, `console.log(...)`), curried (`f()()`) and
 *     chained (`a.b().c()`) callees all SKIP — handlers/methods lack threaded
 *     class context (nero C2) and member resolution is slice-5 territory.
 *   - Argument types: known ONLY when the argument expression is literally
 *     `new ClassName(...)` with ClassName a known class. NO let-binding / ident
 *     / member resolution (nero C1/C4 — real use-def is slice 5). Every other
 *     argument shape → unknown → that argument position is SKIPPED.
 *
 * PARAM DIALECT (probed): a `fn` carries params either as child `param` nodes
 * (`name`/`type` props, plus optional `rest`/`default`/`optional` markers) or
 * as a single `params=` string prop (which can encode `...rest`, `= default`
 * and `{ destructure }` forms). Both NON-SIMPLE forms exist in the dialect, so
 * — per the spec — the rules are RESTRICTED to callees whose params are all
 * simple named children: child `param` nodes with no `rest`/`default`/
 * `optional` marker and no `params=` string. Any other form makes the whole
 * call SKIP (the fn is treated as having unknown arity/params). This is NOT
 * vacuous: the common simple-param `fn` is still fully checked.
 *
 * CALL ENUMERATION: a package-local recursive `ValueIR` visitor (core untouched
 * — nero C5) over every statement attribute that `parseExpression` accepts
 * (`BODY_EXPRESSION_PROPS`, mirrored from core's semantic validator). Nested
 * calls (`foo() + bar()`, calls inside other calls' args) ARE visited.
 * Unparseable / legacy bodies are SKIPPED silently (parse errors swallowed).
 */

import { parseExpression } from '../../core/dist/parser-expression.js';
import type { ClassInfo } from '../../core/dist/semantic-validator.js';
import { collectClassInfos } from '../../core/dist/semantic-validator.js';
import type { ValueIR } from '../../core/dist/value-ir.js';
import { assignable, type NominalClassInfo } from './assignable.js';
import type { IRNode } from './walk.js';

/** A call-site check rule identifier. */
export type CallCheckRule = 'check-call-arity' | 'check-call-arg-type';

/** A single call-site diagnostic produced by {@link checkCalls}. */
export interface CallCheckDiagnostic {
  rule: CallCheckRule;
  /** The bare-ident callee name. */
  callee: string;
  /** Zero-based argument index for `check-call-arg-type`; omitted for arity. */
  argIndex?: number;
  reason: string;
}

/**
 * A resolved, checkable top-level `fn`: its declared parameter types (positional;
 * `undefined` where a param has no annotation) and its arity. Only fns whose
 * params are all simple named children are represented here — non-simple fns are
 * never registered, so a call to them resolves to `undefined` and SKIPs.
 */
interface CheckableFn {
  paramTypes: ReadonlyArray<string | undefined>;
  arity: number;
}

/** The expression-bearing props core's `parseExpression` is run over. Mirrors
 *  semantic-validator.ts:BODY_EXPRESSION_PROPS verbatim (core untouched). */
const BODY_EXPRESSION_PROPS = [
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

/**
 * Walk a parsed KERN program and report direct call-site arity / arg-type
 * violations against top-level `fn` declarations.
 *
 * @param root the parsed program IR (a `document`/module root).
 */
export function checkCalls(root: IRNode): CallCheckDiagnostic[] {
  const diagnostics: CallCheckDiagnostic[] = [];

  // classByName: first-wins, mirroring the validator (slice 2 / core).
  const classes = collectClassInfos(root as never) as readonly ClassInfo[];
  const classByName = new Map<string, NominalClassInfo>();
  for (const info of classes) {
    if (!classByName.has(info.name)) {
      classByName.set(info.name, { name: info.name, ...(info.baseName ? { baseName: info.baseName } : {}) });
    }
  }

  // fnByName: first-wins registry of CHECKABLE top-level fns (simple params
  // only). Non-simple fns are intentionally absent → calls to them SKIP.
  const fnByName = collectCheckableFns(root);

  // Recursive ValueIR visitor over every expression-bearing statement prop.
  walkTree(root, (node) => {
    for (const prop of BODY_EXPRESSION_PROPS) {
      const text = expressionPropText(node.props?.[prop]);
      if (text === undefined) continue;
      let value: ValueIR;
      try {
        value = parseExpression(text);
      } catch {
        continue; // unparseable / legacy body → SKIP silently.
      }
      visitValue(value, fnByName, classByName, diagnostics);
    }
  });

  return diagnostics;
}

/**
 * Collect every top-level `fn` declaration with SIMPLE params into a first-wins
 * registry. A fn is checkable iff it uses only child `param` nodes, none of
 * which carry a `rest`, `default`, or `optional` marker, and it has no `params=`
 * string prop. Non-simple fns are omitted so their call sites SKIP.
 */
function collectCheckableFns(root: IRNode): ReadonlyMap<string, CheckableFn> {
  const fns = new Map<string, CheckableFn>();
  walkTree(root, (node) => {
    if (node.type !== 'fn') return;
    const name = stringProp(node, 'name');
    if (!name) return;
    if (fns.has(name)) return; // first-wins
    const checkable = checkableFn(node);
    if (!checkable) return; // non-simple params → not registered.
    fns.set(name, checkable);
  });
  return fns;
}

/**
 * Resolve a `fn` node to a {@link CheckableFn} iff its params are all simple
 * named children, else `undefined` (the call must SKIP).
 */
function checkableFn(node: IRNode): CheckableFn | undefined {
  // The `params=` string dialect encodes rest/default/destructure forms; treat
  // ANY use of it as non-simple → SKIP.
  if (node.props?.params !== undefined) return undefined;

  const children = node.children ?? [];
  const paramTypes: Array<string | undefined> = [];
  for (const child of children) {
    if (child.type !== 'param') continue;
    // Any non-simple marker disqualifies the entire fn.
    if (isTrueFlag(child.props?.rest) || child.props?.default !== undefined || isTrueFlag(child.props?.optional)) {
      return undefined;
    }
    const type = stringProp(child, 'type');
    paramTypes.push(type);
  }
  return { paramTypes, arity: paramTypes.length };
}

/**
 * Recursively visit a {@link ValueIR}, checking every bare-ident `call` against
 * the fn registry. Descends into a call's ARGS (so nested calls in argument
 * position are reached) but NOT its callee position — a call in callee position
 * is a curried/chained call, which the nero-narrowed scope SKIPs. Non-call
 * nodes descend into all sub-expressions (operands, array items, ternary arms).
 */
function visitValue(
  value: ValueIR,
  fnByName: ReadonlyMap<string, CheckableFn>,
  classByName: ReadonlyMap<string, NominalClassInfo>,
  diagnostics: CallCheckDiagnostic[],
): void {
  if (value.kind === 'call') {
    if (value.callee.kind === 'ident') {
      const fn = fnByName.get(value.callee.name);
      if (fn) {
        checkCallAgainstFn(value.callee.name, value, fn, classByName, diagnostics);
      }
    }
    // Descend into the ARGS only — NOT the callee position. A call sitting in
    // another call's callee position is a curried/chained call (`f()()`,
    // `a.b().c()`); per the nero-narrowed scope those callees SKIP, so we never
    // re-check the inner call. Args still recurse (nested calls in args ARE
    // visited), which is what the positive corpus exercises.
    for (const arg of value.args) {
      visitValue(arg, fnByName, classByName, diagnostics);
    }
    return;
  }
  // Non-call node: descend into every sub-expression so nested calls
  // (`foo() + bar()`, calls in operands / array items / ternary arms) are
  // reached.
  for (const child of valueChildren(value)) {
    visitValue(child, fnByName, classByName, diagnostics);
  }
}

/**
 * Apply the arity + per-arg type rules for one bare-ident call to a resolved
 * checkable fn. Spread args make arity indeterminate → the whole call SKIPs.
 */
function checkCallAgainstFn(
  callee: string,
  call: Extract<ValueIR, { kind: 'call' }>,
  fn: CheckableFn,
  classByName: ReadonlyMap<string, NominalClassInfo>,
  diagnostics: CallCheckDiagnostic[],
): void {
  // A spread argument (`f(...xs)`) makes the effective arg count unknown — skip
  // BOTH arity and arg-type checks to stay zero-FP.
  if (call.args.some((arg) => arg.kind === 'spread')) return;

  if (call.args.length !== fn.arity) {
    diagnostics.push({
      rule: 'check-call-arity',
      callee,
      reason:
        `Call to '${callee}' passes ${call.args.length} argument(s) but '${callee}' ` +
        `declares ${fn.arity} parameter(s).`,
    });
    // Arity mismatch ⇒ positional arg-type checks would be misaligned; stop here.
    return;
  }

  for (let index = 0; index < call.args.length; index += 1) {
    const argType = newClassArgType(call.args[index]);
    if (argType === undefined) continue; // arg type unknown → SKIP this position.
    const paramType = fn.paramTypes[index];
    if (paramType === undefined) continue; // param unannotated → SKIP this position.
    const verdict = assignable(argType, paramType, classByName);
    if (verdict.ok === false) {
      diagnostics.push({
        rule: 'check-call-arg-type',
        callee,
        argIndex: index,
        reason:
          `Argument ${index} of call to '${callee}' has type '${argType}', which is not ` +
          `assignable to parameter type '${paramType}'.`,
      });
    }
  }
}

/**
 * Extract the nominal class name of an argument expression IFF it is literally
 * `new ClassName(...)`, else `undefined`. `new ClassName()` parses to
 * `{ kind: 'new', argument: { kind: 'call', callee: { kind: 'ident', name } } }`.
 * No other argument shape yields a known type (nero C1/C4 — no use-def).
 */
function newClassArgType(arg: ValueIR): string | undefined {
  if (arg.kind !== 'new') return undefined;
  const inner = arg.argument;
  if (inner.kind === 'call' && inner.callee.kind === 'ident') return inner.callee.name;
  // `new Foo` (no call) parses with an ident argument; treat the bare ident as
  // the class name too.
  if (inner.kind === 'ident') return inner.name;
  return undefined;
}

/**
 * Enumerate the direct {@link ValueIR} sub-expressions of a NON-call node.
 * `call` is intentionally absent: {@link visitValue} handles calls inline
 * (descending into args only, never the callee) and never delegates a `call`
 * here, so curried/chained callees stay unvisited.
 */
function valueChildren(value: ValueIR): ValueIR[] {
  switch (value.kind) {
    case 'member':
    case 'index':
      return value.kind === 'member' ? [value.object] : [value.object, value.index];
    case 'binary':
      return [value.left, value.right];
    case 'unary':
      return [value.argument];
    case 'spread':
    case 'await':
    case 'new':
      return [value.argument];
    case 'typeAssert':
    case 'nonNull':
      return [value.expression];
    case 'propagate':
      return [value.argument];
    case 'conditional':
      return [value.test, value.consequent, value.alternate];
    case 'arrayLit':
      return value.items;
    case 'objectLit':
      return value.entries.map((entry) => ('value' in entry ? entry.value : entry.argument));
    case 'tmplLit':
      return value.expressions;
    case 'lambda':
      // Expression-bodied arrows expose their body; block-bodied arrows keep
      // their body as opaque raw TS (no ValueIR) — nothing to descend into.
      return value.body ? [value.body] : [];
    default:
      return [];
  }
}

/** True when a flag prop is the boolean `true` or the string `'true'`. */
function isTrueFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Read a non-empty string prop, mirroring core's `stringProp`. */
function stringProp(node: IRNode, prop: string): string | undefined {
  const value = node.props?.[prop];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Coerce an expression-bearing prop to its source text, mirroring core's
 *  `expressionPropText` (bare string, `{ __expr, code }` object, or scalar). */
function expressionPropText(value: unknown): string | undefined {
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

/** Pre-order walk of the IR tree, mirroring core's `walkSemanticTree`. */
function walkTree(node: IRNode, visit: (node: IRNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkTree(child, visit);
}
