/**
 * `expression-v1` runtime semantics.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import {
  evalRegexGlobalMatchExpression,
  evalRegexMatchAllExpression,
  evalRegexMatchExpression,
  evalRegexTestExpression,
  isRegexGlobalMatchExpression,
  isRegexMatchAllExpression,
  isRegexMatchExpression,
  isRegexTestExpression,
  isRunnerNativeRegexFailClose,
  makeRegExpMatchListValue,
  makeRegExpMatchValue,
} from './portable-regex.js';
import {
  evalDecimalExpression,
  evalPortableValue,
  isDecimalValueExpression,
  isPortableBindingName,
  isRunnerNativeDecimalFailClose,
  makeDecimalValue,
} from './portable-scalar.js';
import type { Trace } from './trace.js';

interface ExpressionV1Props {
  name?: string;
  expr?: unknown;
}

function asExpressionV1Props(ir: IRNode): ExpressionV1Props {
  return (ir.props ?? {}) as ExpressionV1Props;
}

function hasExpressionCode(expr: unknown): expr is { __expr: true; code: string } {
  return (
    typeof expr === 'object' &&
    expr !== null &&
    (expr as { __expr?: unknown }).__expr === true &&
    typeof (expr as { code?: unknown }).code === 'string'
  );
}

function expressionSource(expr: unknown): string | undefined {
  if (expr === undefined || expr === null) return undefined;
  if (hasExpressionCode(expr)) return expr.code;
  return String(expr);
}

/** The runner evaluates `Decimal.*` natively ONLY when `Decimal` is the builtin
 *  namespace — NOT when the user has shadowed it (`let Decimal = …`). This mirrors
 *  the emitter's `!isUserBinding(ctx, 'Decimal')` guard (codegen-expression.ts): a
 *  shadowed `Decimal.of(…)` routes to the portable evaluator (→ unsupported call →
 *  abstain) instead of the runner misjudging it as the builtin and diverging from
 *  the emitted legs, which honor the user binding. */
function routesToNativeDecimal(parsed: ReturnType<typeof parseExpression>, env: SemanticEnv): boolean {
  return isDecimalValueExpression(parsed) && !env.bindings.has('Decimal');
}

// The runner executes `regexLit.test(str)` natively ONLY when `RegExp` is the
// builtin (not user-shadowed), mirroring the decimal `!env.has('Decimal')` guard.
// `/g` is deliberately ADMITTED by the gate and fail-closed inside the eval so the
// precondition RE-ADMITS the shared `REGEX_TEST_G_FAILCLOSE` constant (effects
// re-throws it) — this keeps the runner IN the `/g` parity story, surfacing the
// byte-identical constant both emit legs produce. (Re-admit is parity, not
// laziness; moving `/g` to a gate-abstain would drop the runner's leg for `/g`.)
function routesToNativeRegexTest(parsed: ReturnType<typeof parseExpression>, env: SemanticEnv): boolean {
  return isRegexTestExpression(parsed) && !env.bindings.has('RegExp');
}

function routesToNativeRegexMatch(parsed: ReturnType<typeof parseExpression>, env: SemanticEnv): boolean {
  return isRegexMatchExpression(parsed) && !env.bindings.has('RegExp');
}

// SLICE-3 — `<str>.match(/pat/g)` (GLOBAL array result) and `<str>.matchAll(/pat/g)`
// route native ONLY when `RegExp` is the builtin (not user-shadowed), same guard.
// `.matchAll` without /g is deliberately ADMITTED by the gate and fail-closed inside
// the eval so the precondition RE-ADMITS the shared REGEX_MATCHALL_NO_G_FAILCLOSE.
function routesToNativeRegexGlobalMatch(parsed: ReturnType<typeof parseExpression>, env: SemanticEnv): boolean {
  return isRegexGlobalMatchExpression(parsed) && !env.bindings.has('RegExp');
}

function routesToNativeRegexMatchAll(parsed: ReturnType<typeof parseExpression>, env: SemanticEnv): boolean {
  return isRegexMatchAllExpression(parsed) && !env.bindings.has('RegExp');
}

function expressionV1Preconditions(ir: IRNode, env: SemanticEnv): boolean {
  const props = asExpressionV1Props(ir);
  if (!isPortableBindingName(props.name)) return false;
  if (env.bindings.has(props.name)) return false;
  const expr = expressionSource(props.expr);
  if (!Object.hasOwn(ir.props ?? {}, 'expr') || expr === undefined || expr === '') return false;
  try {
    // `parseExpression` is INSIDE the try: a malformed `expr` (e.g. `'1 +'`) must
    // return false here so `referenceRun` raises the normal "Preconditions failed
    // …", not a raw parser error escaping out of `preconditions`.
    const parsed = parseExpression(expr);
    // Runner-native Decimal — trial-evaluate against the current env so variable
    // operands (`Decimal.eq(d, e)`, `Decimal.add(d, Decimal.of("1"))`) reject
    // unbound/non-Decimal bindings at the precondition boundary. Preserve the
    // shared canonical `Decimal.of("...")` fail-close by admitting that specific
    // error through to effects unchanged, mirroring the emitters' lowering site.
    // A user-shadowed `Decimal` (see routesToNativeDecimal) is NOT native — it
    // falls through to the portable trial below and abstains.
    if (routesToNativeDecimal(parsed, env)) {
      try {
        evalDecimalExpression(parsed, env);
        return true;
      } catch (error) {
        if (isRunnerNativeDecimalFailClose(error)) return true;
        return false;
      }
    }
    if (routesToNativeRegexTest(parsed, env)) {
      try {
        evalRegexTestExpression(parsed, env);
        return true;
      } catch (error) {
        if (isRunnerNativeRegexFailClose(error)) return true;
        return false;
      }
    }
    if (routesToNativeRegexMatch(parsed, env)) {
      try {
        evalRegexMatchExpression(parsed, env);
        return true;
      } catch (error) {
        if (isRunnerNativeRegexFailClose(error)) return true;
        return false;
      }
    }
    if (routesToNativeRegexGlobalMatch(parsed, env)) {
      try {
        evalRegexGlobalMatchExpression(parsed, env);
        return true;
      } catch (error) {
        if (isRunnerNativeRegexFailClose(error)) return true;
        return false;
      }
    }
    if (routesToNativeRegexMatchAll(parsed, env)) {
      try {
        evalRegexMatchAllExpression(parsed, env);
        return true;
      } catch (error) {
        if (isRunnerNativeRegexFailClose(error)) return true;
        return false;
      }
    }
    // Trial-evaluate the portable expression: a DOWNSTREAM read of a Decimal
    // binding (`d === "1"`) hits `assertPortableScalar` on the tagged Decimal
    // value, which throws → the runner ABSTAINS (Slice-1 boundary; Slice-2 gives
    // Decimal real downstream value semantics).
    evalPortableValue(parsed, env);
    return true;
  } catch {
    return false;
  }
}

function expressionV1Effects(ir: IRNode, env: SemanticEnv): Trace {
  const props = asExpressionV1Props(ir);
  const name = props.name as string;
  const expr = expressionSource(props.expr);
  if (expr === undefined || expr === '') {
    throw new Error('expression-v1: missing expr');
  }
  const parsed = parseExpression(expr);
  // Runner-native Decimal (Slice 1) — execute natively, then SPLIT the result:
  //   - the Trace's observable `assign.value` is the CANONICAL STRING (the
  //     differential observable the oracle reads, byte-identical to both emitted
  //     legs — a live decimal.js instance never enters the Trace), and
  //   - the `env.bindings` slot holds a TAGGED Decimal VALUE, NOT the bare string.
  // The split is intentional: a bare-string binding would let a DOWNSTREAM
  // portable read judge a Decimal as a string (`d === "1"` → true), diverging
  // from BOTH emitters (which emit `new Decimal("1") === "1"` → false). The tagged
  // value is NOT a portable scalar, so any downstream portable read of it throws
  // through `assertPortableScalar` → the precondition catches it → the runner
  // ABSTAINS rather than producing a divergent value. Full downstream Decimal
  // value semantics (matching the emitters' false/"1") is SLICE-2.
  // A non-canonical `Decimal.of` literal throws the shared canonical fail-close
  // here, which `referenceRun` propagates verbatim. A user-shadowed `Decimal`
  // (see routesToNativeDecimal) is NOT native — it falls through to portable eval.
  if (routesToNativeDecimal(parsed, env)) {
    const str = evalDecimalExpression(parsed, env);
    env.bindings.set(name, makeDecimalValue(str));
    return { events: [{ op: 'assign', target: name, value: str }], completion: { kind: 'normal' } };
  }
  if (routesToNativeRegexTest(parsed, env)) {
    const value = evalRegexTestExpression(parsed, env);
    env.bindings.set(name, value);
    return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
  }
  if (routesToNativeRegexMatch(parsed, env)) {
    const value = evalRegexMatchExpression(parsed, env);
    env.bindings.set(name, value === null ? null : makeRegExpMatchValue(value));
    return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
  }
  // SLICE-3 — `<str>.match(/pat/g)` (GLOBAL): the Trace `assign.value` is the PLAIN
  // array (or null) — the differential observable. The env BINDING holds the TAGGED
  // list wrapper so a downstream read (`m[0]`, `m.length`) hits the tag and ABSTAINS
  // (downstream array value semantics are a later slice). No-match binds plain null.
  if (routesToNativeRegexGlobalMatch(parsed, env)) {
    const value = evalRegexGlobalMatchExpression(parsed, env);
    env.bindings.set(name, value === null ? null : makeRegExpMatchListValue(value));
    return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
  }
  // SLICE-3 — `<str>.matchAll(/pat/g)`: always an array (possibly empty). Same
  // split — plain array in the Trace, tagged wrapper in the binding.
  if (routesToNativeRegexMatchAll(parsed, env)) {
    const value = evalRegexMatchAllExpression(parsed, env);
    env.bindings.set(name, makeRegExpMatchListValue(value));
    return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
  }
  const value = evalPortableValue(parsed, env);
  env.bindings.set(name, value);
  return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
}

function expressionV1Completion() {
  return { kind: 'normal' as const };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'expression-v1: number scalar',
    ir: { type: 'expression-v1', props: { name: 'n', expr: '42' } },
    expected: { events: [{ op: 'assign', target: 'n', value: 42 }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: string scalar',
    ir: { type: 'expression-v1', props: { name: 's', expr: '"hello"' } },
    expected: { events: [{ op: 'assign', target: 's', value: 'hello' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: boolean scalar',
    ir: { type: 'expression-v1', props: { name: 'b', expr: 'true' } },
    expected: { events: [{ op: 'assign', target: 'b', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: null scalar',
    ir: { type: 'expression-v1', props: { name: 'nl', expr: 'null' } },
    expected: { events: [{ op: 'assign', target: 'nl', value: null }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: equality',
    ir: { type: 'expression-v1', props: { name: 'eq', expr: 'x === y' } },
    env: {
      bindings: new Map([
        ['x', 1],
        ['y', 1],
      ]),
    },
    expected: { events: [{ op: 'assign', target: 'eq', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: truthiness basic',
    ir: { type: 'expression-v1', props: { name: 'truth', expr: '!x' } },
    env: { bindings: new Map([['x', '']]) },
    expected: { events: [{ op: 'assign', target: 'truth', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: template literal string coercion',
    ir: { type: 'expression-v1', props: { name: 'res', expr: '`n=${n}`' } },
    env: { bindings: new Map([['n', 100]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'n=100' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion constructor call',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(n)' } },
    env: { bindings: new Map([['n', 100]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: '100' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion canonicalizes null',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(n)' } },
    env: { bindings: new Map([['n', null]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'null' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion canonicalizes boolean',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(flag)' } },
    env: { bindings: new Map([['flag', false]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'false' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: ExprObject expression prop',
    ir: { type: 'expression-v1', props: { name: 'res', expr: { __expr: true, code: 'n + 1' } } },
    env: { bindings: new Map([['n', 41]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 42 }], completion: { kind: 'normal' } },
  },
]);

export const expressionV1Contract: NodeContract = {
  nodeType: 'expression-v1',
  preconditions: expressionV1Preconditions,
  effects: expressionV1Effects,
  completion: expressionV1Completion,
  forbiddenRewrites: [],
  fixtures: FIXTURES,
};

let registered = false;

export function registerExpressionV1Contract(): void {
  if (registered) return;
  registerContract(expressionV1Contract);
  registered = true;
}

export function _resetExpressionV1ContractForTest(): void {
  registered = false;
}
