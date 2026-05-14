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
import type { ProvenanceChain, ReviewFinding, RuleContext } from '../types.js';
import { finding, nodeSpan } from './utils.js';

type ComponentFn = FunctionDeclaration | ArrowFunction | FunctionExpression;
type PropBinding = { propName: string; localName: string };
type PassthroughAnalysis = {
  componentName: string;
  childTag: string;
  passthroughProps: string[];
  /** The JSX element where this passthrough renders its child — used by
   *  prop-drill-chain to produce real file:line:col instead of placeholder. */
  rootJsx: JsxOpeningElement | JsxSelfClosingElement;
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
            safety: 'safe' as const,
          };
        }
      }

      const firstParamNode = fn.getParameters()[0];
      const provenance: ProvenanceChain = {
        summary: `'${name}' declares 'children' but never renders it`,
        steps: [
          {
            kind: 'boundary',
            category: 'component-contract',
            location: nodeSpan(firstParamNode ?? fn, ctx.filePath),
            label: `${name}({ children, … })`,
            detail: `Destructuring 'children' from props establishes the public API contract that this component will render its children.`,
          },
          {
            kind: 'sink',
            category: 'unused-binding',
            location: nodeSpan(body, ctx.filePath),
            label: `{children} never rendered`,
            detail: `The component body has no reference to 'children' — callers passing children get silent drops.`,
          },
        ],
      };

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
            provenance,
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
    rootJsx: root,
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
  // Namespace access (`<UI.Button />` with `import * as UI from './lib'`).
  // The JSX tag text is the full property access; split it so we can look up
  // the receiver as a namespace import. Gemini Phase 7 review flagged this
  // gap — UI libraries that re-export memoised components through namespaces
  // were silently missing the cross-file memo-boundary extension.
  const dotIdx = localName.indexOf('.');
  if (dotIdx > 0) {
    const receiver = localName.slice(0, dotIdx);
    const property = localName.slice(dotIdx + 1);
    // Disallow deeper paths (`<A.B.C />`) — JSX namespace access is at most
    // one level deep in practice, and supporting deeper would require
    // chasing nested namespace re-exports.
    if (property.length === 0 || property.includes('.')) return undefined;
    for (const decl of ctx.sourceFile.getImportDeclarations()) {
      // `getNamespaceImport()` returns the `Identifier` node directly (not a
      // NamespaceImport wrapper), so `.getText()` is the right API — and is
      // safe because an Identifier node has no surrounding trivia.
      const namespaceImport = decl.getNamespaceImport();
      if (namespaceImport?.getText() === receiver) {
        return { importDecl: decl, importedName: property, isDefault: false };
      }
    }
    return undefined;
  }

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

  // Codex Phase 7-v3 review: `findVariableDeclarationByName` only looks in
  // the file's own variable statements, so a memoised export re-exported
  // through a barrel (`export { Button } from './button'` or `export * from
  // './button'`) was reported as not-memoised, silently dropping the
  // cross-file memo-boundary extension for namespace + barrel patterns.
  // `getExportedDeclarations()` resolves through the re-export chain and
  // returns the underlying declaration node, so we hit the memo wrap site
  // wherever it lives.
  const exportedDecls = sourceFile.getExportedDeclarations().get(binding.importedName);
  if (exportedDecls) {
    for (const decl of exportedDecls) {
      if (Node.isVariableDeclaration(decl) && isMemoCall(decl.getInitializer())) return true;
    }
  }

  // Fall back to the in-file lookup as a safety net for cases the resolver
  // didn't chase (e.g. dynamic re-exports the type-checker can't follow).
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
  if (resolved) {
    // The main Project caches resolved source files across reviewFile calls. If the file on disk
    // changed since the last review (watch mode, test re-runs), refresh it so the rule sees fresh content.
    try {
      resolved.refreshFromFileSystemSync();
    } catch {
      // File may have been deleted — caller will decide.
    }
    return resolved;
  }

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
      const childJsx = getSingleReturnedJsx(fn);
      const provenance: ProvenanceChain = {
        summary: `'${analysis.componentName}' is a passthrough wrapper around <${analysis.childTag}>`,
        steps: [
          {
            kind: 'source',
            category: 'prop-decl',
            location: nodeSpan(fn, ctx.filePath),
            label: `${analysis.componentName}({ ${analysis.passthroughProps.join(', ')} })`,
            detail: `Component accepts ${passthroughCount} prop${passthroughCount === 1 ? '' : 's'} but never reads ${passthroughCount === 1 ? 'it' : 'them'} in its body.`,
          },
          {
            kind: 'call',
            category: 'prop-pass',
            location: nodeSpan(childJsx ?? fn, ctx.filePath),
            label: `<${analysis.childTag} ${analysis.passthroughProps.map((p) => `${p}={…}`).join(' ')}/>`,
            detail: `Each unread prop is forwarded directly to the inner element, making this component a pure pipe.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(childJsx ?? fn, ctx.filePath),
            label: `${analysis.componentName} re-renders on every parent prop change`,
            detail: `Any change to the forwarded props forces ${analysis.componentName} to re-render even though it has no logic of its own.`,
          },
        ],
      };

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
            provenance,
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
  /** Location of `<childTag />` inside this hop's wrapper — populated from
   *  the resolved imported source file so prop-drill-chain provenance steps
   *  carry real file:line:col instead of the v1 placeholder. */
  childJsx: JsxOpeningElement | JsxSelfClosingElement;
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
      childJsx: analysis.rootJsx,
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

    // Chain shape: source[prop-decl] → call[prop-pass] (local) → call[prop-pass]
    // (per hop, cross-file) → sink[render-cycle]. Capped at 5 steps total.
    const steps: ProvenanceChain['steps'] = [
      {
        kind: 'source',
        category: 'prop-decl',
        location: nodeSpan(fn, ctx.filePath),
        label: `${localAnalysis.componentName} declares: ${sharedProps.join(', ')}`,
        detail: `The drilled props originate as ${localAnalysis.componentName}'s public API.`,
      },
      {
        kind: 'call',
        category: 'prop-pass',
        location: nodeSpan(fn, ctx.filePath),
        label: `→ <${localAnalysis.childTag}>`,
        detail: `${localAnalysis.componentName} forwards the props one hop without reading them.`,
      },
    ];
    for (const hop of hops.slice(0, 2)) {
      steps.push({
        kind: 'call',
        category: 'prop-pass',
        location: nodeSpan(hop.childJsx, hop.filePath),
        label: `<${hop.componentName}> → <${hop.childTag}>`,
        detail: `${hop.componentName} forwards ${hop.props.join(', ')} to <${hop.childTag}> without reading.`,
      });
    }
    const lastHop = hops[hops.length - 1];
    steps.push({
      kind: 'sink',
      category: 'render-cycle',
      location: nodeSpan(lastHop.childJsx, lastHop.filePath),
      label: `${hops.length + 1} components re-render on any drilled prop change`,
      detail: `Each wrapper in the chain re-renders when any forwarded prop changes, even though only the last one reads it.`,
    });
    const provenance: ProvenanceChain = {
      summary: `prop-drill across ${hops.length + 1} components: ${chainDesc}`,
      steps: steps.slice(0, 5),
    };

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
          provenance,
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
  // Cache value includes the EXPORTED name (not the local JSX tag) so the
  // cross-file walker — which looks up exports in the target file — can resolve
  // aliased imports like `import { MemoButton as B } from './x'; <B />`.
  // Gemini + Codex review caught the prior code passing the local alias and
  // silently producing empty cross-file extensions for every aliased case.
  const memoizedImportCache = new Map<string, { isMemo: boolean; targetFile?: string; exportedName?: string }>();

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
      let importedTargetFile: string | undefined;
      let importedExportedName: string | undefined;
      if (!isMemoizedChild) {
        if (!memoizedImportCache.has(tag)) {
          const binding = findImportBinding(ctx, tag);
          const importedSf = binding ? resolveImportedSourceFile(ctx, binding.importDecl) : undefined;
          const isMemo = !!(binding && importedSf && isMemoizedExport(importedSf, binding));
          memoizedImportCache.set(tag, {
            isMemo,
            targetFile: importedSf?.getFilePath(),
            exportedName: binding?.importedName,
          });
        }
        const cached = memoizedImportCache.get(tag);
        isMemoizedChild = cached?.isMemo ?? false;
        importedTargetFile = cached?.targetFile;
        importedExportedName = cached?.exportedName;
      }
      if (!isMemoizedChild) continue;

      const unstableProps: Array<{ name: string; attr: import('ts-morph').JsxAttribute; kind: string }> = [];
      for (const attr of jsx.getAttributes()) {
        if (!Node.isJsxAttribute(attr)) continue;
        const attrName = attr.getNameNode().getText();
        const init = attr.getInitializer();
        if (!init || !Node.isJsxExpression(init)) continue;
        const expr = init.getExpression();
        if (!expr) continue;

        let kind: string | undefined;
        if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) kind = 'function';
        else if (Node.isObjectLiteralExpression(expr)) kind = 'object literal';
        else if (Node.isArrayLiteralExpression(expr)) kind = 'array literal';

        if (kind) unstableProps.push({ name: attrName, attr, kind });
      }

      if (unstableProps.length === 0) continue;

      const propNames = unstableProps.map((p) => p.name);
      const memoLocalDecl = memoizedNames.has(tag) ? findVariableDeclarationByName(ctx.sourceFile, tag) : undefined;
      const firstUnstable = unstableProps[0];
      const detailKinds = [...new Set(unstableProps.map((p) => p.kind))].join('/');

      const provenance: ProvenanceChain = {
        summary: `<${tag}> memoization defeated by inline prop reference`,
        steps: [
          memoLocalDecl
            ? {
                kind: 'boundary',
                category: 'memo-boundary',
                location: nodeSpan(memoLocalDecl.getNameNode(), ctx.filePath),
                label: `React.memo(${tag})`,
                detail: 'React.memo bails out only when shallow prop comparison sees identical references.',
              }
            : {
                kind: 'import',
                category: 'memo-boundary',
                location: nodeSpan(jsx.getTagNameNode(), ctx.filePath),
                label: `<${tag}> (imported, memoized)`,
                detail: 'React.memo bails out only when shallow prop comparison sees identical references.',
              },
          {
            kind: 'call',
            category: 'prop-pass',
            location: nodeSpan(firstUnstable.attr, ctx.filePath),
            label: `${propNames.length === 1 ? `${propNames[0]}=…` : `${propNames.join(', ')} (inline ${detailKinds})`}`,
            detail: `Inline ${detailKinds} prop${propNames.length === 1 ? '' : 's'} create a new identity on every parent render, so the memoized child receives a different reference each time.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(jsx, ctx.filePath),
            label: 'memo bail-out defeated',
            detail: `<${tag}> rerenders on every parent render even when its other props are unchanged.`,
          },
        ],
      };

      const emitted = finding(
        'memoized-child-inline-prop',
        'warning',
        'pattern',
        `<${tag}> is memoized with React.memo, but inline prop${propNames.length === 1 ? '' : 's'} (${propNames.join(', ')}) create a new identity every render and defeat memoization`,
        ctx.filePath,
        jsx.getStartLineNumber(),
        1,
        {
          suggestion:
            'Hoist static literals, memoize object/array props with useMemo, and memoize callback props with useCallback before passing them to a memoized child',
          provenance,
        },
      );
      findings.push(emitted);

      // When the memoised child is imported, request a cross-file extension
      // that points the chain at the `React.memo(...)` wrap site in the child's
      // declaration file (Plan v3 forward-import walker).
      if (!memoLocalDecl && importedTargetFile && importedExportedName && ctx.pendingCrossFileLinks) {
        ctx.pendingCrossFileLinks.push({
          findingFingerprint: emitted.fingerprint,
          walkerId: 'forward-import',
          payload: { symbol: importedExportedName, targetFile: importedTargetFile },
        });
      }
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
  const memoizedImportCache = new Map<string, { isMemo: boolean; targetFile?: string; exportedName?: string }>();

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    for (const jsx of body.getDescendantsOfKind(SyntaxKind.JsxElement)) {
      const opening = jsx.getOpeningElement();
      const tag = opening.getTagNameNode().getText();
      let isMemoizedChild = memoizedNames.has(tag);
      let importedTargetFile: string | undefined;
      let importedExportedName: string | undefined;
      if (!isMemoizedChild) {
        if (!memoizedImportCache.has(tag)) {
          const binding = findImportBinding(ctx, tag);
          const importedSf = binding ? resolveImportedSourceFile(ctx, binding.importDecl) : undefined;
          const isMemo = !!(binding && importedSf && isMemoizedExport(importedSf, binding));
          memoizedImportCache.set(tag, {
            isMemo,
            targetFile: importedSf?.getFilePath(),
            exportedName: binding?.importedName,
          });
        }
        const cached = memoizedImportCache.get(tag);
        isMemoizedChild = cached?.isMemo ?? false;
        importedTargetFile = cached?.targetFile;
        importedExportedName = cached?.exportedName;
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

      const memoLocalDecl = memoizedNames.has(tag) ? findVariableDeclarationByName(ctx.sourceFile, tag) : undefined;
      const firstChild = unstableChildren[0];
      const provenance: ProvenanceChain = {
        summary: `<${tag}> memoization defeated by inline child elements`,
        steps: [
          memoLocalDecl
            ? {
                kind: 'boundary',
                category: 'memo-boundary',
                location: nodeSpan(memoLocalDecl.getNameNode(), ctx.filePath),
                label: `React.memo(${tag})`,
                detail: 'React.memo only bails out when shallow prop comparison sees identical references.',
              }
            : {
                kind: 'import',
                category: 'memo-boundary',
                location: nodeSpan(opening.getTagNameNode(), ctx.filePath),
                label: `<${tag}> (imported, memoized)`,
                detail: 'React.memo only bails out when shallow prop comparison sees identical references.',
              },
          {
            kind: 'call',
            category: 'prop-pass',
            location: nodeSpan(firstChild, ctx.filePath),
            label: `inline JSX child of <${tag}>`,
            detail: `Inline JSX creates new React element identities every render — the 'children' prop's reference changes each time, so the memoized child sees a different value and re-renders.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(opening, ctx.filePath),
            label: 'memo bail-out defeated',
            detail: `<${tag}> re-renders on every parent render despite being wrapped in React.memo.`,
          },
        ],
      };

      const emitted = finding(
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
          provenance,
        },
      );
      findings.push(emitted);

      if (!memoLocalDecl && importedTargetFile && importedExportedName && ctx.pendingCrossFileLinks) {
        ctx.pendingCrossFileLinks.push({
          findingFingerprint: emitted.fingerprint,
          walkerId: 'forward-import',
          payload: { symbol: importedExportedName, targetFile: importedTargetFile },
        });
      }
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
    let firstStateDecl: import('ts-morph').VariableDeclaration | undefined;
    for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const calleeText = init.getExpression().getText();
      const calleeName = calleeText.includes('.') ? calleeText.split('.').pop() : calleeText;
      if (calleeName !== 'useState' && calleeName !== 'useReducer') continue;
      const nameNode = decl.getNameNode();
      if (!Node.isArrayBindingPattern(nameNode)) continue;
      if (!firstStateDecl) firstStateDecl = decl;
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
      const provenance: ProvenanceChain = {
        summary: `<${tag}> re-renders on every ${info.name} state change despite not depending on any state`,
        steps: [
          {
            kind: 'source',
            category: 'state-decl',
            location: nodeSpan(firstStateDecl ?? fn, ctx.filePath),
            label: `useState in ${info.name}`,
            detail: `State updates here trigger a re-render of '${info.name}' and everything it renders directly.`,
          },
          {
            kind: 'call',
            category: 'parent-render',
            location: nodeSpan(el, ctx.filePath),
            label: `<${tag} … /> (no state-dependent props)`,
            detail: `'${info.name}' renders <${tag}> positionally, but the JSX attributes do not reference any of '${info.name}'s state variables.`,
          },
          {
            kind: 'sink',
            category: 'render-cycle',
            location: nodeSpan(el, ctx.filePath),
            label: 'unnecessary re-render',
            detail: `Every state update in '${info.name}' produces a fresh <${tag}> element reference, forcing React to reconcile a subtree that has no reason to change.`,
          },
        ],
      };

      const emittedRerenderFinding = finding(
        'parent-rerender-via-state',
        'info',
        'pattern',
        `<${tag}> is rendered by '${info.name}' but does not receive any of its state variables (${[...stateVars].slice(0, 3).join(', ')}${stateVars.size > 3 ? '…' : ''}) — it re-renders on every state change. Consider lifting it to the 'children' prop so React can reuse the element.`,
        ctx.filePath,
        el.getStartLineNumber(),
        1,
        {
          suggestion: `Accept <${tag}> as the 'children' prop of '${info.name}' and render it with {children}. The caller composes: <${info.name}><${tag} /></${info.name}>. React will reuse the child element across re-renders.`,
          provenance,
        },
      );
      findings.push(emittedRerenderFinding);

      // Plan v3 v2 — when the unnecessarily-re-rendered child is imported,
      // request a forward-import extension so the chain points at the
      // child's declaration file. The forward walker's semantics (resolve
      // export → emit step) fit even though the trigger here is state-
      // induced re-render rather than memo defeat.
      if (ctx.pendingCrossFileLinks) {
        const binding = findImportBinding(ctx, tag);
        if (binding) {
          const importedSf = resolveImportedSourceFile(ctx, binding.importDecl);
          if (importedSf) {
            ctx.pendingCrossFileLinks.push({
              findingFingerprint: emittedRerenderFinding.fingerprint,
              walkerId: 'forward-import',
              payload: { symbol: binding.importedName, targetFile: importedSf.getFilePath() },
            });
          }
        }
      }

      break; // one finding per component is enough — avoid noise
    }
  }
  return findings;
}

// ── Rule: react-memo-defeated-by-spread ─────────────────────────────────
// `<MemoChild {...props} />` — spread of the WHOLE props parameter from
// the parent component couples the memoized child to every ancestor prop
// and is unmemoizable in practice. This is the only spread shape we flag:
// inline-object spreads (`{...{ a, b }}`) actually fan out into individual
// props that React.memo's shallow compare can still bail on for primitive
// values, so flagging them produces false positives (Codex review caught
// this). useMemo-backed identifier spreads are also exempt.

function isPropsParamIdentifier(expr: Node, fn: ComponentFn): boolean {
  if (!Node.isIdentifier(expr)) return false;
  const name = expr.getText();
  for (const param of fn.getParameters()) {
    const nameNode = param.getNameNode();
    if (Node.isIdentifier(nameNode) && nameNode.getText() === name) return true;
  }
  return false;
}

function reactMemoDefeatedBySpread(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const memoizedNames = collectMemoizedComponentNames(ctx);
  const memoizedImportCache = new Map<string, boolean>();

  // Collect identifiers known to be useMemo-backed — exempt those.
  const useMemoBacked = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const calleeText = init.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (calleeName === 'useMemo') {
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) useMemoBacked.add(nameNode.getText());
    }
  }

  for (const fn of iterComponentFunctions(ctx)) {
    const body = fn.getBody();
    if (!body) continue;

    const jsxNodes: (JsxOpeningElement | JsxSelfClosingElement)[] = [
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

      for (const attr of jsx.getAttributes()) {
        if (!Node.isJsxSpreadAttribute(attr)) continue;
        const expr = attr.getExpression();
        if (!expr) continue;

        // Exempt: useMemo-backed identifier
        if (Node.isIdentifier(expr) && useMemoBacked.has(expr.getText())) continue;

        // Only flag spread of the parent's props parameter — that couples the
        // memoized child to every ancestor prop. Inline object literals get
        // shallow-compared field-by-field so primitives still memoize correctly.
        if (!isPropsParamIdentifier(expr, fn)) continue;

        const memoLocalDecl = memoizedNames.has(tag) ? findVariableDeclarationByName(ctx.sourceFile, tag) : undefined;
        const provenance: ProvenanceChain = {
          summary: `<${tag}> memoization defeated by '{...${expr.getText()}}' spread`,
          steps: [
            memoLocalDecl
              ? {
                  kind: 'boundary',
                  category: 'memo-boundary',
                  location: nodeSpan(memoLocalDecl.getNameNode(), ctx.filePath),
                  label: `React.memo(${tag})`,
                  detail: 'React.memo bails out only when shallow prop comparison sees identical references.',
                }
              : {
                  kind: 'import',
                  category: 'memo-boundary',
                  location: nodeSpan(jsx.getTagNameNode(), ctx.filePath),
                  label: `<${tag}> (imported, memoized)`,
                  detail: 'React.memo bails out only when shallow prop comparison sees identical references.',
                },
            {
              kind: 'call',
              category: 'prop-pass',
              location: nodeSpan(attr, ctx.filePath),
              label: `{...${expr.getText()}}`,
              detail: `Spreading the parent's props parameter forwards every ancestor prop to <${tag}>, so any unrelated change to '${expr.getText()}' invalidates the memo comparison.`,
            },
            {
              kind: 'sink',
              category: 'render-cycle',
              location: nodeSpan(jsx, ctx.filePath),
              label: 'memo bail-out defeated',
              detail: `<${tag}> re-renders on every parent render — it is now coupled to props it doesn't read.`,
            },
          ],
        };

        findings.push(
          finding(
            'react-memo-defeated-by-spread',
            'warning',
            'pattern',
            `<${tag}> is memoized with React.memo, but spreading the parent's '${expr.getText()}' parameter couples it to every render of the parent and undermines the memo bail-out`,
            ctx.filePath,
            attr.getStartLineNumber(),
            1,
            {
              suggestion:
                'Pass props explicitly so memoization can compare a stable surface, or destructure the props the child actually needs',
              provenance,
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Exported composition rules ───────────────────────────────────────────

// ── Rule: memo-component-widely-defeated ────────────────────────────────
// Counterpart to `memoized-child-inline-prop`: fires once on a memoised
// component's DECLARATION when ≥2 parents (anywhere in the project) defeat
// memoisation by passing inline props. The intent is to surface the
// memo-wrap site as the locus of the systemic issue, with the chain
// enumerating every defeating parent — Sight/Guard hover then explains
// "your memo isn't broken in one place, it's broken in N places".
//
// Graph-mode only: the rule fires speculatively on every memo declaration
// in the file, then the `reverse-jsx-usage` walker (with minDefeaters=2)
// either appends one step per defeater or cancels the finding when the
// cross-file count drops below 2. Out of graph mode, the rule short-
// circuits because `pendingCrossFileLinks` is undefined.

function memoComponentWidelyDefeated(ctx: RuleContext): ReviewFinding[] {
  // Speculative emission requires the cross-file walker to validate; skip
  // entirely outside graph mode rather than emit findings the walker
  // can't see to cancel.
  if (!ctx.pendingCrossFileLinks) return [];

  const findings: ReviewFinding[] = [];

  // Targets to consider:
  //   - `export const X = memo(...)` — VariableDeclaration, inline export.
  //   - `const X = memo(...); export { X };` — separate ExportDeclaration.
  //   - `export default memo(...)` / `export default memo(function Foo(){})` — ExportAssignment.
  // `getExportedDeclarations()` covers the first two uniformly: it resolves
  // through export chains and returns the underlying declaration node. The
  // third case is handled below by walking ExportAssignments directly,
  // because `export default <expr>` is an assignment, not a declaration.
  // Gemini + OpenCode Phase 7-v3 review caught both gaps in the original
  // rule which only scanned VariableDeclarations with `VariableStatement.isExported()`.

  const seenDecls = new Set<Node>();

  function emit(symbol: string, anchor: Node, displayName: string): void {
    if (seenDecls.has(anchor)) return;
    seenDecls.add(anchor);

    const provenance: ProvenanceChain = {
      summary: `<${displayName}> is memoised here but its consumers pass inline props on every render`,
      steps: [
        {
          kind: 'boundary',
          category: 'memo-boundary',
          location: nodeSpan(anchor, ctx.filePath),
          label: `React.memo(${displayName})`,
          detail: `Multiple parents render <${displayName}> with inline literal/arrow props; React.memo bails out only when shallow prop comparison sees identical references.`,
        },
        {
          kind: 'sink',
          category: 'memo-boundary',
          location: nodeSpan(anchor, ctx.filePath),
          label: 'memoisation widely defeated',
          detail: `Every parent re-render allocates new identities for the inline props, so React.memo never bails. Defeating parents enumerated below.`,
        },
      ],
    };

    const emitted = finding(
      'memo-component-widely-defeated',
      'warning',
      'pattern',
      `<${displayName}> is wrapped in React.memo but ≥2 consumers pass inline props on every render — memoisation is defeated across the codebase, not in one place`,
      ctx.filePath,
      anchor.getStartLineNumber(),
      1,
      {
        suggestion: `Hoist the inline props at each consumer (useMemo for objects/arrays, useCallback for functions), or accept that <${displayName}> doesn't benefit from memo and remove the wrap. The chain below enumerates the defeating parents.`,
        provenance,
      },
    );
    findings.push(emitted);

    // Reverse-jsx-usage walker validates the ≥2-defeaters condition and
    // appends one step per defeating parent. If <2, the walker cancels
    // this finding so we don't emit a false positive. `pendingCrossFileLinks`
    // is gated to non-null at the top of memoComponentWidelyDefeated, so
    // the non-null assertion is safe in this nested helper.
    ctx.pendingCrossFileLinks!.push({
      findingFingerprint: emitted.fingerprint,
      walkerId: 'reverse-jsx-usage',
      payload: {
        symbol,
        declFile: ctx.filePath,
        minDefeaters: 2,
      },
    });
  }

  // Pattern 1 + 2: named exports (inline `export const X = memo(...)` and
  // separate `export { X }` after a local declaration). `getExportedDeclarations()`
  // resolves the export chain and returns the underlying declaration.
  for (const [exportName, decls] of ctx.sourceFile.getExportedDeclarations()) {
    if (exportName === 'default') continue;
    if (!/^[A-Z]/.test(exportName)) continue;
    for (const decl of decls) {
      // We need the original declaration in THIS file (cross-file re-exports
      // are out of scope — the rule fires from the declaration file).
      if (decl.getSourceFile().getFilePath() !== ctx.sourceFile.getFilePath()) continue;
      if (!Node.isVariableDeclaration(decl)) continue;
      if (!isMemoCall(decl.getInitializer())) continue;
      const nameNode = decl.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      emit(exportName, nameNode, exportName);
      break;
    }
  }

  // Pattern 3: `export default memo(...)`. The memo call lives in an
  // ExportAssignment expression, not a VariableDeclaration. Anchor the
  // finding on the assignment node since there's no name identifier.
  // The display name uses the inner function/class name when present
  // (matches what the JsxUsageIndex normalises to); otherwise falls back to
  // 'default'. The walker payload uses the index's resolved symbol so
  // findUsages hits.
  for (const assign of ctx.sourceFile.getExportAssignments()) {
    if (assign.isExportEquals()) continue; // CommonJS `export =` — different shape
    const expr = assign.getExpression();
    if (!isMemoCall(expr)) continue;
    // Resolve the index's symbol-for-default-export normalisation: when the
    // inner argument is a named FunctionDeclaration / ClassDeclaration the
    // index keys on that name; otherwise 'default'. This mirrors the logic
    // in jsx-usage-index.ts resolveExportBinding.
    const memoCall = expr as CallExpression;
    const innerArg = memoCall.getArguments()[0];
    let indexSymbol = 'default';
    let displayName = 'default-exported memo';
    if (innerArg && (Node.isFunctionDeclaration(innerArg) || Node.isClassDeclaration(innerArg))) {
      const innerName = innerArg.getName();
      if (innerName) {
        indexSymbol = innerName;
        displayName = innerName;
      }
    }
    emit(indexSymbol, assign, displayName);
  }

  return findings;
}

export const reactCompositionRules = [
  childrenNotUsed,
  propDrillPassthrough,
  propDrillChain,
  memoizedChildInlineProp,
  memoizedChildInlineChildren,
  parentRerenderViaState,
  reactMemoDefeatedBySpread,
  memoComponentWidelyDefeated,
];
