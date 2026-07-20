/** Iterative, target-neutral traversal for the complete ValueIR tree. */

import type { ValueIR } from './value-ir.js';

/** Visit each immediate ValueIR child in authored order. */
export function forEachValueIRChild(node: ValueIR, visit: (child: ValueIR) => void): void {
  switch (node.kind) {
    case 'member':
      visit(node.object);
      return;
    case 'index':
      visit(node.object);
      visit(node.index);
      return;
    case 'call':
      visit(node.callee);
      for (const argument of node.args) visit(argument);
      return;
    case 'lambda':
      if (node.body) visit(node.body);
      return;
    case 'binary':
      visit(node.left);
      visit(node.right);
      return;
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
    case 'propagate':
      visit(node.argument);
      return;
    case 'typeAssert':
    case 'nonNull':
      visit(node.expression);
      return;
    case 'tmplLit':
      for (const expression of node.expressions) visit(expression);
      return;
    case 'objectLit':
      for (const entry of node.entries) {
        if ('kind' in entry && entry.kind === 'spread') visit(entry.argument);
        else visit((entry as { value: ValueIR }).value);
      }
      return;
    case 'arrayLit':
      for (const item of node.items) visit(item);
      return;
    case 'conditional':
      visit(node.test);
      visit(node.consequent);
      visit(node.alternate);
      return;
    default:
      return;
  }
}

/** Visit a ValueIR tree in pre-order without consuming the host call stack. */
export function visitValueIRTree(root: ValueIR, visit: (node: ValueIR) => void): void {
  const stack: ValueIR[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as ValueIR;
    visit(node);
    const children: ValueIR[] = [];
    forEachValueIRChild(node, (child) => children.push(child));
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
}

/** Test a ValueIR tree in pre-order without consuming the host call stack. */
export function someValueIRTree(root: ValueIR, predicate: (node: ValueIR) => boolean): boolean {
  const stack: ValueIR[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as ValueIR;
    if (predicate(node)) return true;
    const children: ValueIR[] = [];
    forEachValueIRChild(node, (child) => children.push(child));
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return false;
}
