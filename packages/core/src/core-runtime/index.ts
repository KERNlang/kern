import { hasDirectSuperCtorCall } from '../constructor-super.js';
import {
  CORE_TYPE_CONTRACTS,
  CoreContractEvaluationError,
  type CoreFixtureValue,
  evaluateCoreContractOperation,
} from '../core-contracts/index.js';
import { numberToInt32, numberToUint32 } from '../ir/semantics/to-numeric.js';
import { parseExpression } from '../parser-expression.js';
import { splitPortableExpressionList } from '../portable-expression-list.js';
import type { IRNode } from '../types.js';
import type { ValueIR } from '../value-ir.js';
import {
  CoreRuntimeContractAdapterError,
  coreFixtureValueToKernValue,
  kernValueToCoreFixtureValue,
} from './contract-adapter.js';
import { collectCoreShapeFacts, validateCoreShape } from './shape-validator.js';
import { brandValue, KERN_VALUE_BRAND } from './value-brand.js';

const INTEGER_INDEX_RE = /^(0|[1-9]\d*)$/;
const ACTIVE_INSTANCE_SETTERS = new WeakMap<KernInstanceValue, Set<string>>();
const ACTIVE_CLASS_SETTERS = new WeakMap<KernClassValue, Set<string>>();
const ACTIVE_CONSTRUCTORS = new WeakMap<KernInstanceValue, RuntimeConstructionFrame[]>();

export type KernValue =
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'array'; items: KernValue[] }
  | { kind: 'record'; entries: Record<string, KernValue> }
  | KernFunctionValue
  | KernBuiltinValue
  | KernClassValue
  | KernInstanceValue
  | KernBoundMethodValue
  | KernSuperValue;

export interface KernFunctionValue {
  kind: 'function';
  name?: string;
  params: RuntimeParam[];
  body: IRNode[];
  env: CoreRuntimeEnv;
}

export interface KernBuiltinValue {
  kind: 'builtin';
  name: string;
  call: (args: KernValue[]) => KernValue;
}

export interface KernClassValue {
  kind: 'class';
  name: string;
  node: IRNode;
  env: CoreRuntimeEnv;
  staticFields: Record<string, KernValue>;
  runtimeRootContext?: IRNode | readonly IRNode[];
}

export interface KernInstanceValue {
  kind: 'instance';
  classValue: KernClassValue;
  fields: Record<string, KernValue>;
  initializedClasses: Set<string>;
}

export interface KernBoundMethodValue {
  kind: 'bound-method';
  name: string;
  receiver: KernInstanceValue;
  methodNode: IRNode;
  ownerClass: KernClassValue;
}

export interface KernSuperValue {
  kind: 'super';
  receiver: KernInstanceValue | KernClassValue;
  ownerClass: KernClassValue;
  mode: 'constructor' | 'method' | 'static';
}

export interface RuntimeParam {
  name: string;
  type?: string;
  defaultExpr?: string;
}

interface RuntimeConstructionFrame {
  ownerClass: KernClassValue;
  superCalled: boolean;
}

export type CoreCompletion = { kind: 'normal'; value: KernValue } | { kind: 'return'; value: KernValue };

export interface CoreRuntimeResult {
  completion: CoreCompletion;
  env: CoreRuntimeEnv;
}

export interface CreateCoreRuntimeEnvOptions {
  globals?: Record<string, unknown>;
  parent?: CoreRuntimeEnv;
}

export class CoreRuntimeEnv {
  private readonly bindings = new Map<string, KernValue>();
  private runtimeRootContext?: IRNode | readonly IRNode[];

  constructor(readonly parent?: CoreRuntimeEnv) {}

  define(name: string, value: KernValue): KernValue {
    if (this.bindings.has(name)) throw new Error(`KERN core runtime binding already defined: ${name}`);
    this.bindings.set(name, value);
    return value;
  }

  assign(name: string, value: KernValue): KernValue {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return value;
    }
    if (this.parent) return this.parent.assign(name, value);
    throw new Error(`KERN core runtime binding not found: ${name}`);
  }

  lookup(name: string): KernValue {
    if (this.bindings.has(name)) return this.bindings.get(name) ?? kUndefined();
    if (this.parent) return this.parent.lookup(name);
    throw new Error(`KERN core runtime binding not found: ${name}`);
  }

  has(name: string): boolean {
    return this.bindings.has(name) || (this.parent?.has(name) ?? false);
  }

  child(): CoreRuntimeEnv {
    return new CoreRuntimeEnv(this);
  }

  setRuntimeRootContext(root: IRNode | readonly IRNode[]): void {
    this.runtimeRootContext = root;
  }

  getRuntimeRootContext(): IRNode | readonly IRNode[] | undefined {
    return this.runtimeRootContext ?? this.parent?.getRuntimeRootContext();
  }
}

export const kNull = (): KernValue => brandValue({ kind: 'null' });
export const kUndefined = (): KernValue => brandValue({ kind: 'undefined' });
export const kBoolean = (value: boolean): KernValue => brandValue({ kind: 'boolean', value });
export const kNumber = (value: number): KernValue => {
  if (!Number.isFinite(value)) throw new Error('KERN core runtime number must be finite.');
  return brandValue({ kind: 'number', value });
};
export const kString = (value: string): KernValue => brandValue({ kind: 'string', value });

export function createCoreRuntimeEnv(options: CreateCoreRuntimeEnvOptions = {}): CoreRuntimeEnv {
  const env = new CoreRuntimeEnv(options.parent);
  for (const [name, value] of Object.entries(options.globals ?? {})) env.define(name, fromHostValue(value));
  installPortableBuiltins(env);
  return env;
}

function installPortableBuiltins(env: CoreRuntimeEnv): void {
  for (const builtin of [
    {
      kind: 'builtin' as const,
      name: 'String',
      call: (args: KernValue[]) => {
        if (args.length !== 1) throw new Error('KERN core runtime String() expects exactly one argument.');
        return kString(kernStringCoerce(args[0]));
      },
    },
  ]) {
    if (!env.has(builtin.name)) env.define(builtin.name, brandValue(builtin));
  }
}

export function fromHostValue(value: unknown): KernValue {
  if (isKernValue(value)) return value;
  if (value === null) return kNull();
  if (value === undefined) return kUndefined();
  if (typeof value === 'boolean') return kBoolean(value);
  if (typeof value === 'number') return kNumber(value);
  if (typeof value === 'string') return kString(value);
  if (Array.isArray(value)) return brandValue({ kind: 'array', items: Array.from(value, fromHostValue) });
  if (isPlainRecord(value)) {
    const entries = createRecordEntries();
    for (const [key, entry] of Object.entries(value)) entries[key] = fromHostValue(entry);
    return brandValue({
      kind: 'record',
      entries,
    });
  }
  throw new Error(`Unsupported host value for KERN core runtime: ${typeof value}`);
}

export function toHostValue(value: KernValue | undefined): unknown {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'array':
      return value.items.map(toHostValue);
    case 'record':
      return Object.fromEntries(Object.entries(value.entries).map(([key, entry]) => [key, toHostValue(entry)]));
    case 'instance':
      return Object.fromEntries(Object.entries(value.fields).map(([key, entry]) => [key, toHostValue(entry)]));
    case 'function':
    case 'builtin':
    case 'class':
    case 'bound-method':
      return `[KERN ${value.kind}${value.name ? ` ${value.name}` : ''}]`;
    case 'super':
      return `[KERN super ${value.ownerClass.name}]`;
  }
}

export function kernTruthy(value: KernValue): boolean {
  switch (value.kind) {
    case 'null':
    case 'undefined':
      return false;
    case 'boolean':
      return value.value;
    case 'number':
      // Slice S5 — KERN ToBoolean: a number is falsy iff it is +0/-0 OR NaN.
      // Reject both zero and NaN, matching the Python `_kern_truthy` helper
      // (`x != 0 and x == x`). NaN is currently unreachable here because
      // `kNumber` rejects non-finite numbers, but this keeps the TS truthiness
      // predicate parity-correct by construction (the Python leg DOES see NaN
      // via `float('nan')`).
      return value.value !== 0 && !Number.isNaN(value.value);
    case 'string':
      return value.value.length > 0;
    case 'array':
    case 'record':
    case 'function':
    case 'builtin':
    case 'class':
    case 'instance':
    case 'bound-method':
    case 'super':
      return true;
  }
}

export function evalCoreExpression(expr: string | ValueIR, env: CoreRuntimeEnv = createCoreRuntimeEnv()): KernValue {
  installPortableBuiltins(env);
  const valueIR = typeof expr === 'string' ? parseExpression(expr) : expr;
  return evalValueIR(valueIR, env);
}

export function runCoreRuntime(
  nodeOrNodes: IRNode | readonly IRNode[],
  env = createCoreRuntimeEnv(),
): CoreRuntimeResult {
  env.setRuntimeRootContext(nodeOrNodes);
  const nodes: readonly IRNode[] = isIRNodeArray(nodeOrNodes) ? nodeOrNodes : runtimeChildren(nodeOrNodes);
  return { completion: executeSequence(nodes, env), env };
}

export function callCoreFunction(
  fnNode: IRNode,
  args: KernValue[],
  env = createCoreRuntimeEnv(),
): { value: KernValue; env: CoreRuntimeEnv } {
  if (fnNode.type !== 'fn') throw new Error('KERN core runtime callCoreFunction expects an fn node.');
  const fn = makeFunction(fnNode, env);
  return callFunctionValue(fn, args);
}

function executeSequence(nodes: readonly IRNode[], env: CoreRuntimeEnv): CoreCompletion {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type === 'else') throw new Error('KERN core runtime `else` must immediately follow an `if`.');
    if (node.type === 'if') {
      const completion = executeIf(node, nodes[i + 1], env);
      if (nodes[i + 1]?.type === 'else') i += 1;
      if (completion.kind !== 'normal') return completion;
      continue;
    }
    const completion = executeNode(node, env);
    if (completion.kind !== 'normal') return completion;
  }
  return { kind: 'normal', value: kUndefined() };
}

function executeNode(node: IRNode, env: CoreRuntimeEnv): CoreCompletion {
  switch (node.type) {
    case 'interface':
    case 'import':
    case 'use':
      return { kind: 'normal', value: kUndefined() };
    case 'handler':
    case '__block':
      return executeSequence(node.children ?? [], env);
    case 'let':
    case 'expression-v1': {
      const name = requiredString(node.props?.name, `${node.type} name=`);
      const rawExpr = node.type === 'let' ? node.props?.value : node.props?.expr;
      env.define(name, evalCoreExpression(unwrapExpr(rawExpr, `${node.type} expression`), env));
      return { kind: 'normal', value: kUndefined() };
    }
    case 'return': {
      if (node.props && Object.hasOwn(node.props, 'value')) {
        return { kind: 'return', value: evalCoreExpression(unwrapExpr(node.props.value, 'return value='), env) };
      }
      return { kind: 'return', value: kUndefined() };
    }
    case 'fn': {
      const fn = makeFunction(node, env);
      env.define(requiredString(node.props?.name, 'fn name='), fn);
      return { kind: 'normal', value: kUndefined() };
    }
    case 'class': {
      const klass = makeClass(node, env);
      env.define(klass.name, klass);
      initializeClassStaticFields(klass);
      validateImplementedClassStaticProtocols(klass);
      return { kind: 'normal', value: kUndefined() };
    }
    case 'assign':
      executeAssign(node, env);
      return { kind: 'normal', value: kUndefined() };
    case 'do': {
      evalCoreExpression(unwrapExpr(node.props?.value, 'do value='), env);
      return { kind: 'normal', value: kUndefined() };
    }
    case 'coalesce':
    case 'firstDefined':
      return executeCoalesce(node, env);
    case 'firstTruthy':
      return executeFirstTruthy(node, env);
    default:
      throw new Error(`KERN core runtime unsupported node type: ${node.type}`);
  }
}

function executeIf(node: IRNode, maybeElse: IRNode | undefined, env: CoreRuntimeEnv): CoreCompletion {
  const cond = evalCoreExpression(unwrapExpr(node.props?.cond, 'if cond='), env);
  if (kernTruthy(cond)) return executeSequence(node.children ?? [], env.child());
  if (maybeElse?.type === 'else') return executeSequence(maybeElse.children ?? [], env.child());
  return { kind: 'normal', value: kUndefined() };
}

function executeCoalesce(node: IRNode, env: CoreRuntimeEnv): CoreCompletion {
  const name = requiredString(node.props?.name, `${node.type} name=`);
  const values = splitPortableExpressionList(
    requiredString(node.props?.values, `${node.type} values=`),
    `${node.type} values=`,
  );
  if (values.length < 2) throw new Error(`KERN core runtime ${node.type} requires at least two values.`);
  let winner = kUndefined();
  for (const value of values) {
    const candidate = evalCoreExpression(value, env);
    if (!isNullish(candidate)) {
      winner = candidate;
      break;
    }
  }
  env.define(name, winner);
  return { kind: 'normal', value: kUndefined() };
}

function executeFirstTruthy(node: IRNode, env: CoreRuntimeEnv): CoreCompletion {
  const name = requiredString(node.props?.name, 'firstTruthy name=');
  const values = splitPortableExpressionList(
    requiredString(node.props?.values, 'firstTruthy values='),
    'firstTruthy values=',
  );
  if (values.length < 2) throw new Error('KERN core runtime firstTruthy requires at least two values.');
  let winner = kUndefined();
  for (const value of values) {
    const candidate = evalCoreExpression(value, env);
    if (kernTruthy(candidate)) {
      winner = candidate;
      break;
    }
  }
  env.define(name, winner);
  return { kind: 'normal', value: kUndefined() };
}

function evalValueIR(node: ValueIR, env: CoreRuntimeEnv): KernValue {
  switch (node.kind) {
    case 'numLit':
      if (node.bigint) throw new Error('KERN core runtime bigint literals are not supported yet.');
      return kNumber(node.value);
    case 'strLit':
      return kString(node.value);
    case 'boolLit':
      return kBoolean(node.value);
    case 'nullLit':
      return kNull();
    case 'undefLit':
      return kUndefined();
    case 'ident': {
      const value = env.lookup(node.name);
      if (node.name === 'this' && value.kind === 'instance') guardConstructedInstanceAccess(value);
      return value;
    }
    case 'tmplLit':
      return kString(
        node.quasis.reduce((out, quasi, index) => {
          const expr =
            index < node.expressions.length ? kernStringCoerce(evalValueIR(node.expressions[index], env)) : '';
          return out + quasi + expr;
        }, ''),
      );
    case 'arrayLit':
      return brandValue({ kind: 'array', items: node.items.map((item) => evalValueIR(item, env)) });
    case 'objectLit':
      return evalObjectLiteral(node, env);
    case 'unary':
      return evalUnary(node, env);
    case 'binary':
      return evalBinary(node, env);
    case 'conditional':
      return kernTruthy(evalValueIR(node.test, env))
        ? evalValueIR(node.consequent, env)
        : evalValueIR(node.alternate, env);
    case 'typeAssert':
    case 'nonNull':
      return evalValueIR(node.expression, env);
    case 'member':
      return evalMember(node, env);
    case 'index':
      return evalIndex(node, env);
    case 'call':
      return evalCall(node, env);
    case 'lambda':
      throw new Error('KERN core runtime lambda expressions are not supported in the first runtime slice.');
    case 'new':
      return evalNew(node, env);
    default:
      throw new Error(`KERN core runtime unsupported expression kind: ${node.kind}`);
  }
}

function evalObjectLiteral(node: Extract<ValueIR, { kind: 'objectLit' }>, env: CoreRuntimeEnv): KernValue {
  const entries = createRecordEntries();
  for (const entry of node.entries) {
    if (isObjectSpreadEntry(entry)) {
      const spread = evalValueIR(entry.argument, env);
      if (spread.kind !== 'record') throw new Error('KERN core runtime object spread requires a record.');
      for (const [key, value] of Object.entries(spread.entries)) entries[key] = value;
    } else {
      entries[entry.key] = evalValueIR(entry.value, env);
    }
  }
  return brandValue({ kind: 'record', entries });
}

function evalUnary(node: Extract<ValueIR, { kind: 'unary' }>, env: CoreRuntimeEnv): KernValue {
  const arg = evalValueIR(node.argument, env);
  if (node.op === '!') {
    if (arg.kind !== 'boolean') throw new Error('KERN core runtime unary ! requires a boolean.');
    return dispatchCoreContractOperation('Boolean.not', [arg.value]);
  }
  if (node.op === '-' || node.op === '+') {
    if (arg.kind !== 'number') throw new Error(`KERN core runtime unary ${node.op} requires a number.`);
    return node.op === '-' ? dispatchCoreContractOperation('Number.negate', [arg.value]) : arg;
  }
  // Slice 6 — bitwise NOT `~`: ToInt32(operand), bitwise-not, Int32 result.
  // The operand is already an evaluated number here; ToInt32 = numberToInt32.
  if (node.op === '~') {
    if (arg.kind !== 'number') throw new Error('KERN core runtime unary ~ requires a number.');
    // `~x === -(x+1)` on the Int32 value; recompute through numberToInt32 so
    // the result stays in signed-32 range (matches JS `~`).
    return kNumber(numberToInt32(~numberToInt32(arg.value)));
  }
  throw new Error(`KERN core runtime unsupported unary operator: ${node.op}`);
}

function evalBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: CoreRuntimeEnv): KernValue {
  if (node.op === '&&') {
    const left = evalValueIR(node.left, env);
    return kernTruthy(left) ? evalValueIR(node.right, env) : left;
  }
  if (node.op === '||') {
    const left = evalValueIR(node.left, env);
    return kernTruthy(left) ? left : evalValueIR(node.right, env);
  }
  if (node.op === '??') {
    const left = evalValueIR(node.left, env);
    return isNullish(left) ? evalValueIR(node.right, env) : left;
  }

  const left = evalValueIR(node.left, env);
  const right = evalValueIR(node.right, env);
  switch (node.op) {
    case '+':
      if (left.kind === 'number' && right.kind === 'number') {
        return dispatchCoreContractOperation('Number.add', [left.value, right.value]);
      }
      if (left.kind === 'string' && right.kind === 'string') {
        return dispatchCoreContractOperation('String.concat', [left.value, right.value]);
      }
      throw new Error('KERN core runtime + requires two numbers or two strings.');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    // Slice S7 — split loose (`==`) and strict (`===`) equality so the
    // null/undefined boundary matches JS: `undefined == null` is TRUE (both
    // nullish) but `undefined === null` is FALSE (distinct kinds). Pre-S7 a
    // single `kernEquals` served both ops and, since `undefined` and `null` are
    // distinct KernValue kinds, made `undefined == null` wrongly FALSE.
    case '===':
      return kBoolean(kernStrictEqual(left, right));
    case '==':
      return kBoolean(kernLooseEqual(left, right));
    case '!==':
      return kBoolean(!kernStrictEqual(left, right));
    case '!=':
      return kBoolean(!kernLooseEqual(left, right));
    case '<':
    case '<=':
    case '>':
    case '>=':
      return evalOrderedComparison(node.op, left, right);
    // Slice 6 — bitwise / shift on the ToInt32 substrate. Operands are already
    // evaluated numbers; ToInt32/ToUint32 = numberToInt32/numberToUint32.
    case '&':
    case '|':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return evalBitwiseBinary(node.op, left, right);
    default:
      throw new Error(`KERN core runtime unsupported binary operator: ${node.op}`);
  }
}

/**
 * Slice 6 — JS bitwise/shift semantics on the slice-0.75 ToInt32 substrate.
 *
 *   & | ^      ToInt32(a) <op> ToInt32(b) -> Int32
 *   << >>      ToInt32(a) <op> (ToUint32(b) & 31) -> Int32
 *   >>>        ToUint32(a) >> (ToUint32(b) & 31) -> Uint32 (zero-fill)
 *
 * The converted operands are already in signed/unsigned-32 range, so the native
 * JS operators applied to them reproduce the spec exactly; the final
 * numberToInt32/numberToUint32 re-normalizes (and, for `>>>`, lifts the result
 * out of JS's signed-`>>` range into the 0..2^32-1 Uint32 codomain).
 */
function evalBitwiseBinary(op: string, left: KernValue, right: KernValue): KernValue {
  if (left.kind !== 'number' || right.kind !== 'number') {
    throw new Error(`KERN core runtime ${op} requires two numbers.`);
  }
  const a32 = numberToInt32(left.value);
  switch (op) {
    case '&':
      return kNumber(numberToInt32(a32 & numberToInt32(right.value)));
    case '|':
      return kNumber(numberToInt32(a32 | numberToInt32(right.value)));
    case '^':
      return kNumber(numberToInt32(a32 ^ numberToInt32(right.value)));
    case '<<':
      return kNumber(numberToInt32(a32 << (numberToUint32(right.value) & 31)));
    case '>>':
      return kNumber(numberToInt32(a32 >> (numberToUint32(right.value) & 31)));
    case '>>>': {
      // Zero-fill: operate on the UNSIGNED left operand. JS `>>>` already yields
      // a Uint32; numberToUint32 keeps it in the 0..2^32-1 codomain.
      const shifted = numberToUint32(left.value) >>> (numberToUint32(right.value) & 31);
      return kNumber(numberToUint32(shifted));
    }
    default:
      throw new Error(`KERN core runtime unsupported bitwise operator: ${op}`);
  }
}

function evalNumberBinary(op: string, left: KernValue, right: KernValue): KernValue {
  if (left.kind !== 'number' || right.kind !== 'number') {
    throw new Error(`KERN core runtime ${op} requires two numbers.`);
  }
  switch (op) {
    case '-':
      return dispatchCoreContractOperation('Number.subtract', [left.value, right.value]);
    case '*':
      return dispatchCoreContractOperation('Number.multiply', [left.value, right.value]);
    case '/':
      return dispatchCoreContractOperation('Number.divide', [left.value, right.value]);
    case '%':
      return dispatchCoreContractOperation('Number.remainder', [left.value, right.value]);
    default:
      throw new Error(`KERN core runtime unsupported numeric operator: ${op}`);
  }
}

function evalOrderedComparison(op: string, left: KernValue, right: KernValue): KernValue {
  if (!((left.kind === 'number' && right.kind === 'number') || (left.kind === 'string' && right.kind === 'string'))) {
    throw new Error(`KERN core runtime ${op} requires same-kind number or string operands.`);
  }
  if (left.kind === 'number' && right.kind === 'number') {
    if (op === '<') return dispatchCoreContractOperation('Number.lessThan', [left.value, right.value]);
    if (op === '<=') return dispatchCoreContractOperation('Number.lessThanOrEqual', [left.value, right.value]);
    if (op === '>') return dispatchCoreContractOperation('Number.greaterThan', [left.value, right.value]);
    return dispatchCoreContractOperation('Number.greaterThanOrEqual', [left.value, right.value]);
  }
  if (op === '<') return dispatchCoreContractOperation('String.lessThan', [left.value, right.value]);
  if (op === '<=') return dispatchCoreContractOperation('String.lessThanOrEqual', [left.value, right.value]);
  if (op === '>') return dispatchCoreContractOperation('String.greaterThan', [left.value, right.value]);
  return dispatchCoreContractOperation('String.greaterThanOrEqual', [left.value, right.value]);
}

function evalMember(node: Extract<ValueIR, { kind: 'member' }>, env: CoreRuntimeEnv): KernValue {
  const object = evalValueIR(node.object, env);
  if (isNullish(object)) {
    if (node.optional) return kUndefined();
    throw new Error(`KERN core runtime cannot read .${node.property} from ${object.kind}.`);
  }
  if (object.kind === 'record') {
    return evalRecordGet(object, node.property);
  }
  if (object.kind === 'instance') return evalInstanceMember(object, node.property);
  if (object.kind === 'super') return evalSuperMember(object, node.property);
  if (object.kind === 'class') return evalClassMember(object, node.property);
  if (object.kind === 'array' && node.property === 'length') {
    return kNumber(object.items.length);
  }
  if (object.kind === 'string') return evalStringMember(object, node.property);
  if (object.kind === 'boolean') return evalBooleanMember(object, node.property);
  return kUndefined();
}

function evalIndex(node: Extract<ValueIR, { kind: 'index' }>, env: CoreRuntimeEnv): KernValue {
  const object = evalValueIR(node.object, env);
  if (isNullish(object)) {
    if (node.optional) return kUndefined();
    throw new Error(`KERN core runtime cannot index ${object.kind}.`);
  }
  const index = evalValueIR(node.index, env);
  if (object.kind === 'array') {
    if (index.kind !== 'number') throw new Error('KERN core runtime array index must be a number.');
    return evalListIndex(object, index.value);
  }
  if (object.kind === 'record' || object.kind === 'string') {
    if (index.kind !== 'string' && index.kind !== 'number') {
      throw new Error('KERN core runtime record/string index must be a string or number.');
    }
    const key = String(index.value);
    if (object.kind === 'record') return evalRecordGet(object, key);
    const charIndex =
      index.kind === 'number' ? index.value : INTEGER_INDEX_RE.test(index.value) ? Number(index.value) : NaN;
    if (!Number.isFinite(charIndex) && index.kind !== 'number') return kUndefined();
    return dispatchCoreContractOperation('String.index', [object.value, charIndex]);
  }
  return kUndefined();
}

function evalStringMember(object: Extract<KernValue, { kind: 'string' }>, property: string): KernValue {
  if (property === 'length') return dispatchCoreContractOperation('String.length', [object.value]);
  const operation = stringMemberOperation(property);
  if (!operation) return kUndefined();
  return boundCoreContractOperation(`String.${operation}`, [object.value]);
}

function evalBooleanMember(object: Extract<KernValue, { kind: 'boolean' }>, property: string): KernValue {
  const operation = booleanMemberOperation(property);
  if (!operation) return kUndefined();
  return boundCoreContractOperation(`Boolean.${operation}`, [object.value]);
}

function stringMemberOperation(property: string): string | undefined {
  switch (property) {
    case 'includes':
    case 'index':
    case 'startsWith':
    case 'endsWith':
    case 'slice':
    case 'trim':
    case 'lower':
    case 'upper':
    case 'concat':
    case 'equals':
    case 'toString':
      return property;
    default:
      return undefined;
  }
}

function booleanMemberOperation(property: string): string | undefined {
  switch (property) {
    case 'not':
    case 'and':
    case 'or':
    case 'equals':
    case 'toString':
      return property;
    default:
      return undefined;
  }
}

function boundCoreContractOperation(operationId: string, receiverArgs: readonly CoreFixtureValue[]): KernValue {
  return brandValue({
    kind: 'builtin',
    name: operationId,
    call: (args: KernValue[]) => {
      try {
        return dispatchCoreContractOperation(operationId, [...receiverArgs, ...args.map(kernValueToCoreFixtureValue)]);
      } catch (error) {
        if (error instanceof CoreRuntimeContractAdapterError) {
          throw new CoreContractEvaluationError('strict-type', coreOperationStrictTypeMessage(operationId));
        }
        throw error;
      }
    },
  });
}

function dispatchCoreContractOperation(operationId: string, args: readonly CoreFixtureValue[]): KernValue {
  return coreFixtureValueToKernValue(evaluateCoreContractOperation(operationId, args));
}

function evalListIndex(object: Extract<KernValue, { kind: 'array' }>, index: number): KernValue {
  if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0 || index >= object.items.length) {
    return kUndefined();
  }
  return object.items[index] ?? kUndefined();
}

function evalRecordGet(object: Extract<KernValue, { kind: 'record' }>, key: string): KernValue {
  if (!Object.hasOwn(object.entries, key))
    return dispatchCoreContractOperation('Record.get', [recordShapeFixture(object), key]);
  return object.entries[key] ?? kUndefined();
}

function recordShapeFixture(object: Extract<KernValue, { kind: 'record' }>): Record<string, CoreFixtureValue> {
  const shape = Object.create(null) as Record<string, CoreFixtureValue>;
  for (const key of Object.keys(object.entries)) shape[key] = null;
  return shape;
}

function coreOperationStrictTypeMessage(operationId: string): string {
  for (const contract of Object.values(CORE_TYPE_CONTRACTS.types)) {
    const operation = contract.operations.find((operation) => operation.id === operationId);
    if (operation) return `${operationId} expects ${operation.args.join(', ')}.`;
  }
  return `${operationId} received an unsupported runtime value.`;
}

function evalCall(node: Extract<ValueIR, { kind: 'call' }>, env: CoreRuntimeEnv): KernValue {
  const callee = evalValueIR(node.callee, env);
  if (isNullish(callee)) {
    if (node.optional) return kUndefined();
    throw new Error(`KERN core runtime cannot call ${callee.kind}.`);
  }
  const args = node.args.map((arg) => evalValueIR(arg, env));
  if (callee.kind === 'builtin') return callee.call(args);
  if (callee.kind === 'function') return callFunctionValue(callee, args).value;
  if (callee.kind === 'class') return constructClassValue(callee, args);
  if (callee.kind === 'bound-method') return callBoundMethodValue(callee, args).value;
  if (callee.kind === 'super') return callSuperConstructor(callee, args);
  throw new Error(`KERN core runtime cannot call ${callee.kind}.`);
}

function evalNew(node: Extract<ValueIR, { kind: 'new' }>, env: CoreRuntimeEnv): KernValue {
  if (node.argument.kind === 'member') {
    return evalValueIR({ ...node.argument, object: { kind: 'new', argument: node.argument.object } as ValueIR }, env);
  }
  if (node.argument.kind === 'index') {
    return evalValueIR({ ...node.argument, object: { kind: 'new', argument: node.argument.object } as ValueIR }, env);
  }
  if (
    node.argument.kind === 'call' &&
    (node.argument.callee.kind === 'member' || node.argument.callee.kind === 'index')
  ) {
    return evalValueIR(
      {
        ...node.argument,
        callee: {
          ...node.argument.callee,
          object: { kind: 'new', argument: node.argument.callee.object } as ValueIR,
        },
      },
      env,
    );
  }
  if (node.argument.kind !== 'call') throw new Error('KERN core runtime new expects a constructor call.');
  const callee = evalValueIR(node.argument.callee, env);
  if (callee.kind !== 'class') throw new Error('KERN core runtime new expects a class value.');
  return constructClassValue(
    callee,
    node.argument.args.map((arg) => evalValueIR(arg, env)),
  );
}

function makeClass(node: IRNode, env: CoreRuntimeEnv): KernClassValue {
  if (node.type !== 'class') throw new Error('KERN core runtime makeClass expects a class node.');
  return brandValue({
    kind: 'class',
    name: requiredString(node.props?.name, 'class name='),
    node,
    env,
    staticFields: createRecordEntries(),
    ...(env.getRuntimeRootContext() ? { runtimeRootContext: env.getRuntimeRootContext() } : {}),
  });
}

function initializeClassStaticFields(klass: KernClassValue): void {
  for (const field of runtimeChildNodes(klass.node, 'field')) {
    if (field.props?.static !== true && field.props?.static !== 'true') continue;
    const name = requiredString(field.props?.name, 'field name=');
    const value =
      Object.hasOwn(field.props ?? {}, 'value') || Object.hasOwn(field.props ?? {}, 'default')
        ? evalCoreExpression(runtimeFieldInitializerExpr(field), classStaticEnv(klass))
        : kUndefined();
    klass.staticFields[name] = value;
  }
}

function constructClassValue(klass: KernClassValue, args: readonly KernValue[]): KernInstanceValue {
  const instance = brandValue({
    kind: 'instance' as const,
    classValue: klass,
    fields: createRecordEntries(),
    initializedClasses: new Set<string>(),
  });
  initializeClassLayer(instance, klass, args, true);
  validateImplementedClassProtocols(instance, klass);
  return instance;
}

function validateImplementedClassProtocols(instance: KernInstanceValue, klass: KernClassValue): void {
  const factsByRoot = new Map<IRNode | readonly IRNode[], ReturnType<typeof collectCoreShapeFacts>>();
  for (const layer of classHierarchyFromBase(klass)) {
    const root = layer.runtimeRootContext ?? layer.env.getRuntimeRootContext();
    if (!root) continue;
    const facts = factsByRoot.get(root) ?? collectCoreShapeFacts(root);
    factsByRoot.set(root, facts);
    const shapeByName = new Map(facts.interfaces.map((shape) => [shape.name, shape]));
    const importedProtocolNames = runtimeImportedProtocolNames(root);
    for (const interfaceName of runtimeClassReferenceNames(layer.node.props?.implements)) {
      const shape = shapeByName.get(interfaceName);
      if (!shape) {
        if (importedProtocolNames.has(interfaceName)) continue;
        throw new Error(`KERN core runtime class '${klass.name}' implements unknown interface '${interfaceName}'.`);
      }
      if (!shape.validatorAvailable || shape.indexers.length > 0) {
        throw new Error(
          `KERN core runtime class '${klass.name}' implements interface '${interfaceName}' that is not executable as a class protocol in v1.`,
        );
      }
      const projection = classProtocolProjection(
        instance,
        shape.fields.map((field) => field.name),
      );
      const result = validateCoreShape(projection, interfaceName, root);
      if (!result.passed) {
        throw new Error(
          `KERN core runtime class '${klass.name}' violates implemented interface '${interfaceName}':\n${result.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join('\n')}`,
        );
      }
      const missingMethods = runtimeInterfaceProtocolMethods(root, interfaceName)
        .filter((method) => !classHasRuntimeProtocolMethod(instance.classValue, method))
        .map((method) => method.name);
      if (missingMethods.length > 0) {
        throw new Error(
          `KERN core runtime class '${klass.name}' violates implemented interface '${interfaceName}': missing or incompatible method(s): ${missingMethods.join(', ')}.`,
        );
      }
    }
  }
}

function validateImplementedClassStaticProtocols(klass: KernClassValue): void {
  const root = klass.runtimeRootContext ?? klass.env.getRuntimeRootContext();
  if (!root) return;
  const facts = collectCoreShapeFacts(root);
  const shapeByName = new Map(facts.interfaces.map((shape) => [shape.name, shape]));
  const importedProtocolNames = runtimeImportedProtocolNames(root);
  for (const interfaceName of runtimeClassReferenceNames(klass.node.props?.implements)) {
    const shape = shapeByName.get(interfaceName);
    if (!shape) {
      if (importedProtocolNames.has(interfaceName)) continue;
      throw new Error(`KERN core runtime class '${klass.name}' implements unknown interface '${interfaceName}'.`);
    }
    if (!shape.validatorAvailable || shape.indexers.length > 0) {
      throw new Error(
        `KERN core runtime class '${klass.name}' implements interface '${interfaceName}' that is not executable as a class protocol in v1.`,
      );
    }
    const staticFields = runtimeInterfaceProtocolFields(root, interfaceName, true);
    if (staticFields.length > 0) {
      const missingFields = staticFields.filter((field) => !classHasRuntimeProtocolField(klass, field));
      if (missingFields.length > 0) {
        throw new Error(
          `KERN core runtime class '${klass.name}' violates implemented interface '${interfaceName}': missing or incompatible static member(s): ${missingFields
            .map((field) => field.name)
            .join(', ')}.`,
        );
      }
      const fieldBackedFields = staticFields.filter(
        (field) => findReadableClassShapeMember(klass, field.name, true)?.kind === 'field',
      );
      const projection = classStaticProtocolProjection(klass, fieldBackedFields);
      const result = validateProjectedProtocolFields(projection, interfaceName, fieldBackedFields, root);
      if (!result.passed) {
        throw new Error(
          `KERN core runtime class '${klass.name}' violates implemented interface '${interfaceName}' static field contract:\n${result.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join('\n')}`,
        );
      }
    }
    const missingMethods = runtimeInterfaceProtocolMethods(root, interfaceName, true)
      .filter((method) => !classHasRuntimeProtocolMethod(klass, method, true))
      .map((method) => method.name);
    if (missingMethods.length > 0) {
      throw new Error(
        `KERN core runtime class '${klass.name}' violates implemented interface '${interfaceName}': missing or incompatible static member(s): ${missingMethods.join(', ')}.`,
      );
    }
  }
}

function classProtocolProjection(instance: KernInstanceValue, fieldNames: readonly string[]): KernValue {
  const entries = createRecordEntries();
  for (const fieldName of fieldNames) {
    if (Object.hasOwn(instance.fields, fieldName)) {
      entries[fieldName] = instance.fields[fieldName] ?? kUndefined();
      continue;
    }
    const member = findReadableClassShapeMember(instance.classValue, fieldName, false);
    if (member?.kind !== 'getter') continue;
    entries[fieldName] = evalInstanceMember(instance, fieldName);
  }
  return brandValue({ kind: 'record', entries });
}

function classStaticProtocolProjection(
  klass: KernClassValue,
  fields: readonly RuntimeInterfaceProtocolField[],
): KernValue {
  const entries = createRecordEntries();
  for (const field of fields) {
    const member = findReadableClassShapeMember(klass, field.name, true);
    if (member?.kind !== 'field') continue;
    entries[field.name] = evalClassMember(klass, field.name);
  }
  return brandValue({ kind: 'record', entries });
}

function validateProjectedProtocolFields(
  projection: KernValue,
  interfaceName: string,
  fields: readonly RuntimeInterfaceProtocolField[],
  rootOrNodes: IRNode | readonly IRNode[],
): ReturnType<typeof validateCoreShape> {
  const syntheticName = `__KernStaticProtocol_${interfaceName}`;
  const syntheticInterface: IRNode = {
    type: 'interface',
    props: { name: syntheticName },
    children: fields.map((field) => ({
      type: 'field',
      props: {
        name: field.name,
        optional: field.optional,
        ...(field.type ? { type: field.type } : {}),
      },
    })),
  };
  const roots = [...(isIRNodeArray(rootOrNodes) ? rootOrNodes : [rootOrNodes]), syntheticInterface];
  return validateCoreShape(projection, syntheticName, roots);
}

interface RuntimeInterfaceProtocolField {
  readonly name: string;
  readonly type?: string;
  readonly optional: boolean;
  readonly static: boolean;
}

interface RuntimeInterfaceProtocolMethod {
  readonly name: string;
  readonly arity: number;
  readonly paramTypes: readonly string[];
  readonly async: boolean;
  readonly stream: boolean;
  readonly generator: boolean;
  readonly static: boolean;
  readonly returns?: string;
}

function runtimeInterfaceProtocolFields(
  rootOrNodes: IRNode | readonly IRNode[],
  interfaceName: string,
  staticOnly: boolean,
): RuntimeInterfaceProtocolField[] {
  const interfaceByName = runtimeInterfaceNodesByName(rootOrNodes);
  const resolve = (name: string, seen: ReadonlySet<string>): RuntimeInterfaceProtocolField[] => {
    if (seen.has(name)) return [];
    const node = interfaceByName.get(name);
    if (!node) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    const fields = new Map<string, RuntimeInterfaceProtocolField>();
    for (const baseName of runtimeClassReferenceNames(node.props?.extends)) {
      for (const field of resolve(baseName, nextSeen)) fields.set(runtimeInterfaceMemberShapeKey(field), field);
    }
    for (const child of node.children ?? []) {
      if (child.type !== 'field') continue;
      const name = runtimeStringProp(child.props?.name);
      if (!name) continue;
      const isStatic = runtimeBooleanProp(child.props?.static);
      if (isStatic !== staticOnly) continue;
      fields.set(runtimeInterfaceMemberShapeKey({ name, static: isStatic }), {
        name,
        optional: runtimeBooleanProp(child.props?.optional),
        static: isStatic,
        ...(runtimeStringProp(child.props?.type) ? { type: runtimeStringProp(child.props?.type) } : {}),
      });
    }
    return [...fields.values()];
  };
  return resolve(interfaceName, new Set());
}

function runtimeInterfaceProtocolMethods(
  rootOrNodes: IRNode | readonly IRNode[],
  interfaceName: string,
  staticOnly = false,
): RuntimeInterfaceProtocolMethod[] {
  const interfaceByName = runtimeInterfaceNodesByName(rootOrNodes);
  const resolve = (name: string, seen: ReadonlySet<string>): RuntimeInterfaceProtocolMethod[] => {
    if (seen.has(name)) return [];
    const node = interfaceByName.get(name);
    if (!node) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    const methods = new Map<string, RuntimeInterfaceProtocolMethod>();
    for (const baseName of runtimeClassReferenceNames(node.props?.extends)) {
      for (const method of resolve(baseName, nextSeen)) methods.set(runtimeInterfaceMemberShapeKey(method), method);
    }
    for (const child of node.children ?? []) {
      if (child.type !== 'method') continue;
      const name = runtimeStringProp(child.props?.name);
      if (!name) continue;
      const isStatic = runtimeBooleanProp(child.props?.static);
      if (isStatic !== staticOnly) continue;
      methods.set(runtimeInterfaceMemberShapeKey({ name, static: isStatic }), {
        name,
        arity: runtimeParams(child).length,
        paramTypes: runtimeParams(child).map((param) => param.type ?? ''),
        async: runtimeBooleanProp(child.props?.async),
        stream: runtimeBooleanProp(child.props?.stream),
        generator: runtimeBooleanProp(child.props?.generator),
        static: isStatic,
        ...(runtimeStringProp(child.props?.returns) ? { returns: runtimeStringProp(child.props?.returns) } : {}),
      });
    }
    return [...methods.values()];
  };

  return resolve(interfaceName, new Set());
}

function runtimeInterfaceNodesByName(rootOrNodes: IRNode | readonly IRNode[]): Map<string, IRNode> {
  const interfaceByName = new Map<string, IRNode>();
  const visit = (node: IRNode): void => {
    if (node.type === 'interface') {
      const name = runtimeStringProp(node.props?.name);
      if (name && !interfaceByName.has(name)) interfaceByName.set(name, node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of isIRNodeArray(rootOrNodes) ? rootOrNodes : [rootOrNodes]) visit(node);
  return interfaceByName;
}

function runtimeInterfaceMemberShapeKey(member: { readonly name: string; readonly static: boolean }): string {
  return `${member.static ? 'static' : 'instance'}:${member.name}`;
}

function classHasRuntimeProtocolMethod(
  klass: KernClassValue,
  method: RuntimeInterfaceProtocolMethod,
  staticOnly = false,
): boolean {
  const member = findReadableClassShapeMember(klass, method.name, staticOnly);
  if (member?.kind !== 'method') return false;
  if (runtimeBooleanProp(member.node.props?.private)) return false;
  const params = runtimeParams(member.node);
  if (params.length !== method.arity) return false;
  if (
    !runtimeProtocolParamTypesCompatible(
      params.map((param) => param.type ?? ''),
      method.paramTypes,
    )
  )
    return false;
  if (runtimeBooleanProp(member.node.props?.async) !== method.async) return false;
  if (runtimeBooleanProp(member.node.props?.stream) !== method.stream) return false;
  if (runtimeBooleanProp(member.node.props?.generator) !== method.generator) return false;
  const returns = runtimeStringProp(member.node.props?.returns);
  return runtimeProtocolReturnTypesCompatible(
    returns,
    {
      async: runtimeBooleanProp(member.node.props?.async),
      stream: runtimeBooleanProp(member.node.props?.stream),
      generator: runtimeBooleanProp(member.node.props?.generator),
    },
    method.returns,
    method,
  );
}

function classHasRuntimeProtocolField(klass: KernClassValue, field: RuntimeInterfaceProtocolField): boolean {
  const member = findReadableClassShapeMember(klass, field.name, true);
  if (!member) return field.optional;
  if (member.kind !== 'field' && member.kind !== 'getter') return false;
  if (runtimeBooleanProp(member.node.props?.private)) return false;
  const actualType =
    member.kind === 'getter'
      ? runtimeStringProp(member.node.props?.returns)
      : runtimeStringProp(member.node.props?.type);
  return !field.type || normalizeRuntimeProtocolType(actualType) === normalizeRuntimeProtocolType(field.type);
}

function runtimeProtocolParamTypesCompatible(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every(
    (type, index) => !type || normalizeRuntimeProtocolType(actual[index]) === normalizeRuntimeProtocolType(type),
  );
}

function normalizeRuntimeProtocolType(type: string | undefined): string {
  return compactRuntimeProtocolTypeWhitespace(type);
}

function compactRuntimeProtocolTypeWhitespace(type: string | undefined): string {
  let out = '';
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < (type ?? '').length; index += 1) {
    const ch = (type ?? '')[index];
    if (quote !== null) {
      out += ch;
      if (ch === '\\' && index + 1 < (type ?? '').length) out += (type ?? '')[++index];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

function runtimeProtocolReturnTypesCompatible(
  actual: string | undefined,
  actualFlags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
  expected: string | undefined,
  expectedFlags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
): boolean {
  return (
    normalizeRuntimeProtocolReturnType(actual, actualFlags) ===
    normalizeRuntimeProtocolReturnType(expected, expectedFlags)
  );
}

function normalizeRuntimeProtocolReturnType(
  returns: string | undefined,
  flags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
): string {
  if (flags.stream) {
    if (returns?.startsWith('AsyncGenerator<')) return returns;
    return `AsyncGenerator<${returns || 'unknown'}>`;
  }
  if (flags.generator) {
    if (returns?.startsWith('Generator<') || returns?.startsWith('AsyncGenerator<')) return returns;
    return `${flags.async ? 'AsyncGenerator' : 'Generator'}<${returns || 'unknown'}>`;
  }
  return !returns || returns === 'void' ? 'void' : returns;
}

function classHierarchyFromBase(klass: KernClassValue): KernClassValue[] {
  const base = resolveBaseClass(klass);
  return base ? [...classHierarchyFromBase(base), klass] : [klass];
}

function runtimeImportedProtocolNames(rootOrNodes: IRNode | readonly IRNode[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: IRNode): void => {
    if (node.type === 'import') {
      for (const name of runtimeImportLocalNames(node)) names.add(name);
    }
    if (node.type === 'use') {
      for (const child of node.children ?? []) {
        if (child.type !== 'from') continue;
        const kind = runtimeStringProp(child.props?.kind);
        if (kind && kind !== 'interface' && kind !== 'type') continue;
        const localName = runtimeStringProp(child.props?.as) ?? runtimeStringProp(child.props?.name);
        if (localName) names.add(localName);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of isIRNodeArray(rootOrNodes) ? rootOrNodes : [rootOrNodes]) visit(node);
  return names;
}

function runtimeImportLocalNames(node: IRNode): string[] {
  const names: string[] = [];
  const props = node.props ?? {};
  const defaultName = runtimeStringProp(props.default);
  if (defaultName && defaultName !== 'true') names.push(defaultName);
  const rawNames = runtimeStringProp(props.names);
  if (rawNames) {
    for (const raw of rawNames.split(',')) {
      const name = raw.trim();
      const aliasMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(name);
      if (aliasMatch) names.push(aliasMatch[2] ?? aliasMatch[1]);
      else if (/^[A-Za-z_$][\w$]*$/u.test(name)) names.push(name);
    }
  }
  return names;
}

function initializeClassLayer(
  instance: KernInstanceValue,
  klass: KernClassValue,
  args: readonly KernValue[],
  receivesConstructorArgs: boolean,
): void {
  if (instance.initializedClasses.has(klass.name)) {
    throw new Error(`KERN core runtime class already initialized: ${klass.name}`);
  }
  const base = resolveBaseClass(klass);
  const ctor = firstRuntimeChild(klass.node, 'constructor');
  if (base && !ctor) initializeClassLayer(instance, base, [], false);
  if (!base || !ctor) initializeClassFields(instance, klass);
  if (!ctor) {
    if (receivesConstructorArgs && args.length > 0) {
      throw new Error(`KERN core runtime class ${klass.name} has no constructor.`);
    }
    instance.initializedClasses.add(klass.name);
    return;
  }
  if (base && !hasDirectSuperCtorCall(ctor)) {
    // Implicit-super mode (KERN Option C): a derived constructor that omits a
    // direct super(...) gets base init injected FIRST, then its own field
    // defaults, then its body — identical to what both codegen targets emit, so
    // the interpreter and generated TS/Python agree. The frame starts with
    // superCalled=true so this/super access inside the body is unguarded; an
    // unexpected late super(...) would still trip the double-init guard. The same
    // `hasDirectSuperCtorCall` predicate decides this mode in the validator and
    // both codegens, so all four layers classify the constructor identically.
    initializeClassLayer(instance, base, [], false);
    initializeClassFields(instance, klass);
    withConstructionFrame(instance, klass, true, () => {
      callClassMemberBody(ctor, klass, instance, receivesConstructorArgs ? args : []).value;
    });
    instance.initializedClasses.add(klass.name);
    return;
  }
  if (base) {
    withConstructionFrame(instance, klass, false, () => {
      callClassMemberBody(ctor, klass, instance, receivesConstructorArgs ? args : []).value;
    });
  } else {
    callClassMemberBody(ctor, klass, instance, receivesConstructorArgs ? args : []).value;
  }
  if (base && !instance.initializedClasses.has(base.name)) {
    throw new Error(`KERN core runtime constructor ${klass.name} must call super(...).`);
  }
  instance.initializedClasses.add(klass.name);
}

function initializeClassFields(instance: KernInstanceValue, klass: KernClassValue): void {
  for (const field of runtimeChildNodes(klass.node, 'field')) {
    const name = requiredString(field.props?.name, 'field name=');
    if (field.props?.static === true || field.props?.static === 'true') continue;
    const value =
      Object.hasOwn(field.props ?? {}, 'value') || Object.hasOwn(field.props ?? {}, 'default')
        ? evalCoreExpression(runtimeFieldInitializerExpr(field), classThisEnv(klass, instance))
        : kUndefined();
    instance.fields[name] = value;
  }
}

function runtimeFieldInitializerExpr(node: IRNode): string {
  const propName = Object.hasOwn(node.props ?? {}, 'value') ? 'value' : 'default';
  const rawValue = propName === 'value' ? node.props?.value : node.props?.default;
  if (typeof rawValue === 'string' && (node.__quotedProps ?? []).includes(propName)) return JSON.stringify(rawValue);
  return unwrapExpr(rawValue, 'field value=');
}

function evalInstanceMember(object: KernInstanceValue, property: string): KernValue {
  guardConstructedInstanceAccess(object);
  const member = findReadableClassShapeMember(object.classValue, property, false);
  if (!member) throw new Error(`KERN core runtime unknown instance property: ${object.classValue.name}.${property}.`);
  switch (member.kind) {
    case 'field':
      return object.fields[property] ?? kUndefined();
    case 'getter':
      return callClassMemberBody(member.node, member.owner, object, []).value;
    case 'method':
      return brandValue({
        kind: 'bound-method',
        name: `${object.classValue.name}.${property}`,
        receiver: object,
        methodNode: member.node,
        ownerClass: member.owner,
      });
    case 'setter':
      throw new Error(`KERN core runtime cannot read setter-only property: ${property}.`);
  }
}

function evalSuperMember(object: KernSuperValue, property: string): KernValue {
  const base = resolveBaseClass(object.ownerClass);
  if (!base) return kUndefined();
  if (object.receiver.kind === 'class') return evalClassMemberFrom(base, property, object.receiver);
  guardConstructedSuperAccess(object.receiver);
  const member = findReadableClassShapeMember(base, property, false);
  if (!member) throw new Error(`KERN core runtime unknown super property: ${object.ownerClass.name}.${property}.`);
  switch (member.kind) {
    case 'field':
      return object.receiver.fields[property] ?? kUndefined();
    case 'getter':
      return callClassMemberBody(member.node, member.owner, object.receiver, []).value;
    case 'method':
      return brandValue({
        kind: 'bound-method',
        name: `${base.name}.${property}`,
        receiver: object.receiver,
        methodNode: member.node,
        ownerClass: member.owner,
      });
    case 'setter':
      throw new Error(`KERN core runtime cannot read setter-only super property: ${property}.`);
  }
}

function evalClassMember(object: KernClassValue, property: string): KernValue {
  return evalClassMemberFrom(object, property, object);
}

function evalClassMemberFrom(owner: KernClassValue, property: string, receiver: KernClassValue): KernValue {
  const member = findReadableClassShapeMember(owner, property, true);
  if (!member) throw new Error(`KERN core runtime unknown static property: ${receiver.name}.${property}.`);
  switch (member.kind) {
    case 'field':
      return member.owner === receiver
        ? (receiver.staticFields[property] ?? kUndefined())
        : evalClassStaticField(member.owner, receiver, property);
    case 'getter':
      return callStaticClassMemberBody(member.node, member.owner, receiver, []).value;
    case 'method':
      return brandValue({
        kind: 'builtin' as const,
        name: `${receiver.name}.${property}`,
        call: (args) => callStaticClassMemberBody(member.node, member.owner, receiver, args).value,
      });
    case 'setter':
      throw new Error(`KERN core runtime cannot read setter-only static property: ${property}.`);
  }
}

function assignInstanceMember(object: KernInstanceValue, property: string, value: KernValue): void {
  guardConstructedInstanceAccess(object);
  const member = findWritableClassShapeMember(object.classValue, property, false);
  if (!member) throw new Error(`KERN core runtime cannot assign undeclared instance property: ${property}.`);
  switch (member.kind) {
    case 'field':
      object.fields[property] = value;
      return;
    case 'setter':
      callSetterBody(object, member.node, member.owner, property, value);
      return;
    case 'getter':
      throw new Error(`KERN core runtime cannot assign getter-only property: ${property}.`);
    case 'method':
      throw new Error(`KERN core runtime cannot assign method property: ${property}.`);
  }
}

function assignSuperMember(object: KernSuperValue, property: string, value: KernValue): void {
  const base = resolveBaseClass(object.ownerClass);
  if (!base) throw new Error(`KERN core runtime class ${object.ownerClass.name} has no base class.`);
  if (object.receiver.kind === 'class') {
    assignClassMemberFrom(base, object.receiver, property, value);
    return;
  }
  guardConstructedSuperAccess(object.receiver);
  const member = findWritableClassShapeMember(base, property, false);
  if (!member) throw new Error(`KERN core runtime cannot assign undeclared super property: ${property}.`);
  switch (member.kind) {
    case 'field':
      object.receiver.fields[property] = value;
      return;
    case 'setter':
      callSetterBody(object.receiver, member.node, member.owner, property, value);
      return;
    case 'getter':
      throw new Error(`KERN core runtime cannot assign getter-only property: ${property}.`);
    case 'method':
      throw new Error(`KERN core runtime cannot assign method property: ${property}.`);
  }
}

function assignClassMember(object: KernClassValue, property: string, value: KernValue): void {
  assignClassMemberFrom(object, object, property, value);
}

function assignClassMemberFrom(
  owner: KernClassValue,
  receiver: KernClassValue,
  property: string,
  value: KernValue,
): void {
  const member = findWritableClassShapeMember(owner, property, true);
  if (!member) throw new Error(`KERN core runtime cannot assign undeclared static property: ${property}.`);
  switch (member.kind) {
    case 'field':
      receiver.staticFields[property] = value;
      return;
    case 'setter':
      callStaticSetterBody(receiver, member.node, member.owner, property, value);
      return;
    case 'getter':
      throw new Error(`KERN core runtime cannot assign getter-only static property: ${property}.`);
    case 'method':
      throw new Error(`KERN core runtime cannot assign static method property: ${property}.`);
  }
}

function callSetterBody(
  receiver: KernInstanceValue,
  setterNode: IRNode,
  ownerClass: KernClassValue,
  property: string,
  value: KernValue,
): void {
  const key = `${ownerClass.name}.${property}`;
  const activeSetters = ACTIVE_INSTANCE_SETTERS.get(receiver) ?? new Set<string>();
  if (activeSetters.has(key)) {
    throw new Error(`KERN core runtime recursive setter assignment: ${key}.`);
  }
  activeSetters.add(key);
  ACTIVE_INSTANCE_SETTERS.set(receiver, activeSetters);
  try {
    callClassMemberBody(setterNode, ownerClass, receiver, [value]);
  } finally {
    activeSetters.delete(key);
    if (activeSetters.size === 0) ACTIVE_INSTANCE_SETTERS.delete(receiver);
  }
}

function callStaticSetterBody(
  receiver: KernClassValue,
  setterNode: IRNode,
  ownerClass: KernClassValue,
  property: string,
  value: KernValue,
): void {
  const key = `${ownerClass.name}.${property}`;
  const activeSetters = ACTIVE_CLASS_SETTERS.get(receiver) ?? new Set<string>();
  if (activeSetters.has(key)) {
    throw new Error(`KERN core runtime recursive static setter assignment: ${key}.`);
  }
  activeSetters.add(key);
  ACTIVE_CLASS_SETTERS.set(receiver, activeSetters);
  try {
    callStaticClassMemberBody(setterNode, ownerClass, receiver, [value]);
  } finally {
    activeSetters.delete(key);
    if (activeSetters.size === 0) ACTIVE_CLASS_SETTERS.delete(receiver);
  }
}

function callBoundMethodValue(
  method: KernBoundMethodValue,
  args: readonly KernValue[],
): { value: KernValue; env: CoreRuntimeEnv } {
  return callClassMemberBody(method.methodNode, method.ownerClass, method.receiver, args);
}

function callSuperConstructor(value: KernSuperValue, args: readonly KernValue[]): KernValue {
  if (value.mode !== 'constructor') {
    throw new Error('KERN core runtime super(...) is only valid inside a constructor.');
  }
  if (value.receiver.kind !== 'instance') {
    throw new Error('KERN core runtime super(...) requires an instance receiver.');
  }
  const base = resolveBaseClass(value.ownerClass);
  if (!base) throw new Error(`KERN core runtime class ${value.ownerClass.name} has no base class.`);
  const frame = activeConstructionFrame(value.receiver);
  if (!frame || frame.ownerClass !== value.ownerClass) {
    throw new Error(`KERN core runtime super(...) is not active for constructor ${value.ownerClass.name}.`);
  }
  if (frame.superCalled || value.receiver.initializedClasses.has(base.name)) {
    throw new Error(`KERN core runtime constructor ${value.ownerClass.name} called super(...) more than once.`);
  }
  frame.superCalled = true;
  initializeClassLayer(value.receiver, base, args, true);
  initializeClassFields(value.receiver, value.ownerClass);
  return value.receiver;
}

function withConstructionFrame(
  instance: KernInstanceValue,
  ownerClass: KernClassValue,
  initialSuperCalled: boolean,
  run: () => void,
): void {
  const stack = ACTIVE_CONSTRUCTORS.get(instance) ?? [];
  const frame: RuntimeConstructionFrame = { ownerClass, superCalled: initialSuperCalled };
  stack.push(frame);
  ACTIVE_CONSTRUCTORS.set(instance, stack);
  try {
    run();
  } finally {
    stack.pop();
    if (stack.length === 0) ACTIVE_CONSTRUCTORS.delete(instance);
  }
}

function activeConstructionFrame(instance: KernInstanceValue): RuntimeConstructionFrame | undefined {
  const stack = ACTIVE_CONSTRUCTORS.get(instance);
  return stack?.[stack.length - 1];
}

function guardConstructedInstanceAccess(instance: KernInstanceValue): void {
  const frame = activeConstructionFrame(instance);
  if (!frame || frame.superCalled) return;
  if (!resolveBaseClass(frame.ownerClass)) return;
  throw new Error(`KERN core runtime cannot access this before super(...) in ${frame.ownerClass.name}.`);
}

function guardConstructedSuperAccess(instance: KernInstanceValue): void {
  const frame = activeConstructionFrame(instance);
  if (!frame || frame.superCalled) return;
  if (!resolveBaseClass(frame.ownerClass)) return;
  throw new Error(`KERN core runtime cannot access super members before super(...) in ${frame.ownerClass.name}.`);
}

function callClassMemberBody(
  memberNode: IRNode,
  ownerClass: KernClassValue,
  receiver: KernInstanceValue | undefined,
  args: readonly KernValue[],
): { value: KernValue; env: CoreRuntimeEnv } {
  const callEnv = ownerClass.env.child();
  if (receiver) {
    callEnv.define('this', receiver);
    if (resolveBaseClass(ownerClass)) {
      callEnv.define(
        'super',
        brandValue({
          kind: 'super',
          receiver,
          ownerClass,
          mode: memberNode.type === 'constructor' ? 'constructor' : 'method',
        }),
      );
    }
  }
  const params = runtimeParams(memberNode);
  validateRuntimeArgs(`${ownerClass.name}.${memberNode.type}`, params, args);
  params.forEach((param, index) => {
    const provided = args[index];
    const value =
      provided === undefined || (provided.kind === 'undefined' && param.defaultExpr)
        ? param.defaultExpr
          ? evalCoreExpression(param.defaultExpr, callEnv)
          : kUndefined()
        : provided;
    callEnv.define(param.name, value);
  });
  const completion = executeSequence(runtimeFunctionBody(memberNode), callEnv);
  return { value: completion.value, env: callEnv };
}

function callStaticClassMemberBody(
  memberNode: IRNode,
  ownerClass: KernClassValue,
  receiver: KernClassValue,
  args: readonly KernValue[],
): { value: KernValue; env: CoreRuntimeEnv } {
  const callEnv = ownerClass.env.child();
  callEnv.define('this', receiver);
  if (resolveBaseClass(ownerClass)) {
    callEnv.define(
      'super',
      brandValue({
        kind: 'super',
        receiver,
        ownerClass,
        mode: 'static',
      }),
    );
  }
  const params = runtimeParams(memberNode);
  validateRuntimeArgs(`${ownerClass.name}.${memberNode.type}`, params, args);
  params.forEach((param, index) => {
    const provided = args[index];
    const value =
      provided === undefined || (provided.kind === 'undefined' && param.defaultExpr)
        ? param.defaultExpr
          ? evalCoreExpression(param.defaultExpr, callEnv)
          : kUndefined()
        : provided;
    callEnv.define(param.name, value);
  });
  const completion = executeSequence(runtimeFunctionBody(memberNode), callEnv);
  return { value: completion.value, env: callEnv };
}

function findOwnClassMember(
  klass: KernClassValue,
  type: 'method' | 'getter' | 'setter',
  name: string,
  staticOnly = false,
): { node: IRNode; owner: KernClassValue } | undefined {
  for (const child of klass.node.children ?? []) {
    if (child.type !== type || child.props?.name !== name) continue;
    const isStatic = child.props?.static === true || child.props?.static === 'true';
    if (staticOnly !== isStatic) continue;
    return { node: child, owner: klass };
  }
  return undefined;
}

type RuntimeClassShapeKind = 'field' | 'getter' | 'setter' | 'method';

interface RuntimeClassShapeMember {
  kind: RuntimeClassShapeKind;
  node: IRNode;
  owner: KernClassValue;
}

function findReadableClassShapeMember(
  klass: KernClassValue,
  name: string,
  staticOnly: boolean,
): RuntimeClassShapeMember | undefined {
  return findClassShapeMember(klass, name, staticOnly, ['field', 'getter', 'method', 'setter']);
}

function findWritableClassShapeMember(
  klass: KernClassValue,
  name: string,
  staticOnly: boolean,
): RuntimeClassShapeMember | undefined {
  return findClassShapeMember(klass, name, staticOnly, ['field', 'setter', 'getter', 'method']);
}

function findClassShapeMember(
  klass: KernClassValue,
  name: string,
  staticOnly: boolean,
  precedence: readonly RuntimeClassShapeKind[],
): RuntimeClassShapeMember | undefined {
  for (const kind of precedence) {
    const member =
      kind === 'field'
        ? findOwnClassField(klass, name, staticOnly)
        : findOwnClassMethodShapeMember(klass, kind, name, staticOnly);
    if (member) return member;
  }
  const base = resolveBaseClass(klass);
  return base ? findClassShapeMember(base, name, staticOnly, precedence) : undefined;
}

function findOwnClassMethodShapeMember(
  klass: KernClassValue,
  kind: 'getter' | 'setter' | 'method',
  name: string,
  staticOnly: boolean,
): RuntimeClassShapeMember | undefined {
  const member = findOwnClassMember(klass, kind, name, staticOnly);
  return member ? { kind, node: member.node, owner: member.owner } : undefined;
}

function findOwnClassField(
  klass: KernClassValue,
  name: string,
  staticOnly: boolean,
): RuntimeClassShapeMember | undefined {
  for (const child of klass.node.children ?? []) {
    if (child.type !== 'field' || child.props?.name !== name) continue;
    const isStatic = child.props?.static === true || child.props?.static === 'true';
    if (staticOnly !== isStatic) continue;
    return { kind: 'field', node: child, owner: klass };
  }
  return undefined;
}

function evalClassStaticField(owner: KernClassValue, receiver: KernClassValue, property: string): KernValue {
  if (Object.hasOwn(receiver.staticFields, property)) return receiver.staticFields[property] ?? kUndefined();
  return owner.staticFields[property] ?? kUndefined();
}

function resolveBaseClass(klass: KernClassValue): KernClassValue | undefined {
  const baseName = classBaseName(klass.node.props?.extends);
  if (!baseName) return undefined;
  const base = klass.env.lookup(baseName);
  if (base.kind !== 'class') throw new Error(`KERN core runtime base class is not a class: ${baseName}`);
  return base;
}

function classBaseName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = /^([A-Za-z_$][\w$]*)/.exec(value.trim());
  return match?.[1];
}

function runtimeStringProp(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function runtimeBooleanProp(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function runtimeClassReferenceNames(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const parts = splitRuntimeClassReferenceList(value);
  const names = new Set<string>();
  for (const part of parts) {
    const name = runtimeClassReferenceName(part);
    if (!name) throw new Error(`implements= contains an invalid reference: ${part}.`);
    names.add(name);
  }
  return [...names];
}

function runtimeClassReferenceName(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^([A-Za-z_$][\w$]*)(?:\s*<[\s\S]*>)?$/u.exec(trimmed);
  return match?.[1];
}

function splitRuntimeClassReferenceList(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && index + 1 < raw.length) current += raw[++index];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '<') angleDepth += 1;
    else if (ch === '>' && angleDepth > 0) angleDepth -= 1;
    if (depth < 0 || angleDepth < 0) throw new Error('implements= has unbalanced delimiters.');
    if (ch === ',' && depth === 0 && angleDepth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error('implements= contains an empty reference.');
      out.push(part);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0 || angleDepth !== 0) throw new Error('implements= has unbalanced delimiters.');
  const tail = current.trim();
  if (tail.length === 0 && raw.trim().endsWith(',')) throw new Error('implements= contains an empty reference.');
  if (tail.length > 0) out.push(tail);
  return out;
}

function runtimeAngleClosesBeforeNextTopLevelComma(raw: string, start: number): boolean {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = start; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote !== null) {
      if (ch === '\\' && index + 1 < raw.length) index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth -= 1;
    else if (ch === '>' && depth === 0) return true;
    else if (ch === ',' && depth === 0) return false;
  }
  return false;
}

function classThisEnv(klass: KernClassValue, receiver: KernInstanceValue): CoreRuntimeEnv {
  const env = klass.env.child();
  env.define('this', receiver);
  return env;
}

function classStaticEnv(klass: KernClassValue): CoreRuntimeEnv {
  const env = klass.env.child();
  env.define('this', klass);
  if (resolveBaseClass(klass)) {
    env.define(
      'super',
      brandValue({
        kind: 'super',
        receiver: klass,
        ownerClass: klass,
        mode: 'static',
      }),
    );
  }
  return env;
}

function makeFunction(node: IRNode, env: CoreRuntimeEnv): KernFunctionValue {
  return brandValue({
    kind: 'function',
    name: requiredString(node.props?.name, 'fn name='),
    params: runtimeParams(node),
    body: runtimeFunctionBody(node),
    env,
  });
}

function callFunctionValue(
  fn: KernFunctionValue,
  args: readonly KernValue[],
): { value: KernValue; env: CoreRuntimeEnv } {
  const callEnv = fn.env.child();
  validateRuntimeArgs(fn.name ?? 'anonymous function', fn.params, args);
  fn.params.forEach((param, index) => {
    const provided = args[index];
    const value =
      provided === undefined || (provided.kind === 'undefined' && param.defaultExpr)
        ? param.defaultExpr
          ? evalCoreExpression(param.defaultExpr, callEnv)
          : kUndefined()
        : provided;
    callEnv.define(param.name, value);
  });
  const completion = executeSequence(fn.body, callEnv);
  return { value: completion.value, env: callEnv };
}

function validateRuntimeArgs(label: string, params: readonly RuntimeParam[], args: readonly KernValue[]): void {
  if (args.length > params.length) {
    throw new Error(`KERN core runtime ${label} received too many arguments.`);
  }
  params.forEach((param, index) => {
    if (index >= args.length && !param.defaultExpr) {
      throw new Error(`KERN core runtime ${label} missing required argument: ${param.name}.`);
    }
  });
}

function executeAssign(node: IRNode, env: CoreRuntimeEnv): void {
  const target = requiredString(node.props?.target, 'assign target=');
  if (Object.hasOwn(node.props ?? {}, 'op') && node.props?.op !== '=') {
    throw new Error('KERN core runtime assign supports only direct assignment in this slice.');
  }
  const value = evalCoreExpression(unwrapExpr(node.props?.value, 'assign value='), env);
  assignRuntimeTarget(target, value, env);
}

function assignRuntimeTarget(target: string, value: KernValue, env: CoreRuntimeEnv): void {
  const parsed = parseExpression(target);
  if (parsed.kind === 'ident') {
    env.assign(parsed.name, value);
    return;
  }
  if (parsed.kind === 'member') {
    const object = evalValueIR(parsed.object, env);
    if (object.kind === 'instance') {
      assignInstanceMember(object, parsed.property, value);
      return;
    }
    if (object.kind === 'super') {
      assignSuperMember(object, parsed.property, value);
      return;
    }
    if (object.kind === 'record') {
      object.entries[parsed.property] = value;
      return;
    }
    if (object.kind === 'class') {
      assignClassMember(object, parsed.property, value);
      return;
    }
    throw new Error(`KERN core runtime cannot assign member on ${object.kind}.`);
  }
  if (parsed.kind === 'index') {
    const object = evalValueIR(parsed.object, env);
    const index = evalValueIR(parsed.index, env);
    if (object.kind === 'array') {
      if (index.kind !== 'number' || !Number.isInteger(index.value) || index.value < 0) {
        throw new Error('KERN core runtime array assignment index must be a non-negative integer.');
      }
      object.items[index.value] = value;
      return;
    }
    if (object.kind === 'record') {
      if (index.kind !== 'string') throw new Error('KERN core runtime record assignment key must be a string.');
      object.entries[index.value] = value;
      return;
    }
    throw new Error(`KERN core runtime cannot assign index on ${object.kind}.`);
  }
  throw new Error('KERN core runtime assign target must be an identifier, member, or index expression.');
}

function runtimeFunctionBody(node: IRNode): IRNode[] {
  const handler = node.children?.find((child) => child.type === 'handler');
  const body = handler ? (handler.children ?? []) : (node.children ?? []);
  return body.filter((child) => child.type !== 'param' && child.type !== 'decorator');
}

function firstRuntimeChild(node: IRNode, type: string): IRNode | undefined {
  return node.children?.find((child) => child.type === type);
}

function runtimeChildNodes(node: IRNode, type: string): IRNode[] {
  return node.children?.filter((child) => child.type === type) ?? [];
}

function runtimeChildren(node: IRNode): IRNode[] {
  if (node.type === 'document' || node.type === 'handler' || node.type === '__block') return node.children ?? [];
  return [node];
}

function runtimeParams(node: IRNode): RuntimeParam[] {
  const childParams =
    node.children
      ?.filter((child) => child.type === 'param')
      .map((child) => ({
        name: requiredString(child.props?.name, 'param name='),
        type: typeof child.props?.type === 'string' ? child.props.type : undefined,
        defaultExpr: runtimeParamDefaultExpr(child),
      })) ?? [];
  if (childParams.length > 0) return childParams;

  const raw = typeof node.props?.params === 'string' ? node.props.params : '';
  if (!raw.trim()) return [];
  return splitRuntimeParamList(raw, 'fn params=').map((part) => {
    const defaultIndex = findRuntimeDefaultSeparator(part);
    const beforeDefault = defaultIndex >= 0 ? part.slice(0, defaultIndex) : part;
    const defaultExpr = defaultIndex >= 0 ? part.slice(defaultIndex + 1).trim() : undefined;
    const typeIndex = beforeDefault.indexOf(':');
    const name = typeIndex >= 0 ? beforeDefault.slice(0, typeIndex) : beforeDefault;
    const type = typeIndex >= 0 ? beforeDefault.slice(typeIndex + 1) : '';
    return {
      name: requiredString(name.trim(), 'param name='),
      type: type.trim() || undefined,
      defaultExpr: defaultExpr || undefined,
    };
  });
}

function splitRuntimeParamList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let angleDepth = 0;
  let inDefault = false;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && index + 1 < raw.length) current += raw[++index];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0 && angleDepth === 0 && raw[index + 1] !== '>') inDefault = true;
    else if (ch === '<' && (!inDefault || runtimeAngleClosesBeforeNextTopLevelComma(raw, index + 1))) angleDepth += 1;
    else if (ch === '>' && angleDepth > 0) angleDepth -= 1;
    if (depth < 0 || angleDepth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0 && angleDepth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty expression.`);
      out.push(part);
      current = '';
      inDefault = false;
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0 || angleDepth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length === 0 && raw.trim().endsWith(',')) throw new Error(`${propName} contains an empty expression.`);
  if (tail.length > 0) out.push(tail);
  return out;
}

function runtimeParamDefaultExpr(node: IRNode): string | undefined {
  const propName = Object.hasOwn(node.props ?? {}, 'value') ? 'value' : 'default';
  const rawValue = propName === 'value' ? node.props?.value : node.props?.default;
  if (rawValue === undefined || rawValue === null) return undefined;
  if (typeof rawValue === 'string' && (node.__quotedProps ?? []).includes(propName)) return JSON.stringify(rawValue);
  return unwrapExpr(rawValue, 'param value=');
}

function unwrapExpr(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  if (isExprObject(value)) return value.code;
  if (value === undefined || value === null) throw new Error(`KERN core runtime missing ${label}.`);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`KERN core runtime ${label} must be a string expression.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`KERN core runtime requires ${label}.`);
  return value;
}

function kernStringCoerce(value: KernValue): string {
  if (value.kind === 'null') return 'null';
  if (value.kind === 'undefined') return 'undefined';
  if (value.kind === 'boolean') return value.value ? 'true' : 'false';
  if (value.kind === 'number') return String(value.value);
  if (value.kind === 'string') return value.value;
  return String(toHostValue(value));
}

/**
 * Slice S7 — STRICT equality (`===` / `!==`). Different kinds are unequal, so
 * `undefined === null` is FALSE. Same-nullish-kind is equal (`undefined ===
 * undefined`, `null === null`). Arrays/records keep the structural-strict
 * comparison KERN has always used (element identity recurses through strict).
 */
function kernStrictEqual(left: KernValue, right: KernValue): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'null':
    case 'undefined':
      return true;
    case 'boolean':
      return left.value === (right as Extract<KernValue, { kind: 'boolean' }>).value;
    case 'number':
      return left.value === (right as Extract<KernValue, { kind: 'number' }>).value;
    case 'string':
      return left.value === (right as Extract<KernValue, { kind: 'string' }>).value;
    case 'array': {
      const rightArray = right as Extract<KernValue, { kind: 'array' }>;
      return (
        left.items.length === rightArray.items.length &&
        left.items.every((item, i) => kernStrictEqual(item, rightArray.items[i]))
      );
    }
    case 'record': {
      const rightRecord = right as Extract<KernValue, { kind: 'record' }>;
      const leftKeys = Object.keys(left.entries);
      const rightKeys = Object.keys(rightRecord.entries);
      return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
          (key) =>
            Object.hasOwn(rightRecord.entries, key) && kernStrictEqual(left.entries[key], rightRecord.entries[key]),
        )
      );
    }
    case 'function':
    case 'builtin':
    case 'class':
    case 'instance':
    case 'bound-method':
    case 'super':
      return left === right;
  }
}

/**
 * Slice S7 — LOOSE equality (`==` / `!=`). The ONLY divergence from strict in
 * this slice is the null/undefined crossing: `undefined == null` and `null ==
 * undefined` are TRUE (both nullish). Every other comparison defers to strict —
 * KERN's typed value domain does not model the rest of JS's `==` coercion
 * ladder (number↔string, boolean↔number), and the room contract scopes loose
 * equality to the nullish boundary.
 */
function kernLooseEqual(left: KernValue, right: KernValue): boolean {
  if (isNullish(left) && isNullish(right)) return true;
  return kernStrictEqual(left, right);
}

function isNullish(value: KernValue): boolean {
  return value.kind === 'null' || value.kind === 'undefined';
}

function isKernValue(value: unknown): value is KernValue {
  return isKernValueShape(value, new WeakSet<object>());
}

function isKernValueShape(value: unknown, seen: WeakSet<object>): value is KernValue {
  if (
    !isPlainRecord(value) ||
    (value as { [KERN_VALUE_BRAND]?: true })[KERN_VALUE_BRAND] !== true ||
    typeof value.kind !== 'string'
  ) {
    return false;
  }
  if (seen.has(value)) return true;
  seen.add(value);
  switch (value.kind) {
    case 'null':
    case 'undefined':
      return hasOnlyKeys(value, ['kind']);
    case 'boolean':
      return hasOnlyKeys(value, ['kind', 'value']) && typeof value.value === 'boolean';
    case 'number':
      return hasOnlyKeys(value, ['kind', 'value']) && typeof value.value === 'number' && Number.isFinite(value.value);
    case 'string':
      return hasOnlyKeys(value, ['kind', 'value']) && typeof value.value === 'string';
    case 'array':
      return (
        hasOnlyKeys(value, ['kind', 'items']) &&
        Array.isArray(value.items) &&
        !hasArrayHoles(value.items) &&
        value.items.every((item) => isKernValueShape(item, seen))
      );
    case 'record':
      return (
        hasOnlyKeys(value, ['kind', 'entries']) &&
        isPlainRecord(value.entries) &&
        Object.values(value.entries).every((entry) => isKernValueShape(entry, seen))
      );
    case 'function':
      return (
        hasOnlyKeys(value, ['kind', 'params', 'body', 'env'], ['name']) &&
        (value.name === undefined || typeof value.name === 'string') &&
        Array.isArray(value.params) &&
        Array.isArray(value.body) &&
        value.env instanceof CoreRuntimeEnv
      );
    case 'builtin':
      return (
        hasOnlyKeys(value, ['kind', 'name', 'call']) &&
        typeof value.name === 'string' &&
        typeof value.call === 'function'
      );
    case 'class':
      return (
        hasOnlyKeys(value, ['kind', 'name', 'node', 'env', 'staticFields'], ['runtimeRootContext']) &&
        typeof value.name === 'string' &&
        isPlainRecord(value.node) &&
        value.env instanceof CoreRuntimeEnv &&
        isPlainRecord(value.staticFields) &&
        Object.values(value.staticFields).every((entry) => isKernValueShape(entry, seen))
      );
    case 'instance':
      return (
        hasOnlyKeys(value, ['kind', 'classValue', 'fields', 'initializedClasses']) &&
        isKernValueShape(value.classValue, seen) &&
        value.classValue.kind === 'class' &&
        isPlainRecord(value.fields) &&
        Object.values(value.fields).every((entry) => isKernValueShape(entry, seen)) &&
        value.initializedClasses instanceof Set
      );
    case 'bound-method':
      return (
        hasOnlyKeys(value, ['kind', 'name', 'receiver', 'methodNode', 'ownerClass']) &&
        typeof value.name === 'string' &&
        isKernValueShape(value.receiver, seen) &&
        value.receiver.kind === 'instance' &&
        isPlainRecord(value.methodNode) &&
        isKernValueShape(value.ownerClass, seen) &&
        value.ownerClass.kind === 'class'
      );
    case 'super':
      return (
        hasOnlyKeys(value, ['kind', 'receiver', 'ownerClass', 'mode']) &&
        isKernValueShape(value.receiver, seen) &&
        (value.receiver.kind === 'instance' || value.receiver.kind === 'class') &&
        isKernValueShape(value.ownerClass, seen) &&
        value.ownerClass.kind === 'class' &&
        (value.mode === 'constructor' || value.mode === 'method' || value.mode === 'static')
      );
    default:
      return false;
  }
}

function hasArrayHoles(value: readonly unknown[]): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) return true;
  }
  return false;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
}

function createRecordEntries(): Record<string, KernValue> {
  return Object.create(null) as Record<string, KernValue>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findRuntimeDefaultSeparator(value: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if ((ch === '>' || ch === ')' || ch === '}' || ch === ']') && depth > 0) depth -= 1;
    else if (ch === '=' && depth === 0) {
      if (
        value[i + 1] === '>' ||
        value[i + 1] === '=' ||
        value[i - 1] === '=' ||
        value[i - 1] === '<' ||
        value[i - 1] === '>' ||
        value[i - 1] === '!'
      ) {
        continue;
      }
      return i;
    }
  }
  return -1;
}

function isExprObject(value: unknown): value is { __expr: true; code: string } {
  return isPlainRecord(value) && value.__expr === true && typeof value.code === 'string';
}

function isIRNodeArray(value: IRNode | readonly IRNode[]): value is readonly IRNode[] {
  return Array.isArray(value);
}

function isObjectSpreadEntry(
  entry: Extract<ValueIR, { kind: 'objectLit' }>['entries'][number],
): entry is { kind: 'spread'; argument: ValueIR } {
  return 'kind' in entry && entry.kind === 'spread';
}
