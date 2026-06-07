import { parseExpression } from '../parser-expression.js';
import { splitPortableExpressionList } from '../portable-expression-list.js';
import type { IRNode } from '../types.js';
import type { ValueIR } from '../value-ir.js';

const KERN_VALUE_BRAND: unique symbol = Symbol('KERN core runtime value');
const INTEGER_INDEX_RE = /^(0|[1-9]\d*)$/;

export type KernValue =
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'array'; items: KernValue[] }
  | { kind: 'record'; entries: Record<string, KernValue> }
  | KernFunctionValue
  | KernBuiltinValue;

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

export interface RuntimeParam {
  name: string;
  type?: string;
  defaultExpr?: string;
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

  constructor(readonly parent?: CoreRuntimeEnv) {}

  define(name: string, value: KernValue): KernValue {
    if (this.bindings.has(name)) throw new Error(`KERN core runtime binding already defined: ${name}`);
    this.bindings.set(name, value);
    return value;
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
    case 'function':
    case 'builtin':
      return `[KERN ${value.kind}${value.name ? ` ${value.name}` : ''}]`;
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
      return value.value !== 0;
    case 'string':
      return value.value.length > 0;
    case 'array':
    case 'record':
    case 'function':
    case 'builtin':
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
    case 'ident':
      return env.lookup(node.name);
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
  if (node.op === '!') return kBoolean(!kernTruthy(arg));
  if (node.op === '-' || node.op === '+') {
    if (arg.kind !== 'number') throw new Error(`KERN core runtime unary ${node.op} requires a number.`);
    return kNumber(node.op === '-' ? -arg.value : arg.value);
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
      if (left.kind === 'number' && right.kind === 'number') return kNumber(left.value + right.value);
      if (left.kind === 'string' && right.kind === 'string') return kString(left.value + right.value);
      throw new Error('KERN core runtime + requires two numbers or two strings.');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    case '===':
    case '==':
      return kBoolean(kernEquals(left, right));
    case '!==':
    case '!=':
      return kBoolean(!kernEquals(left, right));
    case '<':
    case '<=':
    case '>':
    case '>=':
      return evalOrderedComparison(node.op, left, right);
    default:
      throw new Error(`KERN core runtime unsupported binary operator: ${node.op}`);
  }
}

function evalNumberBinary(op: string, left: KernValue, right: KernValue): KernValue {
  if (left.kind !== 'number' || right.kind !== 'number') {
    throw new Error(`KERN core runtime ${op} requires two numbers.`);
  }
  if (op === '-') return kNumber(left.value - right.value);
  if (op === '*') return kNumber(left.value * right.value);
  if (right.value === 0 && (op === '/' || op === '%')) throw new Error(`KERN core runtime ${op} division by zero.`);
  if (op === '/') return kNumber(left.value / right.value);
  return kNumber(left.value % right.value);
}

function evalOrderedComparison(op: string, left: KernValue, right: KernValue): KernValue {
  if (!((left.kind === 'number' && right.kind === 'number') || (left.kind === 'string' && right.kind === 'string'))) {
    throw new Error(`KERN core runtime ${op} requires same-kind number or string operands.`);
  }
  if (op === '<') return kBoolean(left.value < right.value);
  if (op === '<=') return kBoolean(left.value <= right.value);
  if (op === '>') return kBoolean(left.value > right.value);
  return kBoolean(left.value >= right.value);
}

function evalMember(node: Extract<ValueIR, { kind: 'member' }>, env: CoreRuntimeEnv): KernValue {
  const object = evalValueIR(node.object, env);
  if (isNullish(object)) {
    if (node.optional) return kUndefined();
    throw new Error(`KERN core runtime cannot read .${node.property} from ${object.kind}.`);
  }
  if (object.kind === 'record') {
    return Object.hasOwn(object.entries, node.property) ? object.entries[node.property] : kUndefined();
  }
  if (object.kind === 'array' && node.property === 'length') return kNumber(object.items.length);
  if (object.kind === 'string' && node.property === 'length') return kNumber(object.value.length);
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
    return object.items[index.value] ?? kUndefined();
  }
  if (object.kind === 'record' || object.kind === 'string') {
    if (index.kind !== 'string' && index.kind !== 'number') {
      throw new Error('KERN core runtime record/string index must be a string or number.');
    }
    const key = String(index.value);
    if (object.kind === 'record') return Object.hasOwn(object.entries, key) ? object.entries[key] : kUndefined();
    const charIndex =
      index.kind === 'number' ? index.value : INTEGER_INDEX_RE.test(index.value) ? Number(index.value) : NaN;
    return Number.isInteger(charIndex) && charIndex >= 0 && charIndex < object.value.length
      ? kString(object.value[charIndex] ?? '')
      : kUndefined();
  }
  return kUndefined();
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
  throw new Error(`KERN core runtime cannot call ${callee.kind}.`);
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

function runtimeFunctionBody(node: IRNode): IRNode[] {
  const handler = node.children?.find((child) => child.type === 'handler');
  const body = handler ? (handler.children ?? []) : (node.children ?? []);
  return body.filter((child) => child.type !== 'param' && child.type !== 'decorator');
}

function runtimeChildren(node: IRNode): IRNode[] {
  if (node.type === 'handler' || node.type === '__block') return node.children ?? [];
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
  return splitPortableExpressionList(raw, 'fn params=').map((part) => {
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

function kernEquals(left: KernValue, right: KernValue): boolean {
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
        left.items.every((item, i) => kernEquals(item, rightArray.items[i]))
      );
    }
    case 'record': {
      const rightRecord = right as Extract<KernValue, { kind: 'record' }>;
      const leftKeys = Object.keys(left.entries);
      const rightKeys = Object.keys(rightRecord.entries);
      return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
          (key) => Object.hasOwn(rightRecord.entries, key) && kernEquals(left.entries[key], rightRecord.entries[key]),
        )
      );
    }
    case 'function':
    case 'builtin':
      return left === right;
  }
}

function isNullish(value: KernValue): boolean {
  return value.kind === 'null' || value.kind === 'undefined';
}

function isKernValue(value: unknown): value is KernValue {
  if (
    !isPlainRecord(value) ||
    (value as { [KERN_VALUE_BRAND]?: true })[KERN_VALUE_BRAND] !== true ||
    typeof value.kind !== 'string'
  ) {
    return false;
  }
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
        value.items.every(isKernValue)
      );
    case 'record':
      return (
        hasOnlyKeys(value, ['kind', 'entries']) &&
        isPlainRecord(value.entries) &&
        Object.values(value.entries).every(isKernValue)
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
    default:
      return false;
  }
}

function brandValue<T extends KernValue>(value: T): T {
  Object.defineProperty(value, KERN_VALUE_BRAND, { value: true });
  return value;
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
