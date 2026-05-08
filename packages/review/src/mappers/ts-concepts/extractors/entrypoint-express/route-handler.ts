import { SyntaxKind } from 'ts-morph';
import { isExternalSourcePath, numericLiteralValue } from '../../helpers/ast.js';
import type { FieldTypeMap } from '../../helpers/types.js';
import { API_ERROR_STATUS_CODES, IDEMPOTENCY_RE } from '../../signatures.js';
import { extractExpressPaginationStrategy, hasUnboundedExpressCollectionQuery } from './pagination.js';
import { extractExpressSuccessStatusCodes } from './success-status.js';
import { extractExpressValidation, handlerHasDbWrite } from './validation.js';

export type ExpressRouteHandlerFn =
  | import('ts-morph').ArrowFunction
  | import('ts-morph').FunctionExpression
  | import('ts-morph').FunctionDeclaration;

export interface ExpressRouteHandlerResolution {
  fn: ExpressRouteHandlerFn;
  conceptStart: number;
  conceptFilePath: string;
}

export interface RouteHandlerAnalysis {
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

export const EMPTY_ROUTE_ANALYSIS: RouteHandlerAnalysis = {};

export function analyzeExpressRouteHandler(
  handlerFn: ExpressRouteHandlerFn,
  routeArgs: readonly import('ts-morph').Node[],
  method: string,
  routePath: string | undefined,
): RouteHandlerAnalysis {
  const text = handlerFn.getText();
  const errorStatusCodes = extractExpressErrorStatusCodes(handlerFn);
  const successStatuses = extractExpressSuccessStatusCodes(handlerFn);
  const pagination = extractExpressPaginationStrategy(handlerFn);
  const validation = extractExpressValidation(handlerFn, routeArgs);
  return {
    errorStatusCodes,
    successStatusCodes: successStatuses.codes,
    successStatusCodesResolved: successStatuses.resolved,
    paginationStrategy: pagination.strategy,
    paginationStrategyResolved: pagination.resolved,
    hasUnboundedCollectionQuery: hasUnboundedExpressCollectionQuery(handlerFn, method, routePath),
    hasDbWrite: handlerHasDbWrite(handlerFn),
    hasIdempotencyProtection: IDEMPOTENCY_RE.test(text),
    hasBodyValidation: validation.has,
    validatedBodyFields: validation.fields,
    bodyValidationResolved: validation.resolved,
    validatedBodyFieldTypes: validation.types,
  };
}

export function resolveExpressRouteHandler(
  routeArgs: readonly import('ts-morph').Node[],
  filePath: string,
): ExpressRouteHandlerResolution | undefined {
  for (let i = routeArgs.length - 1; i >= 1; i--) {
    const arg = routeArgs[i];
    const kind = arg.getKind();
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      return {
        fn: arg as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
        conceptStart: arg.getStart(),
        conceptFilePath: filePath,
      };
    }
    if (kind !== SyntaxKind.Identifier) continue;
    const resolved = resolveHandlerIdentifier(arg as import('ts-morph').Identifier);
    if (resolved) return resolved;
  }
  return undefined;
}

function resolveHandlerIdentifier(ident: import('ts-morph').Identifier): ExpressRouteHandlerResolution | undefined {
  const symbol = ident.getSymbol();
  if (!symbol) return undefined;

  for (const candidate of expandIdentifierSymbols(symbol)) {
    for (const decl of candidate.getDeclarations()) {
      const conceptFilePath = decl.getSourceFile().getFilePath();
      if (isExternalSourcePath(conceptFilePath)) continue;
      if (decl.getKind() === SyntaxKind.FunctionDeclaration) {
        const fn = decl as import('ts-morph').FunctionDeclaration;
        return { fn, conceptStart: fn.getStart(), conceptFilePath };
      }
      if (decl.getKind() !== SyntaxKind.VariableDeclaration) continue;
      const varDecl = decl as import('ts-morph').VariableDeclaration;
      const init = varDecl.getInitializer();
      if (!init) continue;
      const initKind = init.getKind();
      if (initKind !== SyntaxKind.ArrowFunction && initKind !== SyntaxKind.FunctionExpression) continue;
      return {
        fn: init as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
        conceptStart: varDecl.getStart(),
        conceptFilePath,
      };
    }
  }

  return undefined;
}

function expandIdentifierSymbols(symbol: import('ts-morph').Symbol): readonly import('ts-morph').Symbol[] {
  const aliased = symbol.getAliasedSymbol();
  return aliased ? [aliased, symbol] : [symbol];
}

export function extractExpressErrorStatusCodes(handlerFn: ExpressRouteHandlerFn): readonly number[] | undefined {
  const codes = new Set<number>();

  for (const call of handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'next' && call.getArguments().length > 0) {
      codes.add(500);
      continue;
    }
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const name = pa.getName();
    if (name !== 'status' && name !== 'sendStatus') continue;
    const receiver = pa.getExpression().getText();
    if (!/\b(res|reply|response)\b/i.test(receiver)) continue;
    const code = numericLiteralValue(call.getArguments()[0]);
    if (code !== undefined && API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }

  for (const throwStmt of handlerFn.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    if (throwStmt.getExpression()) codes.add(500);
  }

  return codes.size > 0 ? Array.from(codes).sort((a, b) => a - b) : undefined;
}
