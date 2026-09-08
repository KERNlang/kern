import type { LinkedKernKirExpression, LinkedKernKirHandler, LinkedKernKirStatement } from './contracts.js';
import { expressionVariantUnhandled, statementSubBlocks, statementSubExpressions } from './contracts.js';

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
    return (
      statementSubExpressions(statement).some((expression) => expressionInvokesCapability(expression, helpers, walk)) ||
      statementSubBlocks(statement).some((block) => statementsInvokeCapability(block, helpers, walk))
    );
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
      return Math.max(
        0,
        ...statementSubExpressions(statement).map((expression) =>
          expressionCallDepth(expression, helpers, depths, active),
        ),
        ...statementSubBlocks(statement).map((block) => statementsCallDepth(block, helpers, depths, active)),
      );
    }),
  );
}

export function linkedStatementsCallDepth(
  statements: readonly LinkedKernKirStatement[],
  helpers?: CapabilityClosure,
): number {
  return statementsCallDepth(statements, helpers, new Map<string, number>(), new Set<string>());
}
