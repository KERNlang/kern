/**
 * TypeScript Concept Mapper — extracts universal concepts from ts-morph AST.
 *
 * Phase 1: error_raise, error_handle, effect
 * Phase 2: entrypoint, guard, state_mutation, call, dependency
 */

import type { ConceptEdge, ConceptMap, ConceptNode, ConceptSpan, ErrorHandlePayload } from '@kernlang/core';
import { conceptId, conceptSpan } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';

const EXTRACTOR_VERSION = '1.0.0';

// ── Network effect signatures ────────────────────────────────────────────

const NETWORK_CALLS = new Set(['fetch', 'axios', 'got', 'request', 'superagent', 'ky']);

const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']);

// ── Wrapped HTTP-client detection ────────────────────────────────────────
// ~75% of production React/Next/Expo apps route through a wrapper (custom
// ApiClient class, axios.create instance, tRPC-generated client). The fixed
// NETWORK_CALLS set misses those, so the cross-stack wedge rules
// (contract-drift, untyped-api-response, tainted-across-wire) silently
// find nothing on real repos. collectClientIdentifiers() scans the file
// for wrapper patterns and returns the local identifiers that behave like
// HTTP clients; extractEffects() then treats `<name>.get/post/…` calls on
// those identifiers as network effects.

const CLIENT_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// Names considered client-shaped for imported identifiers. Kept narrow on
// purpose — false positives here cascade into the wedge rules and poison
// the pitch. Matches: api, http, client, apiClient, httpClient, fetcher,
// requester, ApiClient, HttpClient, MyApiClient, etc.
const CLIENT_NAME_PATTERN = /^(api|http|client|apiClient|httpClient|fetcher|requester)$|Client$/;

// Wrapper factories — if a variable is initialized with one of these calls,
// the variable is a client instance (axios.create, ky.create, got.extend).
const CLIENT_FACTORY_CALLS = new Set(['axios.create', 'ky.create', 'ky.extend', 'got.extend']);

const DB_CALLS = new Set([
  'query',
  'execute',
  'findMany',
  'findFirst',
  'findUnique',
  'create',
  'update',
  'delete',
  'upsert',
  'aggregate',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'find',
  'findOne',
  'countDocuments',
]);

const DB_COLLECTION_READ_CALLS = new Set([
  'findMany',
  'find',
  'select',
  'query',
  'aggregate',
  'toArray',
  'all',
  'fetchAll',
]);

const DB_WRITE_CALLS = new Set([
  'create',
  'createMany',
  'insert',
  'insertOne',
  'insertMany',
  'update',
  'updateMany',
  'updateOne',
  'delete',
  'deleteMany',
  'deleteOne',
  'remove',
  'save',
  'upsert',
]);

const FS_CALLS = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'readdir',
  'readdirSync',
  'mkdir',
  'mkdirSync',
  'unlink',
  'unlinkSync',
  'rename',
  'renameSync',
  'createReadStream',
  'createWriteStream',
]);

// ── Main Extractor ───────────────────────────────────────────────────────

export function extractTsConcepts(sourceFile: SourceFile, filePath: string): ConceptMap {
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];

  extractErrorRaise(sourceFile, filePath, nodes);
  extractErrorHandle(sourceFile, filePath, nodes);
  extractEffects(sourceFile, filePath, nodes);
  extractEntrypoints(sourceFile, filePath, nodes);
  extractNextjsHandlers(sourceFile, filePath, nodes);
  extractGuards(sourceFile, filePath, nodes);
  extractStateMutation(sourceFile, filePath, nodes);
  extractFunctionDeclarations(sourceFile, filePath, nodes);
  extractReactWrapperComponents(sourceFile, filePath, nodes);
  extractDependencyEdges(sourceFile, filePath, edges);

  return {
    filePath,
    language: 'ts',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}

// ── error_raise ──────────────────────────────────────────────────────────

function extractErrorRaise(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // throw statements
  for (const throwStmt of sf.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    const start = throwStmt.getStart();
    const _line = throwStmt.getStartLineNumber();
    const errorType = extractThrowType(throwStmt);

    nodes.push({
      id: conceptId(filePath, 'error_raise', start),
      kind: 'error_raise',
      primarySpan: span(filePath, throwStmt),
      evidence: throwStmt.getText().substring(0, 100),
      confidence: 1.0,
      language: 'ts',
      containerId: getContainerId(throwStmt, filePath),
      payload: {
        kind: 'error_raise',
        subtype: 'throw',
        errorType,
      },
    });
  }

  // Promise.reject()
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'reject') continue;
    if (pa.getExpression().getText() !== 'Promise') continue;

    nodes.push({
      id: conceptId(filePath, 'error_raise', call.getStart()),
      kind: 'error_raise',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: 1.0,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'error_raise', subtype: 'reject' },
    });
  }
}

// ── error_handle ─────────────────────────────────────────────────────────

function extractErrorHandle(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  for (const catchClause of sf.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = catchClause.getBlock();
    const stmts = block.getStatements();
    const errorVar = catchClause.getVariableDeclaration()?.getName();

    const disposition = classifyDisposition(stmts, errorVar, block);

    nodes.push({
      id: conceptId(filePath, 'error_handle', catchClause.getStart()),
      kind: 'error_handle',
      primarySpan: span(filePath, catchClause),
      evidence: catchClause.getText().substring(0, 150),
      confidence: disposition.confidence,
      language: 'ts',
      containerId: getContainerId(catchClause, filePath),
      payload: {
        kind: 'error_handle',
        disposition: disposition.type,
        errorVariable: errorVar,
      },
    });
  }

  // .catch() on promises
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'catch') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    // Check if the catch callback is empty or just logs
    const callbackText = args[0].getText();
    let disposition: ErrorHandlePayload['disposition'] = 'wrapped';
    let confidence = 0.7;

    if (callbackText.includes('() => {}') || callbackText.includes('() => undefined')) {
      disposition = 'ignored';
      confidence = 1.0;
    } else if (/console\.(log|error|warn)/.test(callbackText)) {
      disposition = 'logged';
      confidence = 0.9;
    }

    nodes.push({
      id: conceptId(filePath, 'error_handle', call.getStart()),
      kind: 'error_handle',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 150),
      confidence,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: {
        kind: 'error_handle',
        disposition,
      },
    });
  }
}

function classifyDisposition(
  stmts: import('ts-morph').Statement[],
  errorVar?: string,
  block?: import('ts-morph').Block,
): { type: ErrorHandlePayload['disposition']; confidence: number } {
  // Empty catch — trust author intent comments. Real-world generated code
  // (AudioFacets, Agon) routinely uses short explanations like
  // `/* non-fatal */`, `/* already gone */`, `// process likely exited`.
  // If the author wrote a comment, they thought about it; the lint job is
  // to flag CARE-less code, not to override documented decisions.
  if (stmts.length === 0) {
    if (block && hasIntentComment(block.getText())) {
      return { type: 'wrapped', confidence: 0.4 };
    }
    return { type: 'ignored', confidence: 1.0 };
  }

  const bodyText = stmts.map((s) => s.getText()).join('\n');

  // Check for rethrow
  if (bodyText.includes('throw')) {
    // throw new XError(err) → wrapped (use word boundary to avoid 'e' matching 'HttpException')
    if (errorVar && new RegExp(`\\b${errorVar}\\b`).test(bodyText)) {
      return { type: 'wrapped', confidence: 0.95 };
    }
    return { type: 'rethrown', confidence: 0.9 };
  }

  // Check for return (error bubbling)
  const lastStmt = stmts[stmts.length - 1];
  if (lastStmt.getKind() === SyntaxKind.ReturnStatement) {
    return { type: 'returned', confidence: 0.85 };
  }

  // Check for logging only
  if (/console\.(log|error|warn)/.test(bodyText) || /logger\.\w+/.test(bodyText)) {
    // If the ONLY thing is logging, it's "logged"
    if (stmts.length === 1) {
      return { type: 'logged', confidence: 0.9 };
    }
    // Logging + other stuff → probably handling it
    return { type: 'logged', confidence: 0.7 };
  }

  // Has statements but we can't classify precisely
  return { type: 'wrapped', confidence: 0.5 };
}

/**
 * Does the text of an empty catch block carry ANY non-trivial comment?
 * A comment with at least one non-whitespace character beyond the marker
 * counts — we don't judge whether the reasoning is right, only that the
 * author documented their choice.
 *
 * Matches:
 *   //·ignore                        (single-line, any content)
 *   /* non-fatal * /                 (block, any content)
 *   /* already gone — ok * /         (block with unicode + spaces)
 *
 * Rejects:
 *   //                               (empty line comment)
 *   /* * /                           (empty block comment)
 */
function hasIntentComment(text: string): boolean {
  // Single-line `// content` with at least one non-whitespace char after the slashes.
  if (/\/\/[^\n]*\S/.test(text)) return true;
  // Block `/* content */` with at least one non-whitespace char inside.
  if (/\/\*[\s\S]*?\S[\s\S]*?\*\//.test(text)) return true;
  return false;
}

// ── effect ───────────────────────────────────────────────────────────────

function extractEffects(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  const clientIdents = collectClientIdentifiers(sf);

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let funcName = '';
    let objName = '';

    if (callee.getKind() === SyntaxKind.Identifier) {
      funcName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      funcName = pa.getName();
      objName = pa.getExpression().getText();
    }

    // Network effects
    const isDirectNetwork = NETWORK_CALLS.has(funcName);
    const isKnownLibraryMethod = NETWORK_METHODS.has(funcName) && /axios|got|ky|http|request|superagent/i.test(objName);
    const isWrappedClientCall = CLIENT_HTTP_METHODS.has(funcName) && clientIdents.has(objName);

    if (isDirectNetwork || isKnownLibraryMethod || isWrappedClientCall) {
      const isAsync = isInAsyncContext(call);
      const target = extractTarget(call);
      const sentFieldsInfo = extractSentFields(call, funcName);
      const queryParamsInfo = extractQueryParams(call);
      const hasAuthHeader = extractHasAuthHeader(call, funcName);
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: isDirectNetwork ? 1.0 : isWrappedClientCall ? 0.75 : 0.8,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: {
          kind: 'effect',
          subtype: 'network',
          async: isAsync,
          target,
          host: extractHost(target),
          responseAsserted: isResponseAsserted(call, isWrappedClientCall),
          bodyKind: extractBodyKind(call, funcName),
          method: extractHttpMethod(call, funcName, isDirectNetwork, isKnownLibraryMethod, isWrappedClientCall),
          hasAuthHeader,
          sentFields: sentFieldsInfo.fields,
          sentFieldsResolved: sentFieldsInfo.resolved,
          handlesApiErrors: extractHandlesApiErrors(call, isWrappedClientCall),
          authPropagation: extractAuthPropagation(call, funcName, objName, isWrappedClientCall, hasAuthHeader),
          queryParams: queryParamsInfo.params,
          queryParamsResolved: queryParamsInfo.resolved,
        },
      });
      continue;
    }

    // DB effects
    if (DB_CALLS.has(funcName) && /db|prisma|mongo|pool|client|knex|sequelize|typeorm|drizzle/i.test(objName)) {
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: 0.85,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'effect', subtype: 'db', async: isInAsyncContext(call) },
      });
      continue;
    }

    // FS effects
    if (FS_CALLS.has(funcName)) {
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: 0.95,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'effect', subtype: 'fs', async: funcName.includes('Sync') ? false : isInAsyncContext(call) },
      });
    }
  }
}

// ── entrypoint ───────────────────────────────────────────────────────────

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

function extractEntrypoints(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
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
    // dereference `handlerConceptId`. Imported handlers are still analyzed
    // when TypeScript can resolve their body, but are not linked into this
    // file's concept map.
    const resolvedHandler = resolveExpressRouteHandler(args, filePath);
    const handlerFn = resolvedHandler?.fn;
    const handlerConceptId =
      resolvedHandler && isSameConceptSourceFile(resolvedHandler.conceptFilePath, filePath)
        ? conceptId(filePath, 'function_declaration', resolvedHandler.conceptStart)
        : undefined;

    const bodyFieldsInfo = handlerFn
      ? extractHandlerBodyFields(handlerFn)
      : { fields: undefined as readonly string[] | undefined, resolved: false };
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
        errorStatusCodes: routeAnalysis.errorStatusCodes,
        hasUnboundedCollectionQuery: routeAnalysis.hasUnboundedCollectionQuery,
        hasDbWrite: routeAnalysis.hasDbWrite,
        hasIdempotencyProtection: routeAnalysis.hasIdempotencyProtection,
        hasBodyValidation: routeAnalysis.hasBodyValidation,
        validatedBodyFields: routeAnalysis.validatedBodyFields,
        bodyValidationResolved: routeAnalysis.bodyValidationResolved,
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

interface RouteHandlerAnalysis {
  errorStatusCodes?: readonly number[];
  hasUnboundedCollectionQuery?: boolean;
  hasDbWrite?: boolean;
  hasIdempotencyProtection?: boolean;
  hasBodyValidation?: boolean;
  validatedBodyFields?: readonly string[];
  bodyValidationResolved?: boolean;
}

type ExpressRouteHandlerFn =
  | import('ts-morph').ArrowFunction
  | import('ts-morph').FunctionExpression
  | import('ts-morph').FunctionDeclaration;

interface ExpressRouteHandlerResolution {
  fn: ExpressRouteHandlerFn;
  conceptStart: number;
  conceptFilePath: string;
}

const EMPTY_ROUTE_ANALYSIS: RouteHandlerAnalysis = {};
const API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
const PAGINATION_RE = /\b(limit|take|offset|skip|cursor|page|pageSize|perPage)\b|\.limit\s*\(|\.take\s*\(/i;
const IDEMPOTENCY_RE =
  /\b(idempotency|Idempotency-Key|transaction|\$transaction|unique|upsert|findUnique|findOne|on\s+conflict|getOrCreate|createOrGet)\b/i;

function analyzeExpressRouteHandler(
  handlerFn: ExpressRouteHandlerFn,
  routeArgs: readonly import('ts-morph').Node[],
  method: string,
  routePath: string | undefined,
): RouteHandlerAnalysis {
  const text = handlerFn.getText();
  const errorStatusCodes = extractExpressErrorStatusCodes(handlerFn);
  const validation = extractExpressValidation(handlerFn, routeArgs);
  return {
    errorStatusCodes,
    hasUnboundedCollectionQuery: hasUnboundedExpressCollectionQuery(handlerFn, method, routePath),
    hasDbWrite: handlerHasDbWrite(handlerFn),
    hasIdempotencyProtection: IDEMPOTENCY_RE.test(text),
    hasBodyValidation: validation.has,
    validatedBodyFields: validation.fields,
    bodyValidationResolved: validation.resolved,
  };
}

function resolveExpressRouteHandler(
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

function isSameConceptSourceFile(actualFilePath: string, conceptFilePath: string): boolean {
  const actual = actualFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const expected = conceptFilePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return actual === expected || actual.endsWith(`/${expected}`) || expected.endsWith(`/${actual}`);
}

function isExternalSourcePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/node_modules/') || normalized.includes('/.pnpm/');
}

function extractExpressErrorStatusCodes(handlerFn: ExpressRouteHandlerFn): readonly number[] | undefined {
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

function numericLiteralValue(node: import('ts-morph').Node | undefined): number | undefined {
  if (!node || node.getKind() !== SyntaxKind.NumericLiteral) return undefined;
  const value = Number(node.getText());
  return Number.isFinite(value) ? value : undefined;
}

function hasUnboundedExpressCollectionQuery(
  handlerFn: ExpressRouteHandlerFn,
  method: string,
  routePath: string | undefined,
): boolean {
  if (method !== 'GET') return false;
  if (routePath && /[:{]/.test(routePath)) return false;
  const text = handlerFn.getText();
  if (PAGINATION_RE.test(text) || /\b(req|request)\.query\b/.test(text)) return false;
  if (!handlerHasDbCollectionRead(handlerFn)) return false;
  if (!/\.json\s*\(|send\s*\(/.test(text)) return false;

  const lastSegment = routePath?.split('/').filter(Boolean).pop();
  return Boolean(lastSegment?.endsWith('s')) || /\bfindMany\b|\.find\s*\(|\.toArray\s*\(/.test(text);
}

function handlerHasDbCollectionRead(handlerFn: ExpressRouteHandlerFn): boolean {
  return handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!DB_COLLECTION_READ_CALLS.has(pa.getName())) return false;
    return isDbLikeReceiver(pa.getExpression().getText());
  });
}

function handlerHasDbWrite(handlerFn: ExpressRouteHandlerFn): boolean {
  return handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!DB_WRITE_CALLS.has(pa.getName())) return false;
    return isDbLikeReceiver(pa.getExpression().getText());
  });
}

function isDbLikeReceiver(receiver: string): boolean {
  return (
    /\b(db|prisma|mongo|collection|repo|repository|model|client|knex|sequelize|typeorm|pool)\b/i.test(receiver) ||
    /^[A-Z][A-Za-z0-9_]*(Model)?$/.test(receiver)
  );
}

function extractExpressValidation(
  handlerFn: ExpressRouteHandlerFn,
  routeArgs: readonly import('ts-morph').Node[],
): { has: boolean; fields: readonly string[] | undefined; resolved: boolean } {
  const fields = new Set<string>();
  let hasValidation = false;
  let resolved = false;

  for (const arg of routeArgs) {
    if (arg === handlerFn) continue;
    if (arg.getStart() > handlerFn.getStart()) continue;
    if (/\b(validate|validator|schema|zod|joi)\b/i.test(arg.getText())) hasValidation = true;
    for (const field of extractExpressValidatorFields(arg)) {
      fields.add(field);
      hasValidation = true;
      resolved = true;
    }
  }

  const handlerText = handlerFn.getText();
  if (/\.(parse|safeParse|validate)\s*\(\s*(req|request)\.body\b/.test(handlerText)) hasValidation = true;

  for (const call of handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isSchemaObjectCall(call)) continue;
    if (!schemaCallValidatesRequestBody(call)) continue;
    const arg = call.getArguments()[0];
    if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const extracted = extractLiteralObjectFields(arg as import('ts-morph').ObjectLiteralExpression);
    if (!extracted.resolved || !extracted.fields) continue;
    for (const field of extracted.fields) fields.add(field);
    hasValidation = true;
    resolved = true;
  }

  return {
    has: hasValidation,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved,
  };
}

function extractExpressValidatorFields(node: import('ts-morph').Node): string[] {
  const fields: string[] = [];
  const calls =
    node.getKind() === SyntaxKind.CallExpression
      ? [node as import('ts-morph').CallExpression, ...node.getDescendantsOfKind(SyntaxKind.CallExpression)]
      : node.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const callee = call.getExpression().getText();
    if (!/^(body|check|param|query)$/.test(callee) && !/\.(body|check|param|query)$/.test(callee)) continue;
    const first = call.getArguments()[0];
    if (!first || first.getKind() !== SyntaxKind.StringLiteral) continue;
    fields.push((first as import('ts-morph').StringLiteral).getLiteralValue());
  }
  return fields;
}

function isSchemaObjectCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression().getText();
  return callee === 'z.object' || callee === 'Joi.object' || callee.endsWith('.object');
}

function schemaCallValidatesRequestBody(call: import('ts-morph').CallExpression): boolean {
  let cursor: import('ts-morph').Node | undefined = call;
  for (let depth = 0; depth < 5; depth++) {
    cursor = cursor.getParent();
    if (!cursor) return false;
    const text = cursor.getText();
    if (/\.(parse|safeParse|validate)\s*\(\s*(req|request)\.body\b/.test(text)) return true;
  }
  return false;
}

// Express `app.use('/api/prefix', ...middlewares, subRouter)`: emit a
// route-mount concept so `collectRoutesAcrossGraph` can join the sub-router's
// bare paths (`router.get('/foo')`) with the mount prefix (`/api/prefix/foo`).
// Mirrors the FastAPI `app.include_router()` emission in review-python.
// Caller must have already filtered to `.use()` calls whose object matches
// `app|router|server`.
function extractRouteMount(call: import('ts-morph').CallExpression, mountFile: string): ConceptNode | undefined {
  const args = call.getArguments();
  if (args.length < 2) return undefined;
  if (args[0].getKind() !== SyntaxKind.StringLiteral) return undefined;
  const prefix = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
  if (!prefix.startsWith('/')) return undefined;

  // The sub-router is the LAST arg; intermediate args are middlewares.
  const last = args[args.length - 1];
  if (last.getKind() !== SyntaxKind.Identifier) return undefined;
  const ident = last as import('ts-morph').Identifier;
  const routerName = ident.getText();

  const sourceModule = resolveImportedFileSuffix(ident, mountFile);
  // Emit even when resolution fails — the same-file fallback in
  // resolveMountPrefix can still match if the router is declared locally.
  return {
    id: conceptId(mountFile, 'entrypoint', call.getStart()),
    kind: 'entrypoint',
    primarySpan: span(mountFile, call),
    evidence: call.getText().substring(0, 120),
    confidence: 0.9,
    language: 'ts',
    containerId: getContainerId(call, mountFile),
    payload: {
      kind: 'entrypoint',
      subtype: 'route-mount',
      name: prefix,
      routerName,
      sourceModule,
    },
  };
}

// Given an identifier used in a mount call, resolve it back to the file it
// was imported from, and return a trailing path suffix (relative to the mount
// file's directory, with extension) usable by `cross-stack-utils`'s
// `routeFile.endsWith('/' + sourceModule)` matcher.
//
// Returns `undefined` when the identifier is declared locally (no import),
// when the import cannot be resolved to a source file, or when the import
// is external (node_modules).
function resolveImportedFileSuffix(ident: import('ts-morph').Identifier, mountFile: string): string | undefined {
  const symbol = ident.getSymbol();
  if (!symbol) return undefined;
  for (const decl of symbol.getDeclarations()) {
    const kind = decl.getKind();
    if (kind !== SyntaxKind.ImportClause && kind !== SyntaxKind.ImportSpecifier) continue;
    const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (!importDecl) continue;
    const resolved = importDecl.getModuleSpecifierSourceFile();
    if (resolved) {
      return pathSuffixBetween(mountFile, resolved.getFilePath());
    }
    // ts-morph couldn't resolve (no project config) — fall back to parsing the
    // specifier string and swapping common JS→TS extensions.
    const specifier = importDecl.getModuleSpecifierValue();
    const guess = guessResolvedSuffix(specifier, mountFile);
    if (guess) return guess;
  }
  return undefined;
}

function pathSuffixBetween(mountFile: string, targetFile: string): string {
  // Return targetFile relative to the mount file's directory when possible.
  // Fallback: the last 2-3 path components of the target. This just needs to
  // be a unique trailing suffix for `routeFile.endsWith('/' + suffix)` to match.
  const parts = targetFile.split('/');
  const mountParts = mountFile.split('/');
  // Find longest common prefix
  let commonLen = 0;
  while (
    commonLen < parts.length - 1 &&
    commonLen < mountParts.length - 1 &&
    parts[commonLen] === mountParts[commonLen]
  ) {
    commonLen++;
  }
  const tail = parts.slice(commonLen).join('/');
  return tail || parts.slice(-2).join('/');
}

// Walk an Express handler body and collect the REQUIRED body field names it
// reads. Combines two evidence sources:
//   1. Destructuring:  `const { name, email } = req.body;`
//   2. Property access: `req.body.name`, `req.body['email']`
//
// Default-assignments in destructuring (`{ status = 'active' }`) mark the
// field as optional and are excluded from the required set. A rest element
// (`{ ...rest }`) or a dynamic key (`req.body[var]`) poisons the resolution
// because the handler may need arbitrary fields we can't see.
function extractHandlerBodyFields(fn: ExpressRouteHandlerFn): {
  fields: readonly string[] | undefined;
  resolved: boolean;
} {
  const body = fn.getBody();
  if (!body) return { fields: undefined, resolved: false };

  const required = new Set<string>();
  let poisoned = false;

  // 1. Destructuring: walk VariableDeclarations whose initializer is `req.body`
  //    or a reference that aliases it. V1 matches only direct `req.body`.
  for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || init.getText() !== 'req.body') continue;
    const name = decl.getNameNode();
    if (name.getKind() !== SyntaxKind.ObjectBindingPattern) {
      // `const body = req.body` whole-body alias — handler may read anything
      // off `body.X` downstream. Poison the resolution for safety.
      poisoned = true;
      continue;
    }
    for (const el of (name as import('ts-morph').ObjectBindingPattern).getElements()) {
      if (el.getDotDotDotToken()) {
        // `{ ...rest } = req.body` — unknowable set of fields.
        poisoned = true;
        continue;
      }
      if (el.getInitializer()) {
        // `{ status = 'active' }` — optional, skip (don't add to required).
        continue;
      }
      const elName = el.getNameNode();
      if (elName.getKind() === SyntaxKind.Identifier) {
        // `{ name }` or `{ name: alias }` — the property name lives on
        // `propertyNameNode` when aliased, `nameNode` otherwise.
        const propName = el.getPropertyNameNode()?.getText() ?? elName.getText();
        required.add(propName);
      } else {
        // Nested destructuring or other exotic shape — give up for v1.
        poisoned = true;
      }
    }
  }

  // 2. Property access: `req.body.name` / `req.body['name']`.
  for (const pa of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pa.getExpression().getText() !== 'req.body') continue;
    required.add(pa.getName());
  }
  for (const el of body.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    if (el.getExpression().getText() !== 'req.body') continue;
    const arg = el.getArgumentExpression();
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      required.add((arg as import('ts-morph').StringLiteral).getLiteralValue());
    } else {
      // `req.body[key]` dynamic — unknowable.
      poisoned = true;
    }
  }

  if (poisoned) return { fields: undefined, resolved: false };
  if (required.size === 0) return { fields: undefined, resolved: false };
  return { fields: Array.from(required), resolved: true };
}

function guessResolvedSuffix(specifier: string, mountFile: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const mountDir = mountFile.split('/').slice(0, -1).join('/');
  const segments: string[] = [];
  for (const seg of specifier.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (mountDir.length === 0) continue;
      segments.pop();
    } else {
      segments.push(seg);
    }
  }
  if (segments.length === 0) return undefined;
  const base = segments[segments.length - 1];
  const swapped = base.replace(/\.(js|mjs|cjs)$/i, '.ts');
  segments[segments.length - 1] = /\.(ts|tsx)$/i.test(swapped) ? swapped : `${swapped}.ts`;
  return segments.join('/');
}

// ── Next.js handlers & server actions ────────────────────────────────────

const NEXTJS_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

function hasUseServerDirective(sf: SourceFile): boolean {
  const text = sf.getFullText();
  return /^\s*['"]use server['"];?\s*$/m.test(text.substring(0, 200));
}

function extractNextjsHandlers(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Track offsets we already emitted as entrypoints, to avoid duplication with extractEntrypoints
  const emittedOffsets = new Set<number>();

  // 1. App Router API route handlers: export async function GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (!NEXTJS_HTTP_METHODS.has(name)) continue;
    for (const decl of decls) {
      if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
      const fn = decl as import('ts-morph').FunctionDeclaration;
      emittedOffsets.add(fn.getStart());
      nodes.push({
        id: conceptId(filePath, 'entrypoint', fn.getStart()),
        kind: 'entrypoint',
        primarySpan: span(filePath, fn),
        evidence: fn.getText().substring(0, 120),
        confidence: 0.95,
        language: 'ts',
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name,
          httpMethod: name,
        },
      });
    }
  }

  // 2. Pages Router: default export with NextApiRequest/NextApiResponse params OR file in api/ path
  const isApiPath = /\/api\//.test(filePath) || /\/pages\/api\//.test(filePath);
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (name !== 'default') continue;
    for (const decl of decls) {
      if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
      const fn = decl as import('ts-morph').FunctionDeclaration;
      if (emittedOffsets.has(fn.getStart())) continue;

      const params = fn.getParameters();
      const paramTypes = params.map((p) => p.getType().getText()).join(',');
      const hasNextApiParams =
        /NextApiRequest|NextApiResponse/.test(paramTypes) ||
        /NextApiRequest|NextApiResponse/.test(params.map((p) => p.getText()).join(','));

      if (hasNextApiParams || isApiPath) {
        emittedOffsets.add(fn.getStart());
        nodes.push({
          id: conceptId(filePath, 'entrypoint', fn.getStart()),
          kind: 'entrypoint',
          primarySpan: span(filePath, fn),
          evidence: fn.getText().substring(0, 120),
          confidence: hasNextApiParams ? 0.95 : 0.85,
          language: 'ts',
          payload: {
            kind: 'entrypoint',
            subtype: 'handler',
            name: fn.getName() || 'default',
          },
        });
      }
    }
  }

  // 3. Server actions: files with 'use server' directive — all exported async functions are server actions
  if (hasUseServerDirective(sf)) {
    for (const [name, decls] of sf.getExportedDeclarations()) {
      if (name === 'default') continue;
      for (const decl of decls) {
        if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
        const fn = decl as import('ts-morph').FunctionDeclaration;
        if (!fn.isAsync()) continue;
        if (emittedOffsets.has(fn.getStart())) continue;

        nodes.push({
          id: conceptId(filePath, 'entrypoint', fn.getStart()),
          kind: 'entrypoint',
          primarySpan: span(filePath, fn),
          evidence: fn.getText().substring(0, 120),
          confidence: 0.95,
          language: 'ts',
          payload: {
            kind: 'entrypoint',
            subtype: 'handler',
            name: fn.getName() || name,
          },
        });
      }
    }
  }
}

// ── React wrapper components (memo, forwardRef) ─────────────────────────

const REACT_WRAPPERS = new Set(['memo', 'forwardRef']);
const REACT_QUALIFIED_WRAPPERS = new Set(['React.memo', 'React.forwardRef']);

function extractReactWrapperComponents(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
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

    // Check if the callee is a known React wrapper
    const isWrapper = REACT_WRAPPERS.has(calleeText) || REACT_QUALIFIED_WRAPPERS.has(calleeText);
    if (!isWrapper) continue;

    const name = varDecl.getName();
    // React components must start with uppercase
    if (!/^[A-Z]/.test(name)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    // The first argument should be an arrow function or function expression
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

// ── guard ────────────────────────────────────────────────────────────────

const AUTH_KEYWORDS = /auth|session|token|user|role|permission|admin|login|credential/i;
const VALIDATION_CALLS = new Set(['parse', 'safeParse', 'validate', 'validateSync', 'check']);

function extractGuards(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Pattern 1: early return/throw after auth check: if (!req.user) return/throw
  for (const ifStmt of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const condText = ifStmt.getExpression().getText();
    if (!AUTH_KEYWORDS.test(condText)) continue;

    const thenBlock = ifStmt.getThenStatement();
    const thenText = thenBlock.getText();

    // Must be early exit (return, throw, or response with 401/403)
    const isEarlyExit =
      thenText.includes('return') ||
      thenText.includes('throw') ||
      thenText.includes('401') ||
      thenText.includes('403') ||
      thenText.includes('redirect');

    if (!isEarlyExit) continue;

    nodes.push({
      id: conceptId(filePath, 'guard', ifStmt.getStart()),
      kind: 'guard',
      primarySpan: span(filePath, ifStmt),
      evidence: ifStmt.getText().substring(0, 120),
      confidence: 0.8,
      language: 'ts',
      containerId: getContainerId(ifStmt, filePath),
      payload: { kind: 'guard', subtype: 'auth', name: condText.substring(0, 60) },
    });
  }

  // Pattern 2: schema.parse(), validator.validate() calls
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!VALIDATION_CALLS.has(pa.getName())) continue;

    const objText = pa.getExpression().getText();
    if (/schema|validator|zod|yup|joi|valibot/i.test(objText) || /Schema$/.test(objText)) {
      nodes.push({
        id: conceptId(filePath, 'guard', call.getStart()),
        kind: 'guard',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 100),
        confidence: 0.9,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'guard', subtype: 'validation', name: objText },
      });
    }
  }
}

// ── state_mutation ───────────────────────────────────────────────────────

function extractStateMutation(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // this.x = ..., this.x++, this.x += ...
  for (const binExpr of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = binExpr.getOperatorToken().getKind();
    if (op !== SyntaxKind.EqualsToken && op !== SyntaxKind.PlusEqualsToken && op !== SyntaxKind.MinusEqualsToken)
      continue;

    const leftText = binExpr.getLeft().getText();
    if (!leftText.includes('.')) continue; // only property assignments

    const root = leftText.split('.')[0];

    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    if (root === 'this' || root === 'self') scope = 'module';
    else if (/global|window|process\.env/i.test(root)) scope = 'global';
    else if (/state|store|cache|registry/i.test(root)) scope = 'shared';
    else continue; // skip local assignments like obj.prop = x

    nodes.push({
      id: conceptId(filePath, 'state_mutation', binExpr.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, binExpr),
      evidence: binExpr.getText().substring(0, 100),
      confidence: scope === 'module' ? 0.9 : 0.75,
      language: 'ts',
      containerId: getContainerId(binExpr, filePath),
      payload: { kind: 'state_mutation', target: leftText, scope, via: 'assignment' },
    });
  }

  // Prefix/postfix: this.count++, state.value--
  for (const unary of [
    ...sf.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
  ]) {
    const operandText =
      unary.getKind() === SyntaxKind.PostfixUnaryExpression
        ? (unary as import('ts-morph').PostfixUnaryExpression).getOperand().getText()
        : (unary as import('ts-morph').PrefixUnaryExpression).getOperand().getText();

    if (!operandText.includes('.')) continue;
    const root = operandText.split('.')[0];

    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    if (root === 'this' || root === 'self') scope = 'module';
    else if (/state|store|cache/i.test(root)) scope = 'shared';
    else continue;

    nodes.push({
      id: conceptId(filePath, 'state_mutation', unary.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, unary),
      evidence: unary.getText().substring(0, 80),
      confidence: 0.85,
      language: 'ts',
      containerId: getContainerId(unary, filePath),
      payload: { kind: 'state_mutation', target: operandText, scope, via: 'increment' },
    });
  }

  // Call-based: setState(), setCount(), dispatch(), store.dispatch()
  const NON_STATE_SETTERS =
    /^(setTimeout|setInterval|setImmediate|setAttribute|setProperty|setHeader|setRequestHeader|setItem|setCustomValidity)$/;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const target = calleeText;
    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    let api: string | undefined;
    let isStateMutation = false;

    if (calleeText === 'dispatch' || calleeText === 'this.setState') {
      isStateMutation = true;
      scope = calleeText.startsWith('this.') ? 'module' : 'local';
      api = calleeText === 'this.setState' ? 'setState' : 'dispatch';
    } else if (/^store\.dispatch|\.dispatch$/.test(calleeText)) {
      isStateMutation = true;
      scope = 'shared';
      api = 'dispatch';
    } else if (/^set[A-Z]/.test(calleeText) && !NON_STATE_SETTERS.test(calleeText)) {
      isStateMutation = true;
      scope = 'local';
      api = 'setter';
    }

    if (!isStateMutation) continue;

    nodes.push({
      id: conceptId(filePath, 'state_mutation', call.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: 0.85,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'state_mutation', target, scope, via: 'call', api },
    });
  }
}

// ── function declarations ─────────────────────────────────────────────────

function hasAwaitInBody(node: import('ts-morph').Node): boolean {
  // Check for AwaitExpression or ForOfStatement with await
  for (const desc of node.getDescendants()) {
    const kind = desc.getKind();
    if (kind === SyntaxKind.AwaitExpression) {
      // Verify this await is not inside a nested function
      let parent = desc.getParent();
      let isNested = false;
      while (parent && parent !== node) {
        const pk = parent.getKind();
        if (
          pk === SyntaxKind.FunctionDeclaration ||
          pk === SyntaxKind.FunctionExpression ||
          pk === SyntaxKind.ArrowFunction ||
          pk === SyntaxKind.MethodDeclaration
        ) {
          isNested = true;
          break;
        }
        parent = parent.getParent();
      }
      if (!isNested) return true;
    }
    if (kind === SyntaxKind.ForOfStatement) {
      // Check for `for await` by looking at the text
      if (/\bfor\s+await\b/.test(desc.getText().substring(0, 20))) {
        let parent = desc.getParent();
        let isNested = false;
        while (parent && parent !== node) {
          const pk = parent.getKind();
          if (
            pk === SyntaxKind.FunctionDeclaration ||
            pk === SyntaxKind.FunctionExpression ||
            pk === SyntaxKind.ArrowFunction ||
            pk === SyntaxKind.MethodDeclaration
          ) {
            isNested = true;
            break;
          }
          parent = parent.getParent();
        }
        if (!isNested) return true;
      }
    }
  }
  return false;
}

function extractFunctionDeclarations(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
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

// ── Express route handler callbacks ──────────────────────────────────────

const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'use', 'all']);

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

    // Extract route path from first argument (string literal)
    let routePath: string | undefined;
    if (args[0].getKind() === SyntaxKind.StringLiteral) {
      routePath = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
    }

    // Check all arguments after the first for arrow functions / function expressions
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      const argKind = arg.getKind();
      if (argKind !== SyntaxKind.ArrowFunction && argKind !== SyntaxKind.FunctionExpression) continue;

      const fn = arg as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
      const offset = fn.getStart();

      // Skip if already emitted (e.g., assigned to a variable first)
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

// ── dependency edges ─────────────────────────────────────────────────────

const NODE_STDLIB = new Set([
  'fs',
  'path',
  'os',
  'http',
  'https',
  'url',
  'util',
  'crypto',
  'events',
  'stream',
  'buffer',
  'child_process',
  'cluster',
  'net',
  'dns',
  'tls',
  'zlib',
  'readline',
  'assert',
  'querystring',
]);

function extractDependencyEdges(sf: SourceFile, filePath: string, edges: ConceptEdge[]): void {
  for (const imp of sf.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    const start = imp.getStart();

    let subtype: 'internal' | 'external' | 'stdlib' = 'external';
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      subtype = 'internal';
    } else if (NODE_STDLIB.has(specifier.split('/')[0]) || specifier.startsWith('node:')) {
      subtype = 'stdlib';
    }

    edges.push({
      id: conceptId(filePath, 'dependency', start),
      kind: 'dependency',
      sourceId: filePath,
      targetId: specifier,
      primarySpan: span(filePath, imp),
      evidence: imp.getText().substring(0, 120),
      confidence: 1.0,
      language: 'ts',
      payload: { kind: 'dependency', subtype, specifier },
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function span(filePath: string, node: import('ts-morph').Node): ConceptSpan {
  return conceptSpan(
    filePath,
    node.getStartLineNumber(),
    node.getStart() - node.getSourceFile().getFullText().lastIndexOf('\n', node.getStart()),
    node.getEndLineNumber(),
    1,
  );
}

// Incidental HOF callbacks — these are NOT logical containers
const SKIP_CALLBACKS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'some',
  'every',
  'find',
  'findIndex',
  'flatMap',
  'sort',
  'then',
  'catch',
  'finally',
]);

function getContainerId(node: import('ts-morph').Node, filePath: string): string | undefined {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration) {
      const name = (parent as any).getName?.() || 'anonymous';
      return `${filePath}#fn:${name}@${parent.getStart()}`;
    }
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      // Skip if this function is an argument to an incidental HOF (forEach, map, etc.)
      const grandparent = parent.getParent();
      if (grandparent?.getKind() === SyntaxKind.CallExpression) {
        const callee = (grandparent as import('ts-morph').CallExpression).getExpression();
        if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
          const methodName = (callee as import('ts-morph').PropertyAccessExpression).getName();
          if (SKIP_CALLBACKS.has(methodName)) {
            parent = grandparent.getParent();
            continue;
          }
        }
      }
      // Not a skippable callback — this IS the container
      const name = (parent as any).getName?.() || 'anonymous';
      return `${filePath}#fn:${name}@${parent.getStart()}`;
    }
    parent = parent.getParent();
  }
  return undefined;
}

function extractThrowType(throwStmt: import('ts-morph').ThrowStatement): string | undefined {
  const expr = throwStmt.getExpression();
  if (!expr) return undefined;
  if (expr.getKind() === SyntaxKind.NewExpression) {
    return (expr as import('ts-morph').NewExpression).getExpression().getText();
  }
  return undefined;
}

function isInAsyncContext(node: import('ts-morph').Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
      return (parent as import('ts-morph').FunctionDeclaration).isAsync();
    }
    if (parent.getKind() === SyntaxKind.ArrowFunction) {
      return (parent as import('ts-morph').ArrowFunction).isAsync();
    }
    if (parent.getKind() === SyntaxKind.MethodDeclaration) {
      return (parent as import('ts-morph').MethodDeclaration).isAsync();
    }
    parent = parent.getParent();
  }
  return false;
}

// Extract the field names a network call sends on the wire. High-confidence
// sources:
//   - literal objects: `JSON.stringify({ a, b })`, `axios.post(url, { a, b })`
//   - typed payload variables: `JSON.stringify(input)` where `input: CreateUser`
// Everything else returns `{ fields: undefined, resolved: false }` so
// body-shape-drift stays silent on opaque shapes rather than guessing.
function extractSentFields(
  call: import('ts-morph').CallExpression,
  funcName: string,
): { fields: readonly string[] | undefined; resolved: boolean } {
  const payload = extractNetworkPayloadExpression(call, funcName);
  if (!payload) return { fields: undefined, resolved: false };
  return extractPayloadFields(payload);
}

function extractNetworkPayloadExpression(
  call: import('ts-morph').CallExpression,
  funcName: string,
): import('ts-morph').Node | undefined {
  const args = call.getArguments();
  if (args.length < 2) return undefined;

  if (AXIOS_STYLE_METHODS.has(funcName)) {
    return args[1];
  }

  if (funcName !== 'fetch') return undefined;
  const opts = args[1];
  if (opts.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const optsObj = opts as import('ts-morph').ObjectLiteralExpression;
  const bodyProp = optsObj.getProperty('body');
  if (!bodyProp) return undefined;
  if (bodyProp.getKind() !== SyntaxKind.PropertyAssignment) {
    return undefined;
  }
  const init = (bodyProp as import('ts-morph').PropertyAssignment).getInitializer();
  return init;
}

function extractPayloadFields(node: import('ts-morph').Node): {
  fields: readonly string[] | undefined;
  resolved: boolean;
} {
  const payload = unwrapPayloadExpression(node);
  if (payload.getKind() === SyntaxKind.CallExpression) {
    const bodyCall = payload as import('ts-morph').CallExpression;
    if (bodyCall.getExpression().getText() !== 'JSON.stringify') return { fields: undefined, resolved: false };
    const stringifyArg = bodyCall.getArguments()[0];
    return stringifyArg ? extractPayloadFields(stringifyArg) : { fields: undefined, resolved: false };
  }
  if (payload.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return extractLiteralObjectFields(payload as import('ts-morph').ObjectLiteralExpression);
  }
  if (payload.getKind() === SyntaxKind.Identifier || payload.getKind() === SyntaxKind.PropertyAccessExpression) {
    return extractObjectFieldsFromType(payload);
  }
  return { fields: undefined, resolved: false };
}

function unwrapPayloadExpression(node: import('ts-morph').Node): import('ts-morph').Node {
  let current = node;
  while (true) {
    const kind = current.getKind();
    if (kind === SyntaxKind.ParenthesizedExpression) {
      current = (current as import('ts-morph').ParenthesizedExpression).getExpression();
    } else if (kind === SyntaxKind.AsExpression) {
      current = (current as import('ts-morph').AsExpression).getExpression();
    } else if (kind === SyntaxKind.TypeAssertionExpression) {
      current = (current as import('ts-morph').TypeAssertion).getExpression();
    } else if (kind === SyntaxKind.NonNullExpression) {
      current = (current as import('ts-morph').NonNullExpression).getExpression();
    } else if (kind === SyntaxKind.SatisfiesExpression) {
      current = (current as import('ts-morph').SatisfiesExpression).getExpression();
    } else {
      return current;
    }
  }
}

function extractObjectFieldsFromType(node: import('ts-morph').Node): {
  fields: readonly string[] | undefined;
  resolved: boolean;
} {
  const type = node.getType();
  if (type.isAny() || type.isUnknown() || type.isUnion()) return { fields: undefined, resolved: false };
  if (type.getStringIndexType() || type.getNumberIndexType()) return { fields: undefined, resolved: false };

  const fields = new Set<string>();
  for (const prop of type.getProperties()) {
    const declarations = prop.getDeclarations();
    if (declarations.length === 0) return { fields: undefined, resolved: false };
    if (declarations.some((decl) => isExternalSourcePath(decl.getSourceFile().getFilePath()))) {
      return { fields: undefined, resolved: false };
    }
    if (declarations.some((decl) => declarationIsOptional(decl))) continue;
    const name = prop.getName();
    if (!/^[A-Za-z_$][\w$-]*$/.test(name)) return { fields: undefined, resolved: false };
    fields.add(name);
  }

  return fields.size > 0 ? { fields: Array.from(fields).sort(), resolved: true } : { fields: [], resolved: true };
}

function declarationIsOptional(decl: import('ts-morph').Node): boolean {
  const maybeOptional = decl as import('ts-morph').Node & { hasQuestionToken?: () => boolean };
  return maybeOptional.hasQuestionToken?.() === true;
}

// Walk an object literal and return its identifier-keyed property names.
// Spread (`...x`) or computed keys (`[x]: ...`) poison the resolution —
// we mark unresolved rather than return a partial field list that would
// produce false positives downstream.
function extractLiteralObjectFields(obj: import('ts-morph').ObjectLiteralExpression): {
  fields: readonly string[] | undefined;
  resolved: boolean;
} {
  const fields: string[] = [];
  for (const prop of obj.getProperties()) {
    const kind = prop.getKind();
    if (kind === SyntaxKind.SpreadAssignment) return { fields: undefined, resolved: false };
    if (kind === SyntaxKind.PropertyAssignment) {
      const name = (prop as import('ts-morph').PropertyAssignment).getNameNode();
      if (name.getKind() === SyntaxKind.ComputedPropertyName) return { fields: undefined, resolved: false };
      if (name.getKind() === SyntaxKind.Identifier || name.getKind() === SyntaxKind.StringLiteral) {
        fields.push((name as import('ts-morph').Identifier).getText().replace(/['"]/g, ''));
      } else {
        return { fields: undefined, resolved: false };
      }
    } else if (kind === SyntaxKind.ShorthandPropertyAssignment) {
      fields.push((prop as import('ts-morph').ShorthandPropertyAssignment).getName());
    } else {
      // Method definitions, getters, setters — unusual in a fetch body,
      // treat as unresolved.
      return { fields: undefined, resolved: false };
    }
  }
  return { fields, resolved: true };
}

function extractTarget(call: import('ts-morph').CallExpression): string | undefined {
  const args = call.getArguments();
  if (args.length === 0) return undefined;
  const first = args[0];
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return (first as import('ts-morph').StringLiteral).getLiteralValue();
  }
  if (first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (first as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue();
  }
  if (first.getKind() === SyntaxKind.TemplateExpression) {
    return extractTemplateUrl(first as import('ts-morph').TemplateExpression);
  }
  return undefined;
}

// Phase 1 of surface-fingerprinting: pull the host out of an absolute URL so
// downstream cross-stack rules can later filter third-party calls (e.g. a
// frontend `fetch` to `stripe.com/api/charges` shouldn't match against the
// partner backend's `/api/charges` route). Phase 2 will use this — phase 1
// only captures it.
//
// Accepts the already-extracted target string (lit / no-substitution / template
// post-extraction). Rejects targets where the host slot is a placeholder like
// `:HOST` produced by `extractTemplateUrl` from `https://${HOST}/...` — those
// aren't real DNS names. Returns the host lower-cased so case-insensitive
// comparison is free downstream.
const HOST_LIKE_RE = /^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$/i;

function extractHost(target: string | undefined): string | undefined {
  if (!target) return undefined;
  if (!target.startsWith('http://') && !target.startsWith('https://')) return undefined;
  const hostStart = target.indexOf('://') + 3;
  const pathStart = target.indexOf('/', hostStart);
  const host = pathStart === -1 ? target.slice(hostStart) : target.slice(hostStart, pathStart);
  if (!HOST_LIKE_RE.test(host)) return undefined;
  return host.toLowerCase();
}

function extractQueryParams(call: import('ts-morph').CallExpression): {
  params: readonly string[] | undefined;
  resolved: boolean;
} {
  const target = extractTarget(call);
  if (!target) return { params: undefined, resolved: false };
  const q = target.indexOf('?');
  if (q === -1) return { params: [], resolved: true };
  const query = target.slice(q + 1).split('#')[0] ?? '';
  if (query.length === 0) return { params: [], resolved: true };
  const params: string[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawName] = part.split('=');
    if (!rawName) continue;
    const name = rawName.replace(/^:+/, '');
    if (/^[A-Za-z_][\w-]*$/.test(name)) params.push(name);
  }
  return { params, resolved: true };
}

// Convert a template literal like `${API_BASE}/api/review/${slug}` into a
// server-route-shaped path like `/api/review/:slug` so cross-stack rules can
// correlate it against backend routes. Without this every `fetch(` \`${BASE}/…\` `)`
// call is silently dropped by `normalizeClientUrl` (which rejects targets that
// start with \`$ instead of \`/).
function extractTemplateUrl(tmpl: import('ts-morph').TemplateExpression): string | undefined {
  const head = tmpl.getHead();
  let out = head.getLiteralText();
  const spans = tmpl.getTemplateSpans();
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const expr = span.getExpression();
    const exprText = expr.getText();
    const isBareIdent = expr.getKind() === SyntaxKind.Identifier;
    if (i === 0 && out === '' && isBareIdent && looksLikeBaseUrlName(exprText)) {
      // Drop a leading `${BASE_URL}` interpolation so the path starts with `/`.
    } else {
      out += `:${isBareIdent ? exprText : 'param'}`;
    }
    out += span.getLiteral().getLiteralText();
  }
  return out.length > 0 ? out : undefined;
}

function looksLikeBaseUrlName(name: string): boolean {
  return (
    /(^|_)(base|url|host|origin|endpoint|api|server)(_|$)/i.test(name) ||
    /(Base|Url|Host|Origin|Endpoint|Api|Server)$/.test(name)
  );
}

/**
 * Given a network call (fetch/axios/…), decide whether the eventual JSON
 * payload is consumed with a type annotation, `as T` cast, or `satisfies T`
 * clause. Returns:
 *   - `true` — the call-site is typed; the consumer enforces a shape.
 *   - `false` — the call-site is awaited/.then()'d but no assertion appears.
 *   - `undefined` — no `.json()` consumption in scope, or the pattern is
 *     too complex to analyze.
 *
 * Powers the `untyped-api-response` cross-stack rule (the frontend treats
 * the server's declared response shape as `any`). Kept intentionally
 * conservative — false positives here poison the pitch.
 */
function isResponseAsserted(call: import('ts-morph').CallExpression, isWrappedClientCall = false): boolean | undefined {
  // Generic type argument on the call itself, e.g. `apiClient.get<User>(url)`.
  // Wrapped clients (~75% of prod apps) almost always rely on this — the
  // wrapper pre-parses JSON and returns a typed payload, so the caller never
  // sees a `.json()` call. Treating the generic as the assertion is the only
  // way the `untyped-api-response` rule can fire on wrapped-client codebases.
  if (call.getTypeArguments().length > 0) return true;

  // Walk outward from the network call looking for JSON consumption. Only
  // after we've seen `.json()` (or a `.then(r => r.json())` callback) does
  // it make sense to rule the *payload* typed vs untyped — a raw Response
  // assigned to a variable like `const res = await fetch(...)` tells us
  // nothing about how the caller will later parse it. Codex review on
  // 550a57ec caught the false positive for the split pattern
  // `const res = await fetch(url); const data: User[] = await res.json();`
  // where the raw Response variable has no annotation.
  //
  // Wrapped clients pre-parse JSON inside the wrapper, so there's no
  // `.json()` call to observe at the call-site. For those we treat the
  // wrapped call itself as if JSON consumption had already happened — the
  // payload is whatever `apiClient.get(...)` returns, and we classify the
  // enclosing binding's type annotation directly.
  let cursor: import('ts-morph').Node = call;
  let sawJsonConsumption = isWrappedClientCall;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return undefined;

    if (parent.getKind() === SyntaxKind.AwaitExpression || parent.getKind() === SyntaxKind.ParenthesizedExpression) {
      cursor = parent;
      continue;
    }

    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = parent as import('ts-morph').PropertyAccessExpression;
      const parentCall = pa.getParent();
      if (pa.getName() === 'then' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        // Count this as JSON consumption only if the `.then` callback
        // clearly parses JSON. A `.then(r => r.status)` chain doesn't.
        if (callbackCallsJson(parentCall as import('ts-morph').CallExpression)) {
          sawJsonConsumption = true;
        }
        cursor = parentCall;
        continue;
      }
      if (pa.getName() === 'json' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        // `(…).json()` — we've now reached the JSON payload.
        sawJsonConsumption = true;
        cursor = parentCall;
        continue;
      }
      return undefined;
    }

    // From here on, every branch is about classifying the payload.
    // If we haven't actually reached the payload yet, we're looking at a
    // raw Response and can't honestly say whether it's typed — bail with
    // `undefined` instead of misclassifying it as untyped.
    if (!sawJsonConsumption) return undefined;

    if (parent.getKind() === SyntaxKind.VariableDeclaration) {
      const decl = parent as import('ts-morph').VariableDeclaration;
      if (decl.getTypeNode()) return true;
      return containsAssertion(decl.getInitializer());
    }

    if (
      parent.getKind() === SyntaxKind.ReturnStatement ||
      parent.getKind() === SyntaxKind.ArrowFunction ||
      parent.getKind() === SyntaxKind.BinaryExpression
    ) {
      return containsAssertion(cursor);
    }

    if (
      parent.getKind() === SyntaxKind.AsExpression ||
      parent.getKind() === SyntaxKind.TypeAssertionExpression ||
      parent.getKind() === SyntaxKind.SatisfiesExpression
    ) {
      return true;
    }

    return undefined;
  }
  return undefined;
}

/**
 * Peek into a `.then(...)` call's first argument and return true when the
 * callback body contains a `.json()` call. Used to tell whether a
 * `.then(r => r.json())` chain actually resolves to JSON — as opposed to
 * `.then(r => r.status)` which resolves to a number and should not be
 * treated as JSON consumption.
 */
/**
 * Classify the body payload of a network call (fetch/axios/…):
 *   - `'none'` — no options arg, or no body property found.
 *   - `'static'` — body is a literal (string/object/array) with no dynamic
 *     interpolation.
 *   - `'dynamic'` — body reads from a variable, uses a template literal
 *     containing `${…}`, or calls `JSON.stringify(x)` on a non-literal `x`.
 *
 * Feeds the `tainted-across-wire` cross-stack rule. Conservative by design:
 * when unsure we return `undefined` (fallthrough) so the rule stays silent
 * instead of over-reporting.
 */
/**
 * Network libraries split into two call-site conventions:
 *   fetch-style — `fetch(url, options)` where `options.body` carries the
 *     payload. `ky` and generic `request()` follow this shape.
 *   axios-style — `axios.post(url, data, config)` where the second arg IS
 *     the payload directly. `got.post`, `superagent.post`, and most axios
 *     method calls (post/put/patch) match this.
 * Gemini review on d8f95d49 caught that the flat "object literal at arg1?
 * look for .body" logic returned `none` for legitimate axios payloads like
 * `axios.post('/api', { name: 'foo' })` — the whole object IS the body.
 */
const AXIOS_STYLE_METHODS = new Set(['post', 'put', 'patch']);

function extractBodyKind(
  call: import('ts-morph').CallExpression,
  funcName: string,
): 'none' | 'static' | 'dynamic' | undefined {
  const args = call.getArguments();
  if (args.length < 2) return 'none';
  const arg = args[1];

  // Axios-style: the 2nd arg *is* the body.
  if (AXIOS_STYLE_METHODS.has(funcName)) {
    return classifyBodyExpression(arg);
  }

  // Fetch-style: the 2nd arg is an options object; body lives in `.body`.
  if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = arg as import('ts-morph').ObjectLiteralExpression;
    const bodyProp = obj.getProperty('body');
    if (!bodyProp) return 'none';
    // Shorthand `{ method: 'POST', body }` — the body is a variable reference
    // by definition, so it's dynamic. Codex flagged the earlier branch that
    // returned `undefined` here as a false negative: a shorthand in a
    // fetch options object is a common RequestInit pattern, not an
    // unclassifiable construct.
    if (bodyProp.getKind() === SyntaxKind.ShorthandPropertyAssignment) return 'dynamic';
    if (bodyProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
    const initializer = (bodyProp as import('ts-morph').PropertyAssignment).getInitializer();
    return classifyBodyExpression(initializer);
  }

  // Options is passed as a variable (common pattern: `fetch(url, opts)`) —
  // we don't have enough info to tell without type checker dataflow.
  return undefined;
}

/**
 * Derive the HTTP method of a network call. Returns uppercase method string
 * (`GET`, `POST`, …) when confident, `undefined` when the method lives in a
 * runtime variable we can't read statically (e.g. `axios({ method: verb })`).
 * Feeds the `contract-method-drift` cross-stack rule.
 *
 * Resolution rules (in order):
 *   1. Wrapped client (`apiClient.post(…)`) or library method (`axios.get(…)`)
 *      → `funcName.toUpperCase()`. `funcName === 'request'` is intentionally
 *      skipped — for `axios.request({ method })` we'd need to read the config.
 *   2. Raw `fetch(url, { method: 'POST' })` — read the string literal. Any
 *      spread (`{ method: 'GET', ...opts }`) downgrades to `undefined` since
 *      we can't tell if opts overrides method at runtime.
 *   3. Raw `fetch(url)` / `axios(url)` with no options arg → `GET` (WHATWG +
 *      axios spec default).
 *   4. Raw call with variable options arg → `undefined` (requires dataflow).
 */
function extractHttpMethod(
  call: import('ts-morph').CallExpression,
  funcName: string,
  isDirectNetwork: boolean,
  isKnownLibraryMethod: boolean,
  isWrappedClientCall: boolean,
): string | undefined {
  if (isKnownLibraryMethod || isWrappedClientCall) {
    if (funcName === 'request') return undefined;
    return funcName.toUpperCase();
  }
  if (!isDirectNetwork) return undefined;

  const args = call.getArguments();
  if (args.length < 2) return 'GET';

  const opts = args[1];
  if (opts.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = opts as import('ts-morph').ObjectLiteralExpression;
    const hasSpread = obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment);
    if (hasSpread) return undefined;
    const methodProp = obj.getProperty('method');
    if (!methodProp) return 'GET';
    if (methodProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
    const initializer = (methodProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (!initializer) return undefined;
    const iKind = initializer.getKind();
    if (iKind === SyntaxKind.StringLiteral) {
      return (initializer as import('ts-morph').StringLiteral).getLiteralValue().toUpperCase();
    }
    if (iKind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      return (initializer as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue().toUpperCase();
    }
    return undefined;
  }
  return undefined;
}

/**
 * Detect whether a network call's options literal carries an `Authorization`
 * header. Returns `true`/`false` when the options object is inspectable,
 * `undefined` when it's a variable, spread, or missing. Only looks at raw
 * `fetch(…)` — wrapped clients typically inject auth inside the wrapper.
 * Feeds the `auth-drift` rule, which only fires when the mapper is confident.
 */
function extractHasAuthHeader(call: import('ts-morph').CallExpression, funcName: string): boolean | undefined {
  if (funcName !== 'fetch') return undefined;
  const args = call.getArguments();
  if (args.length < 2) return false;
  const opts = args[1];
  if (opts.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const obj = opts as import('ts-morph').ObjectLiteralExpression;
  if (obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return undefined;

  // Cookie / session auth: `fetch(url, { credentials: 'include' })` or
  // `'same-origin'` sends session cookies without an Authorization header.
  // We can't tell from the call alone whether the server accepts that auth
  // channel, so downgrade to `undefined` and let auth-drift stay silent.
  // Codex review: without this, cookie-based apps fire auth-drift on every
  // protected route even though they're authenticated.
  const credentialsProp = obj.getProperty('credentials');
  if (credentialsProp && credentialsProp.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (credentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (init) {
      const k = init.getKind();
      if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) {
        const v = (init as import('ts-morph').StringLiteral).getLiteralValue();
        if (v === 'include' || v === 'same-origin') return undefined;
      } else {
        // Runtime-computed credentials flag — can't tell.
        return undefined;
      }
    }
  }

  const headersProp = obj.getProperty('headers');
  if (!headersProp) return false;
  if (headersProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  const headersInit = (headersProp as import('ts-morph').PropertyAssignment).getInitializer();
  if (!headersInit) return undefined;
  if (headersInit.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const headersObj = headersInit as import('ts-morph').ObjectLiteralExpression;
  if (headersObj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return undefined;
  for (const prop of headersObj.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const pa = prop as import('ts-morph').PropertyAssignment;
      if (/^['"]?authorization['"]?$/i.test(pa.getName())) return true;
    }
  }
  return false;
}

function extractHandlesApiErrors(
  call: import('ts-morph').CallExpression,
  isWrappedClientCall: boolean,
): boolean | undefined {
  if (isWrappedClientCall) return undefined;
  if (isInsideTryWithCatch(call)) return true;
  if (hasCatchInPromiseChain(call)) return true;
  if (hasInlineStatusCheck(call)) return true;
  if (hasAssignedResponseStatusCheck(call)) return true;
  if (isPassedToApiResponseHelper(call)) return true;
  if (hasNearbyErrorUiPath(call)) return true;
  return false;
}

function isInsideTryWithCatch(node: import('ts-morph').Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.TryStatement) {
      const tryStmt = parent as import('ts-morph').TryStatement;
      return Boolean(tryStmt.getCatchClause());
    }
    parent = parent.getParent();
  }
  return false;
}

function hasCatchInPromiseChain(node: import('ts-morph').Node): boolean {
  let cursor: import('ts-morph').Node = node;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = parent as import('ts-morph').PropertyAccessExpression;
      if (pa.getName() === 'catch') return true;
    }
    cursor = parent;
  }
  return false;
}

function hasInlineStatusCheck(call: import('ts-morph').CallExpression): boolean {
  let cursor: import('ts-morph').Node = call;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    const text = parent.getText();
    if (
      /\b\w+\.(ok|status|statusCode)\b/.test(text) &&
      /\b(if|throw|reject|setError|toast\.error|Alert\.alert)\b/.test(text)
    ) {
      return true;
    }
    if (parent.getKind() === SyntaxKind.ExpressionStatement || parent.getKind() === SyntaxKind.VariableDeclaration) {
      return false;
    }
    cursor = parent;
  }
  return false;
}

function hasAssignedResponseStatusCheck(call: import('ts-morph').CallExpression): boolean {
  const decl = enclosingVariableDeclaration(call);
  if (!decl) return false;
  const name = decl.getName();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false;
  const block = nearestBlock(decl);
  if (!block) return false;
  const escaped = escapeRegExp(name);
  const text = block.getText();
  return new RegExp(`\\b${escaped}\\.(ok|status|statusCode)\\b`).test(text);
}

function isPassedToApiResponseHelper(call: import('ts-morph').CallExpression): boolean {
  let cursor: import('ts-morph').Node = call;
  for (let depth = 0; depth < 4; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    const kind = parent.getKind();
    if (kind === SyntaxKind.AwaitExpression || kind === SyntaxKind.ParenthesizedExpression) {
      cursor = parent;
      continue;
    }
    if (kind !== SyntaxKind.CallExpression) return false;
    const helperName = (parent as import('ts-morph').CallExpression).getExpression().getText();
    return /^(parse|handle|check|ensure|assert|unwrap)[A-Za-z0-9_$]*(Api|Response|Result)$/i.test(helperName);
  }
  return false;
}

function hasNearbyErrorUiPath(call: import('ts-morph').CallExpression): boolean {
  const container = nearestFunctionLike(call);
  if (!container) return false;
  const text = container.getText();
  return /\b(setError|setErrorMessage|showError|toast\.error|Alert\.alert|notifyError)\s*\(/.test(text);
}

function enclosingVariableDeclaration(
  node: import('ts-morph').Node,
): import('ts-morph').VariableDeclaration | undefined {
  let cursor: import('ts-morph').Node = node;
  for (let depth = 0; depth < 6; depth++) {
    const parent = cursor.getParent();
    if (!parent) return undefined;
    if (parent.getKind() === SyntaxKind.VariableDeclaration) return parent as import('ts-morph').VariableDeclaration;
    cursor = parent;
  }
  return undefined;
}

function nearestBlock(node: import('ts-morph').Node): import('ts-morph').Block | undefined {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.Block) return parent as import('ts-morph').Block;
    parent = parent.getParent();
  }
  return undefined;
}

function nearestFunctionLike(node: import('ts-morph').Node): import('ts-morph').Node | undefined {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.MethodDeclaration ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionExpression
    ) {
      return parent;
    }
    parent = parent.getParent();
  }
  return undefined;
}

function extractAuthPropagation(
  call: import('ts-morph').CallExpression,
  funcName: string,
  objName: string,
  isWrappedClientCall: boolean,
  hasAuthHeader: boolean | undefined,
): 'present' | 'absent' | 'unknown' {
  if (hasAuthHeader === true) return 'present';
  if (hasCookieOrSessionEvidence(call, funcName)) return 'present';
  if (isWrappedClientCall) return /auth|session|private|secure/i.test(objName) ? 'present' : 'unknown';
  if (funcName === 'fetch') return hasAuthHeader === false ? 'absent' : 'unknown';
  const config = networkConfigArgument(call, funcName);
  if (!config) return 'absent';
  if (config.getKind() !== SyntaxKind.ObjectLiteralExpression) return 'unknown';
  const obj = config as import('ts-morph').ObjectLiteralExpression;
  if (obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return 'unknown';
  return configObjectHasAuthEvidence(obj) ? 'present' : 'absent';
}

function hasCookieOrSessionEvidence(call: import('ts-morph').CallExpression, funcName: string): boolean {
  const config = funcName === 'fetch' ? call.getArguments()[1] : networkConfigArgument(call, funcName);
  if (!config || config.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
  return configObjectHasAuthEvidence(config as import('ts-morph').ObjectLiteralExpression);
}

function networkConfigArgument(
  call: import('ts-morph').CallExpression,
  funcName: string,
): import('ts-morph').Node | undefined {
  const args = call.getArguments();
  if (funcName === 'fetch') return args[1];
  if (AXIOS_STYLE_METHODS.has(funcName)) return args[2];
  return args[1];
}

function configObjectHasAuthEvidence(obj: import('ts-morph').ObjectLiteralExpression): boolean {
  const credentialsProp = obj.getProperty('credentials');
  if (credentialsProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (credentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (
      init &&
      (init.getKind() === SyntaxKind.StringLiteral || init.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      const value = (init as import('ts-morph').StringLiteral).getLiteralValue();
      if (value === 'include' || value === 'same-origin') return true;
    }
  }

  const withCredentialsProp = obj.getProperty('withCredentials');
  if (withCredentialsProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (withCredentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (init?.getKind() === SyntaxKind.TrueKeyword) return true;
  }

  const headersProp = obj.getProperty('headers');
  if (headersProp?.getKind() !== SyntaxKind.PropertyAssignment) return false;
  const headersInit = (headersProp as import('ts-morph').PropertyAssignment).getInitializer();
  if (!headersInit || headersInit.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
  const headersObj = headersInit as import('ts-morph').ObjectLiteralExpression;
  if (headersObj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return false;
  for (const prop of headersObj.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const name = (prop as import('ts-morph').PropertyAssignment).getName().replace(/['"]/g, '').toLowerCase();
    if (name === 'authorization' || name === 'cookie' || name === 'x-session' || name === 'x-csrf-token') return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifyBodyExpression(expr: import('ts-morph').Node | undefined): 'none' | 'static' | 'dynamic' | undefined {
  if (!expr) return undefined;
  const k = expr.getKind();

  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) return 'static';
  if (k === SyntaxKind.NumericLiteral || k === SyntaxKind.TrueKeyword || k === SyntaxKind.FalseKeyword) return 'static';
  if (k === SyntaxKind.NullKeyword || k === SyntaxKind.UndefinedKeyword) return 'none';

  // Template literal with ${…} → dynamic. Template without substitutions is
  // handled above as NoSubstitutionTemplateLiteral.
  if (k === SyntaxKind.TemplateExpression) return 'dynamic';

  // Plain object/array literal — dynamic iff any value inside is non-literal.
  if (k === SyntaxKind.ObjectLiteralExpression || k === SyntaxKind.ArrayLiteralExpression) {
    return objectOrArrayIsDynamic(expr) ? 'dynamic' : 'static';
  }

  // `JSON.stringify(x)` — dynamic when x is non-literal, static otherwise.
  if (k === SyntaxKind.CallExpression) {
    const call = expr as import('ts-morph').CallExpression;
    const calleeText = call.getExpression().getText();
    if (calleeText === 'JSON.stringify') {
      const arg = call.getArguments()[0];
      return classifyBodyExpression(arg);
    }
    return 'dynamic';
  }

  // Identifier, property access, element access, binary expression, etc. —
  // something that reads a variable or constructs a value at runtime.
  if (
    k === SyntaxKind.Identifier ||
    k === SyntaxKind.PropertyAccessExpression ||
    k === SyntaxKind.ElementAccessExpression ||
    k === SyntaxKind.BinaryExpression ||
    k === SyntaxKind.ConditionalExpression ||
    k === SyntaxKind.SpreadElement
  ) {
    return 'dynamic';
  }

  return undefined;
}

function objectOrArrayIsDynamic(expr: import('ts-morph').Node): boolean {
  // Walk top-level values; recurse into nested objects/arrays.
  if (expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = expr as import('ts-morph').ObjectLiteralExpression;
    for (const prop of obj.getProperties()) {
      if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) return true;
      if (prop.getKind() === SyntaxKind.SpreadAssignment) return true;
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) return true;
      const init = (prop as import('ts-morph').PropertyAssignment).getInitializer();
      const kind = classifyBodyExpression(init);
      if (kind !== 'static' && kind !== 'none') return true;
    }
    return false;
  }
  if (expr.getKind() === SyntaxKind.ArrayLiteralExpression) {
    const arr = expr as import('ts-morph').ArrayLiteralExpression;
    for (const el of arr.getElements()) {
      const kind = classifyBodyExpression(el);
      if (kind !== 'static' && kind !== 'none') return true;
    }
    return false;
  }
  return true;
}

function callbackCallsJson(thenCall: import('ts-morph').CallExpression): boolean {
  const callback = thenCall.getArguments()[0];
  if (!callback) return false;
  const k = callback.getKind();
  if (k !== SyntaxKind.ArrowFunction && k !== SyntaxKind.FunctionExpression) return false;
  const callbackText = callback.getText();
  // Text-based check is sufficient here: the callback bodies we care about
  // are short and the helper is advisory. The rule treats `undefined` as
  // "unknown" and stays silent, so a miss here is never a false positive.
  return /\.json\s*\(\s*\)/.test(callbackText);
}

function containsAssertion(node: import('ts-morph').Node | undefined): boolean {
  if (!node) return false;
  const k = node.getKind();
  if (
    k === SyntaxKind.AsExpression ||
    k === SyntaxKind.TypeAssertionExpression ||
    k === SyntaxKind.SatisfiesExpression
  ) {
    return true;
  }
  // A single-level unwrap of `await` / `(...)` is enough for the common
  // `const x = (await fetch(...).then(r => r.json())) as User` shape.
  if (k === SyntaxKind.AwaitExpression || k === SyntaxKind.ParenthesizedExpression) {
    const child = (
      node as import('ts-morph').AwaitExpression | import('ts-morph').ParenthesizedExpression
    ).getExpression();
    return containsAssertion(child);
  }
  return false;
}

/**
 * Scan `sf` for identifiers that behave like HTTP client wrappers, so that
 * `extractEffects` can emit `effect.network` for `<name>.get/post/…` calls
 * that would otherwise slip through the fixed NETWORK_CALLS/library-method
 * filter.
 *
 * Three evidence sources (all single-file, no cross-file graph resolution):
 *   1. Local class declarations whose bodies call a known network primitive
 *      somewhere — that class IS a client wrapper. The class name is used
 *      in pass 2 to mark `new <ClassName>()` instances.
 *   2. Local variable initializers that match a client factory
 *      (`axios.create(...)`, `ky.create(...)`, `got.extend(...)`) or
 *      `new <ClientClass>(...)` where <ClientClass> was found in pass 1.
 *   3. Imported identifiers from a relative / alias path whose local name
 *      matches CLIENT_NAME_PATTERN. Third-party imports are skipped —
 *      library HTTP clients are already covered by NETWORK_CALLS.
 *
 * False-positive surface is narrow on purpose: a match only translates into
 * a network effect when the identifier is later called with `.get/post/put/
 * patch/delete`, so a name match alone never produces a finding.
 */
function collectClientIdentifiers(sf: SourceFile): Set<string> {
  const clients = new Set<string>();

  // Pass 1 — wrapper classes defined in this file.
  const clientClassNames = new Set<string>();
  for (const cls of sf.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    if (classCallsNetwork(cls)) {
      const name = cls.getName();
      if (name) clientClassNames.add(name);
    }
  }

  // Pass 2 — local instances: `const api = axios.create(...)`, `new ApiClient()`.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.Identifier) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const identName = nameNode.getText();

    if (init.getKind() === SyntaxKind.NewExpression) {
      const className = (init as import('ts-morph').NewExpression).getExpression().getText();
      if (clientClassNames.has(className)) clients.add(identName);
      continue;
    }

    if (init.getKind() === SyntaxKind.CallExpression) {
      const calleeText = (init as import('ts-morph').CallExpression).getExpression().getText();
      if (CLIENT_FACTORY_CALLS.has(calleeText)) clients.add(identName);
    }
  }

  // Pass 3 — imported clients with client-shaped names from local paths.
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec) continue;
    const isLocal =
      spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('@shared/');
    if (!isLocal) continue;
    for (const named of imp.getNamedImports()) {
      const local = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
      if (CLIENT_NAME_PATTERN.test(local)) clients.add(local);
    }
    const def = imp.getDefaultImport();
    if (def && CLIENT_NAME_PATTERN.test(def.getText())) clients.add(def.getText());
  }

  return clients;
}

function classCallsNetwork(cls: import('ts-morph').ClassDeclaration): boolean {
  for (const call of cls.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const k = callee.getKind();
    if (k === SyntaxKind.Identifier) {
      if (NETWORK_CALLS.has(callee.getText())) return true;
      continue;
    }
    if (k === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      const methodName = pa.getName();
      const objText = pa.getExpression().getText();
      if (NETWORK_METHODS.has(methodName) && /^(axios|got|ky|superagent|request|http)$/.test(objText)) {
        return true;
      }
    }
  }
  return false;
}
