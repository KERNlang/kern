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

        if (from) {
          for (const source of from
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)) {
            if (!stateNames.has(source)) {
              violations.push({
                rule: 'machine-transition-from',
                nodeType: 'transition',
                message: `Transition '${name}' references unknown state '${source}' in 'from'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
                line: child.loc?.line,
                col: child.loc?.col,
              });
            }
          }
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

  // ── each pair-mode is body-stmt only (2026-05-06) ──────────────────────
  // `pairKey`/`pairValue` lower to TS `for (const [k, v] of m)` and Python
  // `for k, v in m.items()`. The render-path JSX emitter (codegen/screens.ts)
  // doesn't read these props, so a render-position `each pairKey=k pairValue=v`
  // would silently emit `m.map((item, __i) => ...)` and lose the destructure.
  // Reject in render/group ancestor scope so the LLM sees the error rather
  // than a silently-wrong `.map()`.
  if (node.type === 'each' && ('pairKey' in (node.props ?? {}) || 'pairValue' in (node.props ?? {}))) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-pair-mode-body-stmt-only',
        nodeType: 'each',
        message:
          '`each pairKey=/pairValue=` is a body-statement form (TS Map iteration / Python dict.items()) and cannot appear inside a `render`/`group` JSX context. Iterate the map ahead of the render block, or use the `name=` form with a render-key.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── each type= is body-stmt only (2026-05-07) ─────────────────────────
  // `type=` annotates a TS `for...of` binding. The render-path JSX emitter
  // lowers `each` to `.map(...)` and does not preserve that annotation, so
  // reject it in render/group scope instead of silently dropping it.
  if (node.type === 'each' && 'type' in (node.props ?? {})) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-type-body-stmt-only',
        nodeType: 'each',
        message:
          '`each type=` is a body-statement form for TS for...of bindings and cannot appear inside a `render`/`group` JSX context. Move the typed iteration above the render block, or omit type= in JSX composition.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── let must be a direct child of each OR handler (slice 1 native bodies) ──
  // `let` has two valid parents:
  //   - `each` — iteration-scoped binding (emits `const` inside the `.map` callback).
  //   - `handler` — body-statement binding inside a native KERN handler (`lang=kern`).
  // Outside both contexts there's no codegen target and the binding is silently
  // dropped — fail loudly instead.
  if (node.type === 'let') {
    const parent = ancestry[ancestry.length - 1];
    // Slice 2c — also accept `if` / `else` parents for native body control flow.
    // `let` inside an if-branch is the natural expression for conditional bindings.
    if (parent !== 'each' && parent !== 'handler' && parent !== 'if' && parent !== 'else') {
      violations.push({
        rule: 'let-must-be-inside-each',
        nodeType: 'let',
        message:
          '`let` must be a direct child of `each`, `handler`, or `if`/`else` (slice 2c). Use `derive` for component-scoped bindings, or `const` at file scope.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── step / catch must be direct children of try ──────────────────────
  // Both are consumed by `generateTry`'s walk — placed elsewhere they hit
  // the defensive throw in the core dispatcher. Flagging semantically
  // surfaces the error with a line number during validation.
  if (node.type === 'step' || node.type === 'catch') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'try') {
      violations.push({
        rule: `${node.type}-must-be-inside-try`,
        nodeType: node.type,
        message: `\`${node.type}\` must be a direct child of \`try\`. Placing it elsewhere has no codegen target.`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── try may have at most one catch ───────────────────────────────────
  // JS only supports a single catch clause, so `generateTry` uses
  // `firstChild(node, 'catch')` — a second or third `catch` sibling would
  // be silently ignored. Flag it during validation so authors don't
  // assume a second catch handles a different error class.
  if (node.type === 'try' && node.children) {
    const catches = node.children.filter((c) => c.type === 'catch');
    if (catches.length > 1) {
      for (const extra of catches.slice(1)) {
        violations.push({
          rule: 'try-single-catch-only',
          nodeType: 'catch',
          message:
            '`try` supports at most one `catch` child — JavaScript has no multi-catch. Merge the error-handling logic or switch on `err instanceof …` inside a single catch.',
          line: extra.loc?.line,
          col: extra.loc?.col,
        });
      }
    }
  }

  // ── group must be a direct child of render or another group ─────────
  // `group wrapper=...` is consumed by the composed-render walk in
  // `collectComposedPieces`, which only visits direct `render`/`group`
  // children. Placements like `render > each > group` or
  // `render > conditional > group` pass the schema but get silently dropped
  // at codegen because `generateEachJSX` / `generateConditionalJSX` don't
  // compose groups. Require a direct `render`/`group` parent so that silent
  // failure is caught as a validation error.
  if (node.type === 'group') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'render' && parent !== 'group') {
      violations.push({
        rule: 'group-must-be-inside-render',
        nodeType: 'group',
        message:
          '`group` must be a direct child of `render` or another `group`. Placing it inside `each`, `conditional`, or any other parent silently drops the wrapper at codegen.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── fmt inline-JSX form must sit inside render/group ─────────────────
  // `fmt template="..."` with no `name` and no `return=true` is the
  // inline-JSX form — it emits `{\`...\`}` as a JSX piece via
  // `collectComposedPieces`. Anywhere else (top-level, inside `fn`, inside
  // `each`/`conditional`, etc.) the codegen dispatcher throws. Flag the
  // misplacement semantically so authors get a line number.
  if (node.type === 'fmt') {
    const p = node.props || {};
    const returnMode = p.return === true || p.return === 'true';
    const isInline = !returnMode && !('name' in p);
    if (isInline) {
      const parent = ancestry[ancestry.length - 1];
      if (parent !== 'render' && parent !== 'group') {
        violations.push({
          rule: 'fmt-inline-must-be-inside-render',
          nodeType: 'fmt',
          message:
            '`fmt template="..."` without `name` or `return=true` is the inline-JSX form — it must be a direct child of `render` or `group`. Use `fmt name=X` for a binding or `fmt return=true` inside a `fn` body.',
          line: node.loc?.line,
          col: node.loc?.col,
        });
      }
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
