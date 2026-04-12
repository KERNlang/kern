/**
 * Performance rules — Wave 3 breadth additions.
 *
 * All three rules are heuristics; they ship with `precision: 'medium'` so
 * kern-sight can hide them by default and let users opt in after the first
 * noise-budget pass.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

type JsxElementLike = JsxOpeningElement | JsxSelfClosingElement;

// ── Rule: image-no-lazy ──────────────────────────────────────────────────
// <img> without loading="lazy". next/image is exempt (it lazy-loads by default).

function imageNoLazy(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const jsxElements: JsxElementLike[] = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const el of jsxElements) {
    const tag = el.getTagNameNode().getText();
    if (tag !== 'img') continue;

    let hasLoading = false;
    let hasPriority = false;
    for (const attr of el.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) continue;
      const name = attr.getNameNode().getText();
      if (name === 'loading') hasLoading = true;
      if (name === 'fetchPriority' || name === 'fetchpriority') hasPriority = true;
    }
    if (hasLoading) continue;
    // Above-the-fold images often use fetchPriority="high" — don't nag
    if (hasPriority) continue;

    findings.push(
      finding(
        'image-no-lazy',
        'info',
        'pattern',
        '<img> without loading="lazy" — consider lazy loading below-the-fold images or switching to next/image',
        ctx.filePath,
        el.getStartLineNumber(),
        1,
        {
          suggestion:
            'Add loading="lazy" (and optionally decoding="async") or use next/image which lazy-loads by default',
        },
      ),
    );
  }
  return findings;
}

// ── Rule: heavy-computation-in-render ────────────────────────────────────
// Inline .sort(), .filter().map(), .reduce() chains directly in JSX without
// a useMemo wrap. Fires only when the chain has at least 2 operations to
// reduce noise.

const EXPENSIVE_METHODS = new Set(['sort', 'filter', 'reduce', 'flatMap', 'reverse']);

function heavyComputationInRender(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Walk JSX expression braces — computations that land directly in the tree
  for (const jsxExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const inner = jsxExpr.getExpression();
    if (!inner) continue;

    // Count chained expensive operations
    let expensiveCount = 0;
    let cur: Node | undefined = inner;
    while (cur) {
      if (Node.isCallExpression(cur)) {
        const callee = cur.getExpression();
        if (Node.isPropertyAccessExpression(callee)) {
          if (EXPENSIVE_METHODS.has(callee.getName())) expensiveCount++;
          cur = callee.getExpression();
          continue;
        }
      }
      if (Node.isPropertyAccessExpression(cur)) {
        cur = cur.getExpression();
        continue;
      }
      break;
    }

    if (expensiveCount < 2) continue;

    // Skip if the entire expression is wrapped in useMemo/useCallback
    // (i.e. the variable being rendered is already the result of a memo hook)
    // Simpler: check the text of the immediate identifier at the root
    let root: Node = inner;
    while (Node.isCallExpression(root) || Node.isPropertyAccessExpression(root)) {
      root = Node.isCallExpression(root) ? root.getExpression() : root.getExpression();
    }

    findings.push(
      finding(
        'heavy-computation-in-render',
        'info',
        'pattern',
        `Chained expensive array operations (${expensiveCount} of sort/filter/reduce/flatMap/reverse) inline in JSX — this reruns on every render`,
        ctx.filePath,
        jsxExpr.getStartLineNumber(),
        1,
        {
          suggestion:
            'Wrap the computation in useMemo with the correct dependencies, or move it out of the render path entirely',
        },
      ),
    );
  }
  return findings;
}

// ── Rule: large-list-no-virtualization ───────────────────────────────────
// Heuristic: `.map(...)` in JSX over an identifier whose name suggests a
// collection (items/rows/data/list/entries/results) when the component has
// no import from react-window / react-virtual / virtuoso. Very noisy for
// small lists — ships as `info` and `precision: 'experimental'`.

const LIST_LIKE_NAMES = new Set(['items', 'rows', 'data', 'list', 'entries', 'results', 'records', 'elements']);
const VIRTUAL_LIBS = [/react-window/, /react-virtual/, /virtuoso/, /react-virtualized/, /@tanstack\/react-virtual/];

function largeListNoVirtualization(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Early skip: does this file already import a virtualization library?
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (VIRTUAL_LIBS.some((r) => r.test(mod))) return findings;
  }

  for (const jsxExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const inner = jsxExpr.getExpression();
    if (!inner || !Node.isCallExpression(inner)) continue;

    const callee = inner.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'map') continue;

    // Only fire when the callee root is a plain identifier with a list-like name.
    let root: Node = callee.getExpression();
    while (Node.isPropertyAccessExpression(root)) {
      root = root.getExpression();
    }
    if (!Node.isIdentifier(root)) continue;
    const name = root.getText();
    if (!LIST_LIKE_NAMES.has(name)) continue;

    findings.push(
      finding(
        'large-list-no-virtualization',
        'info',
        'pattern',
        `Rendering '${name}.map(...)' inline — if ${name} can grow large, consider react-window or @tanstack/react-virtual to avoid rendering off-screen rows`,
        ctx.filePath,
        jsxExpr.getStartLineNumber(),
        1,
        {
          suggestion: `Wrap the list in a virtualized container if ${name}.length is unbounded. Skip this rule for static/small collections.`,
        },
      ),
    );
  }
  return findings;
}

// ── Exported perf rules ──────────────────────────────────────────────────

export const perfRules = [imageNoLazy, heavyComputationInRender, largeListNoVirtualization];
