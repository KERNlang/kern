import { KernKirFault, type KernKirLimits, type KernKirValue } from '../contracts.js';

export const KERN_LINKED_KIR_PROGRAM_FORMAT = 'kern.linked-kir-program.v1' as const;

export type LinkedKernKirBinaryOperator = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*';

export type LinkedKernKirStaticType = 'boolean' | 'integer';

export interface LinkedKernKirBinaryOperatorContract {
  readonly family: 'arithmetic' | 'logical' | 'equality' | 'ordering';
  readonly javascriptHelper: string;
  readonly operandType: LinkedKernKirStaticType | 'either';
  readonly pythonHelper: string;
  readonly resultType: LinkedKernKirStaticType;
}

export const LINKED_KIR_BINARY_OPERATORS = Object.freeze({
  '&&': {
    family: 'logical',
    javascriptHelper: '__and',
    operandType: 'boolean',
    pythonHelper: '_and',
    resultType: 'boolean',
  },
  '||': {
    family: 'logical',
    javascriptHelper: '__or',
    operandType: 'boolean',
    pythonHelper: '_or',
    resultType: 'boolean',
  },
  '==': {
    family: 'equality',
    javascriptHelper: '__eq',
    operandType: 'either',
    pythonHelper: '_eq',
    resultType: 'boolean',
  },
  '!=': {
    family: 'equality',
    javascriptHelper: '__ne',
    operandType: 'either',
    pythonHelper: '_ne',
    resultType: 'boolean',
  },
  '<': {
    family: 'ordering',
    javascriptHelper: '__lt',
    operandType: 'integer',
    pythonHelper: '_lt',
    resultType: 'boolean',
  },
  '<=': {
    family: 'ordering',
    javascriptHelper: '__le',
    operandType: 'integer',
    pythonHelper: '_le',
    resultType: 'boolean',
  },
  '>': {
    family: 'ordering',
    javascriptHelper: '__gt',
    operandType: 'integer',
    pythonHelper: '_gt',
    resultType: 'boolean',
  },
  '>=': {
    family: 'ordering',
    javascriptHelper: '__ge',
    operandType: 'integer',
    pythonHelper: '_ge',
    resultType: 'boolean',
  },
  '+': {
    family: 'arithmetic',
    javascriptHelper: '__add',
    operandType: 'integer',
    pythonHelper: '_add',
    resultType: 'integer',
  },
  '-': {
    family: 'arithmetic',
    javascriptHelper: '__sub',
    operandType: 'integer',
    pythonHelper: '_sub',
    resultType: 'integer',
  },
  '*': {
    family: 'arithmetic',
    javascriptHelper: '__mul',
    operandType: 'integer',
    pythonHelper: '_mul',
    resultType: 'integer',
  },
}) satisfies Record<LinkedKernKirBinaryOperator, LinkedKernKirBinaryOperatorContract>;

export function linkedKirBinaryOperator(op: string): LinkedKernKirBinaryOperator | undefined {
  return Object.hasOwn(LINKED_KIR_BINARY_OPERATORS, op) ? (op as LinkedKernKirBinaryOperator) : undefined;
}

export type LinkedKernKirUnaryOperator = '-';

export interface LinkedKernKirUnaryOperatorContract {
  readonly javascriptHelper: string;
  readonly operandType: LinkedKernKirStaticType;
  readonly pythonHelper: string;
  readonly resultType: LinkedKernKirStaticType;
}

export const LINKED_KIR_UNARY_OPERATORS = Object.freeze({
  '-': { javascriptHelper: '__neg', operandType: 'integer', pythonHelper: '_neg', resultType: 'integer' },
}) satisfies Record<LinkedKernKirUnaryOperator, LinkedKernKirUnaryOperatorContract>;

export function linkedKirUnaryOperator(op: string): LinkedKernKirUnaryOperator | undefined {
  return Object.hasOwn(LINKED_KIR_UNARY_OPERATORS, op) ? (op as LinkedKernKirUnaryOperator) : undefined;
}

export type LinkedKernKirCrossCallType = 'boolean' | 'list<boolean>' | 'list<text>' | 'text';

export interface LinkedKernKirCrossCallTypeContract {
  readonly element: 'boolean' | 'text' | undefined;
  readonly kind: 'boolean' | 'list' | 'text';
}

export const LINKED_KIR_CROSS_CALL_TYPES = Object.freeze({
  boolean: { element: undefined, kind: 'boolean' },
  'list<boolean>': { element: 'boolean', kind: 'list' },
  'list<text>': { element: 'text', kind: 'list' },
  text: { element: undefined, kind: 'text' },
}) satisfies Record<LinkedKernKirCrossCallType, LinkedKernKirCrossCallTypeContract>;

export const LINKED_KIR_CROSS_CALL_TYPE_NAMES = Object.freeze(
  Object.keys(LINKED_KIR_CROSS_CALL_TYPES).sort(),
) as readonly LinkedKernKirCrossCallType[];

export function linkedKirCrossCallType(type: LinkedKernKirParameterType): LinkedKernKirCrossCallType | undefined {
  const element = type.kind === 'list' ? type.element : undefined;
  return LINKED_KIR_CROSS_CALL_TYPE_NAMES.find((name) => {
    const contract = LINKED_KIR_CROSS_CALL_TYPES[name];
    return contract.kind === type.kind && contract.element === element;
  });
}

export interface LinkedKernKirCallPolicy {
  readonly maxCallDepth: number;
}

// Every leg dispatches a call on its own host stack, so the reachable chain has to be bounded
// once, at the single admission edge, or the legs could diverge on where they overflow. The
// default leaves roughly a 2x margin under the deepest chain measured good on all three legs
// (32) and stays inside what F5 projects (33), so the gate is exercised rather than theoretical.
export const LINKED_KIR_DEFAULT_CALL_POLICY = Object.freeze({
  maxCallDepth: 16,
}) satisfies LinkedKernKirCallPolicy;

export interface LinkedKernKirCallScope {
  readonly isAsync: (name: string) => boolean;
  readonly linked: ReadonlyMap<string, LinkedKernKirHandler>;
  readonly resolve: (name: string, label: string) => LinkedKernKirHandler;
}

export interface LinkedKernKirTypeScope {
  readonly bindings: ReadonlySet<string>;
  readonly calls: LinkedKernKirCallScope | undefined;
  readonly crossCallTypes: ReadonlyMap<string, LinkedKernKirCrossCallType>;
  readonly types: ReadonlyMap<string, LinkedKernKirStaticType>;
}

export type LinkedKernKirExpression =
  | { readonly kind: 'identifier'; readonly name: string }
  | {
      readonly kind: 'user-call';
      readonly arguments: readonly LinkedKernKirExpression[];
      readonly handlerName: string;
    }
  | {
      readonly kind: 'binary';
      readonly left: LinkedKernKirExpression;
      readonly op: LinkedKernKirBinaryOperator;
      readonly right: LinkedKernKirExpression;
    }
  | { readonly kind: 'unary'; readonly argument: LinkedKernKirExpression; readonly op: LinkedKernKirUnaryOperator }
  | { readonly kind: 'literal'; readonly value: KernKirValue }
  | { readonly kind: 'list'; readonly items: readonly LinkedKernKirExpression[] }
  | {
      readonly kind: 'record';
      readonly entries: readonly { readonly key: string; readonly value: LinkedKernKirExpression }[];
    }
  | {
      readonly kind: 'member';
      readonly object: LinkedKernKirExpression;
      readonly optional: boolean;
      readonly property: string;
    }
  | {
      readonly kind: 'json-call';
      readonly operation: 'parse' | 'stringify';
      readonly argument: LinkedKernKirExpression;
    };

export type LinkedKernKirParameterType =
  | { readonly kind: 'boolean' | 'integer' | 'text' }
  | { readonly kind: 'list'; readonly element: 'boolean' | 'integer' | 'text' };

// `void` is a return position only, and only on the entry: no cross-call row exists for it, so a
// void handler has no call form and a helper's return type can never widen to it.
export type LinkedKernKirReturnType = LinkedKernKirParameterType | { readonly kind: 'void' };

export type LinkedKernKirTypeKind = 'boolean' | 'integer' | 'list' | 'text' | 'void';

export interface LinkedKernKirTypeAdmission {
  readonly parameter: boolean;
  readonly return: boolean;
  readonly scalar: boolean;
}

// The closed table both linker type gates are built from, rather than two hand-written literal
// lists that could drift apart. `void` is the one return-only row, and that asymmetry is what
// `handlerReturnType` reads to recognise it.
export const LINKED_KIR_TYPE_ADMISSION = Object.freeze({
  boolean: { parameter: true, return: true, scalar: true },
  integer: { parameter: true, return: true, scalar: true },
  list: { parameter: true, return: true, scalar: false },
  text: { parameter: true, return: true, scalar: true },
  void: { parameter: false, return: true, scalar: false },
}) satisfies Record<LinkedKernKirTypeKind, LinkedKernKirTypeAdmission>;

export function linkedKirAdmitsType(kind: string, position: 'parameter' | 'return'): boolean {
  return (
    Object.hasOwn(LINKED_KIR_TYPE_ADMISSION, kind) && LINKED_KIR_TYPE_ADMISSION[kind as LinkedKernKirTypeKind][position]
  );
}

export function linkedKirAdmitsScalar(
  kind: string,
  position: 'parameter' | 'return',
): kind is 'boolean' | 'integer' | 'text' {
  return linkedKirAdmitsType(kind, position) && LINKED_KIR_TYPE_ADMISSION[kind as LinkedKernKirTypeKind].scalar;
}

export const LINKED_KIR_VOID_RETURN_TYPE = Object.freeze({
  kind: 'void' as const,
}) satisfies LinkedKernKirReturnType;

export type LinkedKernKirStatement =
  | { readonly kind: 'assign'; readonly target: string; readonly value: LinkedKernKirExpression }
  | { readonly kind: 'let'; readonly name: string; readonly value: LinkedKernKirExpression }
  | {
      readonly kind: 'capability';
      readonly input: LinkedKernKirExpression | undefined;
      readonly name: string;
      readonly namespace: string;
      readonly operation: string;
    }
  | { readonly kind: 'print'; readonly value: LinkedKernKirExpression }
  | { readonly kind: 'return'; readonly value: LinkedKernKirExpression }
  | {
      readonly kind: 'if';
      readonly condition: LinkedKernKirExpression;
      readonly thenBranch: readonly LinkedKernKirStatement[];
      readonly elseBranch: readonly LinkedKernKirStatement[] | undefined;
    };

// Exhaustive on purpose, like `containsAsyncCall`: a permissive `default` would let a future
// expression variant slip past the capability closure and the call-depth policy with no tsc error.
function expressionVariantUnhandled(expression: never): never {
  throw new KernKirFault(
    'handler-entry-unsupported',
    'link',
    `unhandled variant ${String((expression as { kind?: unknown }).kind)}`,
  );
}

type CapabilityClosure = ReadonlyMap<string, LinkedKernKirHandler> | undefined;

export interface LinkedKernKirClosureWalk {
  readonly active: Set<string>;
  readonly done: Map<string, boolean>;
  cycles: number;
  visits: number;
}

export function createLinkedKirClosureWalk(): LinkedKernKirClosureWalk {
  return { active: new Set<string>(), cycles: 0, done: new Map<string, boolean>(), visits: 0 };
}

function expressionInvokesCapability(
  expression: LinkedKernKirExpression,
  helpers: CapabilityClosure,
  walk: LinkedKernKirClosureWalk,
): boolean {
  switch (expression.kind) {
    case 'user-call': {
      if (expression.arguments.some((argument) => expressionInvokesCapability(argument, helpers, walk))) return true;
      const callee = helpers?.get(expression.handlerName);
      if (callee === undefined) return false;
      const memoized = walk.done.get(expression.handlerName);
      if (memoized !== undefined) return memoized;
      if (walk.active.has(expression.handlerName)) {
        walk.cycles += 1;
        return false;
      }
      walk.active.add(expression.handlerName);
      walk.visits += 1;
      const enclosingCycles = walk.cycles;
      const invokes = statementsInvokeCapability(callee.statements, helpers, walk);
      walk.active.delete(expression.handlerName);
      if (walk.cycles === enclosingCycles) walk.done.set(expression.handlerName, invokes);
      return invokes;
    }
    case 'binary':
      return (
        expressionInvokesCapability(expression.left, helpers, walk) ||
        expressionInvokesCapability(expression.right, helpers, walk)
      );
    case 'unary':
      return expressionInvokesCapability(expression.argument, helpers, walk);
    case 'list':
      return expression.items.some((item) => expressionInvokesCapability(item, helpers, walk));
    case 'record':
      return expression.entries.some((entry) => expressionInvokesCapability(entry.value, helpers, walk));
    case 'member':
      return expressionInvokesCapability(expression.object, helpers, walk);
    case 'json-call':
      return expressionInvokesCapability(expression.argument, helpers, walk);
    case 'literal':
    case 'identifier':
      return false;
    default:
      return expressionVariantUnhandled(expression);
  }
}

function statementsInvokeCapability(
  statements: readonly LinkedKernKirStatement[],
  helpers: CapabilityClosure,
  walk: LinkedKernKirClosureWalk,
): boolean {
  return statements.some((statement) => {
    if (statement.kind === 'capability') return true;
    if (statement.kind === 'if') {
      return (
        expressionInvokesCapability(statement.condition, helpers, walk) ||
        statementsInvokeCapability(statement.thenBranch, helpers, walk) ||
        (statement.elseBranch !== undefined && statementsInvokeCapability(statement.elseBranch, helpers, walk))
      );
    }
    return expressionInvokesCapability(statement.value, helpers, walk);
  });
}

export function linkedStatementsInvokeCapability(
  statements: readonly LinkedKernKirStatement[],
  helpers?: CapabilityClosure,
  walk: LinkedKernKirClosureWalk = createLinkedKirClosureWalk(),
): boolean {
  return statementsInvokeCapability(statements, helpers, walk);
}

function expressionCallDepth(
  expression: LinkedKernKirExpression,
  helpers: CapabilityClosure,
  depths: Map<string, number>,
  active: Set<string>,
): number {
  switch (expression.kind) {
    case 'user-call': {
      const fromArguments = expression.arguments.map((argument) =>
        expressionCallDepth(argument, helpers, depths, active),
      );
      const callee = helpers?.get(expression.handlerName);
      const own =
        callee === undefined || active.has(expression.handlerName)
          ? 1
          : 1 + calleeDepth(expression.handlerName, callee, helpers, depths, active);
      return Math.max(own, ...fromArguments);
    }
    case 'binary':
      return Math.max(
        expressionCallDepth(expression.left, helpers, depths, active),
        expressionCallDepth(expression.right, helpers, depths, active),
      );
    case 'unary':
      return expressionCallDepth(expression.argument, helpers, depths, active);
    case 'list':
      return Math.max(0, ...expression.items.map((item) => expressionCallDepth(item, helpers, depths, active)));
    case 'record':
      return Math.max(
        0,
        ...expression.entries.map((entry) => expressionCallDepth(entry.value, helpers, depths, active)),
      );
    case 'member':
      return expressionCallDepth(expression.object, helpers, depths, active);
    case 'json-call':
      return expressionCallDepth(expression.argument, helpers, depths, active);
    case 'literal':
    case 'identifier':
      return 0;
    default:
      return expressionVariantUnhandled(expression);
  }
}

function calleeDepth(
  name: string,
  callee: LinkedKernKirHandler,
  helpers: CapabilityClosure,
  depths: Map<string, number>,
  active: Set<string>,
): number {
  const memoized = depths.get(name);
  if (memoized !== undefined) return memoized;
  active.add(name);
  const depth = statementsCallDepth(callee.statements, helpers, depths, active);
  active.delete(name);
  depths.set(name, depth);
  return depth;
}

function statementsCallDepth(
  statements: readonly LinkedKernKirStatement[],
  helpers: CapabilityClosure,
  depths: Map<string, number>,
  active: Set<string>,
): number {
  return Math.max(
    0,
    ...statements.map((statement) => {
      if (statement.kind === 'capability') {
        return statement.input === undefined ? 0 : expressionCallDepth(statement.input, helpers, depths, active);
      }
      if (statement.kind === 'if') {
        return Math.max(
          expressionCallDepth(statement.condition, helpers, depths, active),
          statementsCallDepth(statement.thenBranch, helpers, depths, active),
          statement.elseBranch === undefined ? 0 : statementsCallDepth(statement.elseBranch, helpers, depths, active),
        );
      }
      return expressionCallDepth(statement.value, helpers, depths, active);
    }),
  );
}

export function linkedStatementsCallDepth(
  statements: readonly LinkedKernKirStatement[],
  helpers?: CapabilityClosure,
): number {
  return statementsCallDepth(statements, helpers, new Map<string, number>(), new Set<string>());
}

export interface LinkedKernKirHandler {
  readonly parameters: readonly { readonly name: string; readonly type: LinkedKernKirParameterType }[];
  readonly returnType: LinkedKernKirParameterType;
  readonly statements: readonly LinkedKernKirStatement[];
}

export interface LinkedKernKirEntryHandler {
  readonly parameters: readonly { readonly name: string; readonly type: LinkedKernKirParameterType }[];
  readonly returnType: LinkedKernKirReturnType;
  readonly statements: readonly LinkedKernKirStatement[];
}

// The flag is omitted, never serialized as false, so a synchronous helper costs the same bytes it
// cost before the classification existed and every pre-slice linked digest survives unchanged.
export interface LinkedKernKirHelper {
  readonly async?: true;
  readonly handler: LinkedKernKirHandler;
  readonly name: string;
}

export interface LinkedKernKirProgram {
  readonly format: typeof KERN_LINKED_KIR_PROGRAM_FORMAT;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly helpers?: readonly LinkedKernKirHelper[];
  readonly program: LinkedKernKirEntryHandler;
  readonly projectionArtifactSha256: string;
  readonly sha256: string;
}

export function linkedProgramHelpers(
  helpers: readonly LinkedKernKirHelper[] | undefined,
): ReadonlyMap<string, LinkedKernKirHandler> | undefined {
  if (helpers === undefined) return undefined;
  return new Map(helpers.map((helper) => [helper.name, helper.handler]));
}

export function linkedProgramAsyncHelpers(helpers: readonly LinkedKernKirHelper[] | undefined): ReadonlySet<string> {
  return new Set((helpers ?? []).filter((helper) => helper.async === true).map((helper) => helper.name));
}

export type KernKirLinkCode =
  | 'projection-authentication-error'
  | 'handler-entry-not-found'
  | 'handler-entry-ambiguous'
  | 'handler-entry-unsupported'
  | 'handler-link-error';

export type LinkKernKirProgramResult =
  | { readonly outcome: 'success'; readonly program: LinkedKernKirProgram }
  | { readonly outcome: 'failure'; readonly code: KernKirLinkCode };

export interface LinkedKernKirEntry {
  readonly moduleId: string;
  readonly handlerName: string;
}

export type LinkedKernKirLimits = KernKirLimits;
