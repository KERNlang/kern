/**
 * Semantic Validation — cross-reference checks that go beyond structural schema validation.
 *
 * Currently validates:
 *   1. Machine transitions reference valid states
 *   2. No duplicate sibling names (e.g., two `field name=id` in the same interface)
 */

import type { IRNode } from './types.js';

export interface SemanticViolation {
  rule: string;
  nodeType: string;
  message: string;
  line?: number;
  col?: number;
}

/**
 * Run semantic validation on an IR tree.
 * Returns an empty array when the tree is valid.
 */
export function validateSemantics(root: IRNode): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  validateNode(root, violations);
  return violations;
}

function validateNode(node: IRNode, violations: SemanticViolation[]): void {
  // ── Machine transition cross-ref ───────────────────────────────────
  if (node.type === 'machine' && node.children) {
    const stateNames = new Set<string>();
    for (const child of node.children) {
      if (child.type === 'state' && child.props?.name) {
        stateNames.add(child.props.name as string);
      }
    }

    for (const child of node.children) {
      if (child.type === 'transition') {
        const from = child.props?.from as string | undefined;
        const to = child.props?.to as string | undefined;
        const name = (child.props?.name as string) || '(unnamed)';

        if (from && !stateNames.has(from)) {
          violations.push({
            rule: 'machine-transition-from',
            nodeType: 'transition',
            message: `Transition '${name}' references unknown state '${from}' in 'from'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
        if (to && !stateNames.has(to)) {
          violations.push({
            rule: 'machine-transition-to',
            nodeType: 'transition',
            message: `Transition '${name}' references unknown state '${to}' in 'to'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
      }
    }
  }

  // ── Duplicate sibling names ────────────────────────────────────────
  if (node.children && node.children.length > 1) {
    const seen = new Map<string, IRNode>();
    for (const child of node.children) {
      const name = child.props?.name as string | undefined;
      if (!name) continue;
      const key = `${child.type}:${name}`;
      const prev = seen.get(key);
      if (prev) {
        violations.push({
          rule: 'duplicate-sibling-name',
          nodeType: child.type,
          message: `Duplicate '${child.type}' named '${name}' — first defined at line ${prev.loc?.line ?? '?'}`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
      } else {
        seen.set(key, child);
      }
    }
  }

  // Recurse
  if (node.children) {
    for (const child of node.children) {
      validateNode(child, violations);
    }
  }
}
