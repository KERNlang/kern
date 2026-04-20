/**
 * Semantic Validation — cross-reference checks that go beyond structural schema validation.
 *
 * Currently validates:
 *   1. Machine transitions reference valid states
 *   2. No duplicate sibling names (e.g., two `field name=id` in the same interface)
 *   3. `derive` cannot be a direct child of `each` when that `each` is inside
 *      a `render` block — `derive` compiles to `useMemo`, which violates React's
 *      Rules of Hooks when called inside a `.map()` callback.
 *   4. `set name=X` must have a matching `state name=X` declared in an ancestor
 *      screen/component. Otherwise codegen emits `setX(...)` with no bound
 *      setter, which fails at React runtime with no compile-time signal.
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
  validateNode(root, violations, [], []);
  return violations;
}

function validateNode(
  node: IRNode,
  violations: SemanticViolation[],
  ancestry: string[],
  ancestorNodes: IRNode[],
): void {
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

  // ── derive-inside-render-each — Rules-of-Hooks guard ───────────────
  // derive → useMemo (see packages/react/src/codegen-react.ts).
  // useMemo inside .map((item) => ...) violates React's Rules of Hooks.
  if (node.type === 'each' && ancestry.includes('render') && node.children) {
    for (const child of node.children) {
      if (child.type === 'derive') {
        violations.push({
          rule: 'no-derive-inside-render-each',
          nodeType: 'derive',
          message:
            '`derive` compiles to `useMemo`, which cannot run inside an `each`/`.map` callback (React Rules of Hooks). Move the derive above the `each`, or inline the expression in the handler.',
          line: child.loc?.line,
          col: child.loc?.col,
        });
      }
    }
  }

  // ── let must be a direct child of each ─────────────────────────────
  // `let` is an iteration-scoped binding (plain `const` inside the `.map`
  // callback). Outside of `each` it has no codegen target and is silently
  // dropped — fail loudly instead.
  if (node.type === 'let') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'each') {
      violations.push({
        rule: 'let-must-be-inside-each',
        nodeType: 'let',
        message:
          '`let` must be a direct child of `each`. Use `derive` for component-scoped bindings, or `const` at file scope.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── set must match a state declaration ─────────────────────────────
  // `set name=X` lowers to `setX(...)` using the React useState convention.
  // If no ancestor declares `state name=X`, the emitted setter is unbound
  // and fails at React runtime with no compile-time signal.
  if (node.type === 'set') {
    const targetName = node.props?.name as string | undefined;
    if (targetName && !hasMatchingState(targetName, ancestorNodes)) {
      const declared = collectDeclaredStateNames(ancestorNodes);
      const hint =
        declared.length > 0
          ? ` Available in scope: ${declared.join(', ')}.`
          : ' No `state` declarations found in scope.';
      violations.push({
        rule: 'set-requires-matching-state',
        nodeType: 'set',
        message: `\`set name=${targetName}\` has no matching \`state name=${targetName}\` in scope — the emitted \`set${capitalize(targetName)}(...)\` will be unbound at runtime.${hint}`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // Recurse
  if (node.children) {
    const nextAncestry = node.type ? [...ancestry, node.type] : ancestry;
    const nextAncestorNodes = node.type ? [...ancestorNodes, node] : ancestorNodes;
    for (const child of node.children) {
      validateNode(child, violations, nextAncestry, nextAncestorNodes);
    }
  }
}

function hasMatchingState(name: string, ancestors: IRNode[]): boolean {
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      if (child.type === 'state' && (child.props?.name as string | undefined) === name) {
        return true;
      }
    }
  }
  return false;
}

function collectDeclaredStateNames(ancestors: IRNode[]): string[] {
  const names: string[] = [];
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      if (child.type === 'state') {
        const n = child.props?.name as string | undefined;
        if (n) names.push(n);
      }
    }
  }
  return names;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
