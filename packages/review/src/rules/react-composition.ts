/**
 * React composition rules — catch prop-drilling and "parent rerenders child
 * that doesn't depend on parent state" antipatterns.
 *
 * These rules push toward the `children` prop pattern, which preserves
 * element identity across parent renders and lets React skip reconciliation
 * of unchanged subtrees.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  JsxOpeningElement,
  JsxSelfClosingElement,
  ObjectBindingPattern,
  VariableDeclaration,
} from 'ts-morph';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding, nodeSpan } from './utils.js';

type ComponentFn = FunctionDeclaration | ArrowFunction | FunctionExpression;
type PropBinding = { propName: string; localName: string };
type PassthroughAnalysis = {
  componentName: string;
  childTag: string;
  passthroughProps: string[];
};
type ImportBinding = {
  importDecl: import('ts-morph').ImportDeclaration;
  importedName: string;
  isDefault: boolean;
};

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
function getDestructuredPropBindings(fn: ComponentFn): PropBinding[] | undefined {
  const params = fn.getParameters();
  if (params.length === 0) return undefined;
  const nameNode = params[0].getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return undefined;

  const bindings: PropBinding[] = [];
  for (const el of (nameNode as ObjectBindingPattern).getElements()) {
    // Use the property name if aliased, otherwise the binding name
    const propName = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
    const localName = el.getNameNode().getText();
    bindings.push({ propName, localName });
  }
  return bindings;
}

function getPropsParamName(fn: ComponentFn): string | undefined {
  const params = fn.getParameters();
  if (params.length === 0) return undefined;
  const nameNode = params[0].getNameNode();
  if (Node.isIdentifier(nameNode)) return nameNode.getText();
  return undefined;
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
    const propBindings = getDestructuredPropBindings(fn);
    if (!propBindings?.some((p) => p.propName === 'children')) continue;

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

      // Autofix: remove the `children` entry from the destructured props
      // pattern. Only applies when the binding pattern is simple (no renames,
      // defaults, or rest — those are fine, we just leave them alone here).
      let autofixAction: ReviewFinding['autofix'] | undefined;
      const firstParam = fn.getParameters()[0];
      if (firstParam) {
        const nameNode = firstParam.getNameNode();
        if (Node.isObjectBindingPattern(nameNode)) {
          const elements = (nameNode as ObjectBindingPattern).getElements();
          const remaining = elements.filter((el) => {
            const propName = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
            return propName !== 'children';
          });
          // Reconstruct a clean `{ a, b, c }` pattern using each element's
          // original text. Preserves renames, defaults, and rest operators.
          const rebuilt = `{ ${remaining.map((el) => el.getText()).join(', ')} }`;
          autofixAction = {
            type: 'replace' as const,
            span: nodeSpan(nameNode, ctx.filePath),
            replacement: rebuilt,
            description: `Remove unused 'children' from the props destructuring`,
          };
        }
      }

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
            ...(autofixAction ? { autofix: autofixAction } : {}),
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

function analyzePassthroughComponent(fn: ComponentFn): PassthroughAnalysis | undefined {
  const propBindings = getDestructuredPropBindings(fn) ?? [];
  const propsParamName = getPropsParamName(fn);
  if (propBindings.length === 0 && !propsParamName) return undefined;

  const root = getSingleReturnedJsx(fn);
  if (!root) return undefined;

  const tag = root.getTagNameNode().getText();
  if (!/^[A-Z]/.test(tag)) return undefined;

  const bindingByLocal = new Map(propBindings.map((b) => [b.localName, b]));
  const passedToChild = new Map<string, { attrExpr: import('ts-morph').Node; localName?: string }>();
  for (const attr of root.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) continue;
    const init = attr.getInitializer();
    if (!init) continue;
    if (!Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (!expr) continue;

    if (Node.isIdentifier(expr)) {
      const binding = bindingByLocal.get(expr.getText());
      if (binding) {
        passedToChild.set(binding.propName, { attrExpr: expr, localName: binding.localName });
      }
      continue;
    }

    if (propsParamName && Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression();
      if (Node.isIdentifier(obj) && obj.getText() === propsParamName) {
        passedToChild.set(expr.getName(), { attrExpr: expr });
      }
    }
  }

  if (passedToChild.size < 2) return undefined;

  const body = fn.getBody();
  if (!body) return undefined;

  const consumedProps = new Set<string>();

  for (const [propName, { attrExpr, localName }] of passedToChild) {
    if (propName === 'children') continue;

    if (localName) {
      for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (id.getText() !== localName) continue;
        const parent = id.getParent();
        if (parent && Node.isBindingElement(parent)) continue;
        if (parent && Node.isJsxAttribute(parent) && parent.getNameNode() === id) continue;
        if (id === attrExpr) continue;
        consumedProps.add(propName);
        break;
      }
    } else if (propsParamName) {
      for (const access of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        if (access === attrExpr) continue;
        const obj = access.getExpression();
        if (Node.isIdentifier(obj) && obj.getText() === propsParamName && access.getName() === propName) {
          consumedProps.add(propName);
          break;
        }
      }
    }
  }

  const passthroughProps = [...passedToChild.keys()].filter((p) => p !== 'children' && !consumedProps.has(p));
  if (passthroughProps.length < 2) return undefined;

  const info = isComponentFunction(fn);
  return {
    componentName: info.name,
    childTag: tag,
    passthroughProps,
  };
}

function findComponentFunctionByName(
  sourceFile: import('ts-morph').SourceFile,
  componentName: string,
): ComponentFn | undefined {
  for (const fn of sourceFile.getFunctions()) {
    const info = isComponentFunction(fn);
    if (info.isComponent && info.name === componentName) return fn;
  }
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
      const info = isComponentFunction(init);
      if (info.isComponent && info.name === componentName) return init;
    }
  }
  return undefined;
}

function isMemoCall(expr: Node | undefined): expr is CallExpression {
  return Node.isCallExpression(expr) && ['memo', 'React.memo'].includes(expr.getExpression().getText());
}

function findVariableDeclarationByName(
  sourceFile: import('ts-morph').SourceFile,
  variableName: string,
): VariableDeclaration | undefined {
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() === variableName) return decl;
    }
  }
  return undefined;
}

function findImportBinding(ctx: RuleContext, localName: string): ImportBinding | undefined {
  for (const decl of ctx.sourceFile.getImportDeclarations()) {
    const defaultImport = decl.getDefaultImport();
    if (defaultImport?.getText() === localName) {
      return { importDecl: decl, importedName: 'default', isDefault: true };
    }

    for (const named of decl.getNamedImports()) {
      const boundLocal = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
      if (boundLocal === localName) {
        return { importDecl: decl, importedName: named.getNameNode().getText(), isDefault: false };
      }
    }
  }
  return undefined;
}

function findDefaultExportedComponentFunction(sourceFile: import('ts-morph').SourceFile): ComponentFn | undefined {
  for (const fn of sourceFile.getFunctions()) {
    const info = isComponentFunction(fn);
    if (info.isComponent && fn.isDefaultExport()) return fn;
  }

  for (const assign of sourceFile.getExportAssignments()) {
    const expr = assign.getExpression();
    if (!expr) continue;

    if (Node.isIdentifier(expr)) {
      const resolved = findComponentFunctionByName(sourceFile, expr.getText());
      if (resolved) return resolved;
    }

    if (isMemoCall(expr)) {
      const firstArg = expr.getArguments()[0];
      if (firstArg && (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg))) {
        const info = isComponentFunction(firstArg);
        if (info.isComponent) return firstArg;
      }
    }
  }

  return undefined;
}

function findImportedComponentFunction(
  sourceFile: import('ts-morph').SourceFile,
  binding: ImportBinding,
): ComponentFn | undefined {
  return binding.isDefault
    ? findDefaultExportedComponentFunction(sourceFile)
    : findComponentFunctionByName(sourceFile, binding.importedName);
}

function isMemoizedExport(sourceFile: import('ts-morph').SourceFile, binding: ImportBinding): boolean {
  if (binding.isDefault) {
    for (const assign of sourceFile.getExportAssignments()) {
      const expr = assign.getExpression();
      if (!expr) continue;
      if (isMemoCall(expr)) return true;
      if (Node.isIdentifier(expr)) {
        const decl = findVariableDeclarationByName(sourceFile, expr.getText());
        if (decl && isMemoCall(decl.getInitializer())) return true;
      }
    }
    return false;
  }

  const decl = findVariableDeclarationByName(sourceFile, binding.importedName);
  return !!decl && isMemoCall(decl.getInitializer());
}

function resolveImportedSourceFile(
  ctx: RuleContext,
  importDecl: import('ts-morph').ImportDeclaration,
): import('ts-morph').SourceFile | undefined {
  let resolved: import('ts-morph').SourceFile | undefined;
  try {
    resolved = importDecl.getModuleSpecifierSourceFile() ?? undefined;
  } catch {
    return undefined;
  }
  if (resolved) return resolved;

  const spec = importDecl.getModuleSpecifierValue();
  if (!spec.startsWith('.')) return undefined;

  const baseDir = dirname(ctx.filePath);
  const candidates: string[] = [];
  if (/\.[cm]?[jt]sx?$/.test(spec)) {
    candidates.push(resolve(baseDir, spec));
    if (spec.endsWith('.js')) {
      candidates.push(resolve(baseDir, `${spec.slice(0, -3)}.ts`));
      candidates.push(resolve(baseDir, `${spec.slice(0, -3)}.tsx`));
    } else if (spec.endsWith('.jsx')) {
      candidates.push(resolve(baseDir, `${spec.slice(0, -4)}.tsx`));
    }
  } else {
    candidates.push(resolve(baseDir, `${spec}.ts`));
    candidates.push(resolve(baseDir, `${spec}.tsx`));
    candidates.push(resolve(baseDir, `${spec}/index.ts`));
    candidates.push(resolve(baseDir, `${spec}/index.tsx`));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const auxProject = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { target: 99, module: 99, moduleResolution: 100, jsx: 4 },
    });
    return auxProject.createSourceFile(candidate, readFileSync(candidate, 'utf-8'), { overwrite: true });
  }

  return undefined;
}

function propDrillPassthrough(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const analysis = analyzePassthroughComponent(fn);
    if (analysis) {
      const passthroughCount = analysis.passthroughProps.length;
      findings.push(
        finding(
          'prop-drill-passthrough',
          'warning',
          'pattern',
          `'${analysis.componentName}' passes ${passthroughCount} prop${passthroughCount === 1 ? '' : 's'} (${analysis.passthroughProps.join(', ')}) through to <${analysis.childTag}> without reading ${passthroughCount === 1 ? 'it' : 'them'} — consider 'children' prop or React context`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          {
            suggestion: `Accept <${analysis.childTag} .../> as the 'children' prop, or move the shared data into a React context. Passing props through an intermediate component forces it to re-render whenever any of them change.`,
          },
        ),
      );
    }
  }
  return findings;
}

// ── Rule: prop-drill-chain ───────────────────────────────────────────────
// Current file passes props into an imported wrapper component that itself
// passes those same props onward without reading them. Walks up to MAX_HOPS
// imported components to detect drilling that spans 3+ files, not just 2.

const MAX_PROP_DRILL_HOPS = 3;

/**
 * Extend a prop-drill chain: starting from `currentSf` and `currentComponent`,
 * follow the `childTag` import and see whether the imported component is
 * itself a passthrough wrapper that shares props with `carriedProps`.
 *
 * Returns the list of hops beyond the initial component (excluding the
 * starting component itself). Each hop: { componentName, childTag, file }.
 */
interface DrillHop {
  componentName: string;
  childTag: string;
  filePath: string;
  props: string[];
}

function walkPropDrillChain(
  initialCarriedProps: string[],
  initialBinding: ImportBinding,
  ctx: RuleContext,
): DrillHop[] {
  const hops: DrillHop[] = [];
  const visitedFiles = new Set<string>([ctx.filePath]);
  const analysisCache = new Map<string, ReturnType<typeof analyzePassthroughComponent>>();

  let currentCarriedProps = initialCarriedProps;
  let currentBinding: ImportBinding | undefined = initialBinding;
  let currentSf: import('ts-morph').SourceFile | undefined;

  for (let hopIdx = 0; hopIdx < MAX_PROP_DRILL_HOPS; hopIdx++) {
    if (!currentBinding) break;

    currentSf = resolveImportedSourceFile(
      hopIdx === 0 ? ctx : { ...ctx, filePath: currentSf!.getFilePath(), sourceFile: currentSf! },
      currentBinding.importDecl,
    );
    if (!currentSf) break;

    const nextFilePath = currentSf.getFilePath();
    if (visitedFiles.has(nextFilePath)) break;
    visitedFiles.add(nextFilePath);

    const importedFn = findImportedComponentFunction(currentSf, currentBinding);
    if (!importedFn) break;

    const cacheKey = `${nextFilePath}::${currentBinding.importedName}::${currentBinding.isDefault}`;
    let analysis = analysisCache.get(cacheKey);
    if (analysis === undefined) {
      analysis = analyzePassthroughComponent(importedFn);
      analysisCache.set(cacheKey, analysis);
    }
    if (!analysis) break;

    const sharedProps = currentCarriedProps.filter((p) => analysis!.passthroughProps.includes(p));
    if (sharedProps.length < 2) break;

    hops.push({
      componentName: analysis.componentName,
      childTag: analysis.childTag,
      filePath: nextFilePath,
      props: sharedProps,
    });

    const nextCtx: RuleContext = { ...ctx, filePath: nextFilePath, sourceFile: currentSf };
    const nextBinding = findImportBinding(nextCtx, analysis.childTag);
    if (!nextBinding) break;
    currentCarriedProps = sharedProps;
    currentBinding = nextBinding;
  }

  return hops;
}

function propDrillChain(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const localAnalysis = analyzePassthroughComponent(fn);
    if (!localAnalysis) continue;

    const binding = findImportBinding(ctx, localAnalysis.childTag);
    if (!binding) continue;

    const hops = walkPropDrillChain(localAnalysis.passthroughProps, binding, ctx);
    if (hops.length === 0) continue;

    const firstHop = hops[0];
    const sharedProps = firstHop.props;

    // Describe the chain: local → first imported wrapper → ... → last wrapper's child
    const chainDesc =
      hops.length === 1
        ? `<${localAnalysis.childTag}>, which then passes them through to <${firstHop.childTag}>`
        : `<${localAnalysis.childTag}> → ${hops.map((h) => `<${h.componentName}>`).join(' → ')} → <${hops[hops.length - 1].childTag}>`;

    findings.push(
      finding(
        'prop-drill-chain',
        'warning',
        'pattern',
        `'${localAnalysis.componentName}' drills props (${sharedProps.join(', ')}) across ${hops.length + 1} component${hops.length + 1 === 1 ? '' : 's'}: ${chainDesc}`,
        ctx.filePath,
        fn.getStartLineNumber(),
        1,
        {
          suggestion:
            'Collapse the intermediate wrappers, switch to children-based composition, or lift the shared data into React context so the props stop crossing multiple component boundaries',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: memoized-child-inline-prop ─────────────────────────────────────
// Inline object/array/function props create a new identity every render and
// defeat React.memo's shallow prop comparison for that child.

function collectMemoizedComponentNames(ctx: RuleContext): Set<string> {
  const names = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!isMemoCall(decl.getInitializer())) continue;
    const nameNode = decl.getNameNode();
    if (Node.isIdentifier(nameNode) && /^[A-Z]/.test(nameNode.getText())) {
      names.add(nameNode.getText());
    }
  }
  return names;
}

function memoizedChildInlineProp(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const memoizedNames = collectMemoizedComponentNames(ctx);
  const memoizedImportCache = new Map<string, boolean>();

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    const jsxNodes = [
      ...body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const jsx of jsxNodes) {
      const tag = jsx.getTagNameNode().getText();
      let isMemoizedChild = memoizedNames.has(tag);
      if (!isMemoizedChild) {
        if (!memoizedImportCache.has(tag)) {
          const binding = findImportBinding(ctx, tag);
          const importedSf = binding ? resolveImportedSourceFile(ctx, binding.importDecl) : undefined;
          memoizedImportCache.set(tag, !!(binding && importedSf && isMemoizedExport(importedSf, binding)));
        }
        isMemoizedChild = memoizedImportCache.get(tag) ?? false;
      }
      if (!isMemoizedChild) continue;

      const unstableProps: string[] = [];
      for (const attr of jsx.getAttributes()) {
        if (!Node.isJsxAttribute(attr)) continue;
        const attrName = attr.getNameNode().getText();
        const init = attr.getInitializer();
        if (!init || !Node.isJsxExpression(init)) continue;
        const expr = init.getExpression();
        if (!expr) continue;

        const isUnstable =
          Node.isArrowFunction(expr) ||
          Node.isFunctionExpression(expr) ||
          Node.isObjectLiteralExpression(expr) ||
          Node.isArrayLiteralExpression(expr);

        if (isUnstable) unstableProps.push(attrName);
      }

      if (unstableProps.length === 0) continue;

      findings.push(
        finding(
          'memoized-child-inline-prop',
          'warning',
          'pattern',
          `<${tag}> is memoized with React.memo, but inline prop${unstableProps.length === 1 ? '' : 's'} (${unstableProps.join(', ')}) create a new identity every render and defeat memoization`,
          ctx.filePath,
          jsx.getStartLineNumber(),
          1,
          {
            suggestion:
              'Hoist static literals, memoize object/array props with useMemo, and memoize callback props with useCallback before passing them to a memoized child',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: memoized-child-inline-children ─────────────────────────────────
// Inline JSX children create fresh React element objects every render, so a
// React.memo child receiving them through `children` cannot bail out.

function memoizedChildInlineChildren(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const memoizedNames = collectMemoizedComponentNames(ctx);
  const memoizedImportCache = new Map<string, boolean>();

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    for (const jsx of body.getDescendantsOfKind(SyntaxKind.JsxElement)) {
      const opening = jsx.getOpeningElement();
      const tag = opening.getTagNameNode().getText();
      let isMemoizedChild = memoizedNames.has(tag);
      if (!isMemoizedChild) {
        if (!memoizedImportCache.has(tag)) {
          const binding = findImportBinding(ctx, tag);
          const importedSf = binding ? resolveImportedSourceFile(ctx, binding.importDecl) : undefined;
          memoizedImportCache.set(tag, !!(binding && importedSf && isMemoizedExport(importedSf, binding)));
        }
        isMemoizedChild = memoizedImportCache.get(tag) ?? false;
      }
      if (!isMemoizedChild) continue;

      const unstableChildren = jsx.getJsxChildren().filter(
        (child) =>
          Node.isJsxElement(child) ||
          Node.isJsxSelfClosingElement(child) ||
          Node.isJsxFragment(child) ||
          (Node.isJsxExpression(child) &&
            (() => {
              const expr = child.getExpression();
              return (
                expr != null &&
                (Node.isArrowFunction(expr) ||
                  Node.isFunctionExpression(expr) ||
                  Node.isObjectLiteralExpression(expr) ||
                  Node.isArrayLiteralExpression(expr))
              );
            })()),
      );

      if (unstableChildren.length === 0) continue;

      findings.push(
        finding(
          'memoized-child-inline-children',
          'warning',
          'pattern',
          `<${tag}> is memoized with React.memo, but its inline children create new React element identities every render and defeat memoization`,
          ctx.filePath,
          opening.getStartLineNumber(),
          1,
          {
            suggestion:
              'Hoist the child subtree outside the parent render, memoize it with useMemo, or restructure the component so the memoized child receives stable primitive props instead of inline children',
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

/**
 * Get the DIRECT-child JSX elements of the top-level return. Skips nested
 * descendants, elements inside callbacks (map renderers), and elements deep
 * in conditional branches. This is the key guard against false positives:
 * we only care about JSX that the parent component's own render produces
 * positionally — those are the elements that could be lifted to `children`.
 */
function getDirectChildrenOfReturn(
  root: JsxOpeningElement | JsxSelfClosingElement,
): (JsxOpeningElement | JsxSelfClosingElement)[] {
  // If the root is already a self-closing element, there are no direct JSX children.
  if (Node.isJsxSelfClosingElement(root)) return [root];

  // Root is a JsxOpeningElement — walk its parent JsxElement children once.
  const parent = root.getParent();
  if (!parent || !Node.isJsxElement(parent)) return [root];

  const result: (JsxOpeningElement | JsxSelfClosingElement)[] = [root];
  for (const child of parent.getJsxChildren()) {
    if (Node.isJsxElement(child)) {
      result.push(child.getOpeningElement());
    } else if (Node.isJsxSelfClosingElement(child)) {
      result.push(child);
    }
    // Skip JsxExpression / JsxText / JsxFragment content — too dynamic to reason about
  }
  return result;
}

/**
 * Does this expression text mention any of the state variables? Wraps each
 * variable in \b boundaries and tests the combined text. Handles callbacks
 * too (e.g. onClick={() => setCount(c => c + 1)} — we treat ANY reference
 * to setCount as a legitimate state dependency).
 */
function mentionsStateVars(text: string, stateVars: Set<string>): boolean {
  for (const v of stateVars) {
    if (new RegExp(`\\b${v}\\b`).test(text)) return true;
  }
  return false;
}

function parentRerenderViaState(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    // Collect state variable names AND setter names from useState/useReducer.
    // Both the value and the setter count as "state refs" — a child that
    // receives `setCount` is wiring to state and should NOT be flagged.
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

    // Already composing with children? Skip — the user is on the correct path.
    const propBindings = getDestructuredPropBindings(fn);
    const alreadyComposesChildren = propBindings?.some((p) => p.propName === 'children') ?? false;
    if (alreadyComposesChildren) continue;

    // Require a clean single-root returned JSX tree. Fragments, conditional
    // returns, and dynamic structures are too ambiguous to reason about
    // without a real dataflow pass — skip them.
    const root = getSingleReturnedJsx(fn);
    if (!root) continue;

    // Only look at the DIRECT children of the returned root. Nested helper
    // JSX inside map callbacks, conditional branches, or deep descendants
    // are not flaggable — they may close over state transitively.
    const candidates = getDirectChildrenOfReturn(root);

    for (const el of candidates) {
      const tag = el.getTagNameNode().getText();
      if (!/^[A-Z]/.test(tag)) continue; // HTML element — not a rerender target we care about

      // Does this child receive any state var (or setter) via attributes?
      // Scan the entire attribute bag's text in one pass so callback props
      // like onClick={() => setCount(c => c + 1)} count as state-dependent.
      const attrsText = el
        .getAttributes()
        .map((a) => (Node.isJsxAttribute(a) ? a.getText() : ''))
        .join(' ');
      if (mentionsStateVars(attrsText, stateVars)) continue;

      // Is this element inside a JsxExpression that references state (a
      // conditional render like `{count > 0 && <Child />}` or a map based
      // on state)? Walk up the JSX container chain.
      const containingExpr = el.getFirstAncestorByKind(SyntaxKind.JsxExpression);
      if (containingExpr && mentionsStateVars(containingExpr.getText(), stateVars)) continue;

      // Flag: this direct child never sees state and re-renders unnecessarily.
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

export const reactCompositionRules = [
  childrenNotUsed,
  propDrillPassthrough,
  propDrillChain,
  memoizedChildInlineProp,
  memoizedChildInlineChildren,
  parentRerenderViaState,
];
