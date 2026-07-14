/**
 * Portable Map VALUES for the ReferenceRunner — milestone 5.1b stdlib slice.
 *
 * Mirrors `portable-array.ts`'s design: the runner represents a KERN `Map`
 * as a genuine, native JS `Map<string, PortableScalar>`. No custom tag is
 * needed (unlike Decimal/caught-error) — `instanceof Map` is already a
 * precise, un-spoofable discriminator, and a bare `Map` object automatically
 * fails `isPortableScalar` (like arrays), so any SCALAR-context read of a Map
 * binding (`print m`, `m + 1`) still fails closed via `assertPortableScalar`.
 *
 * Scope (deliberately narrow — this is a first vertical slice, not the full
 * `Map` stdlib surface):
 *   - Construction: `new Map()` ONLY (zero-arg). A from-entries form
 *     (`new Map([[k,v], ...])`) is NOT supported — fails closed.
 *   - Keys: STRING scalars only. `Map.get`/`Map.has`/`Map.set` all require a
 *     string key; a number/boolean/null key fails closed rather than risk a
 *     TS/Python key-coercion divergence no fixture has proven safe.
 *   - Values: portable SCALARS only (no nested array/Map values) — the same
 *     conservative restriction, deferred rather than guessed at.
 *   - `Map.get` on a MISSING key fails closed (abstains) rather than
 *     returning a value: real `Map.prototype.get` returns `undefined` on a
 *     miss while Python's `dict.get(k)` returns `None` — the SAME KERN_STDLIB
 *     lowering (`$0.get($1)` on both legs) that ALREADY ships for this
 *     operation carries that exact TS-`undefined`-vs-Python-`None` gap for a
 *     miss (pre-existing, not introduced here); `Map.has` is the safe way to
 *     probe presence, and this predicate makes the REFERENCE runner abstain
 *     on the one input shape where the two other legs would visibly diverge
 *     if the raw result were ever printed/returned.
 *   - `Map.set` is a MUTATION and only certifies inside `do` (see do.ts) —
 *     Maps, like arrays, are plain values here with no observable shared
 *     identity (never cross a function-call boundary), so "set" is modeled
 *     as a functional rebind of the target identifier to a NEW Map (all
 *     existing entries plus the new/updated one), never a true in-place
 *     mutation of a shared object.
 */

import { isValueIR, type ValueIR } from '../../value-ir.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { isPortableBindingName, type PortableScalar } from './portable-scalar-domain.js';
import { getBinding, hasBinding, type SemanticEnv } from './semantic-env.js';

export type PortableMapValue = ReadonlyMap<string, PortableScalar>;

/** True iff `value` is a runner-native Map value. */
export function isPortableMapValue(value: unknown): value is PortableMapValue {
  return value instanceof Map;
}

/**
 * True iff `node` is the builtin, UNSHADOWED `Map` namespace identifier —
 * mirrors the Decimal-namespace-call gate (`env.has('Decimal')` in
 * `evalRunnerNativeDecimalCall`) so a user binding named `Map` shadows the
 * builtin instead of silently colliding with it.
 */
function isMapNamespaceIdent(node: ValueIR, env: SemanticEnv): boolean {
  return node.kind === 'ident' && node.name === 'Map' && !hasBinding(env, 'Map');
}

/** True iff `node` (a `new` expression's `.argument`) is exactly `Map()` —
 *  i.e. the whole expression is `new Map()`. Any argument makes this false
 *  (fail closed; only the empty-map constructor is supported). */
export function isEmptyMapConstructorCall(node: ValueIR, env: SemanticEnv): boolean {
  return node.kind === 'call' && !node.optional && node.args.length === 0 && isMapNamespaceIdent(node.callee, env);
}

function requirePortableMapBinding(name: string, env: SemanticEnv, label: string): PortableMapValue {
  if (!hasBinding(env, name)) throw new Error(`portable: binding "${name}" not found`);
  const value = getBinding(env, name);
  if (!isPortableMapValue(value)) throw new Error(`portable: "${name}" is not a Map binding (required by ${label})`);
  return value;
}

function requireStringKey(node: ValueIR, env: SemanticEnv, evaluate: EvalPortableValue, label: string): string {
  const key = evaluate(node, env);
  if (typeof key !== 'string') throw new Error(`portable: ${label} key must be a string`);
  return key;
}

/**
 * `Map.get(m, k)` / `Map.has(m, k)` — read-only namespace calls. Returns
 * `undefined` when `node` is not shaped like ONE of these two calls (so the
 * caller falls through to the generic call path); throws on a recognized but
 * invalid shape (wrong arity, non-ident receiver, non-string key, missing
 * `.get` key) so the runner abstains atomically rather than guess.
 */
export function evalMapReadCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PortableScalar | undefined {
  if (node.optional) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional) return undefined;
  if (!isMapNamespaceIdent(callee.object, env)) return undefined;
  if (callee.property !== 'get' && callee.property !== 'has') return undefined;
  const label = `Map.${callee.property}`;
  if (node.args.length !== 2) throw new Error(`portable: ${label} expects exactly 2 arguments`);
  const mapArg = node.args[0];
  if (!isValueIR(mapArg) || mapArg.kind !== 'ident' || !isPortableBindingName(mapArg.name)) {
    throw new Error(`portable: ${label} first argument must be a bare map-binding identifier`);
  }
  const mapValue = requirePortableMapBinding(mapArg.name, env, label);
  const key = requireStringKey(node.args[1], env, evaluate, label);
  if (callee.property === 'has') return mapValue.has(key);
  if (!mapValue.has(key)) {
    throw new Error(`portable: ${label} on a missing key is outside the portable domain (use Map.has to probe first)`);
  }
  return mapValue.get(key) as PortableScalar;
}

/**
 * `Map.set(<mapIdent>, <keyExpr>, <valueExpr>)` — recognized ONLY by `do`
 * (see do.ts). Returns the resolved target name + a NEW Map with the
 * key/value applied on top of the current entries, or `undefined` when
 * `node` is not this exact shape (three args, `Map` namespace, bare ident
 * receiver) so the caller can try other `do` shapes / fail closed itself.
 */
export function resolveMapSetCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): { targetName: string; newMap: PortableMapValue } | undefined {
  if (node.optional) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional || callee.property !== 'set') return undefined;
  if (!isMapNamespaceIdent(callee.object, env)) return undefined;
  if (node.args.length !== 3) throw new Error('portable: Map.set expects exactly 3 arguments');
  const mapArg = node.args[0];
  if (!isValueIR(mapArg) || mapArg.kind !== 'ident' || !isPortableBindingName(mapArg.name)) {
    throw new Error('portable: Map.set first argument must be a bare map-binding identifier');
  }
  return resolveParsedMapSet(mapArg.name, node.args[1], node.args[2], env, evaluate);
}

export function resolveParsedMapSet(
  targetName: string,
  keyNode: ValueIR,
  valueNode: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): { targetName: string; newMap: PortableMapValue } {
  const current = requirePortableMapBinding(targetName, env, 'Map.set');
  const key = requireStringKey(keyNode, env, evaluate, 'Map.set');
  const value = evaluate(valueNode, env);
  const newMap = new Map(current);
  newMap.set(key, value);
  return { targetName, newMap };
}
