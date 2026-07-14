import { parseExpression } from '../../parser-expression.js';
import type { ValueIR } from '../../value-ir.js';

export function addInternalMachineExpressionBindings(target: Set<string>, node: ValueIR): void {
  if (node.kind === 'ident') target.add(node.name);
  else if (node.kind === 'unary') addInternalMachineExpressionBindings(target, node.argument);
  else if (node.kind === 'binary') {
    addInternalMachineExpressionBindings(target, node.left);
    addInternalMachineExpressionBindings(target, node.right);
  } else if (node.kind === 'conditional') {
    addInternalMachineExpressionBindings(target, node.test);
    addInternalMachineExpressionBindings(target, node.consequent);
    addInternalMachineExpressionBindings(target, node.alternate);
  } else if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    addInternalMachineExpressionBindings(target, node.expression);
  } else if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) addInternalMachineExpressionBindings(target, expression);
  } else if (node.kind === 'member') addInternalMachineExpressionBindings(target, node.object);
  else if (node.kind === 'index') {
    addInternalMachineExpressionBindings(target, node.object);
    addInternalMachineExpressionBindings(target, node.index);
  } else if (node.kind === 'call') {
    for (const argument of node.args) addInternalMachineExpressionBindings(target, argument);
  } else if (node.kind === 'arrayLit') {
    for (const item of node.items) addInternalMachineExpressionBindings(target, item);
  } else if (node.kind === 'objectLit') {
    for (const entry of node.entries) {
      addInternalMachineExpressionBindings(target, 'kind' in entry ? entry.argument : entry.value);
    }
  } else if (node.kind === 'new') addInternalMachineExpressionBindings(target, node.argument);
}

export function internalMachineExpressionBindings(raw: string): ReadonlySet<string> {
  const out = new Set<string>();
  addInternalMachineExpressionBindings(out, parseExpression(raw));
  return out;
}
