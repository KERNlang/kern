/**
 * Performance rules — Wave 3 breadth additions.
 *
 * All three rules are heuristics; they ship with `precision: 'medium'` so
 * kern-sight can hide them by default and let users opt in after the first
 * noise-budget pass.
 */

import type { JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding, insertAfterSpan } from './utils.js';

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
          autofix: {
            type: 'insert-after',
            span: insertAfterSpan(el.getTagNameNode(), ctx.filePath),
            replacement: ' loading="lazy"',
            description: 'Insert loading="lazy" attribute',
          },
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

// ── Render-path classifier (shared) ─────────────────────────────────────
// True when a node sits in the synchronous render path of a React component:
// inside a component function body but NOT inside a hook callback, lazy
// initializer, JSX event handler, or async timer. The whitelist is
// intentionally generous — a "render-path" finding only fires when we can
// prove the node is reached on every render.

const HOOK_AND_TIMER_GATES = new Set([
  'useEffect',
  'useLayoutEffect',
  'useCallback',
  'useMemo',
  'useReducer',
  'useTransition',
  'useDeferredValue',
  'useState', // lazy initializer
  'useRef', // lazy initializer (rare but valid)
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
  // Promise prototype callbacks — body runs after the promise settles, never
  // synchronously during render. (Gemini final review.)
  'then',
  'catch',
  'finally',
]);

function nodeIsRenderPath(node: Node): boolean {
  let cur: Node | undefined = node;
  let foundComponentBoundary = false;
  while (cur) {
    // Function-like ancestor — classify whether the FUNCTION itself is invoked
    // synchronously during render. If we cross a function boundary that ISN'T
    // synchronously invoked at render time, the inner code is not render-path.
    if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      const parent: Node | undefined = cur.getParent();

      // Case: the function is an argument to a call (e.g. `list.map(fn)`,
      // `useMemo(fn, [])`, `setTimeout(fn, 100)`).
      if (parent && Node.isCallExpression(parent)) {
        const callee = parent.getExpression().getText();
        const name = callee.includes('.') ? callee.split('.').pop() : callee;
        // Hooks / lazy initializers / async timers — function does NOT run on render
        if (name && HOOK_AND_TIMER_GATES.has(name)) {
          if (parent.getArguments().includes(cur)) return false;
        }
        // Otherwise: function is an immediate-call argument (Array#map, forEach,
        // etc.) — body runs synchronously during render. Keep walking up.
      } else if (parent && Node.isJsxExpression(parent)) {
        // JSX onXxx attribute → event handler, not render-path
        const grand = parent.getParent();
        if (grand && Node.isJsxAttribute(grand)) {
          const attrName = grand.getNameNode().getText();
          if (attrName.startsWith('on') && attrName.length > 2 && /^[A-Z]/.test(attrName.charAt(2))) {
            return false;
          }
        }
        // Any other JSX-expression context for a function value (e.g. children
        // render-prop) — function is captured, not invoked during render.
        return false;
      } else if (parent && Node.isVariableDeclaration(parent)) {
        // The arrow IS a `const X = () => { ... }` declaration. If X is a
        // capitalized name, the arrow is the React component itself — body
        // executes whenever X renders, so the node IS render-path.
        const nameNode = parent.getNameNode();
        if (Node.isIdentifier(nameNode) && /^[A-Z]/.test(nameNode.getText())) {
          return true;
        }
        // Otherwise the arrow is captured for later use (handler, helper, etc.)
        // — not invoked during render.
        return false;
      } else {
        // Function expression returned, passed to a non-recognised call, used
        // as a JSX child, etc. — captured for later use, not invoked on render.
        // (`const onClick = () => Date.now()` was the canonical example.)
        return false;
      }
    } else if (Node.isFunctionDeclaration(cur)) {
      const fnName = cur.getName();
      if (fnName && /^[A-Z]/.test(fnName)) foundComponentBoundary = true;
    } else if (Node.isVariableDeclaration(cur)) {
      const nameNode = cur.getNameNode();
      if (Node.isIdentifier(nameNode) && /^[A-Z]/.test(nameNode.getText())) {
        const init = cur.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          foundComponentBoundary = true;
        }
      }
    }
    cur = cur.getParent();
  }
  return foundComponentBoundary;
}

// ── Rule: nondeterministic-in-render ────────────────────────────────────
// Date.now() / new Date() / Math.random() / crypto.randomUUID() / performance.now()
// in the render path defeats memoization (every render gets a new value),
// breaks hydration in SSR, and produces unstable keys/IDs. The fix is to
// move the call into useState/useMemo/useEffect or hoist it out of render.

const NONDETERMINISTIC_PROPERTY_CALLS = new Set([
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
  'crypto.getRandomValues',
  'performance.now',
]);

function nondeterministicInRender(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const reported = new Set<number>(); // dedup by absolute char offset (already unique)

  // Property-call form: Date.now(), Math.random(), crypto.randomUUID(), performance.now()
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let label: string | undefined;
    if (Node.isPropertyAccessExpression(callee)) {
      const text = callee.getText();
      if (NONDETERMINISTIC_PROPERTY_CALLS.has(text)) label = `${text}()`;
    }
    if (!label) continue;
    if (!nodeIsRenderPath(call)) continue;

    const line = call.getStartLineNumber();
    if (reported.has(call.getStart())) continue;
    reported.add(call.getStart());

    findings.push(
      finding(
        'nondeterministic-in-render',
        'warning',
        'bug',
        `${label} called in component render path — produces a new value every render, defeats memoization, and breaks SSR hydration`,
        ctx.filePath,
        line,
        1,
        {
          suggestion: `Move the call into useState's lazy initializer (useState(() => ${label})) for a per-mount value, useMemo for a derived stable value, or useEffect for a per-mount side effect`,
        },
      ),
    );
  }

  // `new Date()` with no args — same hazard as Date.now() but distinct AST shape.
  for (const newExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const ctor = newExpr.getExpression();
    if (!Node.isIdentifier(ctor) || ctor.getText() !== 'Date') continue;
    if (newExpr.getArguments().length > 0) continue; // new Date(timestamp) is deterministic
    if (!nodeIsRenderPath(newExpr)) continue;

    const line = newExpr.getStartLineNumber();
    if (reported.has(newExpr.getStart())) continue;
    reported.add(newExpr.getStart());

    findings.push(
      finding(
        'nondeterministic-in-render',
        'warning',
        'bug',
        '`new Date()` (no args) called in component render path — produces a new value every render, defeats memoization, and breaks SSR hydration',
        ctx.filePath,
        line,
        1,
        {
          suggestion:
            'Move it into useState lazy init (useState(() => new Date())), useMemo with stable deps, or useEffect for a per-mount side effect',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: regex-literal-in-render ───────────────────────────────────────
// `/pattern/g` literal sitting in the render path is recompiled and gets a
// new identity every render. Harmful when it is passed as a prop to a
// memoized child (defeats memo) or used inside .replace/.match in a hot
// loop (recompile cost). Fires conservatively — only when the regex is
// actually used in a call (str.replace, str.match, etc.) or referenced as
// a JSX attribute value.

function regexLiteralInRender(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const re of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.RegularExpressionLiteral)) {
    if (!nodeIsRenderPath(re)) continue;

    // Only fire when the literal is used in a "hot" position:
    //   1) argument to str.replace/replaceAll/match/matchAll      e.g. s.replace(/x/, ...)
    //   2) receiver of regex.test/exec called on the literal       e.g. /x/.test(s)
    //   3) JSX attribute value                                     e.g. <Input pattern={/x/} />
    let isHotUse = false;
    const parent: Node | undefined = re.getParent();
    if (parent && Node.isCallExpression(parent)) {
      // Case 1: regex passed as an argument to a string method
      const callee = parent.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        const method = callee.getName();
        if (method === 'replace' || method === 'replaceAll' || method === 'match' || method === 'matchAll') {
          isHotUse = true;
        }
      }
    } else if (parent && Node.isPropertyAccessExpression(parent)) {
      // Case 2: literal is the receiver of a regex method (`/x/.test(s)`, `/x/.exec(s)`)
      const grand: Node | undefined = parent.getParent();
      if (grand && Node.isCallExpression(grand)) {
        const method = parent.getName();
        if (method === 'test' || method === 'exec') isHotUse = true;
      }
    } else if (parent && Node.isJsxExpression(parent)) {
      const grand: Node | undefined = parent.getParent();
      if (grand && Node.isJsxAttribute(grand)) isHotUse = true;
    }
    if (!isHotUse) continue;

    findings.push(
      finding(
        'regex-literal-in-render',
        'info',
        'pattern',
        'RegExp literal sits in the render path — it is recompiled every render and gets a new identity, defeating memoized children that receive it as a prop',
        ctx.filePath,
        re.getStartLineNumber(),
        1,
        {
          suggestion:
            'Hoist the regex literal to module scope (or wrap in useMemo with stable deps) so it is constructed once and shared across renders',
        },
      ),
    );
  }

  return findings;
}

// ── Exported perf rules ──────────────────────────────────────────────────

export const perfRules = [
  imageNoLazy,
  heavyComputationInRender,
  largeListNoVirtualization,
  nondeterministicInRender,
  regexLiteralInRender,
];
