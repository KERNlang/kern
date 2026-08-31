import type { KernKirLimits, KernKirValue } from '../contracts.js';

export const KERN_LINKED_KIR_PROGRAM_FORMAT = 'kern.linked-kir-program.v1' as const;

export type LinkedKernKirBinaryOperator = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type LinkedKernKirStaticType = 'boolean' | 'integer';

export interface LinkedKernKirBinaryOperatorContract {
  readonly family: 'logical' | 'equality' | 'ordering';
  readonly javascriptHelper: string;
  readonly operandType: LinkedKernKirStaticType | 'either';
  readonly pythonHelper: string;
}

export const LINKED_KIR_BINARY_OPERATORS = Object.freeze({
  '&&': { family: 'logical', javascriptHelper: '__and', operandType: 'boolean', pythonHelper: '_and' },
  '||': { family: 'logical', javascriptHelper: '__or', operandType: 'boolean', pythonHelper: '_or' },
  '==': { family: 'equality', javascriptHelper: '__eq', operandType: 'either', pythonHelper: '_eq' },
  '!=': { family: 'equality', javascriptHelper: '__ne', operandType: 'either', pythonHelper: '_ne' },
  '<': { family: 'ordering', javascriptHelper: '__lt', operandType: 'integer', pythonHelper: '_lt' },
  '<=': { family: 'ordering', javascriptHelper: '__le', operandType: 'integer', pythonHelper: '_le' },
  '>': { family: 'ordering', javascriptHelper: '__gt', operandType: 'integer', pythonHelper: '_gt' },
  '>=': { family: 'ordering', javascriptHelper: '__ge', operandType: 'integer', pythonHelper: '_ge' },
}) satisfies Record<LinkedKernKirBinaryOperator, LinkedKernKirBinaryOperatorContract>;

export function linkedKirBinaryOperator(op: string): LinkedKernKirBinaryOperator | undefined {
  return Object.hasOwn(LINKED_KIR_BINARY_OPERATORS, op) ? (op as LinkedKernKirBinaryOperator) : undefined;
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

export interface LinkedKernKirCallScope {
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

export type LinkedKernKirStatement =
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

type CapabilityClosure = ReadonlyMap<string, LinkedKernKirHandler> | undefined;

function expressionInvokesCapability(
  expression: LinkedKernKirExpression,
  helpers: CapabilityClosure,
  visiting: Set<string>,
): boolean {
  switch (expression.kind) {
    case 'user-call': {
      if (expression.arguments.some((argument) => expressionInvokesCapability(argument, helpers, visiting)))
        return true;
      const callee = helpers?.get(expression.handlerName);
      if (callee === undefined || visiting.has(expression.handlerName)) return false;
      visiting.add(expression.handlerName);
      const invokes = statementsInvokeCapability(callee.statements, helpers, visiting);
      visiting.delete(expression.handlerName);
      return invokes;
    }
    case 'binary':
      return (
        expressionInvokesCapability(expression.left, helpers, visiting) ||
        expressionInvokesCapability(expression.right, helpers, visiting)
      );
    case 'list':
      return expression.items.some((item) => expressionInvokesCapability(item, helpers, visiting));
    case 'record':
      return expression.entries.some((entry) => expressionInvokesCapability(entry.value, helpers, visiting));
    case 'member':
      return expressionInvokesCapability(expression.object, helpers, visiting);
    case 'json-call':
      return expressionInvokesCapability(expression.argument, helpers, visiting);
    default:
      return false;
  }
}

function statementsInvokeCapability(
  statements: readonly LinkedKernKirStatement[],
  helpers: CapabilityClosure,
  visiting: Set<string>,
): boolean {
  return statements.some((statement) => {
    if (statement.kind === 'capability') return true;
    if (statement.kind === 'if') {
      return (
        expressionInvokesCapability(statement.condition, helpers, visiting) ||
        statementsInvokeCapability(statement.thenBranch, helpers, visiting) ||
        (statement.elseBranch !== undefined && statementsInvokeCapability(statement.elseBranch, helpers, visiting))
      );
    }
    return expressionInvokesCapability(statement.value, helpers, visiting);
  });
}

export function linkedStatementsInvokeCapability(
  statements: readonly LinkedKernKirStatement[],
  helpers?: CapabilityClosure,
): boolean {
  return statementsInvokeCapability(statements, helpers, new Set<string>());
}

export interface LinkedKernKirHandler {
  readonly parameters: readonly { readonly name: string; readonly type: LinkedKernKirParameterType }[];
  readonly returnType: LinkedKernKirParameterType;
  readonly statements: readonly LinkedKernKirStatement[];
}

export interface LinkedKernKirHelper {
  readonly handler: LinkedKernKirHandler;
  readonly name: string;
}

export interface LinkedKernKirProgram {
  readonly format: typeof KERN_LINKED_KIR_PROGRAM_FORMAT;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly helpers?: readonly LinkedKernKirHelper[];
  readonly program: LinkedKernKirHandler;
  readonly projectionArtifactSha256: string;
  readonly sha256: string;
}

export function linkedProgramHelpers(
  helpers: readonly LinkedKernKirHelper[] | undefined,
): ReadonlyMap<string, LinkedKernKirHandler> | undefined {
  if (helpers === undefined) return undefined;
  return new Map(helpers.map((helper) => [helper.name, helper.handler]));
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
