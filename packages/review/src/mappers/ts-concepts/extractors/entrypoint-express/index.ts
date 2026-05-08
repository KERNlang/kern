import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, isSameConceptSourceFile, span } from '../../helpers/ast.js';
import type { FieldTypeMap } from '../../helpers/types.js';
import { ROUTE_METHODS } from '../../signatures.js';
import { extractRouteMount } from './mount.js';
import { analyzeExpressRouteHandler, EMPTY_ROUTE_ANALYSIS, resolveExpressRouteHandler } from './route-handler.js';
import { extractHandlerBodyFields } from './validation.js';

export function extractEntrypoints(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Express/Fastify route handlers: app.get('/path', handler)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();

    const objText = pa.getExpression().getText();
    if (!/app|router|server/i.test(objText)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    if (methodName === 'use') {
      const mount = extractRouteMount(call, filePath);
      if (mount) nodes.push(mount);
      continue;
    }

    if (!ROUTE_METHODS.has(methodName)) continue;

    // First arg is the route path
    let routePath: string | undefined;
    if (args[0].getKind() === SyntaxKind.StringLiteral) {
      routePath = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
    }

    // Inline, same-file named, or statically imported handler. The id we
    // compute for same-file handlers must match the function_declaration
    // concept emitted for the same function, so downstream rules can
    // dereference `handlerConceptId`.
    const resolvedHandler = resolveExpressRouteHandler(args, filePath);
    const handlerFn = resolvedHandler?.fn;
    const handlerConceptId =
      resolvedHandler && isSameConceptSourceFile(resolvedHandler.conceptFilePath, filePath)
        ? conceptId(filePath, 'function_declaration', resolvedHandler.conceptStart)
        : undefined;

    const bodyFieldsInfo = handlerFn
      ? extractHandlerBodyFields(handlerFn)
      : {
          fields: undefined as readonly string[] | undefined,
          resolved: false,
          types: undefined as FieldTypeMap | undefined,
        };
    const routeAnalysis = handlerFn
      ? analyzeExpressRouteHandler(handlerFn, args, methodName.toUpperCase(), routePath)
      : EMPTY_ROUTE_ANALYSIS;

    nodes.push({
      id: conceptId(filePath, 'entrypoint', call.getStart()),
      kind: 'entrypoint',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 120),
      confidence: 0.95,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: {
        kind: 'entrypoint',
        subtype: 'route',
        name: routePath || methodName,
        httpMethod: methodName.toUpperCase(),
        handlerConceptId,
        bodyFields: bodyFieldsInfo.fields,
        bodyFieldsResolved: bodyFieldsInfo.resolved,
        bodyFieldTypes: bodyFieldsInfo.types,
        errorStatusCodes: routeAnalysis.errorStatusCodes,
        successStatusCodes: routeAnalysis.successStatusCodes,
        successStatusCodesResolved: routeAnalysis.successStatusCodesResolved,
        paginationStrategy: routeAnalysis.paginationStrategy,
        paginationStrategyResolved: routeAnalysis.paginationStrategyResolved,
        hasUnboundedCollectionQuery: routeAnalysis.hasUnboundedCollectionQuery,
        hasDbWrite: routeAnalysis.hasDbWrite,
        hasIdempotencyProtection: routeAnalysis.hasIdempotencyProtection,
        hasBodyValidation: routeAnalysis.hasBodyValidation,
        validatedBodyFields: routeAnalysis.validatedBodyFields,
        bodyValidationResolved: routeAnalysis.bodyValidationResolved,
        validatedBodyFieldTypes: routeAnalysis.validatedBodyFieldTypes,
      },
    });
  }

  // export default function — only if it looks like a handler (has req/res params or returns JSX)
  for (const exportDecl of sf.getExportedDeclarations()) {
    const [name, decls] = exportDecl;
    if (name !== 'default') continue;
    for (const decl of decls) {
      if (decl.getKind() === SyntaxKind.FunctionDeclaration) {
        const fn = decl as import('ts-morph').FunctionDeclaration;
        const params = fn.getParameters();
        const paramNames = params.map((p) => p.getName());
        const isHandler = paramNames.some((n) => /req|request|ctx|context|event/i.test(n));
        const isComponent = fn.getName()?.[0]?.toUpperCase() === fn.getName()?.[0];

        if (isHandler || isComponent) {
          nodes.push({
            id: conceptId(filePath, 'entrypoint', decl.getStart()),
            kind: 'entrypoint',
            primarySpan: span(filePath, decl),
            evidence: decl.getText().substring(0, 100),
            confidence: isHandler ? 0.9 : 0.7,
            language: 'ts',
            payload: {
              kind: 'entrypoint',
              subtype: isHandler ? 'handler' : 'export',
              name: fn.getName() || 'default',
            },
          });
        }
      }
    }
  }
}
