import type { ValueIR } from '../../value-ir.js';

// This proof is intentionally narrower than JavaScript string coercion. Every
// concatenated branch must independently prove string output so mixed values
// such as a string plus an unproved deferred binding remain fail-closed.
export function isSyntacticallyStringMapKey(node: ValueIR): boolean {
  if (node.kind === 'strLit') return true;
  if (node.kind === 'binary' && node.op === '+') {
    return isSyntacticallyStringMapKey(node.left) && isSyntacticallyStringMapKey(node.right);
  }
  return (
    node.kind === 'call' &&
    !node.optional &&
    node.callee.kind === 'ident' &&
    node.callee.name === 'String' &&
    node.args.length === 1
  );
}
