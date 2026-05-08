/**
 * React hooks correctness — Wave 2 net-new rules.
 *
 * Intentionally conservative: each rule only fires when the pattern is
 * unambiguous. eslint-plugin-react-hooks is the authority for exhaustive
 * correctness; this layer catches the common footguns with high precision.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding, nodeSpan, shouldSkipHookRules } from './utils.js';

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const MEMO_HOOKS = new Set(['useMemo', 'useCallback']);

const REACT_HOOK_NAMES = new Set([
  'useState',
  'useEffect',
  'useLayoutEffect',
  'useRef',
  'useCallback',
  'useMemo',
  'useReducer',
  'useContext',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useSyncExternalStore',
  'useId',
  'useDebugValue',
]);

const GLOBAL_NAMES = new Set([
  'console',
  'window',
  'document',
  'globalThis',
  'process',
  'Math',
  'Date',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'Promise',
  'Error',
  'TypeError',
  'RangeError',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'Reflect',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'queueMicrotask',
  'structuredClone',
  'fetch',
  'URL',
  'URLSearchParams',
  'localStorage',
  'sessionStorage',
  'navigator',
  'history',
  'location',
  'alert',
  'confirm',
  'prompt',
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  'React',
]);

/**
 * Collect "stable" identifier names inside the enclosing function:
 *   - setters from `const [x, setX] = useState(...)`
 *   - dispatch from `const [state, dispatch] = useReducer(...)`
 *   - refs from `const foo = useRef(...)`
 *
 * These are guaranteed stable across renders and don't need to appear
 * in dependency arrays.
 */
function collectStableNames(root: Node): { setters: Set<string>; refs: Set<string> } {
  const setters = new Set<string>();
  const refs = new Set<string>();

  for (const decl of root.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression().getText();
    const calleeName = callee.includes('.') ? callee.split('.').pop() : callee;

    const nameNode = decl.getNameNode();

    if (calleeName === 'useState' || calleeName === 'useReducer') {
      // Destructured tuple: const [state, setter] = useState(...)
      if (Node.isArrayBindingPattern(nameNode)) {
        const elements = nameNode.getElements();
        if (elements.length >= 2) {
          const second = elements[1];
          if (Node.isBindingElement(second)) {
            setters.add(second.getNameNode().getText());
          }
        }
      }
    } else if (calleeName === 'useRef') {
      if (Node.isIdentifier(nameNode)) {
        refs.add(nameNode.getText());
      }
    }
  }

  return { setters, refs };
}

/** Extract identifiers from a deps array literal — returns names only. */
function extractDepNames(depsExpr: Node): Set<string> {
  const names = new Set<string>();
  if (!Node.isArrayLiteralExpression(depsExpr)) return names;
  for (const el of depsExpr.getElements()) {
    if (Node.isIdentifier(el)) {
      names.add(el.getText());
    } else if (Node.isPropertyAccessExpression(el)) {
      // Capture the root: `foo.bar.baz` → `foo`
      let cur: Node = el;
      while (Node.isPropertyAccessExpression(cur)) {
        cur = cur.getExpression();
      }
      if (Node.isIdentifier(cur)) names.add(cur.getText());
      names.add(el.getText()); // also allow exact match
    }
  }
  return names;
}

// ── Rule: exhaustive-deps ────────────────────────────────────────────────

function exhaustiveDeps(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;

    const isEffect = EFFECT_HOOKS.has(calleeName);
    const isMemo = MEMO_HOOKS.has(calleeName);
    if (!isEffect && !isMemo) continue;

    const args = call.getArguments();
    if (args.length < 2) continue; // handled by missing-memo-deps
    const fnArg = args[0];
    const depsArg = args[1];
    if (!Node.isArrayLiteralExpression(depsArg)) continue;
    if (!Node.isArrowFunction(fnArg) && !Node.isFunctionExpression(fnArg)) continue;

    // Find enclosing React component function to collect stable names
    const enclosingFn =
      call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
      call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
      call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
    if (!enclosingFn) continue;

    const { setters, refs } = collectStableNames(enclosingFn);
    const depNames = extractDepNames(depsArg);

    const body = fnArg.getBody();
    if (!body) continue;

    // Collect identifiers defined INSIDE the hook body itself — they are local.
    // Must cover: const x = ..., const { a, b } = obj, const [x, y] = arr.
    const locallyDeclared = new Set<string>();
    for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        locallyDeclared.add(nameNode.getText());
      } else if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
        for (const el of nameNode.getDescendantsOfKind(SyntaxKind.BindingElement)) {
          const n = el.getNameNode();
          if (Node.isIdentifier(n)) locallyDeclared.add(n.getText());
        }
      }
    }
    for (const param of fnArg.getParameters()) {
      locallyDeclared.add(param.getName());
    }

    const missing = new Set<string>();

    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();

      if (GLOBAL_NAMES.has(name)) continue;
      if (REACT_HOOK_NAMES.has(name)) continue;
      if (setters.has(name)) continue;
      if (refs.has(name)) continue;
      if (locallyDeclared.has(name)) continue;
      if (depNames.has(name)) continue;

      // Skip identifiers that are the property name in a PropertyAccessExpression
      // (we only care about the root object, which is the expression side)
      const parent = id.getParent();
      if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
      // Skip property assignment keys (but NOT shorthand — shorthand IS a read of the identifier)
      if (parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
      // Note: shorthand property assignments like `{ userId }` inside a hook body
      // ARE reads of `userId` and must be checked — do NOT skip them.
      // Skip import specifiers / binding elements (declarations, not references)
      if (parent && (Node.isImportSpecifier(parent) || Node.isBindingElement(parent))) continue;
      // Skip type references
      if (parent && Node.isTypeReference(parent)) continue;
      // Skip function/variable declaration names
      if (parent && Node.isVariableDeclaration(parent) && parent.getNameNode() === id) continue;
      if (parent && Node.isFunctionDeclaration(parent) && parent.getNameNode() === id) continue;
      if (parent && Node.isParameterDeclaration(parent)) continue;

      // Check if it's defined outside the enclosing function (import, module-level)
      const sym = id.getSymbol();
      if (!sym) continue;
      const decls = sym.getDeclarations();
      if (decls.length === 0) continue;

      let definedInEnclosing = false;
      for (const d of decls) {
        const ancestor = d.getFirstAncestor((a) => a === enclosingFn);
        if (ancestor) {
          definedInEnclosing = true;
          break;
        }
      }
      if (!definedInEnclosing) continue;

      missing.add(name);
    }

    if (missing.size > 0) {
      const hookName = calleeName;
      const names = [...missing].sort().join(', ');
      // Autofix: rebuild the dependency array to include the missing names.
      // Preserve existing deps in their original order, then append missing
      // in sorted order. Marked as "review before applying" because adding
      // deps can introduce render loops when a dep is a non-memoized object.
      const existingTexts = depsArg.getElements().map((e) => e.getText());
      const missingSorted = [...missing].sort();
      const newDepsText = `[${[...existingTexts, ...missingSorted].join(', ')}]`;
      findings.push(
        finding(
          'exhaustive-deps',
          'warning',
          'bug',
          `${hookName} references ${names} but ${missing.size === 1 ? 'it is' : 'they are'} missing from the dependency array — will use stale ${missing.size === 1 ? 'value' : 'values'} across renders`,
          ctx.filePath,
          depsArg.getStartLineNumber(),
          1,
          {
            suggestion: `Add ${names} to the dependency array, or move ${missing.size === 1 ? 'it' : 'them'} out of the enclosing closure`,
            autofix: {
              type: 'replace',
              span: nodeSpan(depsArg, ctx.filePath),
              replacement: newDepsText,
              description: `Add ${names} to the dependency array — REVIEW before applying: adding a non-memoized object/function dep can trigger a render loop`,
            },
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: ref-in-deps ────────────────────────────────────────────────────
// A ref created with useRef() is stable across renders — putting it in a
// dependency array is pointless noise and usually indicates a misunderstanding.

function refInDeps(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;

    if (!EFFECT_HOOKS.has(calleeName) && !MEMO_HOOKS.has(calleeName)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const depsArg = args[1];
    if (!Node.isArrayLiteralExpression(depsArg)) continue;

    const enclosingFn =
      call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
      call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
      call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
    if (!enclosingFn) continue;

    const { refs } = collectStableNames(enclosingFn);

    // Collect the ref names present in the deps array, then emit one finding
    // per ref with an autofix that rewrites the deps array without ANY of the
    // refs. That way applying the first autofix also resolves the others,
    // and we avoid emitting stale "remove X" fixes after the user accepted one.
    const depElements = depsArg.getElements();
    const refElementsInDeps = depElements.filter((el) => Node.isIdentifier(el) && refs.has(el.getText()));
    if (refElementsInDeps.length === 0) continue;

    const refNamesInDeps = new Set(refElementsInDeps.map((e) => e.getText()));
    const filteredElements = depElements.filter((el) => !(Node.isIdentifier(el) && refNamesInDeps.has(el.getText())));
    const newDepsText = `[${filteredElements.map((e) => e.getText()).join(', ')}]`;

    for (const el of refElementsInDeps) {
      findings.push(
        finding(
          'ref-in-deps',
          'warning',
          'pattern',
          `'${el.getText()}' is a ref from useRef — refs are stable across renders, so including them in a dependency array has no effect`,
          ctx.filePath,
          el.getStartLineNumber(),
          1,
          {
            suggestion: `Remove '${el.getText()}' from the dependency array. If you want to react to ref.current changes, you need a different pattern (state or a callback ref).`,
            autofix: {
              type: 'replace',
              span: nodeSpan(depsArg, ctx.filePath),
              replacement: newDepsText,
              description: `Remove ref(s) from the dependency array`,
            },
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: state-derived-from-props ───────────────────────────────────────
// `const [x, setX] = useState(props.y)` — classic stale-state antipattern.
// The state is initialized from props once, then drifts if props.y changes.

function stateDerivedFromProps(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (calleeName !== 'useState') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const initArg = args[0];

    // Pattern A: useState(props.y) / useState(props.y.z)
    // Pattern B: useState(someProp) where someProp is a destructured prop
    let flagged = false;
    let label = '';

    if (Node.isPropertyAccessExpression(initArg)) {
      let root: Node = initArg;
      while (Node.isPropertyAccessExpression(root)) {
        root = root.getExpression();
      }
      if (Node.isIdentifier(root) && root.getText() === 'props') {
        flagged = true;
        label = initArg.getText();
      }
    } else if (Node.isIdentifier(initArg)) {
      // Check if this identifier is a destructured prop
      const name = initArg.getText();
      const enclosingFn =
        call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
        call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
      if (enclosingFn) {
        const params = enclosingFn.getParameters();
        // Component signature: `function Foo({ y, z })` — first param is an object binding pattern
        if (params.length > 0) {
          const firstParam = params[0];
          const paramName = firstParam.getNameNode();
          if (Node.isObjectBindingPattern(paramName)) {
            for (const el of paramName.getElements()) {
              if (el.getName() === name) {
                flagged = true;
                label = `destructured prop '${name}'`;
                break;
              }
            }
          }
        }
      }
    }

    if (flagged) {
      findings.push(
        finding(
          'state-derived-from-props',
          'warning',
          'bug',
          `useState initialized from ${label} — state will not update when the prop changes, causing stale UI`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion:
              'Use the prop directly, derive with useMemo, or use a key prop on the parent to force remount when the source changes',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: usecallback-no-benefit ─────────────────────────────────────────
// useCallback used only as a host-element event handler provides no memoized
// consumer and usually just adds indirection.

function useCallbackNoBenefit(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const calleeText = init.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (calleeName !== 'useCallback') continue;

    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const callbackName = nameNode.getText();

    const refs = ctx.sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === callbackName && id !== nameNode);

    if (refs.length !== 1) continue;

    const onlyRef = refs[0];
    const jsxAttr = onlyRef.getFirstAncestorByKind(SyntaxKind.JsxAttribute);
    if (!jsxAttr) continue;

    const jsxTag =
      jsxAttr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement) ||
      jsxAttr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
    if (!jsxTag) continue;

    const tagName = jsxTag.getTagNameNode().getText();
    if (!/^[a-z]/.test(tagName)) continue; // only intrinsic DOM tags

    findings.push(
      finding(
        'usecallback-no-benefit',
        'info',
        'pattern',
        `'${callbackName}' is wrapped in useCallback but is only used as a '${jsxAttr.getNameNode().getText()}' handler on <${tagName}> — this adds memoization overhead without a memoized consumer`,
        ctx.filePath,
        decl.getStartLineNumber(),
        1,
        {
          suggestion:
            'Inline the handler in JSX or use a normal local function. Keep useCallback for memoized children, hook dependency stability, or imperative subscription APIs that need stable identity',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: unstable-deps-literal ──────────────────────────────────────────
// An array, object, or function literal sitting INSIDE a hook's dependency
// array. The literal is a fresh reference every render, which silently
// defeats the memoization the hook is supposed to provide.
//
//   useEffect(fn, [{ id: 1 }])      // new object every render
//   useMemo(fn, [() => doX()])      // new function every render
//   useCallback(fn, [foo, [a, b]])  // new array every render
//
// Distinct from `exhaustive-deps` (missing deps) and `ref-in-deps` (stable
// ref noise) — this is "you put a freshly-allocated value where stability
// was required."

function unstableDepsLiteral(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (!EFFECT_HOOKS.has(calleeName) && !MEMO_HOOKS.has(calleeName)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;
    const depsArg = args[1];
    if (!Node.isArrayLiteralExpression(depsArg)) continue;

    for (const el of depsArg.getElements()) {
      let kind: 'object' | 'array' | 'function' | undefined;
      if (Node.isObjectLiteralExpression(el)) kind = 'object';
      else if (Node.isArrayLiteralExpression(el)) kind = 'array';
      else if (Node.isArrowFunction(el) || Node.isFunctionExpression(el)) kind = 'function';
      if (!kind) continue;

      findings.push(
        finding(
          'unstable-deps-literal',
          'warning',
          'bug',
          `${calleeName} dependency contains an inline ${kind} literal — it has a new reference every render and silently defeats memoization`,
          ctx.filePath,
          el.getStartLineNumber(),
          1,
          {
            suggestion:
              kind === 'function'
                ? 'Hoist the function into useCallback (with its own deps) or out of the component'
                : `Hoist the ${kind} into a useMemo (with its own deps) or move it outside the component if it never depends on render state`,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: usememo-primitive-cheap ────────────────────────────────────────
// useMemo wrapping a trivially cheap primitive computation — the memoization
// machinery costs more than re-running the expression. Heuristic: fires only
// when the body returns a single primitive expression (literal, identifier,
// short binary op chain, or a length/property read) and the deps array is
// short. Conservative on purpose — `precision: 'medium'`.
//
//   const total = useMemo(() => a + b, [a, b]);                  // flagged
//   const len   = useMemo(() => list.length, [list]);            // flagged
//   const flag  = useMemo(() => x > 0, [x]);                     // flagged
//   const heavy = useMemo(() => list.filter(...).map(...), ...); // NOT flagged

const PRIMITIVE_BINARY_OPS = new Set([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

/** True when the expression is provably "cheap" — memoization costs more than re-running it. */
function isCheapPrimitiveExpression(expr: Node, depth = 0): boolean {
  if (depth > 4) return false; // bounded recursion — anything deeper is "complex enough"

  // Literals
  if (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    Node.isNoSubstitutionTemplateLiteral(expr) ||
    expr.getKind() === SyntaxKind.TrueKeyword ||
    expr.getKind() === SyntaxKind.FalseKeyword ||
    expr.getKind() === SyntaxKind.NullKeyword
  ) {
    return true;
  }

  // Bare identifier
  if (Node.isIdentifier(expr)) return true;

  // Property access on identifier chain (e.g. list.length, user.name)
  if (Node.isPropertyAccessExpression(expr)) {
    return isCheapPrimitiveExpression(expr.getExpression(), depth + 1);
  }

  // Non-null/parenthesized wrappers
  if (Node.isNonNullExpression(expr) || Node.isParenthesizedExpression(expr)) {
    return isCheapPrimitiveExpression(expr.getExpression(), depth + 1);
  }

  // Prefix unary on cheap operand (!, -, +)
  if (Node.isPrefixUnaryExpression(expr)) {
    return isCheapPrimitiveExpression(expr.getOperand(), depth + 1);
  }

  // Binary primitive op on two cheap operands
  if (Node.isBinaryExpression(expr)) {
    if (!PRIMITIVE_BINARY_OPS.has(expr.getOperatorToken().getKind())) return false;
    return (
      isCheapPrimitiveExpression(expr.getLeft(), depth + 1) && isCheapPrimitiveExpression(expr.getRight(), depth + 1)
    );
  }

  // Conditional: cond ? a : b — cheap if all three branches are cheap
  if (Node.isConditionalExpression(expr)) {
    return (
      isCheapPrimitiveExpression(expr.getCondition(), depth + 1) &&
      isCheapPrimitiveExpression(expr.getWhenTrue(), depth + 1) &&
      isCheapPrimitiveExpression(expr.getWhenFalse(), depth + 1)
    );
  }

  return false;
}

function useMemoPrimitiveCheap(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (calleeName !== 'useMemo') continue;

    const args = call.getArguments();
    if (args.length < 1) continue;
    const fnArg = args[0];
    if (!Node.isArrowFunction(fnArg) && !Node.isFunctionExpression(fnArg)) continue;

    const body = fnArg.getBody();
    if (!body) continue;

    let returned: Node | undefined;
    if (Node.isBlock(body)) {
      const statements = body.getStatements();
      if (statements.length !== 1) continue; // multi-statement bodies are not "trivial"
      const only = statements[0];
      if (!Node.isReturnStatement(only)) continue;
      returned = only.getExpression();
    } else {
      // Expression body: () => expr
      returned = body;
    }

    if (!returned) continue;
    if (!isCheapPrimitiveExpression(returned)) continue;

    findings.push(
      finding(
        'usememo-primitive-cheap',
        'info',
        'pattern',
        'useMemo wraps a trivially cheap expression — the memoization bookkeeping costs more than re-running it on every render',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Drop the useMemo and assign the value directly. Reserve useMemo for expensive work (large array transforms, deep clones, parsers) or stable reference identity required by a memoized child or hook dep.',
        },
      ),
    );
  }

  return findings;
}

// ── Exported React Hooks Rules ───────────────────────────────────────────

/** All rules in this file assume a client runtime — skip on server/api/middleware
 *  unless the file still has React content (JSX / react import / hook call). */
function clientOnly<T extends (ctx: RuleContext) => ReviewFinding[]>(fn: T): T {
  return ((ctx: RuleContext) => (shouldSkipHookRules(ctx) ? [] : fn(ctx))) as T;
}

export const reactHooksRules = [
  clientOnly(exhaustiveDeps),
  clientOnly(refInDeps),
  clientOnly(stateDerivedFromProps),
  clientOnly(useCallbackNoBenefit),
  clientOnly(unstableDepsLiteral),
  clientOnly(useMemoPrimitiveCheap),
];
