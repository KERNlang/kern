/**
 * React review rules — active when target = nextjs | tailwind | web | native.
 *
 * Catches React-specific bugs that KERN IR + AST can detect mechanically.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ProvenanceChain, ReviewFinding, RuleContext } from '../types.js';
import {
  cleanupExpressionMatches,
  escapeRegex,
  findAssignedIdentifier,
  finding,
  getTopLevelCleanupExpressions,
  nodeSpan,
  shouldSkipHookRules,
} from './utils.js';

/**
 * Wrap a hook-specific rule so it short-circuits on server/api/middleware
 * files — unless the file still has React content (JSX / react import /
 * hook call), which means the boundary classifier is wrong for this file
 * (common on `/routes/` and `/controllers/` React components).
 */
function clientOnly<T extends (ctx: RuleContext) => ReviewFinding[]>(fn: T): T {
  return ((ctx: RuleContext) => (shouldSkipHookRules(ctx) ? [] : fn(ctx))) as T;
}

/**
 * Check if a file is actually a React file — has JSX syntax or React imports.
 * Backend/utility files in a React-targeted project should not trigger React rules.
 */
function isReactFile(ctx: RuleContext): boolean {
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0) return true;
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0) return true;
  if (ctx.sourceFile.getImportDeclarations().some((i) => i.getModuleSpecifierValue() === 'react')) return true;
  const fullText = ctx.sourceFile.getFullText();
  if (/\buse(?:State|Effect|Ref|Callback|Memo|Reducer|Context)\s*[<(]/.test(fullText)) return true;
  return false;
}

function unwrapJsxExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function getMapCallbackRootJsx(
  callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
):
  | import('ts-morph').JsxElement
  | import('ts-morph').JsxSelfClosingElement
  | import('ts-morph').JsxFragment
  | undefined {
  const body = callback.getBody();
  if (Node.isBlock(body)) {
    const returnStmt = body.getStatements().find((stmt) => Node.isReturnStatement(stmt));
    const expr = returnStmt?.getExpression();
    if (!expr) return undefined;
    const unwrapped = unwrapJsxExpression(expr);
    if (Node.isJsxElement(unwrapped) || Node.isJsxSelfClosingElement(unwrapped) || Node.isJsxFragment(unwrapped)) {
      return unwrapped;
    }
    return undefined;
  }

  const unwrapped = unwrapJsxExpression(body);
  if (Node.isJsxElement(unwrapped) || Node.isJsxSelfClosingElement(unwrapped) || Node.isJsxFragment(unwrapped)) {
    return unwrapped;
  }
  return undefined;
}

function getMapCallbackReturnedExpression(
  callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
): Node | undefined {
  const body = callback.getBody();
  if (Node.isBlock(body)) {
    const returnStmt = body.getStatements().find((stmt) => Node.isReturnStatement(stmt));
    const expr = returnStmt?.getExpression();
    return expr ? unwrapJsxExpression(expr) : undefined;
  }
  return unwrapJsxExpression(body);
}

// ── Rule 11: async-effect ────────────────────────────────────────────────
// useEffect(async () => ...) — React doesn't support async effect callbacks

function asyncEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useEffect' && callee !== 'React.useEffect' && callee !== 'useLayoutEffect') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const callback = args[0];
    if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
      if (callback.isAsync()) {
        const provenance: ProvenanceChain = {
          summary: `${callee} callback is async — React ignores the returned Promise`,
          steps: [
            {
              kind: 'boundary',
              category: 'effect-schedule',
              location: nodeSpan(call, ctx.filePath),
              label: `${callee}(async () => …, …)`,
              detail: 'React expects the effect callback to either return nothing or a synchronous cleanup function.',
            },
            {
              kind: 'sink',
              category: 'render-cycle',
              location: nodeSpan(callback, ctx.filePath),
              label: 'async callback returns a Promise',
              detail:
                'React treats the returned Promise as the cleanup function — it is not callable, so cleanups silently never run.',
            },
          ],
        };

        findings.push(
          finding(
            'async-effect',
            'error',
            'bug',
            'useEffect callback must not be async — use an inner async function instead',
            ctx.filePath,
            callback.getStartLineNumber(),
            1,
            {
              suggestion: 'useEffect(() => { async function run() { ... } run(); }, [])',
              provenance,
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 12: render-side-effect ──────────────────────────────────────────
// setState or fetch called directly in render body (outside hooks/handlers)

function renderSideEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Gate: skip non-React files
  if (!isReactFile(ctx)) return findings;

  function checkBlock(block: import('ts-morph').Block, name: string): void {
    for (const stmt of block.getStatements()) {
      if (stmt.getKind() === SyntaxKind.ReturnStatement) continue;
      if (stmt.getKind() === SyntaxKind.VariableStatement) {
        const text = stmt.getText();
        if (/\buse[A-Z]/.test(text)) continue;
      }

      if (stmt.getKind() !== SyntaxKind.ExpressionStatement) continue;
      const exprStmt = stmt as import('ts-morph').ExpressionStatement;
      const exprText = exprStmt.getExpression().getText();

      if (/\b(useEffect|useLayoutEffect|useCallback|useMemo|useInsertionEffect)\s*\(/.test(exprText)) continue;

      if (
        /\bset[A-Z]\w*\(/.test(exprText) &&
        !exprText.includes('useState') &&
        !/\b(setTimeout|setInterval|setImmediate|setAttribute|setProperty|setHeader|setRequestHeader|setItem|setCustomValidity)\s*\(/.test(
          exprText,
        )
      ) {
        const provenance: ProvenanceChain = {
          summary: `setState call in '${name}' render body triggers an infinite re-render`,
          steps: [
            {
              kind: 'boundary',
              category: 'render-body',
              location: nodeSpan(block, ctx.filePath),
              label: `${name}() render body`,
              detail:
                'React calls the component body to compute JSX; any state update here runs during reconciliation.',
            },
            {
              kind: 'sink',
              category: 'render-cycle',
              location: nodeSpan(stmt, ctx.filePath),
              label: 'setState during render',
              detail:
                'Each setState schedules another render, which runs this same statement again — until React detects the loop and throws.',
            },
          ],
        };

        findings.push(
          finding(
            'render-side-effect',
            'error',
            'bug',
            `setState called in render body of '${name}' — move to useEffect or event handler`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
            { provenance },
          ),
        );
      }

      const expr = exprStmt.getExpression();
      if (Node.isCallExpression(expr) && expr.getExpression().getText() === 'fetch') {
        const provenance: ProvenanceChain = {
          summary: `fetch() in '${name}' render body fires on every render`,
          steps: [
            {
              kind: 'boundary',
              category: 'render-body',
              location: nodeSpan(block, ctx.filePath),
              label: `${name}() render body`,
              detail: 'Render bodies must be pure — side effects belong in useEffect or event handlers.',
            },
            {
              kind: 'sink',
              category: 'side-effect',
              location: nodeSpan(stmt, ctx.filePath),
              label: 'fetch() during render',
              detail:
                "Each render kicks off a new network request and never cancels it — the network tab fills with duplicates and the component can't be SSR-safe.",
            },
          ],
        };

        findings.push(
          finding(
            'render-side-effect',
            'error',
            'bug',
            `fetch() called in render body of '${name}' — move to useEffect or event handler`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
            { provenance },
          ),
        );
      }
    }
  }

  // Function declaration components
  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName() || '';
    if (!name || name[0] !== name[0].toUpperCase()) continue;
    const body = fn.getBody();
    if (!body || body.getKind() !== SyntaxKind.Block) continue;
    checkBlock(body as import('ts-morph').Block, name);
  }

  // Arrow function components: const App = () => { ... }
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!name || name[0] !== name[0].toUpperCase()) continue;
      const init = decl.getInitializer();
      if (!init) continue;
      if (init.getKind() !== SyntaxKind.ArrowFunction) continue;
      const arrow = init as import('ts-morph').ArrowFunction;
      const body = arrow.getBody();
      if (!body || body.getKind() !== SyntaxKind.Block) continue;
      checkBlock(body as import('ts-morph').Block, name);
    }
  }

  return findings;
}

// ── Rule 13: unstable-key ────────────────────────────────────────────────
// Missing key or key={index} in .map() JSX expressions

function mappedFragmentKey(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'map') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const callback = args[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const rootJsx = getMapCallbackRootJsx(callback);
    if (!rootJsx || !Node.isJsxFragment(rootJsx)) continue;

    findings.push(
      finding(
        'mapped-fragment-key',
        'warning',
        'bug',
        'JSX fragment returned from .map() cannot carry a key — use <Fragment key={...}> or a keyed element',
        ctx.filePath,
        rootJsx.getStartLineNumber(),
        1,
        { suggestion: 'Replace <>...</> with <Fragment key={item.id}>...</Fragment> or wrap in a keyed element' },
      ),
    );
  }

  return findings;
}

function unstableKey(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // AST-based: walk CallExpressions where callee is .map()
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

    const propAccess = callee as import('ts-morph').PropertyAccessExpression;
    if (propAccess.getName() !== 'map') continue;

    // Get first argument — should be ArrowFunction or FunctionExpression
    const args = call.getArguments();
    if (args.length === 0) continue;
    const callback = args[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    // Get the index parameter (second param of the callback)
    const params =
      callback.getKind() === SyntaxKind.ArrowFunction
        ? (callback as import('ts-morph').ArrowFunction).getParameters()
        : (callback as import('ts-morph').FunctionExpression).getParameters();
    const indexParam = params.length >= 2 ? params[1].getName() : null;

    const line = call.getStartLineNumber();
    const rootJsx = getMapCallbackRootJsx(callback);
    if (!rootJsx) {
      const returned = getMapCallbackReturnedExpression(callback);
      const createElementKey = returned ? getCreateElementKeyStatus(returned, indexParam) : undefined;
      if (!createElementKey) continue; // No JSX/createElement root → skip (fixes non-React .map() FP)

      if (createElementKey.usesIndexKey) {
        findings.push(
          finding(
            'unstable-key',
            'warning',
            'bug',
            `key={${indexParam}} uses array index — use a stable identifier instead`,
            ctx.filePath,
            line,
            1,
            {
              suggestion: 'Use a unique ID from the data (e.g., key={item.id})',
              provenance: {
                summary: `key={${indexParam}} ties identity to array position — reordering shuffles state`,
                steps: [
                  {
                    kind: 'boundary',
                    category: 'list-render',
                    location: nodeSpan(call, ctx.filePath),
                    label: `.map((…, ${indexParam}) => createElement(…))`,
                    detail: 'React uses the key to match items across renders and decide who to remount.',
                  },
                  {
                    kind: 'sink',
                    category: 'key-collision',
                    location: nodeSpan(call, ctx.filePath),
                    label: `key={${indexParam}}`,
                    detail:
                      'Using the array index means every position keeps the same key even after reordering, insertion, or deletion — React keeps the wrong DOM nodes and the wrong state with the wrong items.',
                  },
                ],
              },
            },
          ),
        );
      } else if (!createElementKey.hasKey) {
        findings.push(
          finding(
            'unstable-key',
            'warning',
            'bug',
            'React.createElement in .map() is missing a key prop',
            ctx.filePath,
            line,
            1,
            {
              suggestion: 'Add key: item.id to the props object passed to React.createElement',
              provenance: {
                summary: '.map() returns createElement(…) with no key — every item is a new mount',
                steps: [
                  {
                    kind: 'boundary',
                    category: 'list-render',
                    location: nodeSpan(call, ctx.filePath),
                    label: '.map(item => createElement(…))',
                    detail: 'React requires a key to track sibling identity across renders.',
                  },
                  {
                    kind: 'sink',
                    category: 'key-collision',
                    location: nodeSpan(call, ctx.filePath),
                    label: 'no key prop',
                    detail:
                      'Without keys, React falls back to positional matching and emits a console warning; sibling state and refs cannot be preserved across reorders.',
                  },
                ],
              },
            },
          ),
        );
      }
      continue;
    }
    if (Node.isJsxFragment(rootJsx)) continue; // handled by mapped-fragment-key

    // Get attributes from the first JSX element
    const attributes =
      rootJsx.getKind() === SyntaxKind.JsxSelfClosingElement
        ? (rootJsx as import('ts-morph').JsxSelfClosingElement).getAttributes()
        : (rootJsx as import('ts-morph').JsxElement).getOpeningElement().getAttributes();

    let hasKey = false;
    let usesIndexKey = false;

    for (const attr of attributes) {
      if (attr.getKind() !== SyntaxKind.JsxAttribute) continue;
      const jsxAttr = attr as import('ts-morph').JsxAttribute;
      if (jsxAttr.getNameNode().getText() !== 'key') continue;
      hasKey = true;

      // Check if key={indexVar}
      if (indexParam) {
        const init = jsxAttr.getInitializer();
        if (init && init.getKind() === SyntaxKind.JsxExpression) {
          const exprText = (init as import('ts-morph').JsxExpression).getExpression()?.getText();
          if (exprText === indexParam) {
            usesIndexKey = true;
          }
        }
      }
      break;
    }

    if (usesIndexKey) {
      findings.push(
        finding(
          'unstable-key',
          'warning',
          'bug',
          `key={${indexParam}} uses array index — use a stable identifier instead`,
          ctx.filePath,
          line,
          1,
          {
            suggestion: 'Use a unique ID from the data (e.g., key={item.id})',
            provenance: {
              summary: `key={${indexParam}} ties identity to array position — reordering shuffles state`,
              steps: [
                {
                  kind: 'boundary',
                  category: 'list-render',
                  location: nodeSpan(call, ctx.filePath),
                  label: `.map((…, ${indexParam}) => <… key={${indexParam}}/>)`,
                  detail: 'React uses the key to match items across renders and decide who to remount.',
                },
                {
                  kind: 'sink',
                  category: 'key-collision',
                  location: nodeSpan(rootJsx, ctx.filePath),
                  label: `key={${indexParam}}`,
                  detail:
                    'Using the array index means every position keeps the same key even after reordering, insertion, or deletion — React keeps the wrong DOM nodes and the wrong state with the wrong items.',
                },
              ],
            },
          },
        ),
      );
    } else if (!hasKey) {
      findings.push(
        finding('unstable-key', 'warning', 'bug', 'JSX in .map() is missing a key prop', ctx.filePath, line, 1, {
          suggestion: 'Add key={item.id} to the root JSX element in .map()',
          provenance: {
            summary: '.map() emits JSX with no key — every item is a new mount',
            steps: [
              {
                kind: 'boundary',
                category: 'list-render',
                location: nodeSpan(call, ctx.filePath),
                label: '.map(item => <…/>)',
                detail: 'React requires a key to track sibling identity across renders.',
              },
              {
                kind: 'sink',
                category: 'key-collision',
                location: nodeSpan(rootJsx, ctx.filePath),
                label: 'no key prop',
                detail:
                  'Without keys, React falls back to positional matching and emits a console warning; sibling state and refs cannot be preserved across reorders.',
              },
            ],
          },
        }),
      );
    }
  }

  return findings;
}

function getCreateElementKeyStatus(
  expr: Node,
  indexParam: string | null,
): { hasKey: boolean; usesIndexKey: boolean } | undefined {
  if (!Node.isCallExpression(expr)) return undefined;
  const callee = expr.getExpression().getText();
  if (callee !== 'React.createElement' && callee !== 'createElement') return undefined;

  const propsArg = expr.getArguments()[1];
  if (!propsArg || propsArg.getKind() === SyntaxKind.NullKeyword) {
    return { hasKey: false, usesIndexKey: false };
  }
  if (!Node.isObjectLiteralExpression(propsArg)) return undefined;

  for (const prop of propsArg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop
      .getNameNode()
      .getText()
      .replace(/^['"]|['"]$/g, '');
    if (name !== 'key') continue;
    const initializer = prop.getInitializer();
    return {
      hasKey: true,
      usesIndexKey: indexParam !== null && initializer?.getText() === indexParam,
    };
  }

  return { hasKey: false, usesIndexKey: false };
}

// ── Rule 14: stale-closure ───────────────────────────────────────────────
// Timer captures state not in dependency array

function staleClosure(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useEffect' && callee !== 'useLayoutEffect') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    const callback = args[0];
    const depsArg = args[1];
    if (!Node.isArrayLiteralExpression(depsArg)) continue;
    if (depsArg.getElements().length !== 0) continue;

    // Pure AST: find setInterval/setTimeout calls inside the callback
    const timers = callback.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      const name = c.getExpression().getText();
      return name === 'setInterval' || name === 'setTimeout';
    });

    if (timers.length > 0) {
      const firstTimer = timers[0];
      const timerName = firstTimer.getExpression().getText();
      const provenance: ProvenanceChain = {
        summary: `${callee} captures values that never refresh while the timer is alive`,
        steps: [
          {
            kind: 'boundary',
            category: 'hook-dep',
            location: nodeSpan(depsArg, ctx.filePath),
            label: 'empty dependency array []',
            detail: `${callee} runs only on mount and tears down on unmount; the closure formed here is frozen against the initial render.`,
          },
          {
            kind: 'call',
            category: 'closure-capture',
            location: nodeSpan(firstTimer, ctx.filePath),
            label: `${timerName}(…)`,
            detail: `Timer callback captures variables from the surrounding render scope by closure; those bindings will not update when state changes.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(firstTimer, ctx.filePath),
            label: 'stale read on every tick',
            detail: `Each tick reads the value captured at mount, not the latest one — the timer effectively operates on frozen state.`,
          },
        ],
      };

      findings.push(
        finding(
          'stale-closure',
          'warning',
          'bug',
          'Timer in useEffect with empty deps [] may capture stale state',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion: 'Use a ref for the latest value or add dependencies',
            provenance,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 15: state-explosion ─────────────────────────────────────────────
// >5 useState calls in a single component — should be useReducer or machine

function stateExplosion(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  function checkFn(
    fn:
      | import('ts-morph').FunctionDeclaration
      | import('ts-morph').ArrowFunction
      | import('ts-morph').FunctionExpression,
    name: string,
  ): void {
    const useStates = fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      const text = c.getExpression().getText();
      return text === 'useState' || text === 'React.useState';
    });

    if (useStates.length > 5) {
      const provenance: ProvenanceChain = {
        summary: `'${name}' carries ${useStates.length} useState calls — state has outgrown ad-hoc hooks`,
        steps: [
          {
            kind: 'source',
            category: 'state-decl',
            location: nodeSpan(useStates[0], ctx.filePath),
            label: `first of ${useStates.length} useState calls`,
            detail: 'Many independent useState calls create implicit, undocumented state transitions between hooks.',
          },
          {
            kind: 'boundary',
            category: 'render-body',
            location: nodeSpan(fn, ctx.filePath),
            label: `${name}() body holds ${useStates.length} useState slots`,
            detail:
              'Each render allocates and compares N independent hook slots; updates to one slot trigger a re-render that reads all of them.',
          },
          {
            kind: 'sink',
            category: 'complexity',
            location: nodeSpan(fn, ctx.filePath),
            label: `${useStates.length} > 5 hook-slot threshold`,
            detail:
              'Beyond ~5 useState slots, the component effectively encodes a state machine without naming the transitions — useReducer or a KERN machine makes the legal moves explicit.',
          },
        ],
      };

      findings.push(
        finding(
          'state-explosion',
          'warning',
          'pattern',
          `Component '${name}' has ${useStates.length} useState calls — consider useReducer or a state machine`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          {
            suggestion: 'Use useReducer for complex state, or a KERN machine node for state transitions',
            provenance,
          },
        ),
      );
    }
  }

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName() || '';
    if (!name || name[0] !== name[0].toUpperCase()) continue;
    checkFn(fn, name);
  }

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!name || name[0] !== name[0].toUpperCase()) continue;
      const init = decl.getInitializer();
      if (init && Node.isArrowFunction(init)) {
        checkFn(init, name);
      }
    }
  }

  return findings;
}

// ── Rule 16: hook-order ──────────────────────────────────────────────────
// Conditional hook calls (hooks inside if/loop/early return)

const HOOK_NAMES = new Set([
  'useState',
  'useEffect',
  'useCallback',
  'useMemo',
  'useRef',
  'useContext',
  'useReducer',
  'useLayoutEffect',
  'useImperativeHandle',
  'useDebugValue',
  'useDeferredValue',
  'useTransition',
  'useId',
  'useSyncExternalStore',
  'useInsertionEffect',
]);

function hookOrder(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Collect all control-flow nodes (if/for/while/do)
  const controlFlowNodes = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ForStatement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ForInStatement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.DoStatement),
  ];

  for (const cfNode of controlFlowNodes) {
    // Only flag hooks inside components (capitalized) or custom hooks (use*)
    const enclosingFn =
      cfNode.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
      cfNode.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
      cfNode.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
    if (!enclosingFn) continue;
    const fnName = (enclosingFn as any).getName?.() || '';
    // Skip if not a component (capitalized) or custom hook (use*)
    if (fnName && fnName[0] !== fnName[0].toUpperCase() && !/^use[A-Z]/.test(fnName)) continue;

    const isConditional = cfNode.getKind() === SyntaxKind.IfStatement;
    const label = isConditional ? 'conditional' : 'loop';

    const reported = new Set<string>();
    for (const callExpr of cfNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = callExpr.getExpression();
      if (callee.getKind() !== SyntaxKind.Identifier) continue;
      const hookName = callee.getText();
      if (!HOOK_NAMES.has(hookName)) continue;
      if (reported.has(hookName)) continue;
      reported.add(hookName);

      const provenance: ProvenanceChain = {
        summary: `Hook '${hookName}' inside ${label} — Rules of Hooks violation`,
        steps: [
          {
            kind: 'boundary',
            category: 'control-flow',
            location: nodeSpan(cfNode, ctx.filePath),
            label: `${label} surrounding hook call`,
            detail: `React tracks hook order by call index — a ${label} that skips or repeats the call shifts every later hook's slot and produces corrupted state.`,
          },
          {
            kind: 'sink',
            category: 'hook-call',
            location: nodeSpan(callExpr, ctx.filePath),
            label: `${hookName}(…)`,
            detail: `${hookName} must be called unconditionally at the top level of ${fnName || 'this component or custom hook'} on every render.`,
          },
        ],
      };

      findings.push(
        finding(
          'hook-order',
          'error',
          'bug',
          `Hook '${hookName}' called inside ${label} — violates Rules of Hooks`,
          ctx.filePath,
          cfNode.getStartLineNumber(),
          1,
          {
            suggestion: 'Move hook call to top level of component',
            provenance,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: effect-self-update-loop ────────────────────────────────────────
// useEffect that updates a state variable listed in its own dependency array

function effectSelfUpdateLoop(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const findings: ReviewFinding[] = [];
  const setterToState = new Map<string, string>();

  // Collect useState setter→state mappings: const [count, setCount] = useState(0)
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    const init = decl.getInitializer();
    if (!Node.isArrayBindingPattern(nameNode) || !init || !Node.isCallExpression(init)) continue;
    const calleeText = init.getExpression().getText();
    if (calleeText !== 'useState' && calleeText !== 'React.useState') continue;
    const elements = nameNode.getElements();
    if (elements.length < 2 || !Node.isBindingElement(elements[0]) || !Node.isBindingElement(elements[1])) continue;
    setterToState.set(elements[1].getName(), elements[0].getName());
  }

  if (setterToState.size === 0) return findings;

  // Find useEffect calls and check for self-update loops
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (calleeText !== 'useEffect' && calleeText !== 'React.useEffect') continue;

    const [callbackArg, depsArg] = call.getArguments();
    if (!callbackArg || !depsArg) continue;
    if (!Node.isArrowFunction(callbackArg) && !Node.isFunctionExpression(callbackArg)) continue;
    if (!Node.isArrayLiteralExpression(depsArg)) continue;

    const deps = new Set(depsArg.getElements().map((el) => el.getText()));

    // Find setter calls in the effect body
    for (const innerCall of callbackArg.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = innerCall.getExpression();
      if (!Node.isIdentifier(expr)) continue;
      const setterName = expr.getText();
      const stateName = setterToState.get(setterName);
      if (!stateName || !deps.has(stateName)) continue;

      // Skip if inside a nested function (event handler, cleanup, etc.)
      let isNested = false;
      let cur = innerCall.getParent();
      while (cur && cur !== callbackArg) {
        if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
          isNested = true;
          break;
        }
        cur = cur.getParent();
      }
      if (isNested) continue;

      const provenance: ProvenanceChain = {
        summary: `useEffect writes '${stateName}' while depending on '${stateName}' — infinite loop`,
        steps: [
          {
            kind: 'boundary',
            category: 'hook-dep',
            location: nodeSpan(depsArg, ctx.filePath),
            label: `deps: […, ${stateName}, …]`,
            detail: `Effect re-runs whenever '${stateName}' changes.`,
          },
          {
            kind: 'call',
            category: 'state-write',
            location: nodeSpan(innerCall, ctx.filePath),
            label: `${setterName}(…)`,
            detail: `Effect body writes '${stateName}', producing a new value for the very dep it watches.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(call, ctx.filePath),
            label: 'infinite re-render loop',
            detail: `setState → new '${stateName}' → effect re-runs → setState → … React will eventually bail with "Maximum update depth exceeded".`,
          },
        ],
      };

      findings.push(
        finding(
          'effect-self-update-loop',
          'error',
          'bug',
          `useEffect updates '${stateName}' via ${setterName}() while '${stateName}' is in deps — infinite re-render loop`,
          ctx.filePath,
          innerCall.getStartLineNumber(),
          1,
          {
            suggestion: `Move the write behind a guard or use a ref to break the cycle`,
            provenance,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: missing-effect-cleanup ─────────────────────────────────────────
// useEffect with setInterval/addEventListener but no cleanup return function

function missingEffectCleanup(ctx: RuleContext): ReviewFinding[] {
  interface EffectLeakSpec {
    label: string;
    line: number;
    cleanupPatterns: RegExp[];
    cleanupReturnIdentifiers?: string[];
    cleanupReturnCallPattern?: RegExp;
  }

  const buildEffectLeakSpecs = (
    callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
  ): EffectLeakSpec[] => {
    const specs: EffectLeakSpec[] = [];

    for (const desc of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = desc.getExpression();

      if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        const assignedName = findAssignedIdentifier(desc);
        if (name === 'setInterval' || name === 'setTimeout') {
          const clearName = name === 'setInterval' ? 'clearInterval' : 'clearTimeout';
          specs.push({
            label: name,
            line: desc.getStartLineNumber(),
            cleanupPatterns: assignedName
              ? [new RegExp(`\\b${clearName}\\s*\\(\\s*${escapeRegex(assignedName)}\\s*\\)`)]
              : [new RegExp(`\\b${clearName}\\s*\\(`)],
          });
        }
        continue;
      }

      if (!Node.isPropertyAccessExpression(callee)) continue;

      const method = callee.getName();
      const targetText = callee.getExpression().getText();
      const assignedName = findAssignedIdentifier(desc);

      if (method === 'addEventListener') {
        specs.push({
          label: 'addEventListener',
          line: desc.getStartLineNumber(),
          cleanupPatterns: [new RegExp(`${escapeRegex(targetText)}\\s*\\.\\s*removeEventListener\\s*\\(`)],
        });
        continue;
      }

      if (method === 'on') {
        specs.push({
          label: 'on',
          line: desc.getStartLineNumber(),
          cleanupPatterns: assignedName
            ? [
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\(`),
                new RegExp(
                  `\\b${escapeRegex(assignedName)}\\s*\\.\\s*(?:unsubscribe|dispose|destroy|off|removeListener)\\s*\\(`,
                ),
                new RegExp(`${escapeRegex(targetText)}\\s*\\.\\s*(?:off|removeListener|unsubscribe)\\s*\\(`),
              ]
            : [/\.\s*(?:off|removeListener|unsubscribe|dispose|destroy)\s*\(/],
          cleanupReturnIdentifiers: assignedName ? [assignedName] : [],
          cleanupReturnCallPattern: /\.\s*on\s*\(/,
        });
        continue;
      }

      if (method === 'subscribe') {
        specs.push({
          label: 'subscribe',
          line: desc.getStartLineNumber(),
          cleanupPatterns: assignedName
            ? [
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\(`),
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\.\\s*(?:unsubscribe|dispose|destroy|off)\\s*\\(`),
              ]
            : [/\.\s*(?:unsubscribe|dispose|destroy|off)\s*\(/],
          cleanupReturnIdentifiers: assignedName ? [assignedName] : [],
          cleanupReturnCallPattern: /\.\s*subscribe\s*\(/,
        });
      }
    }

    return specs;
  };

  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useEffect' && callee !== 'useLayoutEffect') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const callback = args[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const leakSpecs = buildEffectLeakSpecs(callback).filter(
      (spec, index, specs) =>
        specs.findIndex((candidate) => candidate.label === spec.label && candidate.line === spec.line) === index,
    );
    if (leakSpecs.length === 0) continue;

    const cleanupExprs = getTopLevelCleanupExpressions(callback.getBody());
    const leakedSpec = leakSpecs.find((spec) => !cleanupExprs.some((expr) => cleanupExpressionMatches(expr, spec)));

    if (leakedSpec) {
      const provenance: ProvenanceChain = {
        summary: `useEffect leaks '${leakedSpec.label}' on unmount`,
        steps: [
          {
            kind: 'boundary',
            category: 'effect-schedule',
            location: nodeSpan(call, ctx.filePath),
            label: `${callee}(…)`,
            detail: 'React invokes the returned cleanup function on unmount and before each effect re-run.',
          },
          {
            kind: 'call',
            category: 'subscription',
            location: {
              file: ctx.filePath,
              startLine: leakedSpec.line,
              startCol: 1,
              endLine: leakedSpec.line,
              endCol: 1,
            },
            label: leakedSpec.label,
            detail: `Effect creates a '${leakedSpec.label}' subscription / timer / listener that needs an explicit teardown.`,
          },
          {
            kind: 'sink',
            category: 'leak',
            location: nodeSpan(callback, ctx.filePath),
            label: 'no return () => …',
            detail: 'Without a cleanup, the resource lives past unmount and re-mount accumulates duplicates.',
          },
        ],
      };

      findings.push(
        finding(
          'missing-effect-cleanup',
          'warning',
          'bug',
          `useEffect uses '${leakedSpec.label}' but is missing matching cleanup`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion: 'Return a cleanup function: return () => clearInterval(id);',
            provenance,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: react-legacy-unsafe-lifecycle ─────────────────────────────────
// Legacy pre-commit lifecycles are unsafe under async/concurrent rendering.

const LEGACY_UNSAFE_LIFECYCLES = new Set([
  'componentWillMount',
  'componentWillReceiveProps',
  'componentWillUpdate',
  'UNSAFE_componentWillMount',
  'UNSAFE_componentWillReceiveProps',
  'UNSAFE_componentWillUpdate',
]);

function reactLegacyUnsafeLifecycle(ctx: RuleContext): ReviewFinding[] {
  if (!isReactFile(ctx)) return [];

  const findings: ReviewFinding[] = [];
  for (const cls of ctx.sourceFile.getClasses()) {
    const extendsText = cls.getExtends()?.getText() ?? '';
    const looksLikeReactClass = /(?:^|\.)(?:Pure)?Component(?:<|$)/.test(extendsText);
    if (!looksLikeReactClass) continue;

    for (const method of cls.getMethods()) {
      const name = method.getName();
      if (!LEGACY_UNSAFE_LIFECYCLES.has(name)) continue;

      findings.push(
        finding(
          'react-legacy-unsafe-lifecycle',
          'warning',
          'bug',
          `React class uses legacy lifecycle '${name}' — it is unsafe under async rendering and can run with stale props/state`,
          ctx.filePath,
          method.getNameNode().getStartLineNumber(),
          1,
          {
            suggestion:
              'Move side effects to componentDidMount/componentDidUpdate, or migrate derived state to getDerivedStateFromProps/useEffect.',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: inline-context-value ───────────────────────────────────────────
// <Context.Provider value={{...}}> causes re-renders on every parent render

function inlineContextValue(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const jsx of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    const name = jsx.getTagNameNode().getText();
    if (!name.endsWith('.Provider')) continue;

    for (const attr of jsx.getAttributes()) {
      if (!Node.isJsxAttribute(attr) || attr.getNameNode().getText() !== 'value') continue;
      const init = attr.getInitializer();
      if (!init || !Node.isJsxExpression(init)) continue;
      const expr = init.getExpression();
      if (!expr) continue;

      if (Node.isObjectLiteralExpression(expr) || Node.isArrayLiteralExpression(expr)) {
        const kind = Node.isObjectLiteralExpression(expr) ? 'object' : 'array';
        const provenance: ProvenanceChain = {
          summary: `<${name} value={${kind === 'object' ? '{…}' : '[…]'}}/> forces every consumer to re-render`,
          steps: [
            {
              kind: 'boundary',
              category: 'context-provider',
              location: nodeSpan(jsx, ctx.filePath),
              label: `<${name}>`,
              detail: 'Context.Provider broadcasts identity changes to every useContext consumer in the subtree.',
            },
            {
              kind: 'call',
              category: 'prop-pass',
              location: nodeSpan(expr, ctx.filePath),
              label: `inline ${kind} value`,
              detail: `Each parent render allocates a fresh ${kind} literal, giving the context value a new reference every time.`,
            },
            {
              kind: 'sink',
              category: 'render-cycle',
              location: nodeSpan(jsx, ctx.filePath),
              label: 'all consumers re-render',
              detail: 'React fires every useContext consumer with the new value, even if no actual data changed.',
            },
          ],
        };

        findings.push(
          finding(
            'inline-context-value',
            'warning',
            'pattern',
            'Inline object/array passed to Context.Provider value — causes all consumers to re-render',
            ctx.filePath,
            jsx.getStartLineNumber(),
            1,
            {
              suggestion: 'Memoize the value with useMemo',
              provenance,
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: ref-in-render ──────────────────────────────────────────────────
// Reading or writing ref.current during render — breaks React purity rules
// Source: react.dev/reference/react/useRef, eslint-plugin-react-hooks/refs

function refInRender(ctx: RuleContext): ReviewFinding[] {
  if (!isReactFile(ctx)) return [];
  const findings: ReviewFinding[] = [];

  // Collect useRef variable names AND their declaration nodes — the decl is
  // used as the provenance source step so the reader can jump to the line
  // where the ref was set up.
  const refVars = new Set<string>();
  const refDecls = new Map<string, import('ts-morph').VariableDeclaration>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression().getText();
    if (callee === 'useRef' || callee === 'React.useRef') {
      const name = decl.getName();
      refVars.add(name);
      if (!refDecls.has(name)) refDecls.set(name, decl);
    }
  }

  if (refVars.size === 0) return findings;

  // Identify safe scopes: useEffect/useLayoutEffect/useCallback/event handler callbacks
  const SAFE_CALLEE = new Set(['useEffect', 'useLayoutEffect', 'useCallback', 'useInsertionEffect']);

  function isInSafeScope(node: import('ts-morph').Node): boolean {
    let cur = node.getParent();
    while (cur) {
      // Inside a useEffect/useCallback callback
      if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && cur.getParent()) {
        const parent = cur.getParent();
        if (Node.isCallExpression(parent)) {
          const calleeName = parent.getExpression().getText();
          if (SAFE_CALLEE.has(calleeName)) return true;
        }
      }
      // Inside an event handler in JSX: onClick={() => ref.current = ...}
      if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && cur.getParent()) {
        const parent = cur.getParent();
        if (Node.isJsxExpression(parent)) return true;
      }
      // Inside a cleanup return function
      if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && cur.getParent()) {
        const parent = cur.getParent();
        if (Node.isReturnStatement(parent)) return true;
      }
      cur = cur.getParent();
    }
    return false;
  }

  function getNearestNestedFunctionScope(
    node: import('ts-morph').Node,
  ):
    | import('ts-morph').ArrowFunction
    | import('ts-morph').FunctionExpression
    | import('ts-morph').FunctionDeclaration
    | undefined {
    let cur = node.getParent();
    while (cur) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
        const outer = cur.getFirstAncestor(
          (ancestor) =>
            Node.isArrowFunction(ancestor) ||
            Node.isFunctionExpression(ancestor) ||
            Node.isFunctionDeclaration(ancestor),
        );
        return outer ? cur : undefined;
      }
      cur = cur.getParent();
    }
    return undefined;
  }

  function getEnclosingFunctionScope(
    node: import('ts-morph').Node,
  ):
    | import('ts-morph').ArrowFunction
    | import('ts-morph').FunctionExpression
    | import('ts-morph').FunctionDeclaration
    | undefined {
    let cur = node.getParent();
    while (cur) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
        return cur;
      }
      cur = cur.getParent();
    }
    return undefined;
  }

  function getFunctionBindingName(
    fn:
      | import('ts-morph').ArrowFunction
      | import('ts-morph').FunctionExpression
      | import('ts-morph').FunctionDeclaration,
  ): import('ts-morph').Identifier | undefined {
    if (Node.isFunctionDeclaration(fn)) {
      const nameNode = fn.getNameNode();
      return nameNode && Node.isIdentifier(nameNode) ? nameNode : undefined;
    }

    const parent = fn.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const nameNode = parent.getNameNode();
      return Node.isIdentifier(nameNode) ? nameNode : undefined;
    }

    return undefined;
  }

  function hasRenderTimeInvocation(
    fn:
      | import('ts-morph').ArrowFunction
      | import('ts-morph').FunctionExpression
      | import('ts-morph').FunctionDeclaration,
  ): boolean {
    const binding = getFunctionBindingName(fn);
    if (!binding) return true;

    const declarations = binding.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length === 0) return true;

    for (const candidate of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (candidate === binding) continue;
      if (candidate.getText() !== binding.getText()) continue;
      if (candidate.getStart() >= fn.getStart() && candidate.getEnd() <= fn.getEnd()) continue;

      const candidateDeclarations = candidate.getSymbol()?.getDeclarations() ?? [];
      if (!candidateDeclarations.some((decl) => declarations.includes(decl))) continue;

      const parent = candidate.getParent();
      const isDirectInvocation =
        (Node.isCallExpression(parent) && parent.getExpression() === candidate) ||
        (Node.isNewExpression(parent) && parent.getExpression() === candidate) ||
        (Node.isTaggedTemplateExpression(parent) && parent.getTag() === candidate);

      if (!isDirectInvocation) continue;
      if (isInSafeScope(candidate)) continue;
      return true;
    }

    return false;
  }

  function isGuardedLazyRefInitialization(prop: import('ts-morph').PropertyAccessExpression, refName: string): boolean {
    const ifAncestor = prop.getFirstAncestorByKind(SyntaxKind.IfStatement);
    if (!ifAncestor) return false;

    const condText = ifAncestor.getExpression().getText().replace(/\s+/g, '');
    const escapedRef = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\b${escapedRef}\\.current\\b.*(?:===|==|!==|!=).*(?:null|undefined)`),
      new RegExp(`(?:null|undefined).*(?:===|==|!==|!=).*\\b${escapedRef}\\.current\\b`),
      new RegExp(`!${escapedRef}\\.current\\b`),
      new RegExp(`\\b${escapedRef}\\.current\\.length===0\\b`),
      new RegExp(`\\b${escapedRef}\\.current\\.length==0\\b`),
      new RegExp(`!${escapedRef}\\.current\\.length\\b`),
    ];

    return patterns.some((pattern) => pattern.test(condText));
  }

  function scopeHasGuardedLazyInitializationReadAllowance(
    scope:
      | import('ts-morph').ArrowFunction
      | import('ts-morph').FunctionExpression
      | import('ts-morph').FunctionDeclaration,
    refName: string,
  ): boolean {
    const escapedRef = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const ifStmt of scope.getDescendantsOfKind(SyntaxKind.IfStatement)) {
      const condText = ifStmt.getExpression().getText().replace(/\s+/g, '');
      const guardPatterns = [
        new RegExp(`\\b${escapedRef}\\.current\\b.*(?:===|==|!==|!=).*(?:null|undefined)`),
        new RegExp(`(?:null|undefined).*(?:===|==|!==|!=).*\\b${escapedRef}\\.current\\b`),
        new RegExp(`!${escapedRef}\\.current\\b`),
        new RegExp(`\\b${escapedRef}\\.current\\.length===0\\b`),
        new RegExp(`\\b${escapedRef}\\.current\\.length==0\\b`),
        new RegExp(`!${escapedRef}\\.current\\.length\\b`),
      ];
      if (!guardPatterns.some((pattern) => pattern.test(condText))) continue;

      const writesInThen = ifStmt
        .getThenStatement()
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .some(
          (expr) =>
            expr.getLeft().getText() === `${refName}.current` &&
            expr.getOperatorToken().getKind() === SyntaxKind.EqualsToken,
        );
      if (writesInThen) return true;
    }

    return false;
  }

  // Find .current access on ref variables
  for (const prop of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (prop.getName() !== 'current') continue;
    const obj = prop.getExpression();
    if (!Node.isIdentifier(obj)) continue;
    if (!refVars.has(obj.getText())) continue;

    // Skip if inside safe scope (effect, handler, callback)
    if (isInSafeScope(prop)) continue;

    // Skip lazy initialization pattern: if (ref.current === null) ref.current = x
    // React explicitly allows this during render (react.dev/reference/react/useRef)
    if (isGuardedLazyRefInitialization(prop, obj.getText())) continue;

    // Writes inside nested local callbacks are not render-time unless the
    // callback is actually invoked during render.
    const nestedFunctionScope = getNearestNestedFunctionScope(prop);
    if (nestedFunctionScope && !hasRenderTimeInvocation(nestedFunctionScope)) continue;

    // Check if this is a read or write
    const parent = prop.getParent();
    const isWrite =
      parent &&
      Node.isBinaryExpression(parent) &&
      parent.getLeft() === prop &&
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken;

    if (!isWrite) {
      const enclosingScope = getEnclosingFunctionScope(prop);
      if (enclosingScope && scopeHasGuardedLazyInitializationReadAllowance(enclosingScope, obj.getText())) continue;
    }

    const action = isWrite ? 'written to' : 'read';
    const refName = obj.getText();
    const refDecl = refDecls.get(refName);
    const provenance: ProvenanceChain = {
      summary: `${refName}.current ${action} during render — refs do not track in React's render cycle`,
      steps: [
        {
          kind: 'source',
          category: 'ref-decl',
          location: nodeSpan(refDecl ?? prop, ctx.filePath),
          label: `const ${refName} = useRef(…)`,
          detail:
            'useRef produces a stable, mutable container that React intentionally does not observe — writes never trigger a re-render and reads can be stale.',
        },
        {
          kind: 'sink',
          category: 'render-cycle',
          location: nodeSpan(prop, ctx.filePath),
          label: `${refName}.current ${action} in render body`,
          detail: isWrite
            ? 'Writing to ref.current during render mutates the value seen by concurrent renders, breaking React 18 strict-mode and the rules of purity.'
            : 'Reading ref.current during render couples the JSX to mutable state React does not subscribe to — the UI silently lags behind the value.',
        },
      ],
    };

    findings.push(
      finding(
        'ref-in-render',
        'error',
        'bug',
        `ref.current ${action} during render — refs are not tracked by React and may be stale`,
        ctx.filePath,
        prop.getStartLineNumber(),
        1,
        {
          suggestion: isWrite
            ? 'Move ref writes to useEffect or event handlers'
            : 'Use useState instead if the value affects rendering',
          provenance,
        },
      ),
    );
  }

  return findings;
}

// ── Rule: missing-memo-deps ──────────────────────────────────────────────
// useMemo/useCallback called without dependency array — recomputes every render
// Source: react.dev/reference/react/useMemo, react.dev/reference/react/useCallback

const MEMO_HOOKS = new Set(['useMemo', 'useCallback', 'React.useMemo', 'React.useCallback']);

function missingMemoDeps(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (!MEMO_HOOKS.has(callee)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    // First arg should be the function, second should be deps array
    if (args.length < 2) {
      const hookName = callee.includes('.') ? callee.split('.')[1] : callee;
      const provenance: ProvenanceChain = {
        summary: `${hookName} called without a deps array — runs on every render`,
        steps: [
          {
            kind: 'boundary',
            category: 'memo-boundary',
            location: nodeSpan(call, ctx.filePath),
            label: `${hookName}(fn) — no deps array`,
            detail: `${hookName}'s second argument is required to tell React when to refresh the memoized value.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(call, ctx.filePath),
            label: 'recomputes every render',
            detail:
              'Without a deps array, React treats every render as a cache miss — the wrapped function runs each time and any consumer relying on stable identity sees a new reference.',
          },
        ],
      };

      findings.push(
        finding(
          'missing-memo-deps',
          'warning',
          'bug',
          `${hookName} called without dependency array — will recompute on every render, defeating memoization`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion: `Add a dependency array as the second argument: ${hookName}(fn, [dep1, dep2])`,
            provenance,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: reducer-mutation ──────────────────────────────────────────────
// Direct state mutation inside useReducer reducer function
// Source: react.dev/reference/react/useReducer

function reducerMutation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Find useReducer calls and get the reducer function
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useReducer' && callee !== 'React.useReducer') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const reducer = args[0];

    // Reducer can be inline or a reference — handle both
    let reducerBody: import('ts-morph').Node | undefined;
    let stateParam: string | undefined;

    if (Node.isArrowFunction(reducer) || Node.isFunctionExpression(reducer)) {
      reducerBody = reducer.getBody();
      const params = reducer.getParameters();
      if (params.length > 0) stateParam = params[0].getName();
    } else if (Node.isIdentifier(reducer)) {
      const name = reducer.getText();
      const fn = ctx.sourceFile.getFunction(name);
      if (fn) {
        reducerBody = fn.getBody();
        const params = fn.getParameters();
        if (params.length > 0) stateParam = params[0].getName();
      }
    }

    if (!reducerBody || !stateParam) continue;

    // Look for direct mutations: state.prop = ..., state.prop++, state.push(...)
    const mutationMethods = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse']);

    // Shared chain shape across all four mutation patterns in this rule:
    // boundary[reducer] (the reducer body React subscribes to) → sink[mutation]
    // (the actual write). Re-built per finding so the sink span is accurate.
    const buildReducerProvenance = (
      sinkNode: import('ts-morph').Node,
      sinkLabel: string,
      sinkDetail: string,
    ): ProvenanceChain => ({
      summary: `reducer mutates '${stateParam}' in place — React keeps the previous state`,
      steps: [
        {
          kind: 'boundary',
          category: 'reducer',
          location: nodeSpan(reducerBody, ctx.filePath),
          label: `reducer(${stateParam}, action)`,
          detail:
            'useReducer treats the reducer as pure: it compares the returned reference against the previous state to decide whether to re-render.',
        },
        {
          kind: 'sink',
          category: 'mutation',
          location: nodeSpan(sinkNode, ctx.filePath),
          label: sinkLabel,
          detail: sinkDetail,
        },
      ],
    });

    for (const bin of reducerBody.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const op = bin.getOperatorToken().getKind();
      if (op !== SyntaxKind.EqualsToken && op !== SyntaxKind.PlusEqualsToken && op !== SyntaxKind.MinusEqualsToken)
        continue;

      const left = bin.getLeft();
      if (!Node.isPropertyAccessExpression(left)) continue;
      const root = left.getExpression();
      if (Node.isIdentifier(root) && root.getText() === stateParam) {
        findings.push(
          finding(
            'reducer-mutation',
            'error',
            'bug',
            `Reducer mutates '${stateParam}.${left.getName()}' directly — return a new object instead`,
            ctx.filePath,
            bin.getStartLineNumber(),
            1,
            {
              suggestion: `return { ...${stateParam}, ${left.getName()}: newValue }`,
              provenance: buildReducerProvenance(
                bin,
                `${stateParam}.${left.getName()} = …`,
                'Assigning to a field of the previous state object never produces a new reference — useReducer sees the same identity and skips the re-render.',
              ),
            },
          ),
        );
        break; // One finding per reducer
      }
    }

    // Check for state.method() mutations
    for (const methodCall of reducerBody.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = methodCall.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      if (!mutationMethods.has(expr.getName())) continue;
      const obj = expr.getExpression();
      // state.push() or state.items.push()
      if (Node.isIdentifier(obj) && obj.getText() === stateParam) {
        findings.push(
          finding(
            'reducer-mutation',
            'error',
            'bug',
            `Reducer mutates '${stateParam}' via .${expr.getName()}() — return a new object instead`,
            ctx.filePath,
            methodCall.getStartLineNumber(),
            1,
            {
              suggestion: `Return new state: return { ...${stateParam}, ... }`,
              provenance: buildReducerProvenance(
                methodCall,
                `${stateParam}.${expr.getName()}(…)`,
                `Array methods like .${expr.getName()}() mutate in place — the reducer returns the same reference React already has, so the dispatch is a no-op for re-render.`,
              ),
            },
          ),
        );
        break;
      }
      if (Node.isPropertyAccessExpression(obj)) {
        const root = obj.getExpression();
        if (Node.isIdentifier(root) && root.getText() === stateParam) {
          findings.push(
            finding(
              'reducer-mutation',
              'error',
              'bug',
              `Reducer mutates '${stateParam}.${obj.getName()}' via .${expr.getName()}() — use immutable update`,
              ctx.filePath,
              methodCall.getStartLineNumber(),
              1,
              {
                suggestion: `return { ...${stateParam}, ${obj.getName()}: [...${stateParam}.${obj.getName()}, newItem] }`,
                provenance: buildReducerProvenance(
                  methodCall,
                  `${stateParam}.${obj.getName()}.${expr.getName()}(…)`,
                  `Mutating a nested collection in place keeps both the inner array and the outer state with their original identities — React sees neither as changed.`,
                ),
              },
            ),
          );
          break;
        }
      }
    }

    // Check for state.prop++ / ++state.prop
    for (const postfix of reducerBody.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression)) {
      const operand = postfix.getOperand();
      if (!Node.isPropertyAccessExpression(operand)) continue;
      const root = operand.getExpression();
      if (Node.isIdentifier(root) && root.getText() === stateParam) {
        findings.push(
          finding(
            'reducer-mutation',
            'error',
            'bug',
            `Reducer mutates '${stateParam}.${operand.getName()}' via ++ — return a new object instead`,
            ctx.filePath,
            postfix.getStartLineNumber(),
            1,
            {
              suggestion: `return { ...${stateParam}, ${operand.getName()}: ${stateParam}.${operand.getName()} + 1 }`,
              provenance: buildReducerProvenance(
                postfix,
                `${stateParam}.${operand.getName()}++`,
                'In-place increment writes to the existing state object — the reducer returns the same reference, so React keeps the stale render.',
              ),
            },
          ),
        );
        break;
      }
    }
  }

  return findings;
}

// ── Rule: effect-cleanup-called-immediately ─────────────────────────────
// `useEffect(() => clearTimeout(id))` calls the cleanup during effect setup.
// React expects a cleanup function: `useEffect(() => () => clearTimeout(id))`.

const EFFECT_CLEANUP_CALLS = new Set(['clearTimeout', 'clearInterval', 'cancelAnimationFrame', 'cancelIdleCallback']);
const EFFECT_CLEANUP_METHODS = new Set([
  'removeEventListener',
  'off',
  'removeListener',
  'unsubscribe',
  'dispose',
  'destroy',
  'disconnect',
  'close',
]);

function isCleanupCallExpression(node: Node | undefined): node is import('ts-morph').CallExpression {
  if (!node || !Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (Node.isIdentifier(callee)) return EFFECT_CLEANUP_CALLS.has(callee.getText());
  if (Node.isPropertyAccessExpression(callee)) return EFFECT_CLEANUP_METHODS.has(callee.getName());
  return false;
}

function getImmediatelyReturnedCleanupCall(
  callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
): import('ts-morph').CallExpression | undefined {
  const body = callback.getBody();
  if (isCleanupCallExpression(body)) return body;
  if (!Node.isBlock(body)) return undefined;

  const statements = body.getStatements();
  if (statements.length !== 1 || !Node.isReturnStatement(statements[0])) return undefined;
  const returned = statements[0].getExpression();
  return isCleanupCallExpression(returned) ? returned : undefined;
}

function effectCleanupCalledImmediately(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeName = call.getExpression().getText().split('.').pop();
    if (calleeName !== 'useEffect' && calleeName !== 'useLayoutEffect' && calleeName !== 'useInsertionEffect') continue;

    const callback = call.getArguments()[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const cleanupCall = getImmediatelyReturnedCleanupCall(callback);
    if (!cleanupCall) continue;

    findings.push(
      finding(
        'effect-cleanup-called-immediately',
        'error',
        'bug',
        `${calleeName} returns the result of '${cleanupCall.getExpression().getText()}(...)' instead of a cleanup function — cleanup runs during setup`,
        ctx.filePath,
        cleanupCall.getStartLineNumber(),
        1,
        { suggestion: `Return a function: ${calleeName}(() => () => ${cleanupCall.getText()}, deps)` },
      ),
    );
  }

  return findings;
}

function isReactClass(cls: import('ts-morph').ClassDeclaration): boolean {
  const extendsText = cls.getExtends()?.getText() ?? '';
  return /(?:^|\.)(?:Pure)?Component(?:<|$)/.test(extendsText);
}

function isLifecycleOrRenderMethod(name: string): boolean {
  return /^(?:constructor|componentDidMount|componentDidUpdate|UNSAFE_componentWillMount|componentWillMount|render)$/.test(
    name,
  );
}

function getThisPropertyAssignmentToCall(
  call: import('ts-morph').CallExpression,
): { propText: string; assignment: import('ts-morph').BinaryExpression } | undefined {
  const parent = call.getParent();
  if (!parent || !Node.isBinaryExpression(parent)) return undefined;
  if (parent.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return undefined;
  if (parent.getRight() !== call) return undefined;
  const left = parent.getLeft();
  if (!Node.isPropertyAccessExpression(left)) return undefined;
  if (left.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return { propText: left.getText(), assignment: parent };
}

function unmountCleansTimer(
  cls: import('ts-morph').ClassDeclaration,
  unmount: import('ts-morph').MethodDeclaration | undefined,
  clearName: string,
  propText: string,
): boolean {
  if (!unmount) return false;
  const cleanupPattern = new RegExp(`\\b${escapeRegex(clearName)}\\s*\\(\\s*${escapeRegex(propText)}\\s*\\)`);
  const windowCleanupPattern = new RegExp(
    `\\bwindow\\s*\\.\\s*${escapeRegex(clearName)}\\s*\\(\\s*${escapeRegex(propText)}\\s*\\)`,
  );
  const unmountText = unmount.getBodyText() ?? '';
  if (cleanupPattern.test(unmountText) || windowCleanupPattern.test(unmountText)) return true;

  for (const method of cls.getMethods()) {
    if (method === unmount) continue;
    const methodText = method.getBodyText() ?? '';
    if (!cleanupPattern.test(methodText) && !windowCleanupPattern.test(methodText)) continue;
    const methodName = method.getName();
    if (new RegExp(`\\bthis\\s*\\.\\s*${escapeRegex(methodName)}\\s*\\(`).test(unmountText)) return true;
  }

  return false;
}

function classTimerMissingUnmountCleanup(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const cls of ctx.sourceFile.getClasses()) {
    if (!isReactClass(cls)) continue;
    const unmount = cls.getInstanceMethod('componentWillUnmount');
    const reported = new Set<string>();

    const methodsAndConstructors = [...cls.getMethods(), ...cls.getConstructors()];
    for (const method of methodsAndConstructors) {
      const methodName = Node.isConstructorDeclaration(method) ? 'constructor' : method.getName();
      if (!isLifecycleOrRenderMethod(methodName)) continue;
      const body = method.getBody();
      if (!body) continue;

      for (const timerCall of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const timerName = timerCall.getExpression().getText();
        if (
          timerName !== 'setTimeout' &&
          timerName !== 'setInterval' &&
          timerName !== 'requestAnimationFrame' &&
          timerName !== 'requestIdleCallback'
        ) {
          continue;
        }
        const assignment = getThisPropertyAssignmentToCall(timerCall);
        if (!assignment) continue;
        if (reported.has(assignment.propText)) continue;

        const clearName =
          timerName === 'setTimeout'
            ? 'clearTimeout'
            : timerName === 'setInterval'
              ? 'clearInterval'
              : timerName === 'requestAnimationFrame'
                ? 'cancelAnimationFrame'
                : 'cancelIdleCallback';
        if (unmountCleansTimer(cls, unmount, clearName, assignment.propText)) continue;

        reported.add(assignment.propText);
        findings.push(
          finding(
            'class-timer-missing-unmount-cleanup',
            'warning',
            'bug',
            `React class stores ${timerName} in '${assignment.propText}' but componentWillUnmount does not clear it`,
            ctx.filePath,
            timerCall.getStartLineNumber(),
            1,
            { suggestion: `Clear it in componentWillUnmount with ${clearName}(${assignment.propText}).` },
          ),
        );
      }
    }
  }

  return findings;
}

function collectModuleScopedTimerNames(ctx: RuleContext): Set<string> {
  const names = new Set<string>();
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    const declKind = stmt.getDeclarationKind();
    if (declKind !== 'let' && declKind !== 'var') continue;
    for (const decl of stmt.getDeclarations()) {
      const nameNode = decl.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      const name = nameNode.getText();
      if (/(?:timer|timeout|interval)$/i.test(name) || /^(?:timer|timeout|interval)/i.test(name)) {
        names.add(name);
      }
    }
  }
  return names;
}

function isInsideReactComponentOrClass(node: Node): boolean {
  const cls = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  if (cls && isReactClass(cls)) return true;

  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isFunctionDeclaration(cur) && cur.getName() && /^[A-Z]/.test(cur.getName()!)) return true;
    if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      const varDecl = cur.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const nameNode = varDecl?.getNameNode();
      if (nameNode && Node.isIdentifier(nameNode) && /^[A-Z]/.test(nameNode.getText())) return true;
    }
    cur = cur.getParent();
  }
  return false;
}

function moduleScopedTimerInComponent(ctx: RuleContext): ReviewFinding[] {
  const timerNames = collectModuleScopedTimerNames(ctx);
  if (timerNames.size === 0) return [];

  const findings: ReviewFinding[] = [];
  const reported = new Set<string>();

  for (const bin of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = bin.getLeft();
    if (!Node.isIdentifier(left) || !timerNames.has(left.getText())) continue;
    const right = bin.getRight();
    if (!Node.isCallExpression(right)) continue;
    const callee = right.getExpression().getText();
    if (
      callee !== 'setTimeout' &&
      callee !== 'setInterval' &&
      callee !== 'requestAnimationFrame' &&
      callee !== 'requestIdleCallback'
    ) {
      continue;
    }
    if (!isInsideReactComponentOrClass(bin)) continue;

    const name = left.getText();
    if (reported.has(name)) continue;
    reported.add(name);
    findings.push(
      finding(
        'module-scoped-timer-in-component',
        'warning',
        'bug',
        `Component writes ${callee} handle to module-scoped '${name}' — multiple component instances can overwrite each other's timer`,
        ctx.filePath,
        bin.getStartLineNumber(),
        1,
        {
          suggestion: 'Store timer handles in useRef or an instance field so each component instance owns its cleanup.',
        },
      ),
    );
  }

  return findings;
}

function getPropertyAccessRootIdentifier(expr: Node): string | undefined {
  let cur = expr;
  while (Node.isPropertyAccessExpression(cur)) {
    cur = cur.getExpression();
  }
  return Node.isIdentifier(cur) ? cur.getText() : undefined;
}

function hookLengthDependency(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const hookName = call.getExpression().getText().split('.').pop();
    if (hookName !== 'useMemo' && hookName !== 'useCallback') continue;

    const callback = call.getArguments()[0];
    const deps = call.getArguments()[1];
    if (
      (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) ||
      !Node.isArrayLiteralExpression(deps)
    ) {
      continue;
    }

    const narrowDeps = new Map<string, string>();
    const fullDeps = new Set<string>();
    for (const dep of deps.getElements()) {
      if (Node.isIdentifier(dep)) {
        fullDeps.add(dep.getText());
        continue;
      }
      if (!Node.isPropertyAccessExpression(dep) || (dep.getName() !== 'length' && dep.getName() !== 'size')) continue;
      const root = getPropertyAccessRootIdentifier(dep);
      if (root) narrowDeps.set(root, dep.getName());
    }
    for (const fullDep of fullDeps) narrowDeps.delete(fullDep);
    if (narrowDeps.size === 0) continue;

    const body = callback.getBody();
    const shadowedDeps = new Set<string>();
    for (const param of body.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const nameNode = param.getNameNode();
      if (Node.isIdentifier(nameNode) && narrowDeps.has(nameNode.getText())) shadowedDeps.add(nameNode.getText());
      for (const binding of nameNode.getDescendantsOfKind(SyntaxKind.BindingElement)) {
        const bindingName = binding.getNameNode();
        if (Node.isIdentifier(bindingName) && narrowDeps.has(bindingName.getText())) {
          shadowedDeps.add(bindingName.getText());
        }
      }
    }
    for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode) && narrowDeps.has(nameNode.getText())) shadowedDeps.add(nameNode.getText());
      for (const binding of nameNode.getDescendantsOfKind(SyntaxKind.BindingElement)) {
        const bindingName = binding.getNameNode();
        if (Node.isIdentifier(bindingName) && narrowDeps.has(bindingName.getText())) {
          shadowedDeps.add(bindingName.getText());
        }
      }
    }
    for (const catchClause of body.getDescendantsOfKind(SyntaxKind.CatchClause)) {
      const name = catchClause.getVariableDeclaration()?.getName();
      if (name && narrowDeps.has(name)) shadowedDeps.add(name);
    }
    for (const shadowed of shadowedDeps) narrowDeps.delete(shadowed);
    if (narrowDeps.size === 0) continue;

    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();
      const narrowProp = narrowDeps.get(name);
      if (!narrowProp) continue;
      const parent = id.getParent();
      if (
        parent &&
        Node.isPropertyAccessExpression(parent) &&
        parent.getExpression() === id &&
        parent.getName() === narrowProp
      ) {
        continue;
      }
      if (parent && Node.isParameterDeclaration(parent)) continue;
      if (parent && Node.isVariableDeclaration(parent) && parent.getNameNode() === id) continue;

      findings.push(
        finding(
          'hook-length-dependency',
          'warning',
          'bug',
          `${hookName} reads '${name}' but its dependency array only watches '${name}.${narrowProp}' — content changes with the same ${narrowProp} can leave stale memoized data`,
          ctx.filePath,
          deps.getStartLineNumber(),
          1,
          {
            suggestion: `Depend on '${name}' itself, or derive a stable version/key that changes when the consumed content changes.`,
          },
        ),
      );
      break;
    }
  }

  return findings;
}

const ARRAY_MUTATION_METHODS = new Set([
  'sort',
  'reverse',
  'splice',
  'copyWithin',
  'fill',
  'push',
  'pop',
  'shift',
  'unshift',
]);

function collectFunctionComponentPropNames(
  fn: import('ts-morph').FunctionDeclaration | import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
): Set<string> {
  const props = new Set<string>();
  const firstParam = fn.getParameters()[0];
  if (!firstParam) return props;
  const nameNode = firstParam.getNameNode();
  if (Node.isIdentifier(nameNode)) props.add(nameNode.getText());
  if (Node.isObjectBindingPattern(nameNode)) {
    for (const element of nameNode.getElements()) {
      const elementName = element.getNameNode();
      if (Node.isIdentifier(elementName)) props.add(elementName.getText());
    }
  }
  return props;
}

function isPropDerivedArrayReceiver(receiver: Node, propNames: Set<string>): boolean {
  if (Node.isIdentifier(receiver)) return propNames.has(receiver.getText());
  if (!Node.isPropertyAccessExpression(receiver)) return false;
  const text = receiver.getText();
  if (/^(?:this\.)?props\./.test(text)) return true;
  const root = getPropertyAccessRootIdentifier(receiver);
  return Boolean(root && propNames.has(root));
}

function propsArrayMutatedInRender(ctx: RuleContext): ReviewFinding[] {
  if (!isReactFile(ctx)) return [];
  const findings: ReviewFinding[] = [];

  function checkCall(
    call: import('ts-morph').CallExpression,
    propNames: Set<string>,
    shadowedNames = new Set<string>(),
  ) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    if (!ARRAY_MUTATION_METHODS.has(method)) return;
    const root = getPropertyAccessRootIdentifier(callee.getExpression());
    if (root && shadowedNames.has(root)) return;
    if (!isPropDerivedArrayReceiver(callee.getExpression(), propNames)) return;

    findings.push(
      finding(
        'props-array-mutated-in-render',
        'warning',
        'bug',
        `Render path calls mutating array method .${method}() on props-derived data — this mutates parent-owned data in place`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion: `Clone before mutating, for example [...items].${method}(...), or use a non-mutating array helper.`,
        },
      ),
    );
  }

  function collectShadowedNames(body: Node, propNames: Set<string>): Set<string> {
    const shadowed = new Set<string>();
    for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode) && propNames.has(nameNode.getText())) shadowed.add(nameNode.getText());
    }
    return shadowed;
  }

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || !/^[A-Z]/.test(name)) continue;
    const body = fn.getBody();
    if (!body) continue;
    const propNames = collectFunctionComponentPropNames(fn);
    const shadowed = collectShadowedNames(body, propNames);
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) checkCall(call, propNames, shadowed);
  }

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const nameNode = decl.getNameNode();
      const init = decl.getInitializer();
      if (!Node.isIdentifier(nameNode) || !/^[A-Z]/.test(nameNode.getText())) continue;
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
      const propNames = collectFunctionComponentPropNames(init);
      const body = init.getBody();
      const shadowed = collectShadowedNames(body, propNames);
      for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) checkCall(call, propNames, shadowed);
    }
  }

  for (const cls of ctx.sourceFile.getClasses()) {
    if (!isReactClass(cls)) continue;
    const render = cls.getInstanceMethod('render');
    const body = render?.getBody();
    if (!body) continue;
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) checkCall(call, new Set(['props']));
  }

  return findings;
}

// ── Rule: component-did-update-setstate-unguarded ───────────────────────
// componentDidUpdate can call setState, but only behind a prop/state comparison
// or an early-return guard. Unguarded writes loop after every update.

function isThisSetStateCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression();
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getExpression().getKind() === SyntaxKind.ThisKeyword &&
    callee.getName() === 'setState'
  );
}

function guardTextComparesPreviousValues(text: string): boolean {
  return /\bprev(?:Props|State|[A-Z]\w*)?\b/.test(text);
}

function hasPrevValueAncestorGuard(
  call: import('ts-morph').CallExpression,
  method: import('ts-morph').MethodDeclaration,
): boolean {
  let cur: Node | undefined = call.getParent();
  while (cur && cur !== method) {
    if (Node.isIfStatement(cur) && guardTextComparesPreviousValues(cur.getExpression().getText())) return true;
    if (Node.isConditionalExpression(cur) && guardTextComparesPreviousValues(cur.getCondition().getText())) return true;
    cur = cur.getParent();
  }
  return false;
}

function hasPrevValueEarlyReturnGuard(method: import('ts-morph').MethodDeclaration): boolean {
  const body = method.getBody();
  if (!body || !Node.isBlock(body)) return false;
  for (const stmt of body.getStatements()) {
    if (!Node.isIfStatement(stmt)) continue;
    if (!guardTextComparesPreviousValues(stmt.getExpression().getText())) continue;
    const thenStmt = stmt.getThenStatement();
    if (Node.isReturnStatement(thenStmt)) return true;
    if (Node.isBlock(thenStmt) && thenStmt.getStatements().some((inner) => Node.isReturnStatement(inner))) return true;
  }
  return false;
}

function componentDidUpdateSetStateUnguarded(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const cls of ctx.sourceFile.getClasses()) {
    if (!isReactClass(cls)) continue;
    const method = cls.getInstanceMethod('componentDidUpdate');
    const body = method?.getBody();
    if (!method || !body) continue;

    const methodHasEarlyGuard = hasPrevValueEarlyReturnGuard(method);
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isThisSetStateCall(call)) continue;
      if (hasPrevValueAncestorGuard(call, method) || methodHasEarlyGuard) continue;

      findings.push(
        finding(
          'component-did-update-setstate-unguarded',
          'error',
          'bug',
          'componentDidUpdate calls this.setState without a prevProps/prevState guard — this can update-loop after every render',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion:
              'Wrap the setState call in a comparison against prevProps/prevState, or return early when nothing relevant changed.',
          },
        ),
      );
    }
  }

  return findings;
}

function nearestFunctionOrMethod(node: Node): Node | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (
      Node.isFunctionDeclaration(cur) ||
      Node.isFunctionExpression(cur) ||
      Node.isArrowFunction(cur) ||
      Node.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.getParent();
  }
  return undefined;
}

function currentGuardScopeText(node: Node): string {
  const scope = nearestFunctionOrMethod(node) ?? node.getSourceFile();
  return scope.getText();
}

function isDirectChildrenExpression(text: string): boolean {
  return /^(?:children|props\.children|this\.props\.children)$/.test(text.replace(/\s+/g, ''));
}

function hasValidElementGuard(scopeText: string, argText: string): boolean {
  const escaped = escapeRegex(argText.replace(/\s+/g, ''));
  const compact = scopeText.replace(/\s+/g, '');
  // Intentionally scope-local: a file-wide scan would let unrelated helpers
  // suppress direct cloneElement(children, ...) findings.
  return (
    new RegExp(`(?:React\\.)?isValidElement\\(${escaped}\\)`).test(compact) ||
    new RegExp(`(?:React\\.)?Children\\.only\\(${escaped}\\)`).test(compact)
  );
}

// ── Rule: clone-element-children-without-valid-guard ────────────────────
// cloneElement(children, ...) throws for arrays/strings/null. Requiring
// isValidElement/Children.only catches wrapper components with loose children.

function cloneElementChildrenWithoutValidGuard(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (calleeText !== 'cloneElement' && calleeText !== 'React.cloneElement') continue;
    const firstArg = call.getArguments()[0];
    if (!firstArg) continue;
    const argText = firstArg.getText();
    const compactArg = argText.replace(/\s+/g, '');
    if (!isDirectChildrenExpression(compactArg)) continue;
    if (hasValidElementGuard(currentGuardScopeText(call), compactArg)) continue;

    findings.push(
      finding(
        'clone-element-children-without-valid-guard',
        'warning',
        'bug',
        'cloneElement is called directly on children without React.isValidElement or React.Children.only — arrays, strings, and null will throw',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Validate children with React.isValidElement, or normalize with React.Children.only before cloning.',
        },
      ),
    );
  }

  return findings;
}

function classHasUnmountCancellationGuard(cls: import('ts-morph').ClassDeclaration): boolean {
  const unmount = cls.getInstanceMethod('componentWillUnmount');
  if (!unmount) return false;
  const unmountText = unmount.getBodyText() ?? '';
  return (
    /\b(?:abort|cancel|unsubscribe|dispose|destroy)\w*\s*\(/i.test(unmountText) ||
    /\b(?:isMounted|mounted|didCancel|cancelled|canceled|unmounted|ignore)\b/i.test(unmountText)
  );
}

function callbackHasStateUnmountGuard(callback: Node): boolean {
  return /\b(?:isMounted|mounted|didCancel|cancelled|canceled|unmounted|ignore|abort|signal)\b/i.test(
    callback.getText(),
  );
}

function isAsyncLifecycleMethod(name: string): boolean {
  return /^(?:componentDidMount|componentDidUpdate|componentWillReceiveProps|UNSAFE_componentWillReceiveProps)$/.test(
    name,
  );
}

// ── Rule: async-setstate-after-unmount ──────────────────────────────────
// Promise callbacks started from class lifecycles can resolve after unmount.
// Keep this conservative: only lifecycle-started .then() callbacks with setState.

function asyncSetStateAfterUnmount(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const cls of ctx.sourceFile.getClasses()) {
    if (!isReactClass(cls)) continue;
    if (classHasUnmountCancellationGuard(cls)) continue;

    for (const method of cls.getMethods()) {
      if (!isAsyncLifecycleMethod(method.getName())) continue;
      const body = method.getBody();
      if (!body) continue;

      for (const promiseCall of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = promiseCall.getExpression();
        if (!Node.isPropertyAccessExpression(callee) || !['then', 'catch', 'finally'].includes(callee.getName())) {
          continue;
        }

        const callbacks = promiseCall
          .getArguments()
          .filter(
            (arg): arg is import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression =>
              Node.isArrowFunction(arg) || Node.isFunctionExpression(arg),
          );
        const unsafeCallback = callbacks.find((callback) => {
          if (callbackHasStateUnmountGuard(callback)) return false;
          return callback.getDescendantsOfKind(SyntaxKind.CallExpression).some(isThisSetStateCall);
        });
        if (!unsafeCallback) continue;

        findings.push(
          finding(
            'async-setstate-after-unmount',
            'warning',
            'bug',
            'Promise callback scheduled from a React class lifecycle calls this.setState without an unmount/cancel guard',
            ctx.filePath,
            promiseCall.getStartLineNumber(),
            1,
            {
              suggestion:
                'Track cancellation in componentWillUnmount, use AbortController where possible, or guard setState before resolving.',
            },
          ),
        );
      }

      if (!method.isAsync()) continue;
      if (callbackHasStateUnmountGuard(method)) continue;
      if (body.getDescendantsOfKind(SyntaxKind.AwaitExpression).length === 0) continue;

      const setStateAfterAwait = body.getDescendantsOfKind(SyntaxKind.CallExpression).find(isThisSetStateCall);
      if (!setStateAfterAwait) continue;

      findings.push(
        finding(
          'async-setstate-after-unmount',
          'warning',
          'bug',
          'Async React class lifecycle awaits work and then calls this.setState without an unmount/cancel guard',
          ctx.filePath,
          setStateAfterAwait.getStartLineNumber(),
          1,
          {
            suggestion:
              'Track cancellation in componentWillUnmount, use AbortController where possible, or guard setState before resolving.',
          },
        ),
      );
    }
  }

  return findings;
}

function collectUseStateSetterMap(ctx: RuleContext): Map<string, string> {
  const setterToState = new Map<string, string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    const init = decl.getInitializer();
    if (!Node.isArrayBindingPattern(nameNode) || !init || !Node.isCallExpression(init)) continue;
    const calleeText = init.getExpression().getText();
    if (calleeText !== 'useState' && calleeText !== 'React.useState') continue;
    const elements = nameNode.getElements();
    if (elements.length < 2 || !Node.isBindingElement(elements[0]) || !Node.isBindingElement(elements[1])) continue;
    setterToState.set(elements[1].getName(), elements[0].getName());
  }
  return setterToState;
}

function isEffectCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression().getText();
  return (
    callee === 'useEffect' ||
    callee === 'React.useEffect' ||
    callee === 'useLayoutEffect' ||
    callee === 'React.useLayoutEffect'
  );
}

function getEffectCallback(
  call: import('ts-morph').CallExpression,
): import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression | undefined {
  const callback = call.getArguments()[0];
  return Node.isArrowFunction(callback) || Node.isFunctionExpression(callback) ? callback : undefined;
}

function effectCleanupText(callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression): string {
  return getTopLevelCleanupExpressions(callback.getBody())
    .map((expr) => expr.getText())
    .join('\n');
}

function callExpressionsIncludingSelf(node: Node): import('ts-morph').CallExpression[] {
  return [...(Node.isCallExpression(node) ? [node] : []), ...node.getDescendantsOfKind(SyntaxKind.CallExpression)];
}

// ── Rule: effect-fetch-missing-cancel-guard ─────────────────────────────
// Effects that fetch and then set state need an unmount/race guard. This rule
// stays conservative: it only fires when the effect body both fetches and
// calls a local useState setter.

function effectFetchMissingCancelGuard(ctx: RuleContext): ReviewFinding[] {
  const setterToState = collectUseStateSetterMap(ctx);
  if (setterToState.size === 0) return [];
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isEffectCall(call)) continue;
    const callback = getEffectCallback(call);
    if (!callback) continue;
    const body = callback.getBody();
    const hasFetch = body.getDescendantsOfKind(SyntaxKind.CallExpression).some((inner) => {
      const exprText = inner.getExpression().getText();
      return exprText === 'fetch' || exprText === 'window.fetch' || exprText === 'globalThis.fetch';
    });
    if (!hasFetch) continue;

    let setterLine: number | undefined;
    for (const inner of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = inner.getExpression();
      if (Node.isIdentifier(expr) && setterToState.has(expr.getText())) {
        setterLine = inner.getStartLineNumber();
        break;
      }
      if (Node.isPropertyAccessExpression(expr) && ['then', 'catch', 'finally'].includes(expr.getName())) {
        const setterArg = inner
          .getArguments()
          .find((arg) => Node.isIdentifier(arg) && setterToState.has(arg.getText()));
        if (setterArg) {
          setterLine = setterArg.getStartLineNumber();
          break;
        }
      }
    }
    if (!setterLine) continue;

    const cleanupText = effectCleanupText(callback);
    if (/\b(?:abort|cancel|didCancel|cancelled|canceled|ignore|ignored|mounted)\b/i.test(cleanupText)) continue;
    if (/\bAbortController\b/i.test(body.getText()) && /\b\.abort\s*\(/.test(cleanupText)) continue;

    findings.push(
      finding(
        'effect-fetch-missing-cancel-guard',
        'warning',
        'bug',
        'useEffect fetch updates state without an unmount/race guard — late responses can overwrite newer state',
        ctx.filePath,
        setterLine,
        1,
        {
          suggestion: 'Use AbortController or an ignore/didCancel flag in the cleanup before calling the state setter.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: interval-state-setter-needs-functional-update ─────────────────
// setInterval callbacks created with [] deps often need functional state
// updates (`setCount(c => c + 1)`) instead of closing over `count`.

function intervalStateSetterNeedsFunctionalUpdate(ctx: RuleContext): ReviewFinding[] {
  const setterToState = collectUseStateSetterMap(ctx);
  if (setterToState.size === 0) return [];
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isEffectCall(call)) continue;
    const deps = call.getArguments()[1];
    if (!Node.isArrayLiteralExpression(deps) || deps.getElements().length !== 0) continue;
    const callback = getEffectCallback(call);
    if (!callback) continue;

    for (const intervalCall of callback.getBody().getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (intervalCall.getExpression().getText() !== 'setInterval') continue;
      const intervalCallback = intervalCall.getArguments()[0];
      if (!Node.isArrowFunction(intervalCallback) && !Node.isFunctionExpression(intervalCallback)) continue;

      for (const setterCall of callExpressionsIncludingSelf(intervalCallback.getBody())) {
        const setter = setterCall.getExpression();
        if (!Node.isIdentifier(setter)) continue;
        const stateName = setterToState.get(setter.getText());
        if (!stateName) continue;
        const firstArg = setterCall.getArguments()[0];
        if (!firstArg || Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) continue;
        if (!new RegExp(`\\b${escapeRegex(stateName)}\\b`).test(firstArg.getText())) continue;

        findings.push(
          finding(
            'interval-state-setter-needs-functional-update',
            'warning',
            'bug',
            `setInterval callback updates '${stateName}' from a stale closure — use a functional state update`,
            ctx.filePath,
            setterCall.getStartLineNumber(),
            1,
            { suggestion: `Use ${setter.getText()}((current) => ...) so each tick receives the latest state.` },
          ),
        );
      }
    }
  }

  return findings;
}

function imperativeHandleMissingDeps(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useImperativeHandle' && callee !== 'React.useImperativeHandle') continue;
    const deps = call.getArguments()[2];
    if (deps && Node.isArrayLiteralExpression(deps)) continue;

    findings.push(
      finding(
        'imperative-handle-missing-deps',
        'warning',
        'pattern',
        'useImperativeHandle is missing a dependency array — the imperative handle is recreated on every render',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: 'Pass a dependency array as the third argument, listing values captured by the handle factory.' },
      ),
    );
  }

  return findings;
}

function isInsideReactComponentClassOrHook(node: Node): boolean {
  if (isInsideReactComponentOrClass(node)) return true;
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isFunctionDeclaration(cur) && /^use[A-Z]/.test(cur.getName() ?? '')) return true;
    if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      const varDecl = cur.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const nameNode = varDecl?.getNameNode();
      if (nameNode && Node.isIdentifier(nameNode) && /^use[A-Z]/.test(nameNode.getText())) return true;
    }
    cur = cur.getParent();
  }
  return false;
}

function contextCreatedInComponent(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'createContext' && callee !== 'React.createContext') continue;
    if (!isInsideReactComponentClassOrHook(call)) continue;

    findings.push(
      finding(
        'context-created-in-component',
        'error',
        'bug',
        'createContext is called inside a component — a new context object is created on every render',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: 'Move createContext to module scope and render providers inside the component.' },
      ),
    );
  }

  return findings;
}

function unwrapTypeAssertionExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current &&
    (Node.isAsExpression(current) || Node.isTypeAssertion(current) || Node.isSatisfiesExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function isUnsafeAssertedContextDefault(node: Node | undefined): boolean {
  if (!node || (!Node.isAsExpression(node) && !Node.isTypeAssertion(node) && !Node.isSatisfiesExpression(node))) {
    return false;
  }
  const inner = unwrapTypeAssertionExpression(node);
  if (!inner) return false;
  if (Node.isObjectLiteralExpression(inner) && inner.getProperties().length === 0) return true;
  if (inner.getKind() === SyntaxKind.NullKeyword || inner.getKind() === SyntaxKind.UndefinedKeyword) return true;
  if (Node.isIdentifier(inner) && inner.getText() === 'undefined') return true;
  return false;
}

// ── Rule: context-default-assertion ─────────────────────────────────────
// createContext({} as T) hides missing providers and turns provider mistakes
// into late undefined property/method failures.

function contextDefaultAssertion(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'createContext' && callee !== 'React.createContext') continue;
    if (!isUnsafeAssertedContextDefault(call.getArguments()[0])) continue;

    findings.push(
      finding(
        'context-default-assertion',
        'warning',
        'bug',
        'createContext uses an asserted empty/null default — missing providers fail later instead of at the useContext boundary',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Use createContext<T | null>(null) and a custom hook that throws when the provider is missing, or provide a real safe default.',
        },
      ),
    );
  }

  return findings;
}

function reduxSelectorUnstableReturn(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useSelector' && callee !== 'ReactRedux.useSelector') continue;
    if (call.getArguments().length >= 2) continue;
    const selector = call.getArguments()[0];
    if (!Node.isArrowFunction(selector) && !Node.isFunctionExpression(selector)) continue;

    const selectorBody = selector.getBody();
    const returned = Node.isBlock(selectorBody)
      ? selectorBody.getStatements().find((stmt) => Node.isReturnStatement(stmt))
      : selectorBody;
    const expr = Node.isReturnStatement(returned) ? returned.getExpression() : returned;
    if (!expr) continue;
    const unwrapped = unwrapJsxExpression(expr);
    if (!Node.isObjectLiteralExpression(unwrapped) && !Node.isArrayLiteralExpression(unwrapped)) continue;

    findings.push(
      finding(
        'redux-selector-unstable-return',
        'warning',
        'pattern',
        'useSelector returns a new object/array without an equality function — component re-renders on every store update',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: 'Select primitives separately, memoize with Reselect, or pass shallowEqual/equalityFn.' },
      ),
    );
  }

  return findings;
}

function reduxDispatchInRender(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  function isInsideNestedFunction(call: import('ts-morph').CallExpression, root: Node): boolean {
    let cur: Node | undefined = call.getParent();
    while (cur && cur !== root) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) return true;
      cur = cur.getParent();
    }
    return false;
  }

  function checkBlock(block: import('ts-morph').Block, componentName: string): void {
    for (const expr of block.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isInsideNestedFunction(expr, block)) continue;
      const callee = expr.getExpression();
      if (!Node.isIdentifier(callee) || callee.getText() !== 'dispatch') continue;

      findings.push(
        finding(
          'redux-dispatch-in-render',
          'error',
          'bug',
          `Redux dispatch() is called during render of '${componentName}' — this can trigger render loops and duplicate actions`,
          ctx.filePath,
          expr.getStartLineNumber(),
          1,
          {
            suggestion: 'Move dispatch() into useEffect for lifecycle work or into an event handler for user actions.',
          },
        ),
      );
    }
  }

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName() ?? '';
    if (!/^[A-Z]/.test(name)) continue;
    const body = fn.getBody();
    if (body && Node.isBlock(body)) checkBlock(body, name);
  }

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const nameNode = decl.getNameNode();
      const init = decl.getInitializer();
      if (!Node.isIdentifier(nameNode) || !/^[A-Z]/.test(nameNode.getText())) continue;
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
      const body = init.getBody();
      if (Node.isBlock(body)) checkBlock(body, nameNode.getText());
    }
  }

  return findings;
}

function reactHookFormContextFallback(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!isReactFile(ctx)) return findings;

  const useFormContextNames = new Set<string>();
  for (const decl of ctx.sourceFile.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== 'react-hook-form') continue;
    for (const named of decl.getNamedImports()) {
      if (named.getName() !== 'useFormContext') continue;
      useFormContextNames.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }
  if (useFormContextNames.size === 0) return findings;

  for (const expr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = expr.getOperatorToken().getText();
    if (operator !== '??' && operator !== '||') continue;

    const left = expr.getLeft();
    if (!Node.isCallExpression(left)) continue;
    const right = unwrapJsxExpression(expr.getRight());
    if (!Node.isObjectLiteralExpression(right) || right.getProperties().length > 0) continue;

    const callee = left.getExpression();
    if (!Node.isIdentifier(callee) || !useFormContextNames.has(callee.getText())) continue;

    findings.push(
      finding(
        'react-hook-form-context-fallback',
        'warning',
        'bug',
        'useFormContext() fallback hides a missing FormProvider — form controls may silently stop registering values',
        ctx.filePath,
        expr.getStartLineNumber(),
        1,
        {
          suggestion:
            'Require a FormProvider, split controlled and react-hook-form variants, or throw an explicit error when form context is absent.',
        },
      ),
    );
  }

  return findings;
}

// ── Exported React Rules ─────────────────────────────────────────────────

export const reactRules = [
  clientOnly(asyncEffect),
  clientOnly(renderSideEffect),
  mappedFragmentKey,
  unstableKey,
  clientOnly(staleClosure),
  clientOnly(stateExplosion),
  clientOnly(hookOrder),
  clientOnly(effectSelfUpdateLoop),
  clientOnly(missingEffectCleanup),
  clientOnly(reactLegacyUnsafeLifecycle),
  inlineContextValue,
  clientOnly(refInRender),
  clientOnly(missingMemoDeps),
  clientOnly(reducerMutation),
  clientOnly(effectCleanupCalledImmediately),
  clientOnly(classTimerMissingUnmountCleanup),
  clientOnly(moduleScopedTimerInComponent),
  clientOnly(hookLengthDependency),
  clientOnly(propsArrayMutatedInRender),
  clientOnly(componentDidUpdateSetStateUnguarded),
  clientOnly(cloneElementChildrenWithoutValidGuard),
  clientOnly(asyncSetStateAfterUnmount),
  clientOnly(effectFetchMissingCancelGuard),
  clientOnly(intervalStateSetterNeedsFunctionalUpdate),
  clientOnly(imperativeHandleMissingDeps),
  clientOnly(contextCreatedInComponent),
  clientOnly(contextDefaultAssertion),
  clientOnly(reduxSelectorUnstableReturn),
  clientOnly(reduxDispatchInRender),
  clientOnly(reactHookFormContextFallback),
];
