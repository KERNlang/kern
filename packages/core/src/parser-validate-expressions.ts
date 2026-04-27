/** Post-parse validator: runs parseExpression on bare-string props whose
 *  schema kind is 'expression'. Failures become INVALID_EXPRESSION diagnostics.
 *  Does NOT change codegen — strings flow through unchanged on success. */

import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import { parseExpression } from './parser-expression.js';
import { NODE_SCHEMAS } from './schema.js';
import type { IRNode } from './types.js';

function isExprObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { __expr?: unknown }).__expr === true;
}

/** Skip validation on values containing characters that bare-collection in
 *  line mode could not have produced, indicating the value originated from a
 *  quoted token. Until the parser tracks quote-origin per prop, this avoids
 *  false positives on string-literal props that happen to share a schema. */
function looksQuotedOrigin(s: string): boolean {
  return s.includes('/') || s.includes('\\') || s.includes(' ') || s.includes('\n');
}

function validateNode(state: ParseState, node: IRNode): void {
  const schema = NODE_SCHEMAS[node.type as string];
  if (schema?.props && node.props) {
    for (const [propName, propSchema] of Object.entries(schema.props)) {
      if (propSchema.kind !== 'expression') continue;
      const val = node.props[propName];
      if (typeof val !== 'string' || val === '') continue;
      if (isExprObject(val)) continue;
      if (looksQuotedOrigin(val)) continue;
      try {
        parseExpression(val);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitDiagnostic(
          state,
          'INVALID_EXPRESSION',
          'error',
          `Invalid expression in '${propName}': ${msg}`,
          node.loc?.line ?? 0,
          node.loc?.col ?? 0,
          { endCol: (node.loc?.col ?? 0) + propName.length },
        );
      }
    }
  }
  if (node.children) {
    for (const child of node.children) validateNode(state, child);
  }
}

export function validateExpressions(state: ParseState, root: IRNode): void {
  validateNode(state, root);
}
