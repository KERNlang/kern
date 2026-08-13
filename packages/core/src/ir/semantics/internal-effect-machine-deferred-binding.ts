import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { isIntProvenancedExpr } from './portable-scalar-domain.js';
import { defineBinding, defineIntBinding, type SemanticEnv } from './semantic-env.js';

export function defineDeferredInternalMachineBinding(node: IRNode, env: SemanticEnv, name: string): void {
  const raw = node.props?.value;
  if (node.type === 'let' && typeof raw === 'string' && isIntProvenancedExpr(parseExpression(raw), env)) {
    defineIntBinding(env, name, null);
  } else defineBinding(env, name, null);
}
