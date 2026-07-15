import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';

function collectInvokedSetupClosures(node: ValueIR, names: ReadonlySet<string>, out: Set<string>): void {
  switch (node.kind) {
    case 'call':
      if (node.callee.kind === 'ident' && names.has(node.callee.name)) out.add(node.callee.name);
      if (
        node.callee.kind === 'member' &&
        node.callee.object.kind === 'ident' &&
        node.callee.object.name === 'List' &&
        (node.callee.property === 'map' || node.callee.property === 'filter') &&
        node.args[1]?.kind === 'ident' &&
        names.has(node.args[1].name)
      ) {
        out.add(node.args[1].name);
      }
      collectInvokedSetupClosures(node.callee, names, out);
      for (const argument of node.args) collectInvokedSetupClosures(argument, names, out);
      return;
    case 'arrayLit':
      for (const item of node.items) collectInvokedSetupClosures(item, names, out);
      return;
    case 'objectLit':
      for (const entry of node.entries) {
        collectInvokedSetupClosures(
          'kind' in entry && entry.kind === 'spread' ? entry.argument : (entry as { value: ValueIR }).value,
          names,
          out,
        );
      }
      return;
    case 'member':
      collectInvokedSetupClosures(node.object, names, out);
      return;
    case 'index':
      collectInvokedSetupClosures(node.object, names, out);
      collectInvokedSetupClosures(node.index, names, out);
      return;
    case 'lambda':
      if (node.body) collectInvokedSetupClosures(node.body, names, out);
      return;
    case 'binary':
      collectInvokedSetupClosures(node.left, names, out);
      collectInvokedSetupClosures(node.right, names, out);
      return;
    case 'unary':
      collectInvokedSetupClosures(node.argument, names, out);
      return;
    case 'conditional':
      collectInvokedSetupClosures(node.test, names, out);
      collectInvokedSetupClosures(node.consequent, names, out);
      collectInvokedSetupClosures(node.alternate, names, out);
      return;
    case 'nonNull':
    case 'typeAssert':
      collectInvokedSetupClosures(node.expression, names, out);
      return;
    default:
      return;
  }
}

export function assertAcyclicLambdaSetupClosures(ir: IRNode): void {
  const bodies = new Map<string, ValueIR>();
  for (const child of ir.children ?? []) {
    const rawValue = child.props?.value;
    if (rawValue === undefined || rawValue === '') continue;
    const value = parseExpression(String(rawValue));
    if (value.kind !== 'lambda' || value.bodyBlock || !value.body) continue;
    const name = child.type === 'let' ? child.props?.name : child.props?.target;
    if (typeof name === 'string') bodies.set(name, value.body);
  }

  const names = new Set(bodies.keys());
  const edges = new Map<string, ReadonlySet<string>>();
  for (const [name, body] of bodies) {
    const invoked = new Set<string>();
    collectInvokedSetupClosures(body, names, invoked);
    edges.set(name, invoked);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visiting.has(name)) throw new Error(`lambda preflight: recursive setup closure "${name}" is not supported`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const target of edges.get(name) ?? []) visit(target);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of names) visit(name);
}
