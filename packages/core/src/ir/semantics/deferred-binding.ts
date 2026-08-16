import type { ValueIR } from '../../value-ir.js';

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
