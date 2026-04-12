/**
 * React composition rules — catch prop-drilling and "parent rerenders child
 * that doesn't depend on parent state" antipatterns.
 *
 * These rules push toward the `children` prop pattern, which preserves
 * element identity across parent renders and lets React skip reconciliation
 * of unchanged subtrees.
 */

import type {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  JsxOpeningElement,
  JsxSelfClosingElement,
  ObjectBindingPattern,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

type ComponentFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** Is this node a React component function? (Capitalized name + returns JSX) */
function isComponentFunction(node: ComponentFn): { name: string; isComponent: boolean } {
  let name = '';
  if (Node.isFunctionDeclaration(node)) {
    name = node.getName() ?? '';
  } else {
    // Arrow/function expression — look at the parent variable declaration
    const parent = node.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      const n = parent.getNameNode();
      if (Node.isIdentifier(n)) name = n.getText();
    }
  }

  if (!name || !/^[A-Z]/.test(name)) return { name, isComponent: false };

  // Must contain JSX somewhere in the body
  const body = node.getBody();
  if (!body) return { name, isComponent: false };
  const hasJsx =
    body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0;
  return { name, isComponent: hasJsx };
}

/** Extract destructured prop names from the first parameter of a component function. */
function getDestructuredPropNames(fn: ComponentFn): string[] | undefined {
  const params = fn.getParameters();
  if (params.length === 0) return undefined;
  const nameNode = params[0].getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return undefined;

  const names: string[] = [];
  for (const el of (nameNode as ObjectBindingPattern).getElements()) {
    // Use the property name if aliased, otherwise the binding name
    const propName = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
    names.push(propName);
  }
  return names;
}

function iterComponentFunctions(ctx: RuleContext): ComponentFn[] {
  const results: ComponentFn[] = [];
  for (const fn of ctx.sourceFile.getFunctions()) {
    const info = isComponentFunction(fn);
    if (info.isComponent) results.push(fn);
  }
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        const info = isComponentFunction(init);
        if (info.isComponent) results.push(init);
      }
    }
  }
  return results;
}

// ── Rule: children-not-used ──────────────────────────────────────────────
// Component accepts `children` in its destructured props but never renders it.

function childrenNotUsed(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const propNames = getDestructuredPropNames(fn);
    if (!propNames || !propNames.includes('children')) continue;

    const body = fn.getBody();
    if (!body) continue;

    // Look for any identifier reference to `children` in the body
    let rendered = false;
    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (id.getText() !== 'children') continue;
      // Skip the declaration in the parameter binding — we want usage, not the binding itself
      const parent = id.getParent();
      if (parent && Node.isBindingElement(parent)) continue;
      rendered = true;
      break;
    }

    if (!rendered) {
      const { name } = isComponentFunction(fn);
      findings.push(
        finding(
          'children-not-used',
          'warning',
          'pattern',
          `'${name}' destructures 'children' from props but never renders it — dead API or forgotten {children}`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          {
            suggestion: `Render {children} in the JSX output, or remove 'children' from the props destructuring if the component should not accept children`,
          },
        ),
      );
    }
  }
  return findings;
}

// ── Rule: prop-drill-passthrough ─────────────────────────────────────────
// Component receives >= 3 props, body is a single JSX element, and >= 2 of
// those props are passed unchanged to that element without being read anywhere
// else. Suggest `children` or context.

function getSingleReturnedJsx(fn: ComponentFn): (JsxOpeningElement | JsxSelfClosingElement) | undefined {
  const body = fn.getBody();
  if (!body) return undefined;

  // Case 1: arrow function with implicit return — body IS the JSX
  if (Node.isJsxElement(body)) return body.getOpeningElement();
  if (Node.isJsxSelfClosingElement(body)) return body;
  if (Node.isJsxFragment(body)) return undefined; // fragments have multiple children

  // Case 2: block body — look for a single return statement at the top level
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    // Allow preamble (const x = ..., hook calls) but require the LAST statement to be a return with a single JSX root
    const ret = statements.find((s) => Node.isReturnStatement(s));
    if (!ret || !Node.isReturnStatement(ret)) return undefined;
    const expr = ret.getExpression();
    if (!expr) return undefined;
    // Walk through parentheses
    let unwrapped: Node = expr;
    while (Node.isParenthesizedExpression(unwrapped)) {
      unwrapped = unwrapped.getExpression();
    }
    if (Node.isJsxElement(unwrapped)) return unwrapped.getOpeningElement();
    if (Node.isJsxSelfClosingElement(unwrapped)) return unwrapped;
  }
  return undefined;
}

function propDrillPassthrough(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const propNames = getDestructuredPropNames(fn);
    if (!propNames || propNames.length < 3) continue;

    const root = getSingleReturnedJsx(fn);
    if (!root) continue;

    // The root element must be a custom component (capitalized tag) to be a meaningful passthrough.
    const tag = root.getTagNameNode().getText();
    if (!/^[A-Z]/.test(tag)) continue;

    // Collect prop names passed as attributes to the root child
    const passedToChild = new Set<string>();
    const passedWithShorthand = new Set<string>();
    for (const attr of root.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) continue;
      const attrName = attr.getNameNode().getText();
      const init = attr.getInitializer();
      if (!init) continue;
      if (!Node.isJsxExpression(init)) continue;
      const expr = init.getExpression();
      if (!expr) continue;
      if (Node.isIdentifier(expr) && expr.getText() === attrName) {
        // Classic shorthand: <Child user={user} theme={theme} />
        passedToChild.add(attrName);
        passedWithShorthand.add(attrName);
      }
    }

    // Count props read OUTSIDE of passing to the root child
    const body = fn.getBody();
    if (!body) continue;

    const bodyText = body.getText();
    // A prop is "consumed" if it appears somewhere other than as the RHS of an attribute
    // of the single root child. We approximate: count total identifier refs in the body,
    // and subtract the passthrough refs.
    const consumedProps = new Set<string>();
    for (const propName of propNames) {
      if (propName === 'children') continue;
      // Skip counting refs that are literally the attribute value of the root child
      const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const totalRefs = (bodyText.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length;
      const passthroughRefs = passedWithShorthand.has(propName) ? 1 : 0;
      if (totalRefs - passthroughRefs > 0) {
        consumedProps.add(propName);
      }
    }

    const passthroughCount = [...passedToChild].filter((p) => !consumedProps.has(p)).length;
    if (passthroughCount >= 2 && propNames.length >= 3) {
      const info = isComponentFunction(fn);
      findings.push(
        finding(
          'prop-drill-passthrough',
          'warning',
          'pattern',
          `'${info.name}' passes ${passthroughCount} of ${propNames.length} props through to <${tag}> without reading them — consider 'children' prop or React context`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          {
            suggestion: `Accept <${tag} .../> as the 'children' prop, or move the shared data into a React context. Passing props through an intermediate component forces it to re-render whenever any of them change.`,
          },
        ),
      );
    }
  }
  return findings;
}

// ── Rule: parent-rerender-via-state ──────────────────────────────────────
// Component holds useState AND renders a child component that receives NEITHER
// the state variables NOR the setters. That child will re-render on every
// state change for no reason — lifting it to `children` preserves its element
// identity and avoids the re-render.

function parentRerenderViaState(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    // Collect state variable names from `const [x, setX] = useState(...)`
    const stateVars = new Set<string>();
    for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const calleeText = init.getExpression().getText();
      const calleeName = calleeText.includes('.') ? calleeText.split('.').pop() : calleeText;
      if (calleeName !== 'useState' && calleeName !== 'useReducer') continue;
      const nameNode = decl.getNameNode();
      if (!Node.isArrayBindingPattern(nameNode)) continue;
      for (const el of nameNode.getElements()) {
        if (Node.isBindingElement(el)) {
          stateVars.add(el.getNameNode().getText());
        }
      }
    }

    if (stateVars.size === 0) continue;

    // Check if this component already accepts `children` — if so, the user is
    // probably already composing correctly.
    const propNames = getDestructuredPropNames(fn);
    const alreadyComposesChildren = propNames?.includes('children') ?? false;
    if (alreadyComposesChildren) continue;

    // Find direct-child custom-component JSX elements in the top-level return
    const root = getSingleReturnedJsx(fn);
    // If the return is a fragment or doesn't yield a single root, look at all custom children
    const candidates: (JsxOpeningElement | JsxSelfClosingElement)[] = [];

    if (root) {
      // Collect siblings of root (direct children of a fragment won't be here,
      // so also scan for Jsx elements with custom tag names nested anywhere)
    }

    // Gather all custom-tag JSX elements under the return statement that are
    // NOT wrapped in a map/conditional that reads state (we don't try to be smart;
    // we just check the attribute bag for state-var references).
    const allJsxOpeners: (JsxOpeningElement | JsxSelfClosingElement)[] = [
      ...body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const el of allJsxOpeners) {
      const tag = el.getTagNameNode().getText();
      if (!/^[A-Z]/.test(tag)) continue; // lowercase = HTML element
      candidates.push(el);
    }

    if (candidates.length === 0) continue;

    for (const el of candidates) {
      // Does this child reference any state var in any attribute?
      let receivesState = false;
      for (const attr of el.getAttributes()) {
        if (!Node.isJsxAttribute(attr)) continue;
        const init = attr.getInitializer();
        if (!init || !Node.isJsxExpression(init)) continue;
        const exprText = init.getText();
        for (const v of stateVars) {
          const re = new RegExp(`\\b${v}\\b`);
          if (re.test(exprText)) {
            receivesState = true;
            break;
          }
        }
        if (receivesState) break;
      }
      if (receivesState) continue;

      // And does the child tag text itself reference state? (e.g. conditional)
      // Walk upward: is this JSX element inside a JsxExpression that references state?
      const parent = el.getParent();
      if (parent && Node.isJsxExpression(parent)) {
        const exprText = parent.getText();
        let mentioned = false;
        for (const v of stateVars) {
          if (new RegExp(`\\b${v}\\b`).test(exprText)) {
            mentioned = true;
            break;
          }
        }
        if (mentioned) continue;
      }

      // Flag: this child re-renders on every state change for nothing.
      const tag = el.getTagNameNode().getText();
      const info = isComponentFunction(fn);
      findings.push(
        finding(
          'parent-rerender-via-state',
          'info',
          'pattern',
          `<${tag}> is rendered by '${info.name}' but does not receive any of its state variables (${[...stateVars].slice(0, 3).join(', ')}${stateVars.size > 3 ? '…' : ''}) — it re-renders on every state change. Consider lifting it to the 'children' prop so React can reuse the element.`,
          ctx.filePath,
          el.getStartLineNumber(),
          1,
          {
            suggestion: `Accept <${tag}> as the 'children' prop of '${info.name}' and render it with {children}. The caller composes: <${info.name}><${tag} /></${info.name}>. React will reuse the child element across re-renders.`,
          },
        ),
      );
      break; // one finding per component is enough — avoid noise
    }
  }
  return findings;
}

// ── Exported composition rules ───────────────────────────────────────────

export const reactCompositionRules = [childrenNotUsed, propDrillPassthrough, parentRerenderViaState];
