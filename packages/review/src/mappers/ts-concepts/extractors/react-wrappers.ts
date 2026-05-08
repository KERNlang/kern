import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, hasAwaitInBody, span } from '../helpers/ast.js';
import { REACT_QUALIFIED_WRAPPERS, REACT_WRAPPERS } from '../signatures.js';

export function extractReactWrapperComponents(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Detect: const MyComponent = React.memo(() => { ... })
  //         const MyComponent = memo(() => { ... })
  //         const MyComponent = React.forwardRef((props, ref) => { ... })
  //         const MyComponent = forwardRef((props, ref) => { ... })
  //
  // These are NOT caught by extractFunctionDeclarations because the initializer
  // is a CallExpression, not ArrowFunction/FunctionExpression.
  for (const varDecl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = varDecl.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) continue;

    const call = init as import('ts-morph').CallExpression;
    const calleeText = call.getExpression().getText();

    const isWrapper = REACT_WRAPPERS.has(calleeText) || REACT_QUALIFIED_WRAPPERS.has(calleeText);
    if (!isWrapper) continue;

    const name = varDecl.getName();
    if (!/^[A-Z]/.test(name)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const innerFn = args[0];
    const innerKind = innerFn.getKind();
    if (innerKind !== SyntaxKind.ArrowFunction && innerKind !== SyntaxKind.FunctionExpression) continue;

    const fn = innerFn as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
    const isAsync = (fn as any).isAsync?.() ?? /^async\s/.test(fn.getText());
    const varStmt = varDecl.getParent()?.getParent();
    const isExport = varStmt ? /^export\s/.test(varStmt.getText()) : false;

    nodes.push({
      id: conceptId(filePath, 'function_declaration', varDecl.getStart()),
      kind: 'function_declaration',
      primarySpan: span(filePath, varDecl),
      evidence: `${calleeText}(${name})`,
      confidence: 0.9,
      language: 'ts',
      containerId: getContainerId(varDecl, filePath),
      payload: {
        kind: 'function_declaration',
        name,
        async: isAsync,
        hasAwait: isAsync ? hasAwaitInBody(fn) : false,
        isComponent: true,
        isExport,
      },
    });
  }
}
