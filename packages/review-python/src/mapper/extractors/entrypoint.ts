import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import {
  collectPythonImportAliases,
  combinePythonSchemaInclusion,
  extractPythonKeywordArgument,
  extractPythonRoutePath,
  extractPythonRouterArgument,
  extractPythonStringLiteral,
  inferPythonResponseEvidence,
  inferPythonRouterConfiguration,
  joinPythonRoutePaths,
  resolvePythonRouterReference,
} from '@kernlang/review';
import type Parser from 'tree-sitter';
import { getSelfContainerId, isAsyncFunction, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';
import type { FieldTypeMap } from '../helpers/types.js';
import { PY_DB_COLLECTION_RE, PY_DB_WRITE_RE, PY_IDEMPOTENCY_RE, PY_PAGINATION_RE } from '../signatures.js';
import { extractPythonHttpExceptionStatusCodes } from './error.js';
import { extractFastApiPaginationStrategy } from './fastapi-pagination.js';
import { extractFastApiSuccessStatusCodes } from './fastapi-status.js';
import { collectPydanticModels, extractFastApiBodyValidation, type PydanticModel } from './pydantic.js';

interface PythonRouteAnalysis {
  errorStatusCodes?: readonly number[];
  successStatusCodes?: readonly number[];
  successStatusCodesResolved?: boolean;
  paginationStrategy?: 'page' | 'offset' | 'cursor' | 'mixed' | 'none';
  paginationStrategyResolved?: boolean;
  hasUnboundedCollectionQuery?: boolean;
  hasDbWrite?: boolean;
  hasIdempotencyProtection?: boolean;
  hasBodyValidation?: boolean;
  validatedBodyFields?: readonly string[];
  bodyValidationResolved?: boolean;
  validatedBodyFieldTypes?: FieldTypeMap;
}

export function extractEntrypoints(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  const pydanticModels = collectPydanticModels(source);
  const importAliases = collectPythonImportAliases(source);
  const routerConfigurations = new Map<string, ReturnType<typeof inferPythonRouterConfiguration>>();

  walkNodes(root, 'assignment', (node) => {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right || left.type !== 'identifier' || right.type !== 'call') return;
    const fn = right.childForFieldName('function');
    if (!fn) return;
    const fnText = source.substring(fn.startIndex, fn.endIndex);
    if (!/(?:^|\.)APIRouter$/.test(fnText)) return;
    routerConfigurations.set(
      source.substring(left.startIndex, left.endIndex),
      inferPythonRouterConfiguration(source.substring(right.startIndex, right.endIndex)),
    );
  });

  // FastAPI / Flask route decorators.
  //
  // The route *path* (e.g. `/current`) is what cross-stack rules need to
  // match against — not the Python function name. Prior to 2026-04-21 this
  // emitted the function name, which `collectRoutes` then silently dropped
  // (it filters on paths starting with `/`). The FastAPI router-prefix join
  // in `cross-stack-utils.collectRoutes` also needs `routerName` so it can
  // pair per-file routes with the `include_router(prefix=…)` call that
  // mounts them.
  walkNodes(root, 'decorated_definition', (node) => {
    const fnDef = node.children.find((c) => c.type === 'function_definition');
    if (!fnDef) return;

    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);

      const routeMatch = decText.match(/@(\w+)\.(route|get|post|put|delete|patch)\s*\(/);
      if (!routeMatch) continue;

      const routerName = routeMatch[1];
      const method = routeMatch[2].toUpperCase();
      const declaredRoutePath = extractPythonRoutePath(decText);
      // Only surface the decorator as a route when we could extract a URL
      // path literal. Mystery decorators with only kwargs (e.g. `@app.get`
      // stub) are noise — skip them instead of filling `name` with the
      // function name, which cross-stack routes treat as invalid.
      if (!declaredRoutePath?.startsWith('/')) continue;
      const routerConfiguration = routerConfigurations.get(routerName);
      const routePath = joinPythonRoutePaths(routerConfiguration?.prefix, declaredRoutePath);

      const returnTypeNode = fnDef.childForFieldName('return_type');
      const response = inferPythonResponseEvidence(
        decText,
        returnTypeNode ? source.substring(returnTypeNode.startIndex, returnTypeNode.endIndex) : undefined,
      );
      const routeContainerId = getSelfContainerId(fnDef, filePath);
      const routeAnalysis = analyzePythonRoute(
        fnDef,
        source,
        method,
        routePath,
        response.responseModel,
        pydanticModels,
        decText,
      );

      nodes.push({
        id: conceptId(filePath, 'entrypoint', child.startIndex),
        kind: 'entrypoint',
        primarySpan: nodeSpan(filePath, child),
        evidence: nodeText(source, child, 100),
        confidence: 1.0,
        language: 'py',
        containerId: routeContainerId,
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name: routePath,
          httpMethod: method === 'ROUTE' ? undefined : method,
          responseModel: response.responseModel,
          responseClass: response.responseClass,
          includeInSchema: combinePythonSchemaInclusion(response.includeInSchema, routerConfiguration?.includeInSchema),
          isAsync: isAsyncFunction(fnDef),
          routerName,
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
  });

  // FastAPI `app.include_router(<module>.<router>, prefix="/api/x")`.
  //
  // Emitted as a route-mount concept so `collectRoutes` can join it with
  // the per-file route nodes: a route declared on `router` in
  // `app/api/nutrition_goals.py` and mounted in `main.py` with
  // `app.include_router(nutrition_goals.router, prefix="/api/nutrition-goals")`
  // should resolve to the full URL `/api/nutrition-goals/<path>`.
  walkNodes(root, 'call', (node) => {
    const fn = node.childForFieldName('function');
    if (!fn) return;
    const fnText = source.substring(fn.startIndex, fn.endIndex);
    if (!/\.include_router$/.test(fnText)) return;
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return;
    const argsText = source.substring(argsNode.startIndex, argsNode.endIndex);
    const mountResponse = inferPythonResponseEvidence(argsText, undefined);

    // First positional arg is the router. Common shapes:
    //   include_router(router)                  — local identifier
    //   include_router(nutrition_goals.router)  — imported-module attribute
    //   include_router(auth_router)             — aliased local identifier
    const routerRef = extractPythonRouterArgument(argsText);
    if (!routerRef) return;
    const resolvedRouter = resolvePythonRouterReference(routerRef, importAliases);

    // Prefix defaults to '' when omitted — still valid (the route keeps its
    // declared path as-is), so emit the mount either way.
    const prefixArgument = extractPythonKeywordArgument(argsText, 'prefix');
    const prefix = prefixArgument === undefined ? '' : extractPythonStringLiteral(prefixArgument);
    if (prefix === undefined) return;

    nodes.push({
      id: conceptId(filePath, 'entrypoint', node.startIndex),
      kind: 'entrypoint',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 120),
      confidence: 0.95,
      language: 'py',
      payload: {
        kind: 'entrypoint',
        subtype: 'route-mount',
        name: prefix,
        routerName: resolvedRouter.routerName,
        routerNameAuthoritative: resolvedRouter.routerNameAuthoritative,
        sourceModule: resolvedRouter.sourceModule,
        includeInSchema: mountResponse.includeInSchema,
      },
    });
  });

  // `if __name__ == '__main__':`
  walkNodes(root, 'if_statement', (node) => {
    const condition = node.childForFieldName('condition');
    if (condition?.text.includes('__name__') && condition.text.includes('__main__')) {
      nodes.push({
        id: conceptId(filePath, 'entrypoint', node.startIndex),
        kind: 'entrypoint',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 1.0,
        language: 'py',
        payload: {
          kind: 'entrypoint',
          subtype: 'main',
          name: 'main',
        },
      });
    }
  });
}

function analyzePythonRoute(
  fnDef: Parser.SyntaxNode,
  source: string,
  method: string,
  routePath: string,
  responseModel: string | undefined,
  pydanticModels: ReadonlyMap<string, PydanticModel>,
  decText: string,
): PythonRouteAnalysis {
  const text = source.substring(fnDef.startIndex, fnDef.endIndex);
  const validation = extractFastApiBodyValidation(fnDef, source, pydanticModels);
  const success = extractFastApiSuccessStatusCodes(decText, fnDef, source);
  const pagination = extractFastApiPaginationStrategy(fnDef, source);
  return {
    errorStatusCodes: extractPythonHttpExceptionStatusCodes(text),
    successStatusCodes: success.codes,
    successStatusCodesResolved: success.resolved,
    paginationStrategy: pagination.strategy,
    paginationStrategyResolved: pagination.resolved,
    hasUnboundedCollectionQuery: hasUnboundedPythonCollectionQuery(text, method, routePath, responseModel),
    hasDbWrite: PY_DB_WRITE_RE.test(text),
    hasIdempotencyProtection: PY_IDEMPOTENCY_RE.test(text),
    hasBodyValidation: validation.has,
    validatedBodyFields: validation.fields,
    bodyValidationResolved: validation.resolved,
    validatedBodyFieldTypes: validation.types,
  };
}

function hasUnboundedPythonCollectionQuery(
  text: string,
  method: string,
  routePath: string,
  responseModel: string | undefined,
): boolean {
  if (method !== 'GET') return false;
  if (/[{:]/.test(routePath)) return false;
  if (PY_PAGINATION_RE.test(text)) return false;
  const responseLooksList = responseModel ? /^(list|List|Sequence|Iterable)\s*\[/.test(responseModel) : false;
  return (
    PY_DB_COLLECTION_RE.test(text) &&
    (responseLooksList || /\breturn\b[\s\S]*(\.all\s*\(|\.find\s*\(|\.fetchall\s*\()/.test(text))
  );
}
