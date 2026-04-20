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
    if (
      NETWORK_CALLS.has(funcName) ||
      (NETWORK_METHODS.has(funcName) && /axios|got|ky|http|request|superagent/i.test(objName))
    ) {
      const isAsync = isInAsyncContext(call);
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: NETWORK_CALLS.has(funcName) ? 1.0 : 0.8,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: {
          kind: 'effect',
          subtype: 'network',
          async: isAsync,
          target: extractTarget(call),
          responseAsserted: isResponseAsserted(call),
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

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

function extractEntrypoints(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Express/Fastify route handlers: app.get('/path', handler)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();
    if (!ROUTE_METHODS.has(methodName)) continue;

    const objText = pa.getExpression().getText();
    if (!/app|router|server/i.test(objText)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    // First arg is the route path
    let routePath: string | undefined;
    if (args[0].getKind() === SyntaxKind.StringLiteral) {
      routePath = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
    }

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
        httpMethod: methodName === 'use' ? undefined : methodName.toUpperCase(),
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

function extractTarget(call: import('ts-morph').CallExpression): string | undefined {
  const args = call.getArguments();
  if (args.length === 0) return undefined;
  const first = args[0];
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return (first as import('ts-morph').StringLiteral).getLiteralValue();
  }
  if (
    first.getKind() === SyntaxKind.TemplateExpression ||
    first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return first.getText().substring(0, 80);
  }
  return undefined;
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
function isResponseAsserted(call: import('ts-morph').CallExpression): boolean | undefined {
  // Walk outward looking for the `.json()` resolution and then check the
  // expression it lands in.
  let cursor: import('ts-morph').Node = call;
  // Skip through chained `.then()` / `await` / paren wrappers.
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return undefined;

    if (parent.getKind() === SyntaxKind.AwaitExpression || parent.getKind() === SyntaxKind.ParenthesizedExpression) {
      cursor = parent;
      continue;
    }

    // `.then(r => r.json())` / `.then(async r => r.json())`
    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = parent as import('ts-morph').PropertyAccessExpression;
      const parentCall = pa.getParent();
      if (pa.getName() === 'then' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        cursor = parentCall;
        continue;
      }
      if (pa.getName() === 'json' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        // `(...).json()` — keep climbing from the json call.
        cursor = parentCall;
        continue;
      }
      return undefined;
    }

    // Landed in a const/let/var decl → check for a type annotation.
    if (parent.getKind() === SyntaxKind.VariableDeclaration) {
      const decl = parent as import('ts-morph').VariableDeclaration;
      // An explicit type node (`const x: User = …`) or an initializer wrapped
      // in `as T` / `satisfies T` both count as an assertion.
      if (decl.getTypeNode()) return true;
      return containsAssertion(decl.getInitializer());
    }

    // Return / arrow body / assignment → look at the expression for assertions.
    if (
      parent.getKind() === SyntaxKind.ReturnStatement ||
      parent.getKind() === SyntaxKind.ArrowFunction ||
      parent.getKind() === SyntaxKind.BinaryExpression
    ) {
      return containsAssertion(cursor);
    }

    // `as T` / `<T>…` / `satisfies T` wrapping the fetch chain directly.
    if (
      parent.getKind() === SyntaxKind.AsExpression ||
      parent.getKind() === SyntaxKind.TypeAssertionExpression ||
      parent.getKind() === SyntaxKind.SatisfiesExpression
    ) {
      return true;
    }

    // Unknown parent shape — bail rather than over-report.
    return undefined;
  }
  return undefined;
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
    const child = (node as import('ts-morph').AwaitExpression | import('ts-morph').ParenthesizedExpression).getExpression();
    return containsAssertion(child);
  }
  return false;
}
