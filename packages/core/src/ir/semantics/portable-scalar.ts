/**
 * Portable-scalar expression evaluator — the cross-target-safe core shared by
 * the body-statement binding contracts (`let`, `assign`, and the `while`
 * condition).
 *
 * The portable scalar domain is the subset of values TS and Python agree on
 * observably: string, finite number, boolean, null. Expressions are kept
 * deliberately small — literals, identifiers resolving to portable scalars,
 * arithmetic over numbers, comparisons over same-typed scalars, boolean /
 * nullish operators over portable truthiness, and conditional expressions.
 * Same-type guards (`sameType`) keep the evaluator out of the divergent
 * corners (Python `bool == int`, mixed-type ordering, etc.); out-of-domain
 * inputs throw, and callers translate that throw into a precondition failure.
 *
 * Extracted from the `let` contract so `assign` and `while` reuse one
 * evaluator instead of forking subtly different copies. There is intentionally
 * no shared evaluator for the collection contracts (`for` / `lambda` keep their
 * own minimal local `evalValue`) — this module is scoped to scalar bindings.
 */

import {
  assertPortableDecimalLiteral,
  type KDecimalCtor,
  type KDecimalValue,
  kernDecimalStr,
  makeKDecimal,
} from '../../decimal/contract.js';
import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';

export type PortableScalar = string | number | boolean | null;

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_NAMES = new Set([
  'Array',
  'Boolean',
  'JSON',
  'List',
  'Map',
  'Math',
  'None',
  'Number',
  'Object',
  'Set',
  'String',
  'True',
  'False',
  'bool',
  'class',
  'const',
  'def',
  'dict',
  'else',
  'false',
  'for',
  'function',
  'if',
  'int',
  'len',
  'let',
  'list',
  'null',
  'print',
  'return',
  'str',
  'true',
  'undefined',
  'var',
  'while',
]);

/** True when `name` is a syntactically valid, non-reserved, non-internal binding name. */
export function isPortableBindingName(name: unknown): name is string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) return false;
  if (RESERVED_NAMES.has(name)) return false;
  return !name.startsWith('__k') && !name.startsWith('_kern');
}

export function isPortableScalar(value: unknown): value is PortableScalar {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// TAGGED runtime Decimal VALUE — the runner's internal representation of a BOUND
// Decimal (Slice 1). When `expression-v1` effects evaluate a `Decimal.<method>(...)`
// expression they bind THIS tagged value into `env.bindings`, NOT a bare canonical
// string. The Trace's observable `assign.value` is STILL the canonical string (the
// differential observable the oracle reads); the binding carries the tag so the
// runner can tell "this slot holds a Decimal" apart from "this slot holds the
// string '1'".
//
// This is a runtime VALUE, not a new IR node type. It is DELIBERATELY not a
// portable scalar — `isPortableScalar(makeDecimalValue(...))` is false (objects
// never pass that guard), so any DOWNSTREAM portable expression that reads a
// decimal binding (`d === "1"`, `d + 1`, `!d`, `String(d)`, `` `${d}` ``) makes
// `evalPortableValue`'s `ident` case call `assertPortableScalar` on the tagged
// value, which THROWS. The `expression-v1` precondition catches that throw and
// returns false, so `referenceRun` ABSTAINS with the normal "Preconditions
// failed …" instead of producing a value that diverges from BOTH emitted legs.
//
// SLICE-2 will give Decimal real downstream value semantics (`d === "1"` → false,
// `String(d)` → "1"), matching the emitters. SLICE-1 only needs the runner to
// STOP producing a divergent value — to refuse, never to misjudge.
// ─────────────────────────────────────────────────────────────────────────────

/** Brand symbol marking a runtime Decimal value. Symbol-keyed so it can never
 *  collide with a user JSON property and is dropped by structural JSON cloning. */
export const DECIMAL_VALUE_TAG: unique symbol = Symbol('kern.decimalValue');

/** The runner's tagged runtime Decimal value: a frozen object carrying the brand
 *  and the canonical rendered STRING. NOT a portable scalar (see above). */
export interface DecimalValue {
  readonly [DECIMAL_VALUE_TAG]: true;
  readonly canonical: string;
}

/** Build a tagged runtime Decimal value from its canonical rendered string. */
export function makeDecimalValue(canonical: string): DecimalValue {
  return Object.freeze({ [DECIMAL_VALUE_TAG]: true as const, canonical });
}

/** True iff `value` is a tagged runtime Decimal value produced by
 *  {@link makeDecimalValue}. */
export function isDecimalValue(value: unknown): value is DecimalValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [DECIMAL_VALUE_TAG]?: unknown })[DECIMAL_VALUE_TAG] === true &&
    typeof (value as { canonical?: unknown }).canonical === 'string'
  );
}

export function assertPortableScalar(value: unknown, label: string): PortableScalar {
  if (isPortableScalar(value)) return value;
  throw new Error(`portable: ${label} must evaluate to a portable scalar`);
}

export function portableTruthy(value: PortableScalar): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.length > 0;
}

export function sameType(a: PortableScalar, b: PortableScalar): boolean {
  if (a === null || b === null) return a === b;
  return typeof a === typeof b;
}

export function evalPortableValue(node: ValueIR, env: SemanticEnv): PortableScalar {
  switch (node.kind) {
    case 'numLit':
      if (node.bigint || !Number.isFinite(node.value)) throw new Error('portable: number literal must be finite');
      return node.value;
    case 'strLit':
      return node.value;
    case 'boolLit':
      return node.value;
    case 'nullLit':
      return null;
    case 'ident': {
      if (!env.bindings.has(node.name)) throw new Error(`portable: binding "${node.name}" not found`);
      return assertPortableScalar(env.bindings.get(node.name), `binding "${node.name}"`);
    }
    case 'unary': {
      const value = evalPortableValue(node.argument, env);
      if (node.op === '!') return !portableTruthy(value);
      if (node.op === '-' || node.op === '+') {
        if (typeof value !== 'number') throw new Error(`portable: unary ${node.op} requires a number`);
        const out = node.op === '-' ? -value : value;
        return assertPortableScalar(out, `unary ${node.op}`);
      }
      throw new Error(`portable: unsupported unary op "${node.op}"`);
    }
    case 'binary':
      return evalPortableBinary(node, env);
    case 'conditional':
      return portableTruthy(evalPortableValue(node.test, env))
        ? evalPortableValue(node.consequent, env)
        : evalPortableValue(node.alternate, env);
    case 'typeAssert':
    case 'nonNull':
      return evalPortableValue(node.expression, env);
    case 'tmplLit': {
      let result = '';
      for (let i = 0; i < node.quasis.length; i++) {
        result += node.quasis[i];
        if (i < node.expressions.length) {
          const val = evalPortableValue(node.expressions[i], env);
          result += coerceToString(val);
        }
      }
      return result;
    }
    case 'call': {
      if (node.callee.kind === 'ident' && node.callee.name === 'String') {
        if (node.args.length !== 1) {
          throw new Error('portable: String() expects exactly 1 argument');
        }
        const val = evalPortableValue(node.args[0], env);
        return coerceToString(val);
      }
      throw new Error(`portable: unsupported call to "${node.callee.kind === 'ident' ? node.callee.name : 'unknown'}"`);
    }
    default:
      throw new Error(`portable: expression kind "${node.kind}" is outside the portable scalar domain`);
  }
}

export function coerceToString(val: PortableScalar): string {
  if (val === null) return 'null';
  return String(val);
}

export function evalPortableBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv): PortableScalar {
  if (node.op === '&&') {
    const left = evalPortableValue(node.left, env);
    return portableTruthy(left) ? evalPortableValue(node.right, env) : left;
  }
  if (node.op === '||') {
    const left = evalPortableValue(node.left, env);
    return portableTruthy(left) ? left : evalPortableValue(node.right, env);
  }
  if (node.op === '??') {
    const left = evalPortableValue(node.left, env);
    return left === null ? evalPortableValue(node.right, env) : left;
  }

  const left = evalPortableValue(node.left, env);
  const right = evalPortableValue(node.right, env);
  switch (node.op) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return assertPortableScalar(left + right, '+');
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      throw new Error('portable: + requires two numbers or two strings');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    case '===':
    case '==':
      if (!sameType(left, right)) throw new Error('portable: equality operands must have the same portable type');
      return left === right;
    case '!==':
    case '!=':
      if (!sameType(left, right)) throw new Error('portable: equality operands must have the same portable type');
      return left !== right;
    case '<':
    case '<=':
    case '>':
    case '>=':
      if (
        !sameType(left, right) ||
        !(
          (typeof left === 'number' && typeof right === 'number') ||
          (typeof left === 'string' && typeof right === 'string')
        )
      ) {
        throw new Error(`portable: ${node.op} requires same-typed number or string operands`);
      }
      return evalOrderedComparison(node.op, left, right);
    default:
      throw new Error(`portable: unsupported binary op "${node.op}"`);
  }
}

export function evalNumberBinary(op: string, left: PortableScalar, right: PortableScalar): PortableScalar {
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`portable: ${op} requires numbers`);
  if (op === '-') return assertPortableScalar(left - right, op);
  if (op === '*') return assertPortableScalar(left * right, op);
  if (op === '/') return assertPortableScalar(left / right, op);
  return assertPortableScalar(left % right, op);
}

export function evalOrderedComparison(op: string, left: string | number, right: string | number): boolean {
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  return left >= right;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNNER-NATIVE Decimal (Slice 1: `Decimal.of` / `Decimal.add` / `Decimal.mul`).
//
// The ReferenceRunner executes the `Decimal` primitive natively as a THIRD "leg"
// of the decimal differential oracle, byte-matching both emitted legs (decimal.js
// on TS, stdlib `decimal` on Python). It does so by recognizing `Decimal.<method>`
// member-calls — the SAME callee shape the emitters dispatch on (`callee.object`
// is the bare `Decimal` namespace identifier) — and computing on a LOCAL cloned
// decimal.js constructor pinned to the canonical context. Decimal stays a plain
// `call` node; no new IR node type is introduced.
//
// Decimal values are NOT portable scalars (a live decimal.js instance is neither
// string/number/boolean/null), so this lives ALONGSIDE `evalPortableValue` rather
// than inside it — the portable-scalar domain is unchanged. The runner's in-flight
// Decimal value is a live `KDecimalValue`; only at the OUTPUT boundary
// ({@link evalDecimalExpression}) is it rendered to a canonical STRING via the
// kernel's {@link kernDecimalStr}.
// ─────────────────────────────────────────────────────────────────────────────

/** The Slice-1 Decimal namespace methods the runner evaluates natively. */
const RUNNER_DECIMAL_METHODS = new Set(['of', 'add', 'mul']);

/** True iff `node` is a `Decimal.<method>(...)` member-call on the bare `Decimal`
 *  namespace identifier — the EXACT recognition shape the emitters use
 *  (`callee.kind === 'member'`, `callee.object` is `ident 'Decimal'`). A user
 *  binding named `decimal` or a member chain is NOT matched. */
function isDecimalNamespaceCall(node: ValueIR): node is Extract<ValueIR, { kind: 'call' }> {
  if (node.kind !== 'call') return false;
  const callee = node.callee;
  if (callee.kind !== 'member') return false;
  return callee.object.kind === 'ident' && callee.object.name === 'Decimal';
}

/** Evaluate a `Decimal.<method>(...)` expression (or a recursively-nested operand
 *  of one) to a live Decimal value, computing on the supplied LOCAL pinned
 *  constructor `KDecimal`. Operands are evaluated recursively, so nested forms
 *  like `Decimal.add(Decimal.of("1.5"), Decimal.mul(...))` work.
 *
 *  - `Decimal.of("lit")` — validates the literal with the shared portable-literal
 *    validator (fail-close with the EXACT shared message on non-canonical input),
 *    then constructs `new KDecimal("lit")`.
 *  - `Decimal.add(a, b)` → `a.plus(b)`; `Decimal.mul(a, b)` → `a.times(b)`.
 *
 *  No `env` is threaded: every Slice-1 operand is itself a `Decimal.<method>(...)`
 *  literal-rooted call, so there is nothing to look up. VARIABLE operands
 *  (`Decimal.add(d, Decimal.of("1"))`) are SLICE-2 — when they arrive this gains
 *  an env parameter and an `ident` operand branch.
 *
 *  Throws on any non-Decimal-namespace node, an unknown/out-of-slice method, a
 *  wrong arity, or a non-string-literal `of` argument — the runner refuses what it
 *  cannot execute byte-identically rather than guessing. The set of inputs that
 *  reach this WITHOUT a structural throw is exactly {@link isDecimalExpression}'s
 *  `true` set; on those it either succeeds or throws ONLY the canonical
 *  `Decimal.of` fail-close. */
function evalDecimalNode(node: ValueIR, KDecimal: KDecimalCtor): KDecimalValue {
  if (!isDecimalNamespaceCall(node)) {
    throw new Error('portable-decimal: expected a Decimal.<method>(...) namespace call');
  }
  // Narrowed: callee is a member on the `Decimal` ident.
  const method = (node.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (!RUNNER_DECIMAL_METHODS.has(method)) {
    throw new Error(`portable-decimal: Decimal.${method} is outside the runner's Slice-1 surface (of/add/mul)`);
  }

  if (method === 'of') {
    if (node.args.length !== 1) {
      throw new Error('portable-decimal: Decimal.of expects exactly 1 argument');
    }
    const arg = node.args[0];
    if (arg.kind !== 'strLit') {
      throw new Error('portable-decimal: Decimal.of requires a string literal argument');
    }
    // Shared fail-close: a non-canonical literal throws the EXACT kernel message,
    // byte-identical to what both emitters throw at the `Decimal.of` lowering site.
    assertPortableDecimalLiteral(arg.value);
    return new KDecimal(arg.value);
  }

  // add / mul — two Decimal operands, each evaluated recursively.
  if (node.args.length !== 2) {
    throw new Error(`portable-decimal: Decimal.${method} expects exactly 2 arguments`);
  }
  const a = evalDecimalNode(node.args[0], KDecimal);
  const b = evalDecimalNode(node.args[1], KDecimal);
  return method === 'add' ? a.plus(b) : a.times(b);
}

/** True iff `node` is a STRUCTURALLY-EVALUABLE Slice-1 Decimal expression —
 *  i.e. a `Decimal.of/add/mul(...)` namespace call whose entire operand tree is
 *  itself made of structurally-valid Decimal namespace calls down to
 *  `Decimal.of("<strLit>")` leaves. This is the recursive admission predicate the
 *  runner routes on: it must accept EXACTLY the inputs {@link evalDecimalNode}
 *  can reach without a STRUCTURAL throw, so a `true` result guarantees
 *  {@link evalDecimalExpression} either succeeds or throws ONLY the canonical
 *  `Decimal.of` fail-close (never an arity / shape / out-of-slice error).
 *
 *  It deliberately does NOT check the literal's CANONICAL-ness: a non-canonical
 *  `Decimal.of("1.10")` is structurally valid → `true`, and effects fails closed
 *  with the shared canonical-scale message (mirroring the emitters, which compile
 *  the call but throw at the lowering boundary).
 *
 *  Examples — `true`: `Decimal.of("1.5")`, `Decimal.of("1.10")`,
 *  `Decimal.add(Decimal.of("1"), Decimal.of("2"))`, arbitrarily nested
 *  `add`/`mul`. `false`: `Decimal.add(1, 2)` (non-Decimal operand),
 *  `Decimal.of(x)` (ident, not strLit — Slice-2), `Decimal.div(...)` (out of
 *  slice), `Decimal.of("1","2")` (arity), `Decimal.of()` (arity),
 *  `String(n)` / `1 + 2` (not a Decimal namespace call). */
export function isDecimalExpression(node: ValueIR): boolean {
  if (!isDecimalNamespaceCall(node)) return false;
  // Narrowed by isDecimalNamespaceCall: callee is a `member` on the Decimal ident.
  const method = (node.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (!RUNNER_DECIMAL_METHODS.has(method)) return false;

  if (method === 'of') {
    // Exactly one string-literal argument (Slice-1: literal operands only).
    return node.args.length === 1 && node.args[0].kind === 'strLit';
  }

  // add / mul — exactly two operands, each itself a structurally-valid Decimal
  // namespace call (recurse — closes the over-accept on `Decimal.add(1, 2)`).
  return node.args.length === 2 && isDecimalExpression(node.args[0]) && isDecimalExpression(node.args[1]);
}

/** Evaluate a `Decimal.<method>(...)` expression through the runner's native
 *  Decimal evaluation and render the result to its KERN-canonical STRING — the
 *  runner's third "leg" of the decimal differential oracle. Computes on a LOCAL
 *  cloned constructor pinned to the canonical context (precision 28,
 *  ROUND_HALF_EVEN, modulo ROUND_DOWN) — NEVER mutating the global decimal.js
 *  constructor — and renders via the kernel's {@link kernDecimalStr}, so the output
 *  is byte-identical to both emitted legs. A non-canonical `Decimal.of` literal
 *  fails closed with the EXACT shared message.
 *
 *  Takes no `env`: Slice-1 operands are literal-rooted, so there is nothing to
 *  resolve. Variable operands are SLICE-2 (see {@link evalDecimalNode}). */
export function evalDecimalExpression(node: ValueIR): string {
  const KDecimal = makeKDecimal();
  return kernDecimalStr(evalDecimalNode(node, KDecimal));
}
