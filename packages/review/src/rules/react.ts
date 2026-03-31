/**
 * React review rules — active when target = nextjs | tailwind | web | native.
 *
 * Catches React-specific bugs that KERN IR + AST can detect mechanically.
 */

import { SyntaxKind, Node } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

/**
 * Check if a file is actually a React file — has JSX syntax or React imports.
 * Backend/utility files in a React-targeted project should not trigger React rules.
 */
function isReactFile(ctx: RuleContext): boolean {
  const fullText = ctx.sourceFile.getFullText();
  if (/\bfrom\s+['"]react['"]/.test(fullText)) return true;
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0) return true;
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0) return true;
  if (/\buse(?:State|Effect|Ref|Callback|Memo|Reducer|Context)\s*[<(]/.test(fullText)) return true;
  return false;
}

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line),
    fingerprint: createFingerprint(ruleId, line, 1),
    ...extra,
  };
}

// ── Rule 11: async-effect ────────────────────────────────────────────────
// useEffect(async () => ...) — React doesn't support async effect callbacks

function asyncEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  const asyncEffectRegex = /useEffect\s*\(\s*async\s/g;
  let match;
  while ((match = asyncEffectRegex.exec(fullText)) !== null) {
    const line = fullText.substring(0, match.index).split('\n').length;
    findings.push(finding('async-effect', 'error', 'bug',
      'useEffect callback must not be async — use an inner async function instead',
      ctx.filePath, line,
      { suggestion: 'useEffect(() => { async function run() { ... } run(); }, [])' }));
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

      if (/\bset[A-Z]\w*\(/.test(exprText) && !exprText.includes('useState') &&
          !/\b(setTimeout|setInterval|setImmediate|setAttribute|setProperty|setHeader|setRequestHeader|setItem|setCustomValidity)\s*\(/.test(exprText)) {
        findings.push(finding('render-side-effect', 'error', 'bug',
          `setState called in render body of '${name}' — move to useEffect or event handler`,
          ctx.filePath, stmt.getStartLineNumber()));
      }

      if (/\bfetch\s*\(/.test(exprText)) {
        findings.push(finding('render-side-effect', 'error', 'bug',
          `fetch() called in render body of '${name}' — move to useEffect or event handler`,
          ctx.filePath, stmt.getStartLineNumber()));
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
    if (callback.getKind() !== SyntaxKind.ArrowFunction &&
        callback.getKind() !== SyntaxKind.FunctionExpression) continue;

    // Get the index parameter (second param of the callback)
    const params = callback.getKind() === SyntaxKind.ArrowFunction
      ? (callback as import('ts-morph').ArrowFunction).getParameters()
      : (callback as import('ts-morph').FunctionExpression).getParameters();
    const indexParam = params.length >= 2 ? params[1].getName() : null;

    // Walk callback descendants for JSX elements
    const jsxElements = [
      ...callback.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...callback.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    if (jsxElements.length === 0) continue; // No JSX → skip (fixes non-JSX .map() FP)

    // Check the FIRST (root) JSX element for key prop
    const firstJsx = jsxElements.sort((a, b) => a.getStart() - b.getStart())[0];
    const line = call.getStartLineNumber();

    // Get attributes from the first JSX element
    const attributes = firstJsx.getKind() === SyntaxKind.JsxSelfClosingElement
      ? (firstJsx as import('ts-morph').JsxSelfClosingElement).getAttributes()
      : (firstJsx as import('ts-morph').JsxOpeningElement).getAttributes();

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
      findings.push(finding('unstable-key', 'warning', 'bug',
        `key={${indexParam}} uses array index — use a stable identifier instead`,
        ctx.filePath, line,
        { suggestion: 'Use a unique ID from the data (e.g., key={item.id})' }));
    } else if (!hasKey) {
      findings.push(finding('unstable-key', 'warning', 'bug',
        'JSX in .map() is missing a key prop',
        ctx.filePath, line,
        { suggestion: 'Add key={item.id} to the root JSX element in .map()' }));
    }
  }

  return findings;
}

// ── Rule 14: stale-closure ───────────────────────────────────────────────
// Timer captures state not in dependency array

function staleClosure(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // AST-based: find useEffect() calls and analyze deps + timer usage
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getText() !== 'useEffect') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    // First arg: the effect callback
    const callbackText = args[0].getText();

    // Second arg: deps array
    const depsArg = args[1];
    if (depsArg.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;

    const depsArray = depsArg as import('ts-morph').ArrayLiteralExpression;
    const deps = depsArray.getElements();

    // Empty deps [] + timer in callback = stale closure risk
    if (deps.length === 0) {
      const hasTimer = /\b(?:setInterval|setTimeout)\s*\(/.test(callbackText);
      if (hasTimer) {
        findings.push(finding('stale-closure', 'warning', 'bug',
          'Timer in useEffect with empty deps [] may capture stale state',
          ctx.filePath, call.getStartLineNumber(),
          { suggestion: 'Use a ref for the latest value or add dependencies' }));
      }
    }
  }

  return findings;
}

// ── Rule 15: state-explosion ─────────────────────────────────────────────
// >5 useState calls in a single component — should be useReducer or machine

function stateExplosion(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName() || '';
    if (!name || name[0] !== name[0].toUpperCase()) continue;

    const body = fn.getBody()?.getText() || '';
    const useStateCount = (body.match(/useState\s*[<(]/g) || []).length;

    if (useStateCount > 5) {
      findings.push(finding('state-explosion', 'warning', 'pattern',
        `Component '${name}' has ${useStateCount} useState calls — consider useReducer or a state machine`,
        ctx.filePath, fn.getStartLineNumber(),
        { suggestion: 'Use useReducer for complex state, or a KERN machine node for state transitions' }));
    }
  }

  // Also check arrow function components
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!name || name[0] !== name[0].toUpperCase()) continue;

      const init = decl.getInitializer()?.getText() || '';
      if (!init.includes('=>')) continue;

      const useStateCount = (init.match(/useState\s*[<(]/g) || []).length;
      if (useStateCount > 5) {
        findings.push(finding('state-explosion', 'warning', 'pattern',
          `Component '${name}' has ${useStateCount} useState calls — consider useReducer or a state machine`,
          ctx.filePath, stmt.getStartLineNumber()));
      }
    }
  }

  return findings;
}

// ── Rule 16: hook-order ──────────────────────────────────────────────────
// Conditional hook calls (hooks inside if/loop/early return)

const HOOK_NAMES = new Set(['useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
  'useSyncExternalStore', 'useInsertionEffect']);

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
    let enclosingFn = cfNode.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
      || cfNode.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
      || cfNode.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
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

      findings.push(finding('hook-order', 'error', 'bug',
        `Hook '${hookName}' called inside ${label} — violates Rules of Hooks`,
        ctx.filePath, cfNode.getStartLineNumber(),
        { suggestion: 'Move hook call to top level of component' }));
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

    const deps = new Set(depsArg.getElements().map(el => el.getText()));

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

      findings.push(finding('effect-self-update-loop', 'error', 'bug',
        `useEffect updates '${stateName}' via ${setterName}() while '${stateName}' is in deps — infinite re-render loop`,
        ctx.filePath, innerCall.getStartLineNumber(),
        { suggestion: `Move the write behind a guard or use a ref to break the cycle` }));
    }
  }

  return findings;
}

// ── Exported React Rules ─────────────────────────────────────────────────

export const reactRules = [
  asyncEffect,
  renderSideEffect,
  unstableKey,
  staleClosure,
  stateExplosion,
  hookOrder,
  effectSelfUpdateLoop,
];
