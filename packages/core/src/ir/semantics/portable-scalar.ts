/** Portable-scalar expression evaluator shared by runner statement contracts. */

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
import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import {
  getBinding,
  hasBinding,
  isIntProvenanced,
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from './index.js';
import { evalMapReadCall } from './portable-map.js';
import { referenceRunSequence } from './reference-runner.js';

export type PortableScalar = string | number | boolean | null;

const RUNNER_CLASS_NO_VALUE = Symbol('runnerClassNoValue');

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

export type PortableRecord = Readonly<Record<string, PortableScalar>>;
export type RunnerPortableArrayValue = ReadonlyArray<PortableScalar | RunnerPortableArrayValue>;
export type RunnerPortableValue = PortableScalar | PortableRecord | RunnerPortableArrayValue;
export type RunnerFunctionValue = RunnerPortableValue | RunnerClassInstanceValue;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
// Milestone 5.1b — same-file recursive helper calls are now SUPPORTED (previously
// ANY re-entrant call to a function already on the call stack was rejected
// outright). The depth limit is the ONLY guard against runaway/infinite
// recursion (a KERN program with no base case still fails closed, just later —
// at MAX_RUNNER_CALL_DEPTH frames deep — instead of on the first re-entry).
// 512 comfortably covers realistic recursive algorithms (tree/list traversal,
// divide-and-conquer) while staying well under Node's default JS call-stack
// budget (each KERN call frame costs several real JS frames: evalPortableValue
// -> evalRunnerFunctionCall -> referenceRunSequence -> referenceRun -> contract
// effects -> ...).
const MAX_RUNNER_CALL_DEPTH = 512;
const MAX_RUNNER_CALL_CACHE_ENTRIES = 1024;

export function isPortableRecordValue(value: unknown): value is PortableRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (isDecimalValue(value) || isCaughtErrorValue(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isPortableScalar);
}

export function isRunnerPortableArrayValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is RunnerPortableArrayValue {
  if (!Array.isArray(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    return value.every((item) => isPortableScalar(item) || isRunnerPortableArrayValue(item, seen));
  } finally {
    seen.delete(value);
  }
}

export function assertRunnerPortableValue(value: unknown, label: string): RunnerPortableValue {
  if (isPortableScalar(value)) return value;
  if (isPortableRecordValue(value)) return value;
  if (isRunnerPortableArrayValue(value)) return value;
  throw new Error(`portable: ${label} must evaluate to a portable scalar, record, or array`);
}

function assertRunnerFunctionArgumentValue(
  value: unknown,
  label: string,
): RunnerPortableValue | RunnerClassInstanceValue {
  if (isRunnerClassInstanceValue(value)) return value;
  return assertRunnerPortableValue(value, label);
}

function assertRunnerFunctionValue(value: unknown, label: string): RunnerFunctionValue {
  if (isRunnerClassInstanceValue(value)) return value;
  return assertRunnerPortableValue(value, label);
}

// Memoization keys must be scoped to the DEFINING module: two modules can each
// declare a private `foo()`, and the call cache is shared across the whole run,
// so a bare-name key would let one module's result satisfy the other's call.
let moduleScopeSeq = 0;
const moduleScopeIds = new WeakMap<object, number>();
function moduleScopeCacheId(scope: RunnerModuleScope | undefined): number {
  if (!scope) return 0;
  let id = moduleScopeIds.get(scope);
  if (id === undefined) {
    id = (moduleScopeSeq += 1);
    moduleScopeIds.set(scope, id);
  }
  return id;
}

function runnerFunctionCacheKey(
  moduleId: number,
  fnName: string,
  argValues: readonly RunnerFunctionValue[],
  argIntProvenance: readonly boolean[],
): string | undefined {
  if (argValues.some(isRunnerClassInstanceValue)) return undefined;
  try {
    return JSON.stringify([moduleId, fnName, argValues.map((value, index) => [value, argIntProvenance[index]])]);
  } catch {
    return undefined;
  }
}

export function isRecordLiteralExpression(node: ValueIR): node is Extract<ValueIR, { kind: 'objectLit' }> {
  return node.kind === 'objectLit';
}

/** Evaluate a flat record literal whose values are portable scalars.
 * Spreads, numeric keys, computed keys, and nested records/arrays are deferred so
 * record reads cannot accidentally widen into host-object semantics. */
export function evalRecordLiteralValue(node: ValueIR, env: SemanticEnv): PortableRecord {
  if (node.kind !== 'objectLit') {
    throw new Error('portable-record: expected an object literal expression');
  }
  const out: Record<string, PortableScalar> = Object.create(null) as Record<string, PortableScalar>;
  for (const entry of node.entries) {
    if ('kind' in entry) {
      throw new Error('portable-record: object spreads are outside the portable record domain');
    }
    if ('rawKey' in entry && entry.rawKey !== undefined) {
      throw new Error('portable-record: numeric record keys are outside the portable record domain');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      throw new Error('portable-record: record keys must be identifier-like strings');
    }
    if (RESERVED_RECORD_KEYS.has(entry.key)) {
      throw new Error(`portable-record: reserved key "${entry.key}" is outside the portable record domain`);
    }
    if (Object.hasOwn(out, entry.key)) {
      throw new Error(`portable-record: duplicate key "${entry.key}" is outside the portable record domain`);
    }
    out[entry.key] = evalPortableValue(entry.value, env);
  }
  return Object.freeze(out);
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
export function isSafeIntegerLiteralIndex(node: ValueIR): boolean {
  if (node.kind !== 'numLit' || node.bigint) return false;
  if (!/^[0-9]+$/.test(node.raw)) return false;
  const n = Number(node.raw);
  return Number.isSafeInteger(n) && String(n) === node.raw && node.value === n;
}

/**
 * Milestone 5.1b — INTEGER-PROVENANCED EXPRESSION. Extends the base/counter
 * provenance check (`isSafeIntegerLiteralIndex` OR a provenanced bare ident)
 * to recursive `+`/`-` arithmetic between provenanced operands, so dynamic
 * index reads can use expressions like `xs[i + 1]` or `xs[i - 1]`, not just a
 * bare loop counter.
 *
 * Base cases:
 *   - a bare safe-integer literal (`isSafeIntegerLiteralIndex`)
 *   - a bare ident whose DECLARING scope marks it integer-provenanced
 *     (currently: a `for` loop counter, or a helper param bound from a
 *     provenanced caller argument — see `evalRunnerFunctionCall`)
 * Recursive case:
 *   - `<provenanced> + <provenanced>` or `<provenanced> - <provenanced>`
 *
 * WHY +/- (not *, /, %, unary) is provably divergence-free: every operand
 * admitted here is, by construction, an EXACTLY-representable JS safe integer
 * (a literal that round-tripped, or a loop counter bounded by safe-integer
 * range/step). IEEE-754 double addition/subtraction of two exactly-
 * representable integers (|x| <= 2^53-1) is ALWAYS exact WHENEVER the true
 * mathematical result is ALSO <= 2^53-1 in magnitude — doubles have 53 bits of
 * integer precision, and a correctly-rounded result that is already exactly
 * representable IS the exact result (no rounding occurs). The call site below
 * (the `index` case) additionally re-checks `Number.isSafeInteger` on the
 * FINAL evaluated index before using it, so any `+`/`-` combination whose true
 * result exceeds the safe range is caught there and abstains — it can never
 * silently round back into a plausible-looking (but wrong) small index,
 * because floating-point rounding near/above 2^53 cannot land back below it
 * except exactly AT the boundary, which the safe-integer check also rejects.
 * That's what makes it SAFE for JS and Python to agree here even though
 * neither language proves it in general: `%` stays excluded (JS and Python
 * disagree on the SIGN of the result for a negative operand — a genuine
 * semantic divergence, not a precision one) and `*`/`/`/unary stay excluded
 * (no concrete indexing use case needs them, and the safe-integer postcheck
 * argument does not extend to them as cleanly).
 */
export function isIntProvenancedExpr(node: ValueIR, env: SemanticEnv): boolean {
  if (isSafeIntegerLiteralIndex(node)) return true;
  if (node.kind === 'ident') return isIntProvenanced(env, node.name);
  if (node.kind === 'binary' && (node.op === '+' || node.op === '-')) {
    return isIntProvenancedExpr(node.left, env) && isIntProvenancedExpr(node.right, env);
  }
  return false;
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
      const runnerValue = evalRunnerClassMemberScalar(node, env);
      if (runnerValue !== RUNNER_CLASS_NO_VALUE) return runnerValue;
      // Member reads are admitted only for the explicit portable slices:
      // `<arrayBinding>.length`, `<recordBinding>.<field>`, and
      // `<caughtErrorBinding>.message`. All must be
      // non-optional reads on a bare identifier. Everything else throws -> the
      // runner ABSTAINS rather than producing a one-leg value.
      if (node.optional) throw new Error('portable: optional member access is outside the portable scalar domain');
      if (!isValueIR(node.object) || node.object.kind !== 'ident') {
        throw new Error('portable: member access is only admitted on an array, record, or caught-error binding');
      }
      // Resolve the binding explicitly (mirrors the `index` case) so an UNBOUND
      // receiver fails with a precise "binding not found" rather than the generic
      // out-of-domain message. Either way the runner abstains; this is diagnostics.
      if (!hasBinding(env, node.object.name)) {
        throw new Error(`portable: binding "${node.object.name}" not found`);
      }
      const obj = getBinding(env, node.object.name);
      if (Array.isArray(obj)) {
        // Array `.length` is portable; string `.length` is not (JS counts UTF-16
        // code units while Python counts code points), so only arrays pass here.
        if (node.property !== 'length') {
          throw new Error(`portable: array has no portable property "${node.property}" (only .length is admitted)`);
        }
        return obj.length;
      }
      const recordField = portableRecordScalarField(obj, node.object.name, node.property);
      if (recordField !== PORTABLE_RECORD_FIELD_MISSING) {
        return recordField;
      }
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
      // Array INDEX read. Certify an in-bounds, non-negative, safe-integer index
      // into an ident-bound array, returning a PORTABLE SCALAR element. The index
      // SOURCE must be INTEGER-PROVENANCED (`isIntProvenancedExpr`, milestone
      // 5.1b): a bare safe-integer LITERAL, a bare ident that is
      // INTEGER-PROVENANCED (currently: the live counter of an enclosing `for`,
      // or a helper param whose caller argument was itself provenanced), or
      // `+`/`-` arithmetic recursively combining such operands (`xs[i + 1]`,
      // `xs[i - 1]`, `xs[1 + 1]`). Everything else throws -> the runner ABSTAINS.
      //
      // Why not any ident, and why `*`/`/`/`%`/unary still abstain — TS<->Python
      // divergences verified on real node+python3:
      //   - INT vs FLOAT: Python list indices MUST be int — `xs[1.0]`, `xs[4/2]`
      //     (Python `/` is float), and any PLAIN-let ident bound to a float raise
      //     TypeError in Python while JS + the reference collapse `1.0 === 1`. A
      //     for-counter is exempt because its provenance proves it is an int; a
      //     plain `let` is NOT provenanced (and `let j = i` is not transitive).
      //   - integer `%` diverges on a negative operand (`5 % -3` is 2 in JS, -1 in
      //     Python) — a SIGN divergence, not a precision one, so `%` stays
      //     excluded from `isIntProvenancedExpr` regardless of operand safety.
      //   - `+`/`-` ARE admitted (see `isIntProvenancedExpr`'s doc comment for the
      //     exact-IEEE-754 argument for why this cannot silently diverge): the
      //     safe-integer + bounds check below still applies to the FINAL
      //     evaluated index, so an overflowing computation still abstains.
      //   - JS has no int/float distinction and the emitters preserve the source
      //     numeric form, so the reference cannot tell a Python int from a float by
      //     VALUE — hence the syntactic literal / provenance gate, not a value check.
      // Provenance proves INTEGER-NESS, not IN-BOUNDS-ness: OOB / NEGATIVE indices
      // are caught at runtime below (TS undefined vs Py IndexError / wraparound),
      // and the throw propagates atomically. Object restricted to an array-binding
      // ident, so OBJECT-position nesting (`xs[0][1]`) and string index (`s[0]`)
      // abstain; a nested-array element is not a portable scalar, so
      // `assertPortableScalar` abstains on it.
      if (node.optional) throw new Error('portable: optional index access is outside the portable scalar domain');
      if (!isValueIR(node.object) || node.object.kind !== 'ident') {
        throw new Error('portable: index access is only admitted on an array-binding identifier');
      }
      if (!isValueIR(node.index) || !isIntProvenancedExpr(node.index, env)) {
        throw new Error(
          'portable: array index must be a bare non-negative safe-integer literal, an integer-provenanced loop counter, or +/- arithmetic between them',
        );
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
      if (node.optional) throw new Error('portable: optional calls are outside the portable scalar domain');
      const decimalScalar = evalRunnerNativeDecimalScalarCall(node, env);
      if (decimalScalar !== undefined) return decimalScalar;
      const runnerValue = evalRunnerClassMethodScalar(node, env);
      if (runnerValue !== RUNNER_CLASS_NO_VALUE) return runnerValue;
      if (node.callee.kind === 'ident' && node.callee.name === 'String') {
        if (node.args.length !== 1) {
          throw new Error('portable: String() expects exactly 1 argument');
        }
        const val = evalPortableValue(node.args[0], env);
        return coerceToString(val);
      }
      const listLengthScalar = evalListLengthNamespaceCall(node, env);
      if (listLengthScalar !== undefined) return listLengthScalar;
      const mapReadScalar = evalMapReadCall(node, env);
      if (mapReadScalar !== undefined) return mapReadScalar;
      if (node.callee.kind === 'ident') return evalRunnerFunctionCall(node.callee.name, node.args, env);
      throw new Error('portable: unsupported non-identifier call');
    }
    default:
      throw new Error(`portable: expression kind "${node.kind}" is outside the portable scalar domain`);
  }
}

export function isRunnerClassInstanceValue(value: unknown): value is RunnerClassInstanceValue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as Partial<RunnerClassInstanceValue>).__kernRunnerClassInstance === true &&
    typeof (value as Partial<RunnerClassInstanceValue>).className === 'string' &&
    Boolean((value as Partial<RunnerClassInstanceValue>).fields) &&
    typeof (value as Partial<RunnerClassInstanceValue>).fields === 'object'
  );
}

export function evalRunnerClassNewValue(node: ValueIR, env: SemanticEnv): RunnerClassInstanceValue {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  return evalRunnerClassNewValueWithArguments(
    node,
    env,
    node.argument.args.map((arg) => evalRunnerClassArgument(arg, env)),
  );
}

export function evalRunnerClassNewValueWithArguments(
  node: ValueIR,
  env: SemanticEnv,
  args: readonly unknown[],
): RunnerClassInstanceValue {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  const className = node.argument.callee.name;
  const classes = runnerClassesForEnv(env);
  const cls = classes?.get(className);
  if (!classes || !cls) throw new Error(`runner-class: unknown class "${className}"`);
  const moduleEnv = withModuleScope(env, cls.module);
  const instance: RunnerClassInstanceValue = {
    __kernRunnerClassInstance: true,
    className: cls.name,
    fields: Object.create(null) as Record<string, unknown>,
    ...(cls.module ? { module: cls.module } : {}),
  };
  initializeRunnerClassInstance(cls, instance, args, moduleEnv);
  return instance;
}

export async function evalRunnerClassNewValueWithArgumentsAsync(
  node: ValueIR,
  env: SemanticEnv,
  args: readonly unknown[],
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<RunnerClassInstanceValue> {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  const className = node.argument.callee.name;
  const classes = runnerClassesForEnv(env);
  const cls = classes?.get(className);
  if (!classes || !cls) throw new Error(`runner-class: unknown class "${className}"`);
  const moduleEnv = withModuleScope(env, cls.module);
  const instance: RunnerClassInstanceValue = {
    __kernRunnerClassInstance: true,
    className: cls.name,
    fields: Object.create(null) as Record<string, unknown>,
    ...(cls.module ? { module: cls.module } : {}),
  };
  await initializeRunnerClassInstanceAsync(cls, instance, args, moduleEnv, runBody);
  return instance;
}

export function assignRunnerClassMember(
  target: string,
  valueExpr: ValueIR,
  env: SemanticEnv,
  mutate = true,
): PortableScalar | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
  if (!match) return undefined;
  const [, receiverName, fieldName] = match;
  if (!hasBinding(env, receiverName)) return undefined;
  const receiver = getBinding(env, receiverName);
  if (!isRunnerClassInstanceValue(receiver)) return undefined;
  const value = evalPortableValue(valueExpr, env);
  if (mutate && env.runnerProtectedClassInstances?.has(receiver)) {
    throw new Error('portable: function mutated class instance argument');
  }
  if (mutate) receiver.fields[fieldName] = value;
  return value;
}

function runnerClassesForEnv(env: SemanticEnv): Map<string, RunnerClassBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerClasses) return cur.runnerClasses;
  }
  return undefined;
}

/**
 * View `env` through a module's callable scope: the returned env resolves
 * functions/classes in `scope` (the DEFINING module) while preserving the
 * caller's capabilities, call stack, cache, seed, and clock. Used so an imported
 * helper or class member executes against its own module's private symbols
 * rather than the importer's flat namespace.
 */
function withModuleScope(env: SemanticEnv, scope: RunnerModuleScope | undefined): SemanticEnv {
  if (!scope) return env;
  if (env.runnerFunctions === scope.functions && env.runnerClasses === scope.classes) return env;
  return { ...env, runnerFunctions: scope.functions, runnerClasses: scope.classes };
}

function evalRunnerClassArgument(node: ValueIR, env: SemanticEnv): unknown {
  if (node.kind === 'new') return evalRunnerClassNewValue(node, env);
  if (node.kind === 'ident' && hasBinding(env, node.name)) return getBinding(env, node.name);
  if (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name !== 'String') {
    return evalRunnerFunctionValue(node.callee.name, node.args, env);
  }
  return evalPortableValue(node, env);
}

export function evalRunnerFunctionArgumentValue(node: ValueIR, env: SemanticEnv): RunnerFunctionValue {
  return assertRunnerFunctionArgumentValue(evalRunnerClassArgument(node, env), 'function argument');
}

function evalRunnerClassReceiver(node: ValueIR, env: SemanticEnv): RunnerClassInstanceValue | undefined {
  if (node.kind === 'ident') {
    if (node.name === 'this' && env.runnerThis) return env.runnerThis;
    if (!hasBinding(env, node.name)) return undefined;
    const value = getBinding(env, node.name);
    return isRunnerClassInstanceValue(value) ? value : undefined;
  }
  if (node.kind === 'new') return evalRunnerClassNewValue(node, env);
  return undefined;
}

function evalRunnerClassMemberScalar(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
): PortableScalar | typeof RUNNER_CLASS_NO_VALUE {
  if (node.optional) return RUNNER_CLASS_NO_VALUE;
  if (!isValueIR(node.object)) return RUNNER_CLASS_NO_VALUE;
  const receiver = evalRunnerClassReceiver(node.object, env);
  if (!receiver) return RUNNER_CLASS_NO_VALUE;
  if (Object.hasOwn(receiver.fields, node.property)) {
    return assertPortableScalar(receiver.fields[node.property], `field "${node.property}"`);
  }
  const menv = withModuleScope(env, receiver.module);
  const getter = findRunnerClassMember(receiver.className, node.property, 'getter', menv);
  if (!getter) throw new Error(`runner-class: class "${receiver.className}" has no field or getter "${node.property}"`);
  return invokeRunnerClassMember(getter, receiver, [], menv);
}

function evalRunnerClassMethodScalar(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
): PortableScalar | typeof RUNNER_CLASS_NO_VALUE {
  if (node.callee.kind !== 'member' || node.callee.optional) return RUNNER_CLASS_NO_VALUE;
  if (!isValueIR(node.callee.object)) return RUNNER_CLASS_NO_VALUE;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return RUNNER_CLASS_NO_VALUE;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return invokeRunnerClassMember(
      method,
      env.runnerThis,
      node.args.map((arg) => evalRunnerClassArgument(arg, env)),
      env,
    );
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return RUNNER_CLASS_NO_VALUE;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return invokeRunnerClassMember(
    method,
    receiver,
    node.args.map((arg) => evalRunnerClassArgument(arg, env)),
    menv,
  );
}

export function evalRunnerClassMethodScalarWithArguments(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  args: readonly unknown[],
): PortableScalar | undefined {
  if (node.callee.kind !== 'member' || node.callee.optional) return undefined;
  if (!isValueIR(node.callee.object)) return undefined;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return undefined;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return invokeRunnerClassMember(method, env.runnerThis, args, env);
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return undefined;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return invokeRunnerClassMember(method, receiver, args, menv);
}

export async function evalRunnerClassMethodScalarWithArgumentsAsync(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  args: readonly unknown[],
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<PortableScalar | undefined> {
  if (node.callee.kind !== 'member' || node.callee.optional) return undefined;
  if (!isValueIR(node.callee.object)) return undefined;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return undefined;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return runRunnerClassBodyAsync(method, env.runnerThis, args, method.body, env, true, runBody);
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return undefined;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return runRunnerClassBodyAsync(method, receiver, args, method.body, menv, true, runBody);
}

function initializeRunnerClassInstance(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
): void {
  const classes = runnerClassesForEnv(env);
  if (cls.extendsName) {
    const base = classes?.get(cls.extendsName);
    if (!base) throw new Error(`runner-class: unknown base class "${cls.extendsName}"`);
    const explicitSuperArgs = explicitSuperCallArgs(
      cls.constructor?.body ?? [],
      env,
      args,
      cls.constructor?.params ?? [],
    );
    initializeRunnerClassInstance(base, instance, explicitSuperArgs ?? [], env);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalRunnerClassArgument(parseExpression(field.value), env)
        : undefined;
  }
  if (!cls.constructor) return;
  const body = cls.extendsName
    ? cls.constructor.body.filter((child) => !isExplicitSuperCallNode(child))
    : cls.constructor.body;
  runRunnerClassBody(cls.constructor, instance, args, body, env, false);
}

async function initializeRunnerClassInstanceAsync(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<void> {
  const classes = runnerClassesForEnv(env);
  if (cls.extendsName) {
    const base = classes?.get(cls.extendsName);
    if (!base) throw new Error(`runner-class: unknown base class "${cls.extendsName}"`);
    const explicitSuperArgs = explicitSuperCallArgs(
      cls.constructor?.body ?? [],
      env,
      args,
      cls.constructor?.params ?? [],
    );
    await initializeRunnerClassInstanceAsync(base, instance, explicitSuperArgs ?? [], env, runBody);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalRunnerClassArgument(parseExpression(field.value), env)
        : undefined;
  }
  if (!cls.constructor) return;
  const body = cls.extendsName
    ? cls.constructor.body.filter((child) => !isExplicitSuperCallNode(child))
    : cls.constructor.body;
  await runRunnerClassBodyAsync(cls.constructor, instance, args, body, env, false, runBody);
}

function explicitSuperCallArgs(
  body: readonly { type: string; props?: Record<string, unknown> }[],
  outerEnv: SemanticEnv,
  args: readonly unknown[],
  params: readonly string[],
): readonly unknown[] | undefined {
  const superNode = body.find(isExplicitSuperCallNode);
  if (!superNode || typeof superNode.props?.value !== 'string') return undefined;
  const parsed = parseExpression(superNode.props.value);
  if (parsed.kind !== 'call' || parsed.callee.kind !== 'ident' || parsed.callee.name !== 'super') return undefined;
  const bindings = new Map<string, unknown>();
  for (let index = 0; index < params.length; index += 1) bindings.set(params[index], args[index]);
  const env = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(outerEnv),
    runnerClasses: runnerClassesForEnv(outerEnv),
    runnerCallStack: outerEnv.runnerCallStack,
    runnerCallCache: outerEnv.runnerCallCache,
    capabilities: outerEnv.capabilities,
    capabilityContext: outerEnv.capabilityContext,
    seed: outerEnv.seed,
    now: outerEnv.now,
  });
  return parsed.args.map((arg) => evalRunnerClassArgument(arg, env));
}

function isExplicitSuperCallNode(node: { type: string; props?: Record<string, unknown> }): boolean {
  return node.type === 'do' && typeof node.props?.value === 'string' && node.props.value.trim().startsWith('super(');
}

function findRunnerClassMember(
  className: string,
  name: string,
  kind: 'method' | 'getter',
  env: SemanticEnv,
): RunnerClassMemberBinding | undefined {
  return findRunnerClassMemberFrom(className, name, kind, env);
}

function findRunnerClassMemberFrom(
  className: string,
  name: string,
  kind: 'method' | 'getter',
  env: SemanticEnv,
): RunnerClassMemberBinding | undefined {
  const classes = runnerClassesForEnv(env);
  for (let current: string | undefined = className; current; ) {
    const cls: RunnerClassBinding | undefined = classes?.get(current);
    if (!cls) return undefined;
    const member = kind === 'method' ? cls.methods.get(name) : cls.getters.get(name);
    if (member) return member;
    current = cls.extendsName;
  }
  return undefined;
}

function invokeRunnerClassMember(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
): PortableScalar {
  return runRunnerClassBody(member, receiver, args, member.body, env, true);
}

function runRunnerClassBody(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  body: readonly IRNode[],
  env: SemanticEnv,
  requireReturn: boolean,
): PortableScalar {
  if (args.length !== member.params.length) {
    throw new Error(
      `runner-class: member "${member.name}" expects ${member.params.length} arguments, got ${args.length}`,
    );
  }
  const callStack = runnerCallStackForEnv(env);
  const label = `${member.ownerClass}.${member.name}`;
  if (callStack.includes(label)) throw new Error(`runner-class: recursive member call "${label}" is unsupported`);
  const bindings = new Map<string, unknown>([['this', receiver]]);
  for (let index = 0; index < member.params.length; index += 1) bindings.set(member.params[index], args[index]);
  const callEnv = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(env),
    runnerClasses: runnerClassesForEnv(env),
    runnerCallStack: [...callStack, label],
    runnerCallCache: env.runnerCallCache,
    runnerThis: receiver,
    runnerSuperClass: runnerClassesForEnv(env)?.get(member.ownerClass)?.extendsName,
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    seed: env.seed,
    now: env.now,
  });
  callEnv.bindings.set('this', receiver);
  callEnv.runnerThis = receiver;
  const fieldSnapshot = requireReturn ? cloneRunnerClassFields(receiver.fields) : undefined;
  if (runnerClassBodyHasCapability(body)) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  let trace: ReturnType<typeof referenceRunSequence>;
  try {
    trace = referenceRunSequence(body, callEnv);
  } catch (error) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw error;
  }
  if (
    trace.events.some(
      (event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'call' || event.op === 'capability',
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  if (
    requireReturn &&
    trace.events.some(
      (event) => event.op === 'assign' && typeof event.target === 'string' && event.target.includes('.'),
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" mutated instance state`);
  }
  if (trace.completion.kind === 'normal' && !requireReturn) return null;
  if (trace.completion.kind !== 'return') {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" must return a portable scalar`);
  }
  return assertPortableScalar(trace.completion.value, `member "${label}" return`);
}

async function runRunnerClassBodyAsync(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  body: readonly IRNode[],
  env: SemanticEnv,
  requireReturn: boolean,
  runBody: (body: readonly IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<PortableScalar> {
  if (args.length !== member.params.length) {
    throw new Error(
      `runner-class: member "${member.name}" expects ${member.params.length} arguments, got ${args.length}`,
    );
  }
  const callStack = runnerCallStackForEnv(env);
  const label = `${member.ownerClass}.${member.name}`;
  if (callStack.includes(label)) throw new Error(`runner-class: recursive member call "${label}" is unsupported`);
  const bindings = new Map<string, unknown>([['this', receiver]]);
  for (let index = 0; index < member.params.length; index += 1) bindings.set(member.params[index], args[index]);
  const callEnv = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(env),
    runnerClasses: runnerClassesForEnv(env),
    runnerCallStack: [...callStack, label],
    runnerCallCache: env.runnerCallCache,
    runnerThis: receiver,
    runnerSuperClass: runnerClassesForEnv(env)?.get(member.ownerClass)?.extendsName,
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    seed: env.seed,
    now: env.now,
  });
  callEnv.bindings.set('this', receiver);
  callEnv.runnerThis = receiver;
  const fieldSnapshot = requireReturn ? cloneRunnerClassFields(receiver.fields) : undefined;
  if (runnerClassBodyHasCapability(body)) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  let trace: import('./trace.js').Trace;
  try {
    trace = await runBody(body, callEnv);
  } catch (error) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw error;
  }
  if (
    trace.events.some(
      (event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'call' || event.op === 'capability',
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  if (
    requireReturn &&
    trace.events.some(
      (event) => event.op === 'assign' && typeof event.target === 'string' && event.target.includes('.'),
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" mutated instance state`);
  }
  if (trace.completion.kind === 'normal' && !requireReturn) return null;
  if (trace.completion.kind !== 'return') {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" must return a portable scalar`);
  }
  return assertPortableScalar(trace.completion.value, `member "${label}" return`);
}

function runnerClassBodyHasCapability(nodes: readonly IRNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'capability') return true;
    if (node.children && runnerClassBodyHasCapability(node.children)) return true;
  }
  return false;
}

function cloneRunnerClassFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, cloneRunnerClassFieldValue(value)]));
}

function cloneRunnerClassFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRunnerClassFieldValue);
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, nested]) => [key, cloneRunnerClassFieldValue(nested)]));
  }
  if (value instanceof Set) return new Set(Array.from(value.values(), cloneRunnerClassFieldValue));
  if (isRunnerClassInstanceValue(value)) {
    return {
      __kernRunnerClassInstance: true,
      className: value.className,
      fields: cloneRunnerClassFields(value.fields),
      ...(value.module ? { module: value.module } : {}),
    } satisfies RunnerClassInstanceValue;
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          cloneRunnerClassFieldValue(nested),
        ]),
      );
    }
  }
  return value;
}

function restoreRunnerClassFields(target: Record<string, unknown>, snapshot: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(snapshot)) target[key] = cloneRunnerClassFieldValue(value);
}

/**
 * Milestone 5.1b — `List.length(xs)`, the KERN-stdlib NAMESPACE-CALL form of
 * the SAME operation the `member` case already certifies as `xs.length`
 * (see kern-stdlib.ts's `List.length` lowering: `ts: '$0.length'`,
 * `py: 'len($0)'`). Returns `undefined` when `node` is not this exact shape
 * (so the caller falls through to the generic call path); throws on a
 * recognized-but-invalid shape (wrong arity, non-ident/non-array receiver) so
 * the runner abstains atomically. Gated on `List` being UNSHADOWED, mirroring
 * the Decimal/Map namespace-call precedent.
 */
function evalListLengthNamespaceCall(node: Extract<ValueIR, { kind: 'call' }>, env: SemanticEnv): number | undefined {
  if (node.optional) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional || callee.property !== 'length') return undefined;
  if (callee.object.kind !== 'ident' || callee.object.name !== 'List' || hasBinding(env, 'List')) return undefined;
  if (node.args.length !== 1) throw new Error('portable: List.length expects exactly 1 argument');
  const arrayArg = node.args[0];
  if (!isValueIR(arrayArg) || arrayArg.kind !== 'ident' || !isPortableBindingName(arrayArg.name)) {
    throw new Error('portable: List.length argument must be a bare array-binding identifier');
  }
  if (!hasBinding(env, arrayArg.name)) throw new Error(`portable: binding "${arrayArg.name}" not found`);
  const arrayValue = getBinding(env, arrayArg.name);
  if (!Array.isArray(arrayValue)) throw new Error(`portable: "${arrayArg.name}" is not an array binding`);
  return arrayValue.length;
}

function runnerFunctionsForEnv(env: SemanticEnv): Map<string, RunnerFunctionBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerFunctions) return cur.runnerFunctions;
  }
  return undefined;
}

function runnerCallStackForEnv(env: SemanticEnv): readonly string[] {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerCallStack) return cur.runnerCallStack;
  }
  return [];
}

function runnerCallCacheForEnv(env: SemanticEnv): Map<string, unknown> {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerCallCache) return cur.runnerCallCache;
  }
  env.runnerCallCache = new Map();
  return env.runnerCallCache;
}

export function evalRunnerFunctionValue(
  fnName: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
): RunnerFunctionValue {
  const functions = runnerFunctionsForEnv(env);
  const fn = functions?.get(fnName);
  if (!fn) throw new Error(`portable: unsupported call to "${fnName}"`);
  if (args.length !== fn.params.length) {
    throw new Error(`portable: function "${fnName}" expects ${fn.params.length} arguments, got ${args.length}`);
  }

  // Milestone 5.1b — same-file recursion (direct self-calls AND mutual/indirect
  // cycles through another helper) is now permitted; the ONLY fail-closed fence
  // left is the explicit depth limit below. Recursive calls stay side-effect-free
  // and memoized exactly like non-recursive ones (the cache below), so a pure
  // recursive helper (factorial, fibonacci-with-memo, tree depth, …) behaves
  // identically to hand-unrolled iteration on every leg.
  const callStack = runnerCallStackForEnv(env);
  if (callStack.length >= MAX_RUNNER_CALL_DEPTH) {
    throw new Error(`portable: runner function call depth exceeded (limit ${MAX_RUNNER_CALL_DEPTH})`);
  }

  const argValues: RunnerFunctionValue[] = [];
  const argIntProvenance: boolean[] = [];
  const bindings = new Map<string, unknown>();
  const intProvenance = new Set<string>();
  for (let index = 0; index < fn.params.length; index += 1) {
    const arg = args[index];
    // Merge of module linking (5.1a) + provenance arithmetic (5.1b): the 5.1a
    // argument evaluator admits class-instance arguments; the 5.1b predicate
    // subsumes literal, ident-provenance, and +/- arithmetic provenance.
    const value = evalRunnerFunctionArgumentValue(arg, env);
    const isSafeIntArg = isIntProvenancedExpr(arg, env);
    argValues.push(value);
    argIntProvenance.push(isSafeIntArg);
    bindings.set(fn.params[index], value);
    if (isSafeIntArg) {
      intProvenance.add(fn.params[index]);
    }
  }

  const cache = runnerCallCacheForEnv(env);
  const cacheKey = runnerFunctionCacheKey(moduleScopeCacheId(fn.module), fnName, argValues, argIntProvenance);
  if (cacheKey !== undefined && cache.has(cacheKey)) {
    return assertRunnerPortableValue(cache.get(cacheKey), `function "${fnName}" cached return`);
  }

  const callEnv = makeEnv({
    bindings,
    intProvenance,
    runnerFunctions: fn.module?.functions ?? functions,
    runnerClasses: fn.module?.classes ?? runnerClassesForEnv(env),
    runnerCallStack: [...callStack, fnName],
    runnerCallCache: cache,
    seed: env.seed,
    now: env.now,
  });
  callEnv.runnerProtectedClassInstances = new WeakSet(
    Array.from(callEnv.bindings.values()).filter(isRunnerClassInstanceValue),
  );
  const trace = referenceRunSequence(fn.body, callEnv);
  if (trace.events.some((event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'call')) {
    throw new Error(`portable: function "${fnName}" produced side effects`);
  }
  if (trace.completion.kind !== 'return') {
    throw new Error(`portable: function "${fnName}" must return a portable scalar, record, or array`);
  }
  const out = assertRunnerFunctionValue(trace.completion.value, `function "${fnName}" return`);
  if (cacheKey !== undefined && !isRunnerClassInstanceValue(out)) {
    if (cache.size >= MAX_RUNNER_CALL_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(cacheKey, out);
  }
  return out;
}

function evalRunnerFunctionCall(fnName: string, args: readonly ValueIR[], env: SemanticEnv): PortableScalar {
  return assertPortableScalar(evalRunnerFunctionValue(fnName, args, env), `function "${fnName}" return`);
}

const PORTABLE_RECORD_FIELD_MISSING = Symbol('portableRecordFieldMissing');

function portableRecordScalarField(
  obj: unknown,
  recordName: string,
  property: string,
): PortableScalar | typeof PORTABLE_RECORD_FIELD_MISSING {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return PORTABLE_RECORD_FIELD_MISSING;
  if (isDecimalValue(obj) || isCaughtErrorValue(obj) || isRunnerClassInstanceValue(obj)) {
    return PORTABLE_RECORD_FIELD_MISSING;
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return PORTABLE_RECORD_FIELD_MISSING;
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new Error(`portable: record "${recordName}" is outside the portable scalar domain`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(obj, property);
  if (!descriptor) {
    throw new Error(`portable: record "${recordName}" has no field "${property}"`);
  }
  if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
    throw new Error(`portable: record "${recordName}" field "${property}" is outside the portable scalar domain`);
  }
  return assertPortableScalar(descriptor.value, `field "${recordName}.${property}"`);
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
      return sameType(left, right) ? left === right : false;
    case '!==':
      return sameType(left, right) ? left !== right : true;
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
