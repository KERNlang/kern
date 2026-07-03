/**
 * `do` runtime semantics — milestone 5.1b.
 *
 * `do value="<expr>"` is KERN's documented "side-effecting expression whose
 * return value is discarded" body statement (see schema.ts's `do` entry,
 * example `arr.push(x)`). The TS and Python codegen legs already lower an
 * arbitrary bare-call expression generically (TS keeps native syntax; Python
 * translates known JS Array/Map method shapes — see
 * `packages/python/src/core/expr/list-ops.ts` for `.push` -> `.append`).
 *
 * The reference runner's domain is deliberately much narrower than "any bare
 * call": arrays and maps are PLAIN, FROZEN, PORTABLE VALUES in this runtime
 * (no shared mutable identity is otherwise observable — arrays/maps never
 * cross a function-call boundary, see portable-scalar.ts), so a "mutation" is
 * always modeled as a FUNCTIONAL rebind of the target identifier to a NEW
 * frozen container, never a true in-place mutation. This is behaviorally
 * indistinguishable from a real in-place mutation for every reachable
 * observation, because no alias of the container can ever exist.
 *
 * Exactly two shapes certify:
 *   1. Array append:  `<arrayIdent>.push(<elementExpr>)`
 *   2. Map set:       `Map.set(<mapIdent>, <keyExpr>, <valueExpr>)`
 * (see `portable-map.ts` for the Map value domain — construction, string
 * keys, portable-scalar values). Everything else — including an
 * EMPTY/absent `value=` (matching the emitters' genuine no-op) — either
 * no-ops or abstains; there is no general "arbitrary discarded expression"
 * support here.
 *
 * Observability: neither shape emits an `{op:'assign'}` trace event. This
 * matches the UNINSTRUMENTED TS/Python emitters exactly — a bare
 * `arr.push(x);` / `arr.append(x)` (and, for Map.set, `m.set(k, v);` /
 * `m.__setitem__(k, v)`) statement produces no observable trace hook of its
 * own; the mutation is only observable through a LATER read
 * (print/return/index) of the container. Emitting a synthetic `assign` event
 * here would create a reference-vs-TS-leg trace mismatch in the differential
 * harness (see `ts-leg.ts`'s `shouldTraceLetAssign`, which does NOT include
 * `do`/`push`/`Map.set` — the LET SETUP inside a `do` fixture still needs
 * `__semanticContract: 'do'` so the surrounding declarations trace correctly).
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import {
  assignBinding,
  getBinding,
  hasBinding,
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { evalArrayLiteralValue, isArrayLiteralExpression, type PortableArrayElement } from './portable-array.js';
import { resolveMapSetCall } from './portable-map.js';
import { evalPortableValue, isPortableBindingName } from './portable-scalar.js';
import { emptyTrace, type Trace } from './trace.js';

interface DoProps {
  value?: unknown;
}

function asDoProps(ir: IRNode): DoProps {
  return (ir.props ?? {}) as DoProps;
}

function isEmptyDoValue(props: DoProps): boolean {
  return props.value === undefined || props.value === '';
}

interface ResolvedPush {
  readonly kind: 'push';
  readonly targetName: string;
  readonly newArray: readonly PortableArrayElement[];
}

interface ResolvedMapSet {
  readonly kind: 'map-set';
  readonly targetName: string;
  readonly newMap: ReadonlyMap<string, unknown>;
}

type ResolvedDo = { readonly kind: 'noop' } | ResolvedPush | ResolvedMapSet;

/**
 * Pure resolution shared by preconditions and effects — never mutates `env`.
 * Throws on any out-of-domain shape so `preconditions` translates the throw
 * into a rejection while `effects` reuses the exact same computation.
 */
function resolveDo(ir: IRNode, env: SemanticEnv): ResolvedDo {
  const props = asDoProps(ir);
  if (isEmptyDoValue(props)) return { kind: 'noop' };
  const parsed = parseExpression(String(props.value));
  if (parsed.kind === 'call') {
    const pushTarget = pushCallTarget(parsed);
    if (pushTarget) {
      const { targetName, elementExpr } = pushTarget;
      if (!hasBinding(env, targetName)) throw new Error(`do: binding "${targetName}" not found`);
      const current = getBinding(env, targetName);
      if (!Array.isArray(current)) throw new Error(`do: "${targetName}.push(...)" requires an array binding`);
      const element = evalPortableArrayElement(elementExpr, env);
      return { kind: 'push', targetName, newArray: Object.freeze([...current, element]) };
    }
    const mapSet = resolveMapSetCall(parsed, env);
    if (mapSet) return { kind: 'map-set', targetName: mapSet.targetName, newMap: mapSet.newMap };
  }
  throw new Error('do: only "<array>.push(<element>)" and "Map.set(<map>, <key>, <value>)" are supported');
}

/** True + the receiver/argument shape iff `node` is `<bareIdent>.push(<expr>)`
 *  (non-optional receiver and call, exactly one argument). */
function pushCallTarget(node: ValueIR): { targetName: string; elementExpr: ValueIR } | undefined {
  if (node.kind !== 'call' || node.optional || node.args.length !== 1) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional || callee.property !== 'push') return undefined;
  if (callee.object.kind !== 'ident') return undefined;
  if (!isPortableBindingName(callee.object.name)) return undefined;
  return { targetName: callee.object.name, elementExpr: node.args[0] };
}

/** Evaluate the element being appended: a scalar (the shared portable-scalar
 *  domain) or a nested array literal, matching `portable-array.ts`'s element
 *  domain — the SAME domain an array LITERAL's own items may hold. */
function evalPortableArrayElement(node: ValueIR, env: SemanticEnv): PortableArrayElement {
  if (isArrayLiteralExpression(node)) return evalArrayLiteralValue(node, env);
  return evalPortableValue(node, env);
}

function doPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    resolveDo(ir, env);
    return true;
  } catch {
    return false;
  }
}

function doEffects(ir: IRNode, env: SemanticEnv): Trace {
  const resolved = resolveDo(ir, env);
  if (resolved.kind === 'noop') return emptyTrace();
  if (resolved.kind === 'push') {
    assignBinding(env, resolved.targetName, resolved.newArray);
    return emptyTrace();
  }
  assignBinding(env, resolved.targetName, resolved.newMap);
  return emptyTrace();
}

function doCompletion(ir: IRNode, env: SemanticEnv) {
  return doEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'emit an {op:"assign"} trace event for push/Map.set (the uninstrumented emitters produce none)',
  'mutate the underlying array/map object in place instead of rebinding a new frozen value',
  'treat a non-push/non-Map.set discarded expression as a supported no-op',
  'evaluate the pushed element / map key / map value more than once',
]);

function fixture(
  description: string,
  ir: IRNode,
  env: Partial<SemanticEnv> | undefined,
  expectedEvents: Trace['events'] = [],
): NodeFixture {
  return {
    description,
    ir,
    env,
    expected: { events: expectedEvents, completion: { kind: 'normal' } },
  };
}

/**
 * Build a fixture that pushes, then reads the mutated container back through
 * a REAL `assign` node (`assign target=probe value="<expr>"`), never `return`.
 *
 * Why not `return`: the fixture-lowering `return` case (`fixture-lowering.ts`)
 * has a DUAL convention — a non-string `value` is a literal passed through
 * raw, a string `value` is JSON-serialized AS A STRING LITERAL (every existing
 * contract's `return` fixtures use non-string literals for exactly this
 * reason). There is no "evaluate this string as an expression" mode for
 * `return` in the lowering, so `return value="xs[2]"` would lower to the TS
 * leg as `new __KernReturn("xs[2]")` — a STRING LITERAL, not an evaluated
 * expression — a false divergence, not a real one.
 *
 * `assign`'s `value` prop, by contrast, is ALWAYS parsed as a portable
 * expression on EVERY leg (see assign.ts's `resolveAssign`), and `assign`
 * emits its OWN `{op:'assign'}` trace event carrying the evaluated result —
 * exactly the observable channel this fixture needs, with zero lowering
 * ambiguity. `probe` is pre-declared with a value of the SAME type as the
 * expected read-back (assign's `=` requires type preservation).
 *
 * Why the pushed-onto array is seeded via `env.bindings`, never a traced
 * `let` node: the TS leg's `letAssignTraceTS` hook records `{op:'assign',
 * value: <liveIdent>}` by REFERENCE — real `Array.prototype.push` mutates
 * that SAME array object in place, so a later inspection of the EARLIER
 * trace event's `value` would retroactively show the ALREADY-PUSHED array (a
 * trace-capture artifact of JS object identity, not a real program
 * divergence — the reference runner's functional rebind never has this
 * problem because it never re-uses the old array object). Seeding the array
 * through `env.bindings` means each leg gets its OWN independently-cloned
 * copy (`makeEnv` clones bindings) with NO trace event for the declaration
 * at all, sidestepping the artifact entirely.
 */
function doFixture(
  description: string,
  containerName: string,
  initialValue: unknown,
  probeInit: string,
  doNode: IRNode,
  probeExpr: string,
  probeName: string,
  finalProbeValue: unknown,
): NodeFixture {
  const probe: IRNode = { type: 'let', props: { name: probeName, kind: 'let', value: probeInit } };
  const readBack: IRNode = { type: 'assign', props: { target: probeName, value: probeExpr } };
  return {
    description,
    ir: { type: '__block', props: { __semanticContract: 'do' }, children: [probe, doNode, readBack] },
    env: { bindings: new Map([[containerName, initialValue]]) },
    expected: {
      events: [
        { op: 'assign', target: probeName, value: JSON.parse(probeInit) },
        { op: 'assign', target: probeName, value: finalProbeValue },
      ],
      completion: { kind: 'normal' },
    },
  };
}

function doPush(target: string, value: string): IRNode {
  return { type: 'do', props: { value: `${target}.push(${value})` } };
}

function doMapSet(target: string, key: string, value: string): IRNode {
  return { type: 'do', props: { value: `Map.set(${target}, ${key}, ${value})` } };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  fixture('do: empty value is a no-op', { type: 'do', props: {} }, undefined),
  doFixture(
    'do: array push appends one element, observable on the NEXT index read',
    'xs',
    [1, 2],
    '0',
    doPush('xs', '3'),
    'xs[2]',
    'probe',
    3,
  ),
  doFixture(
    'do: push does not disturb existing elements',
    'xs',
    [10, 20],
    '0',
    doPush('xs', '30'),
    'xs[0]',
    'probe',
    10,
  ),
  doFixture('do: push grows .length by one', 'xs', [1], '0', doPush('xs', '2'), 'xs.length', 'probe', 2),
  doFixture(
    'do: pushing onto an empty array yields a single-element array',
    'xs',
    [],
    '0',
    doPush('xs', '1'),
    'xs[0]',
    'probe',
    1,
  ),
  doFixture(
    'do: push accepts a nested array-literal element',
    'rows',
    [],
    '0',
    doPush('rows', '[1,2]'),
    'rows.length',
    'probe',
    1,
  ),
  doFixture(
    'do: Map.set adds a new key, observable via Map.get',
    'm',
    new Map<string, unknown>(),
    '0',
    doMapSet('m', '"a"', '1'),
    'Map.get(m, "a")',
    'probe',
    1,
  ),
  doFixture(
    'do: Map.set does not disturb an existing key',
    'm',
    new Map<string, unknown>([['a', 1]]),
    '0',
    doMapSet('m', '"b"', '2'),
    'Map.get(m, "a")',
    'probe',
    1,
  ),
  doFixture(
    'do: Map.set overwrites an existing key',
    'm',
    new Map<string, unknown>([['a', 1]]),
    '0',
    doMapSet('m', '"a"', '2'),
    'Map.get(m, "a")',
    'probe',
    2,
  ),
  doFixture(
    'do: Map.set makes Map.has true for the new key',
    'm',
    new Map<string, unknown>(),
    'false',
    doMapSet('m', '"a"', '1'),
    'Map.has(m, "a")',
    'probe',
    true,
  ),
]);

export const doContract: NodeContract = {
  nodeType: 'do',
  preconditions: doPreconditions,
  effects: doEffects,
  completion: doCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerDoContract(): void {
  if (registered) return;
  registerContract(doContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetDoContractForTest(): void {
  registered = false;
}
