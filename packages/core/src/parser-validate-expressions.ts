/** Post-parse validator: runs parseExpression on bare-string props whose
 *  schema kind is 'expression'. Failures become INVALID_EXPRESSION diagnostics.
 *  Does NOT change codegen — strings flow through unchanged on success. */

import type { ClosureClassifier } from './closure-classifier.js';
import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import { parseExpression } from './parser-expression.js';
import { NODE_SCHEMAS } from './schema.js';
import { type IRNode, isExprObject } from './types.js';

function validateNode(state: ParseState, node: IRNode, closureClassifier?: ClosureClassifier): void {
  const schema = NODE_SCHEMAS[node.type as string];
  if (schema?.props && node.props) {
    const quoted = node.__quotedProps;
    for (const [propName, propSchema] of Object.entries(schema.props)) {
      if (propSchema.kind !== 'expression') continue;
      const val = node.props[propName];
      if (typeof val !== 'string' || val === '') continue;
      if (isExprObject(val)) continue;
      // Skip props whose value originated from a quoted token — those are
      // string literals, not expressions, even though the schema says expression.
      if (quoted?.includes(propName)) continue;
      try {
        parseExpression(val, { closureClassifier });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const detail = val.includes('<<<')
          ? `Raw code block delimiter '<<<' cannot appear inside an expression prop. Put raw code blocks on a statement-line handler body with lang=, for example: handler lang="ts" <<<...>>>. Parser error: ${msg}`
          : msg;
        emitDiagnostic(
          state,
          'INVALID_EXPRESSION',
          'error',
          `Invalid expression in '${propName}': ${detail}`,
          node.loc?.line ?? 0,
          node.loc?.col ?? 0,
          { endCol: (node.loc?.col ?? 0) + propName.length },
        );
      }
    }
  }
  if (node.children) {
    for (const child of node.children) validateNode(state, child, closureClassifier);
  }
}

export function validateExpressions(state: ParseState, root: IRNode, closureClassifier?: ClosureClassifier): void {
  validateNode(state, root, closureClassifier);
}
