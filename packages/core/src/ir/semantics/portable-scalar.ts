/**
 * Portable-scalar expression evaluator — the cross-target-safe core shared by
 * the body-statement binding contracts (`let`, `assign`, and the `while`
 * condition).
 *
 * The portable scalar domain is the subset of values TS and Python agree on
 * observably: string, finite number, boolean, null. Expressions are kept
 * deliberately small — literals, identifiers resolving to portable scalars,
 * arithmetic over numbers, comparisons over same-typed scalars, boolean /
 * nullish operators over portable truthiness, in-bounds array index reads,
 * and conditional expressions.
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
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  type KDecimalCtor,
  type KDecimalValue,
  kDecimalDiv,
  kDecimalMod,
  kDecimalPowInt,
  kernDecimalStr,
  makeKDecimal,
} from '../../decimal/contract.js';
import {
  assertNonZeroDecimalDivisor,
  assertPortableDecimalPow,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  type DecimalProbeAccessor,
} from '../../decimal/probe-gates.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { getBinding, hasBinding } from './index.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// TAGGED runtime CAUGHT-ERROR VALUE — the runner's internal representation of an
// error bound to a `catch name=…` binding (error-substrate Slice 1). Like the
// Decimal tag above it is DELIBERATELY not a portable scalar, so any downstream
// read of the catch binding OTHER than the admitted `.message` access hits
// `assertPortableScalar` and throws → the precondition catches it → the runner
// ABSTAINS (the fail-close fence: a bare `return e`, `e.name`, `e.stack` never
// produce a divergent value). Only the `member` case below reads through the
// tag, and ONLY for `.message`. The tag + recognition helpers live in
// `portable-error.ts`; the VALUE shape lives here so the `member` case can read
// it without a module cycle.
// ─────────────────────────────────────────────────────────────────────────────

/** Brand symbol marking a runtime CAUGHT-ERROR value (see `portable-error.ts`). */
export const CAUGHT_ERROR_TAG: unique symbol = Symbol('kern.caughtError');

/** The runner's tagged caught-error value: a frozen object carrying the brand,
 *  the canonical error `kind`, and the evaluated literal `message`. NOT a
 *  portable scalar. */
export interface CaughtErrorValue {
  readonly [CAUGHT_ERROR_TAG]: true;
  readonly kind: string;
  readonly message: string;
}

/** True iff `value` is a tagged caught-error value. */
export function isCaughtErrorValue(value: unknown): value is CaughtErrorValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [CAUGHT_ERROR_TAG]?: unknown })[CAUGHT_ERROR_TAG] === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
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

/** True iff `node` is a BARE non-negative safe-integer DECIMAL literal — the only
 *  index form provably byte-identical across `kern run`, emitted TS, and emitted
 *  Python. The raw text must be all digits that round-trip exactly through a safe
 *  JS integer (`String(Number(raw)) === raw`), which rejects in ONE check:
 *    - float / exponent literals (`1.0`, `1e3`) — Python list indices must be int;
 *    - UNSAFE integer literals (`9007199254740993`) — JS rounds them, Python keeps
 *      exact precision, so the index would diverge;
 *    - LEADING-ZERO literals (`05`) — a SyntaxError in JS strict mode AND Python.
 *
 *  ARITHMETIC is deliberately EXCLUDED (not just `/`): integer `%` diverges on a
 *  negative operand (JS `5 % -3 === 2`, Python `== -1`), and `+`/`-`/`*` over safe
 *  literals can produce an intermediate that overflows 2^53 and rounds in JS while
 *  Python stays exact — both verified real divergences. IDENTIFIERS and nested
 *  index-reads are excluded too (they can resolve to a Python float). So a computed
 *  or variable index ABSTAINS; dynamic indexing is deferred to a slice that proves
 *  exact integer arithmetic (e.g. BigInt-checked) or carries integer provenance. */
function isSafeIntegerLiteralIndex(node: ValueIR): boolean {
  if (node.kind !== 'numLit' || node.bigint) return false;
  if (!/^[0-9]+$/.test(node.raw)) return false;
  const n = Number(node.raw);
  return Number.isSafeInteger(n) && String(n) === node.raw && node.value === n;
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
      if (!hasBinding(env, node.name)) throw new Error(`portable: binding "${node.name}" not found`);
      return assertPortableScalar(getBinding(env, node.name), `binding "${node.name}"`);
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
    case 'member': {
      // Error-substrate Slice 1 — the ONLY admitted member read in the portable
      // domain is `<caughtErrorBinding>.message` (a non-optional `.message` on
      // an ident resolving to a tagged caught-error value). It returns the
      // EVALUATED LITERAL message stored when the explicit `throw new Error("…")`
      // was caught — byte-identical to TS `e.message` and Python `str(e)`.
      // EVERYTHING else (a different property, an optional `?.`, a non-ident
      // object, an ident that is not a caught error) throws → the runner
      // ABSTAINS. This is the fail-close fence: `e.name`/`e.stack`/`e` (bare)
      // and any non-caught-error member access never produce a one-leg value.
      if (node.optional) throw new Error('portable: optional member access is outside the portable scalar domain');
      if (!isValueIR(node.object) || node.object.kind !== 'ident') {
        throw new Error('portable: member access is only admitted on a caught-error binding');
      }
      const obj = getBinding(env, node.object.name);
      if (!isCaughtErrorValue(obj)) {
        throw new Error(`portable: member access on "${node.object.name}" is outside the portable scalar domain`);
      }
      if (node.property !== 'message') {
        throw new Error(
          `portable: caught error has no portable property "${node.property}" (only .message is admitted)`,
        );
      }
      return obj.message;
    }
    case 'index': {
      // Array INDEX read (slice-2b). Certify ONLY an in-bounds, non-negative,
      // safe-integer index whose SOURCE is a BARE integer LITERAL, into an
      // ident-bound array, returning a PORTABLE SCALAR element. Everything else
      // throws -> the runner ABSTAINS.
      //
      // The index is restricted to a literal ({@link isSafeIntegerLiteralIndex})
      // because of TS<->Python divergences verified on real node+python3:
      //   - INT vs FLOAT: Python list indices MUST be int — `xs[1.0]`, `xs[4/2]`
      //     (Python `/` is float), and any ident bound to a float raise TypeError
      //     in Python while JS + the reference collapse `1.0 === 1` and read xs[1].
      //   - integer `%` diverges on a negative operand (`5 % -3` is 2 in JS, -1 in
      //     Python), and `+`/`-`/`*` over safe literals can overflow 2^53 and round
      //     in JS while Python stays exact — so ARITHMETIC indices abstain.
      //   - JS has no int/float distinction and the emitters preserve the source
      //     numeric form, so the reference cannot tell a Python int from a float by
      //     VALUE — hence the syntactic literal gate, not a value check.
      // Idents / nested index-reads abstain (a binding can hold a Python float);
      // dynamic indexing is a later slice. Then OOB / NEGATIVE are caught at runtime
      // (TS undefined vs Py IndexError / wraparound). Object restricted to an
      // array-binding ident, so OBJECT-position nesting (`xs[0][1]`) and string
      // index (`s[0]`) abstain; a nested-array element is not a portable scalar, so
      // `assertPortableScalar` abstains on it.
      if (node.optional) throw new Error('portable: optional index access is outside the portable scalar domain');
      if (!isValueIR(node.object) || node.object.kind !== 'ident') {
        throw new Error('portable: index access is only admitted on an array-binding identifier');
      }
      if (!isValueIR(node.index) || !isSafeIntegerLiteralIndex(node.index)) {
        throw new Error('portable: array index must be a bare non-negative safe-integer literal');
      }
      if (!hasBinding(env, node.object.name)) {
        throw new Error(`portable: binding "${node.object.name}" not found`);
      }
      const arr = getBinding(env, node.object.name);
      if (!Array.isArray(arr)) {
        throw new Error(`portable: index access on "${node.object.name}" requires an array binding`);
      }
      const idx = evalPortableValue(node.index, env);
      if (typeof idx !== 'number' || !Number.isSafeInteger(idx) || idx < 0 || idx >= arr.length) {
        throw new Error('portable: array index must be an in-bounds non-negative safe integer');
      }
      if (!(idx in arr)) {
        throw new Error('portable: array index must point at an existing element');
      }
      return assertPortableScalar(arr[idx], `element "${node.object.name}[${idx}]"`);
    }
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
      const decimalScalar = evalRunnerNativeDecimalScalarCall(node, env);
      if (decimalScalar !== undefined) return decimalScalar;
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
    // D1a — STRICT `===`/`!==` cross-type equality is KIND-SENSITIVE and no longer
    // abstains: un-same-typed scalars are simply NOT strictly-equal (`1 === "1"` →
    // false, `true === 1` → false), matching core-runtime's `kernStrictEqual` AND
    // both emitted legs (TS `===` is type-strict; Python routes through
    // `_kern_strict_equal`). Same-type operands compare by value (so `1 === 1.0` is
    // true — one numeric kind). This makes the reference a FULLER oracle; it was the
    // only surface abstaining on a comparison the three producers already agree on.
    // Scope: PORTABLE SCALARS only — a tagged Decimal (or any non-portable) operand
    // never reaches here, it abstains UPSTREAM in `evalPortableValue` →
    // `assertPortableScalar` (so `d === "1"` on a Decimal binding still throws).
    case '===':
      return sameType(left, right) ? left === right : false;
    case '!==':
      return sameType(left, right) ? left !== right : true;
    // D1b — LOOSE `==`/`!=` cross-type equality is now RECONCILED (was the last
    // abstaining surface here). KERN's loose `==` is NOT JS `==`: it adds ONLY the
    // null/undefined crossing on top of strict equality and does NOT model JS
    // coercion, so un-same-typed scalars are simply NOT loose-equal (`1 == "1"` →
    // false, `true == 1` → false), matching core-runtime's `kernLooseEqual` AND both
    // emitted legs (TS now routes loose ops through the `__kern_loose_eq` helper;
    // Python through `_kern_loose_equal`). Same-type → value compare (for scalars
    // loose === strict). Identical kind-sensitive shape to the D1a strict relax
    // above. The null/undefined crossing is NOT reachable in this reducer: undefined
    // is non-portable → abstains UPSTREAM in `evalPortableValue` → `assertPortableScalar`
    // (same as D1a), so no unreachable nullish handling is added here. A tagged
    // Decimal (or any non-portable) operand still abstains UPSTREAM.
    case '==':
      return sameType(left, right) ? left === right : false;
    case '!=':
      return sameType(left, right) ? left !== right : true;
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

/** The Decimal namespace methods that PRODUCE a Decimal value. */
const RUNNER_DECIMAL_VALUE_METHODS = new Set(['of', 'add', 'mul', 'sub', 'neg', 'abs', 'div', 'mod', 'pow']);
/** The Decimal namespace methods that PRODUCE a portable scalar. */
const RUNNER_DECIMAL_COMPARATOR_METHODS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'cmp']);

const VALUE_IR_DECIMAL_PROBE_ACCESSOR: DecimalProbeAccessor<ValueIR> = {
  callKind: 'call',
  receiverName(node) {
    if (node.kind !== 'call' || node.callee.kind !== 'member') return null;
    return node.callee.object.kind === 'ident' ? node.callee.object.name : null;
  },
  methodName(node) {
    if (node.kind !== 'call' || node.callee.kind !== 'member') return null;
    return node.callee.property;
  },
  argNode(node, index) {
    if (node.kind !== 'call') return null;
    return node.args[index] ?? null;
  },
  argKind(node) {
    return node.kind;
  },
  argLiteralValue(node) {
    return node.kind === 'strLit' ? node.value : null;
  },
};

/** A FRESH empty env for {@link evalDecimalExpression}'s default (a literal-rooted
 *  call has no idents to resolve). Returns a NEW object on every call — never a
 *  shared module-level map — so a stray future mutation can never leak across
 *  evaluations or contaminate another caller. */
function freshDecimalEvalEnv(): SemanticEnv {
  return { bindings: new Map(), seed: 0, now: 0 };
}

/** Strip TYPE-LEVEL transparent wrappers — a non-null assertion (`expr!`) and a
 *  type assertion (`expr as T`) — down to the runtime expression they wrap. Both
 *  are erased at runtime (TS drops them; the Python emitter never emits them), so
 *  `Decimal.of("1")!` and `Decimal.of("1") as Decimal` have the IDENTICAL runtime
 *  value as `Decimal.of("1")`. The emitters lower these by recursively emitting the
 *  inner producer (`new Decimal("1")!`), so the runner must unwrap them too to
 *  recognize the same Decimal surface — otherwise it would abstain on a form both
 *  emitters accept. (Mirrors the slice-3 transparent-wrapper handling.) */
function unwrapTransparent(node: ValueIR): ValueIR {
  let n: ValueIR = node;
  while (n.kind === 'nonNull' || n.kind === 'typeAssert') {
    n = n.expression;
  }
  return n;
}

/** True iff `node` is a `Decimal.<method>(...)` member-call on the bare `Decimal`
 *  namespace identifier — the EXACT recognition shape the emitters use
 *  (`callee.kind === 'member'`, `callee.object` is `ident 'Decimal'`). A user
 *  binding named `decimal` or a member chain is NOT matched. */
export function isDecimalNamespaceCall(node: ValueIR): node is Extract<ValueIR, { kind: 'call' }> {
  if (node.kind !== 'call') return false;
  const callee = node.callee;
  if (callee.kind !== 'member') return false;
  return callee.object.kind === 'ident' && callee.object.name === 'Decimal';
}

export function decimalNamespaceMethod(node: ValueIR): string | null {
  const inner = unwrapTransparent(node);
  if (!isDecimalNamespaceCall(inner)) return null;
  return (inner.callee as Extract<ValueIR, { kind: 'member' }>).property;
}

/** True iff `error` is the SHARED canonical Decimal-literal scale fail-close (the one
 *  {@link assertPortableDecimalLiteral} throws). The `expression-v1` precondition uses
 *  this to RE-ADMIT that specific failure to effects — so the byte-identical fail-close
 *  message surfaces on the production path — while abstaining on EVERY other throw
 *  (e.g. an unbound / non-Decimal variable operand → "binding is not a Decimal value").
 *  Matching the exported {@link DECIMAL_SCALE_FAILCLOSE} prefix is precise enough: it is
 *  the only message family carrying that prefix, and slice-1's fail-close regression test
 *  guards against a reword silently flipping re-admit into abstain. */
export function isCanonicalDecimalLiteralFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(DECIMAL_SCALE_FAILCLOSE);
}

export function isRunnerNativeDecimalFailClose(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith(DECIMAL_SCALE_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_DIV_ZERO_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_MOD_ZERO_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE)
  );
}

/** Evaluate a `Decimal.<method>(...)` expression (or a recursively-nested operand
 *  of one) to a live Decimal value, computing on the supplied LOCAL pinned
 *  constructor `KDecimal`. Operands are evaluated recursively, so nested forms
 *  like `Decimal.add(Decimal.of("1.5"), Decimal.mul(...))` work.
 *
 *  - `Decimal.of("lit")` — validates the literal with the shared portable-literal
 *    validator (fail-close with the EXACT shared message on non-canonical input),
 *    then constructs `new KDecimal("lit")`.
 *  - `Decimal.add/sub/mul(a, b)` → `a.plus/minus/times(b)`.
 *  - `Decimal.neg/abs(a)` → `a.neg()/abs()`.
 *  - `Decimal.div/mod/pow(a, b)` use the shared syntactic pre-gates plus the kernel
 *    guarded runtime helpers.
 *
 *  Throws on any non-Decimal-namespace node, an unknown/out-of-slice method, a
 *  wrong arity, or a non-string-literal `of` argument — the runner refuses what it
 *  cannot execute byte-identically rather than guessing. The set of inputs that
 *  reach this WITHOUT a structural throw is exactly {@link isDecimalExpression}'s
 *  `true` set; on those it either succeeds or throws ONLY the canonical
 *  `Decimal.of` fail-close. */
function evalDecimalNode(node: ValueIR, env: SemanticEnv, KDecimal: KDecimalCtor): KDecimalValue {
  // Unwrap transparent type-level wrappers (`expr!`, `expr as T`) — runtime no-ops
  // the emitters lower through — so a wrapped producer evaluates natively.
  const inner = unwrapTransparent(node);
  if (inner.kind === 'ident') {
    const bound = getBinding(env, inner.name);
    if (!isDecimalValue(bound)) {
      throw new Error(`portable-decimal: binding "${inner.name}" is not a Decimal value`);
    }
    return new KDecimal(bound.canonical);
  }
  if (!isDecimalNamespaceCall(inner)) {
    throw new Error('portable-decimal: expected a Decimal.<method>(...) namespace call');
  }
  // Narrowed: callee is a member on the `Decimal` ident.
  const method = (inner.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (!RUNNER_DECIMAL_VALUE_METHODS.has(method)) {
    throw new Error(`portable-decimal: Decimal.${method} does not produce a Decimal value`);
  }

  if (method === 'of') {
    if (inner.args.length !== 1) {
      throw new Error('portable-decimal: Decimal.of expects exactly 1 argument');
    }
    const arg = inner.args[0];
    if (arg.kind !== 'strLit') {
      throw new Error('portable-decimal: Decimal.of requires a string literal argument');
    }
    // Shared fail-close: a non-canonical literal throws the EXACT kernel message,
    // byte-identical to what both emitters throw at the `Decimal.of` lowering site.
    assertPortableDecimalLiteral(arg.value);
    return new KDecimal(arg.value);
  }

  if (method === 'neg' || method === 'abs') {
    if (inner.args.length !== 1) {
      throw new Error(`portable-decimal: Decimal.${method} expects exactly 1 argument`);
    }
    const operand = evalDecimalNode(inner.args[0], env, KDecimal);
    return method === 'neg' ? operand.neg() : operand.abs();
  }

  if (inner.args.length !== 2) {
    throw new Error(`portable-decimal: Decimal.${method} expects exactly 2 arguments`);
  }

  if (method === 'div' || method === 'mod') {
    assertNonZeroDecimalDivisor(method, inner.args[1], VALUE_IR_DECIMAL_PROBE_ACCESSOR);
  } else if (method === 'pow') {
    assertPortableDecimalPow(inner.args[0], inner.args[1], VALUE_IR_DECIMAL_PROBE_ACCESSOR);
  }

  const a = evalDecimalNode(inner.args[0], env, KDecimal);
  const b = evalDecimalNode(inner.args[1], env, KDecimal);
  switch (method) {
    case 'add':
      return a.plus(b);
    case 'sub':
      return a.minus(b);
    case 'mul':
      return a.times(b);
    case 'div':
      return kDecimalDiv(a, b);
    case 'mod':
      return kDecimalMod(a, b);
    case 'pow':
      return kDecimalPowInt(KDecimal, a, b);
    default:
      throw new Error(`portable-decimal: unsupported Decimal value method "${method}"`);
  }
}

export function evalRunnerNativeDecimalScalarCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
): PortableScalar | undefined {
  if (hasBinding(env, 'Decimal')) return undefined;
  const method = decimalNamespaceMethod(node);
  if (method === null || !RUNNER_DECIMAL_COMPARATOR_METHODS.has(method)) return undefined;
  if (node.args.length !== 2) {
    throw new Error(`portable-decimal: Decimal.${method} expects exactly 2 arguments`);
  }

  const KDecimal = makeKDecimal();
  const a = evalDecimalNode(node.args[0], env, KDecimal);
  const b = evalDecimalNode(node.args[1], env, KDecimal);
  switch (method) {
    case 'eq':
      return a.eq(b);
    case 'ne':
      return !a.eq(b);
    case 'lt':
      return a.lt(b);
    case 'lte':
      return a.lte(b);
    case 'gt':
      return a.gt(b);
    case 'gte':
      return a.gte(b);
    case 'cmp':
      return a.cmp(b);
    default:
      throw new Error(`portable-decimal: unsupported Decimal scalar method "${method}"`);
  }
}

/** True iff `node` is a STRUCTURALLY-EVALUABLE runner-native Decimal expression —
 *  i.e. either a Decimal VALUE producer (`Decimal.of/add/sub/mul/neg/abs/div/mod/pow(...)`) or a Decimal
 *  comparator (`eq/ne/lt/lte/gt/gte/cmp`) whose operand tree is made of
 *  structurally-valid Decimal operands. This is the recursive admission predicate the
 *  runner routes on: it must accept EXACTLY the inputs {@link evalDecimalNode}
 *  can reach without a STRUCTURAL throw (an arity / shape / out-of-slice error). On a
 *  `true` node, {@link evalDecimalExpression} either succeeds, throws the canonical
 *  `Decimal.of` fail-close, OR — once VARIABLE operands exist — throws a binding
 *  resolution error ("binding is not a Decimal value") for an `ident` operand that is
 *  unbound or not a tagged Decimal. The `expression-v1` precondition distinguishes the
 *  two non-success throws: it RE-ADMITS the canonical fail-close (see
 *  {@link isCanonicalDecimalLiteralFailure}) so effects surfaces the byte-identical
 *  message, and ABSTAINS on the binding error — so the over-accept of `ident` operands
 *  is fail-SAFE, never a divergent value.
 *
 *  It deliberately does NOT check the literal's CANONICAL-ness: a non-canonical
 *  `Decimal.of("1.10")` is structurally valid → `true`, and effects fails closed
 *  with the shared canonical-scale message (mirroring the emitters, which compile
 *  the call but throw at the lowering boundary).
 *
 *  Examples — `true`: `Decimal.of("1.5")`, `Decimal.of("1.10")`,
 *  `Decimal.add(Decimal.of("1"), Decimal.of("2"))`, arbitrarily nested
 *  producers, `Decimal.eq(d, Decimal.of("1"))`. `false`: `Decimal.add(1, 2)`
 *  (non-Decimal operand), `Decimal.of("1","2")` (arity), `Decimal.of()` (arity),
 *  `String(n)` / `1 + 2` (not a Decimal namespace call). */
export function isDecimalExpression(node: ValueIR): boolean {
  // Transparent wrappers (`expr!`, `expr as T`) are runtime no-ops the emitters
  // lower through, so recognize the wrapped form too.
  const inner = unwrapTransparent(node);
  function isDecimalOperand(operand: ValueIR): boolean {
    const unwrapped = unwrapTransparent(operand);
    if (unwrapped.kind === 'ident') return true;
    return isDecimalExpression(unwrapped);
  }
  if (!isDecimalNamespaceCall(inner)) return false;
  // Narrowed by isDecimalNamespaceCall: callee is a `member` on the Decimal ident.
  const method = (inner.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (RUNNER_DECIMAL_VALUE_METHODS.has(method)) {
    if (method === 'of') {
      return inner.args.length === 1 && inner.args[0].kind === 'strLit';
    }
    if (method === 'neg' || method === 'abs') {
      return inner.args.length === 1 && isDecimalOperand(inner.args[0]);
    }
    return inner.args.length === 2 && isDecimalOperand(inner.args[0]) && isDecimalOperand(inner.args[1]);
  }
  if (RUNNER_DECIMAL_COMPARATOR_METHODS.has(method)) {
    return inner.args.length === 2 && isDecimalOperand(inner.args[0]) && isDecimalOperand(inner.args[1]);
  }
  return false;
}

/** True iff the ROOT expression is a Decimal VALUE producer the runner binds as a
 *  tagged Decimal (`Decimal.of/add/mul(...)`), as opposed to a comparator whose
 *  result is already a portable scalar. */
export function isDecimalValueExpression(node: ValueIR): boolean {
  const method = decimalNamespaceMethod(node);
  return method !== null && RUNNER_DECIMAL_VALUE_METHODS.has(method) && isDecimalExpression(node);
}

/** Evaluate a `Decimal.<method>(...)` expression through the runner's native
 *  Decimal evaluation and render the result to its KERN-canonical STRING — the
 *  runner's third "leg" of the decimal differential oracle. Computes on a LOCAL
 *  cloned constructor pinned to the canonical context (precision 28,
 *  ROUND_HALF_EVEN, modulo ROUND_DOWN) — NEVER mutating the global decimal.js
 *  constructor — and renders via the kernel's {@link kernDecimalStr}, so the output
 *  is byte-identical to both emitted legs. A non-canonical `Decimal.of` literal
 *  fails closed with the EXACT shared message. */
export function evalDecimalExpression(node: ValueIR, env: SemanticEnv = freshDecimalEvalEnv()): string {
  const KDecimal = makeKDecimal();
  return kernDecimalStr(evalDecimalNode(node, env, KDecimal));
}
