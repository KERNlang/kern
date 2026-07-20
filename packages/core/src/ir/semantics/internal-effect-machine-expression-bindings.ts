import { parseExpression } from '../../parser-expression.js';
import type { ValueIR } from '../../value-ir.js';
import { forEachValueIRChild } from '../../value-ir-walk.js';

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
