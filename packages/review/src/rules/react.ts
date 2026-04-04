/**
 * React review rules — active when target = nextjs | tailwind | web | native.
 *
 * Catches React-specific bugs that KERN IR + AST can detect mechanically.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

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
        findings.push(
          finding(
            'async-effect',
            'error',
            'bug',
            'useEffect callback must not be async — use an inner async function instead',
            ctx.filePath,
            callback.getStartLineNumber(),
            1,
            { suggestion: 'useEffect(() => { async function run() { ... } run(); }, [])' },
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
        findings.push(
          finding(
            'render-side-effect',
            'error',
            'bug',
            `setState called in render body of '${name}' — move to useEffect or event handler`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
          ),
        );
      }

      const expr = exprStmt.getExpression();
      if (Node.isCallExpression(expr) && expr.getExpression().getText() === 'fetch') {
        findings.push(
          finding(
            'render-side-effect',
            'error',
            'bug',
            `fetch() called in render body of '${name}' — move to useEffect or event handler`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
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
    if (callback.getKind() !== SyntaxKind.ArrowFunction && callback.getKind() !== SyntaxKind.FunctionExpression)
      continue;

    // Get the index parameter (second param of the callback)
    const params =
      callback.getKind() === SyntaxKind.ArrowFunction
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
    const attributes =
      firstJsx.getKind() === SyntaxKind.JsxSelfClosingElement
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
      findings.push(
        finding(
          'unstable-key',
          'warning',
          'bug',
          `key={${indexParam}} uses array index — use a stable identifier instead`,
          ctx.filePath,
          line,
          1,
          { suggestion: 'Use a unique ID from the data (e.g., key={item.id})' },
        ),
      );
    } else if (!hasKey) {
      findings.push(
        finding('unstable-key', 'warning', 'bug', 'JSX in .map() is missing a key prop', ctx.filePath, line, 1, {
          suggestion: 'Add key={item.id} to the root JSX element in .map()',
        }),
      );
    }
  }

  return findings;
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
      findings.push(
        finding(
          'stale-closure',
          'warning',
          'bug',
          'Timer in useEffect with empty deps [] may capture stale state',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: 'Use a ref for the latest value or add dependencies' },
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
      findings.push(
        finding(
          'state-explosion',
          'warning',
          'pattern',
          `Component '${name}' has ${useStates.length} useState calls — consider useReducer or a state machine`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          { suggestion: 'Use useReducer for complex state, or a KERN machine node for state transitions' },
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

      findings.push(
        finding(
          'hook-order',
          'error',
          'bug',
          `Hook '${hookName}' called inside ${label} — violates Rules of Hooks`,
          ctx.filePath,
          cfNode.getStartLineNumber(),
          1,
          { suggestion: 'Move hook call to top level of component' },
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

      findings.push(
        finding(
          'effect-self-update-loop',
          'error',
          'bug',
          `useEffect updates '${stateName}' via ${setterName}() while '${stateName}' is in deps — infinite re-render loop`,
          ctx.filePath,
          innerCall.getStartLineNumber(),
          1,
          { suggestion: `Move the write behind a guard or use a ref to break the cycle` },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: missing-effect-cleanup ─────────────────────────────────────────
// useEffect with setInterval/addEventListener but no cleanup return function

function missingEffectCleanup(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'useEffect' && callee !== 'useLayoutEffect') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const callback = args[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const body = callback.getBody();
    let hasCleanup = false;

    if (Node.isBlock(body)) {
      hasCleanup = body.getStatements().some((s) => {
        if (!Node.isReturnStatement(s)) return false;
        const expr = s.getExpression();
        return (
          expr != null && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr) || Node.isIdentifier(expr))
        );
      });
    }

    if (hasCleanup) continue;

    const leakyCalls = callback.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      const name = c.getExpression().getText();
      return (
        name === 'setInterval' || name === 'setTimeout' || name.endsWith('.addEventListener') || name.endsWith('.on')
      );
    });

    if (leakyCalls.length > 0) {
      findings.push(
        finding(
          'missing-effect-cleanup',
          'warning',
          'bug',
          `useEffect uses '${leakyCalls[0].getExpression().getText()}' but is missing a cleanup return function`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: 'Return a cleanup function: return () => clearInterval(id);' },
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
        findings.push(
          finding(
            'inline-context-value',
            'warning',
            'pattern',
            'Inline object/array passed to Context.Provider value — causes all consumers to re-render',
            ctx.filePath,
            jsx.getStartLineNumber(),
            1,
            { suggestion: 'Memoize the value with useMemo' },
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

  // Collect useRef variable names: const myRef = useRef(...)
  const refVars = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression().getText();
    if (callee === 'useRef' || callee === 'React.useRef') {
      refVars.add(decl.getName());
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
    const ifAncestor = prop.getFirstAncestorByKind(SyntaxKind.IfStatement);
    if (ifAncestor) {
      const condText = ifAncestor.getExpression().getText();
      const refName = obj.getText();
      if (
        condText.includes(`${refName}.current`) &&
        (condText.includes('null') || condText.includes('undefined') || condText.startsWith('!'))
      ) {
        continue;
      }
    }

    // Check if this is a read or write
    const parent = prop.getParent();
    const isWrite =
      parent &&
      Node.isBinaryExpression(parent) &&
      parent.getLeft() === prop &&
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken;

    const action = isWrite ? 'written to' : 'read';
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
      findings.push(
        finding(
          'missing-memo-deps',
          'warning',
          'bug',
          `${hookName} called without dependency array — will recompute on every render, defeating memoization`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: `Add a dependency array as the second argument: ${hookName}(fn, [dep1, dep2])` },
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
            { suggestion: `return { ...${stateParam}, ${left.getName()}: newValue }` },
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
            { suggestion: `Return new state: return { ...${stateParam}, ... }` },
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
            { suggestion: `return { ...${stateParam}, ${operand.getName()}: ${stateParam}.${operand.getName()} + 1 }` },
          ),
        );
        break;
      }
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
  missingEffectCleanup,
  inlineContextValue,
  refInRender,
  missingMemoDeps,
  reducerMutation,
];
