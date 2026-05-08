import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, hasAwaitInBody, span } from '../helpers/ast.js';
import { EXPRESS_ROUTE_METHODS } from '../signatures.js';

export function extractFunctionDeclarations(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // FunctionDeclaration
  for (const fn of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = fn.getName() || 'anonymous';
    const isAsync = fn.isAsync();
    const isExport = fn.isExported();
    const isComponent = /^[A-Z]/.test(name);
    nodes.push({
      id: conceptId(filePath, 'function_declaration', fn.getStart()),
      kind: 'function_declaration',
      primarySpan: span(filePath, fn),
      evidence: `function ${name}`,
      confidence: 0.95,
      language: 'ts',
      containerId: getContainerId(fn, filePath),
      payload: {
        kind: 'function_declaration',
        name,
        async: isAsync,
        hasAwait: isAsync ? hasAwaitInBody(fn) : false,
        isComponent,
        isExport,
      },
    });
  }

  // MethodDeclaration
  for (const method of sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    const name = method.getName();
    const isAsync = method.isAsync();
    nodes.push({
      id: conceptId(filePath, 'function_declaration', method.getStart()),
      kind: 'function_declaration',
      primarySpan: span(filePath, method),
      evidence: `method ${name}`,
      confidence: 0.95,
      language: 'ts',
      containerId: getContainerId(method, filePath),
      payload: {
        kind: 'function_declaration',
        name,
        async: isAsync,
        hasAwait: isAsync ? hasAwaitInBody(method) : false,
        isComponent: false,
        isExport: false,
      },
    });
  }

  // ArrowFunction / FunctionExpression assigned to named variables
  for (const varDecl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = varDecl.getInitializer();
    if (!init) continue;
    const initKind = init.getKind();
    if (initKind !== SyntaxKind.ArrowFunction && initKind !== SyntaxKind.FunctionExpression) continue;

    const name = varDecl.getName();
    const fn = init as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
    const isAsync = (fn as any).isAsync?.() ?? /^async\s/.test(fn.getText());
    const isComponent = /^[A-Z]/.test(name);
    const varStmt = varDecl.getParent()?.getParent();
    const isExport = varStmt ? /^export\s/.test(varStmt.getText()) : false;

    nodes.push({
      id: conceptId(filePath, 'function_declaration', varDecl.getStart()),
      kind: 'function_declaration',
      primarySpan: span(filePath, varDecl),
      evidence: `${isAsync ? 'async ' : ''}${name}`,
      confidence: 0.9,
      language: 'ts',
      containerId: getContainerId(varDecl, filePath),
      payload: {
        kind: 'function_declaration',
        name,
        async: isAsync,
        hasAwait: isAsync ? hasAwaitInBody(fn) : false,
        isComponent,
        isExport,
      },
    });
  }

  // Express route handler arrow/function callbacks: router.get('/path', async (req, res) => { ... })
  // These are NOT assigned to named variables, so the block above misses them.
  // We synthesize a function name from the HTTP method + route path.
  extractExpressCallbacks(sf, filePath, nodes);
}

function extractExpressCallbacks(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Track offsets already emitted as function_declaration to avoid duplicates
  const emittedOffsets = new Set<number>();
  for (const n of nodes) {
    if (n.kind === 'function_declaration') emittedOffsets.add(n.primarySpan.startLine);
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();
    if (!EXPRESS_ROUTE_METHODS.has(methodName)) continue;

    const objText = pa.getExpression().getText();
    if (!/app|router|server/i.test(objText)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    let routePath: string | undefined;
    if (args[0].getKind() === SyntaxKind.StringLiteral) {
      routePath = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
    }

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      const argKind = arg.getKind();
      if (argKind !== SyntaxKind.ArrowFunction && argKind !== SyntaxKind.FunctionExpression) continue;

      const fn = arg as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
      const offset = fn.getStart();

      if (emittedOffsets.has(fn.getStartLineNumber())) continue;

      const syntheticName = `${methodName.toUpperCase()}_${routePath || '/'}`;
      const isAsync = (fn as any).isAsync?.() ?? /^async\s/.test(fn.getText());

      nodes.push({
        id: conceptId(filePath, 'function_declaration', offset),
        kind: 'function_declaration',
        primarySpan: span(filePath, fn),
        evidence: `${isAsync ? 'async ' : ''}${syntheticName}`,
        confidence: 0.85,
        language: 'ts',
        containerId: getContainerId(fn, filePath),
        payload: {
          kind: 'function_declaration',
          name: syntheticName,
          async: isAsync,
          hasAwait: isAsync ? hasAwaitInBody(fn) : false,
          isComponent: false,
          isExport: false,
        },
      });
    }
  }
}
