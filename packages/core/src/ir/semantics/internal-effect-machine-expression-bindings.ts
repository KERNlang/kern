import { parseExpression } from '../../parser-expression.js';
import type { ValueIR } from '../../value-ir.js';
import { forEachValueIRChild } from '../../value-ir-walk.js';

export function expressionHasDeferredBinding(node: ValueIR, deferredBindings: ReadonlySet<string>): boolean {
  if (node.kind === 'ident') return deferredBindings.has(node.name);
  if (node.kind === 'unary' || node.kind === 'new') {
    return expressionHasDeferredBinding(node.argument, deferredBindings);
  }
  if (node.kind === 'binary') {
    return (
      expressionHasDeferredBinding(node.left, deferredBindings) ||
      expressionHasDeferredBinding(node.right, deferredBindings)
    );
  }
  if (node.kind === 'conditional') {
    return (
      expressionHasDeferredBinding(node.test, deferredBindings) ||
      expressionHasDeferredBinding(node.consequent, deferredBindings) ||
      expressionHasDeferredBinding(node.alternate, deferredBindings)
    );
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    return expressionHasDeferredBinding(node.expression, deferredBindings);
  }
  if (node.kind === 'tmplLit') {
    return node.expressions.some((expression) => expressionHasDeferredBinding(expression, deferredBindings));
  }
  if (node.kind === 'member') return expressionHasDeferredBinding(node.object, deferredBindings);
  if (node.kind === 'index') {
    return (
      expressionHasDeferredBinding(node.object, deferredBindings) ||
      expressionHasDeferredBinding(node.index, deferredBindings)
    );
  }
  if (node.kind === 'call') {
    return node.args.some((argument) => expressionHasDeferredBinding(argument, deferredBindings));
  }
  if (node.kind === 'arrayLit') {
    return node.items.some((item) => expressionHasDeferredBinding(item, deferredBindings));
  }
  if (node.kind === 'objectLit') {
    return node.entries.some((entry) =>
      expressionHasDeferredBinding('kind' in entry ? entry.argument : entry.value, deferredBindings),
    );
  }
  if (node.kind === 'spread' || node.kind === 'await' || node.kind === 'propagate') {
    return expressionHasDeferredBinding(node.argument, deferredBindings);
  }
  return false;
}

/**
 * Visit only expression children that are data inputs to the internal machine.
 * Function callees name operations rather than data bindings, and nested
 * lambdas own their own binding scope.
 */
export function forEachInternalMachineDataChild(node: ValueIR, visit: (child: ValueIR) => void): void {
  if (node.kind === 'lambda') return;
  if (node.kind === 'call') {
    for (const argument of node.args) visit(argument);
    return;
  }
  forEachValueIRChild(node, visit);
}

export function addInternalMachineExpressionBindings(target: Set<string>, node: ValueIR): void {
  const stack: ValueIR[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as ValueIR;
    if (current.kind === 'ident') {
      target.add(current.name);
      continue;
    }
    const children: ValueIR[] = [];
    forEachInternalMachineDataChild(current, (child) => children.push(child));
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
}

export function internalMachineExpressionBindings(raw: string): ReadonlySet<string> {
  const out = new Set<string>();
  addInternalMachineExpressionBindings(out, parseExpression(raw));
  return out;
}
