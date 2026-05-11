/**
 * Taint Tracking — AST-based engine using ts-morph.
 *
 * Handles destructuring, method chains, computed property access,
 * and interprocedural taint through intra-file call graph.
 */

import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph';
import type { InternalSinkFunction, TaintPath, TaintResult, TaintSink, TaintSource } from './taint-types.js';
import {
  HTTP_PARAM_NAMES,
  HTTP_PARAM_TYPES,
  isSanitizerSufficient,
  NEXTJS_ROUTE_FILE_RE,
  NEXTJS_ROUTE_VERBS,
  NOSQL_METHODS_REQUIRING_OBJECT_TAINT,
  NOSQL_QUERY_ARG_INDEXES,
  NOSQL_RECEIVER_ALLOWLIST,
  SANITIZER_PATTERN_NAMES,
  SINK_NAMES,
  SQL_BUILDER_VERBS,
} from './taint-types.js';
import type { InferResult } from './types.js';

// ── Intra-File Sink Map ─────────────────────────────────────────────────

/**
 * Build a map of internal functions that contain sinks.
 * For each function, determine which parameters flow to sinks.
 * This enables interprocedural taint: processInput(req.body) → exec() is now visible.
 */
export function buildInternalSinkMap(sourceFile: SourceFile): Map<string, InternalSinkFunction> {
  const sinkMap = new Map<string, InternalSinkFunction>();

  const allFns: Array<{
    name: string;
    node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration;
  }> = [];
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) allFns.push({ name, node: fn });
  }
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && (init.getKindName() === 'ArrowFunction' || init.getKindName() === 'FunctionExpression')) {
        allFns.push({ name: decl.getName(), node: init as any });
      }
    }
  }

  for (const { name, node: fn } of allFns) {
    const params = fn.getParameters();
    const body = fn.getBody();
    if (!body || params.length === 0) continue;

    // Collect all calls in the body that hit a known sink
    const calls: import('ts-morph').CallExpression[] = [];
    body.forEachDescendant((n) => {
      if (n.getKindName() === 'CallExpression') calls.push(n as import('ts-morph').CallExpression);
    });

    const taintedParamIndices = new Set<number>();
    const sinkCategories = new Map<number, Set<TaintSink['category']>>();

    for (const call of calls) {
      // Use the same receiver-aware resolver as the outer sink scan so a
      // helper containing `/regex/.exec(param)` doesn't mark `param` as
      // flowing to a `'command'` sink. Mirrors the resolveSinkCategory
      // gating put in for the kern-guard PR #316 false positive.
      const resolved = resolveSinkCategory(call);
      if (!resolved) continue;
      const { category: sinkDef, name: calleeName } = resolved;

      // Check which parameter names appear in the sink's arguments
      const allArgs = call.getArguments();
      for (let argIdx = 0; argIdx < allArgs.length; argIdx++) {
        // For NoSQL sinks, only scan the method's query positions
        // (filter / update doc) — `find(query, projection)` must not mark
        // `projection` as flowing to a sink.
        if (sinkDef === 'nosql' && !nosqlAcceptsArgIndex(calleeName, argIdx)) continue;

        const arg = allArgs[argIdx];
        const argText = arg.getText();
        for (let i = 0; i < params.length; i++) {
          const paramName = params[i].getName();
          if (argText === paramName || argText.startsWith(`${paramName}.`) || argText.startsWith(`${paramName}[`)) {
            taintedParamIndices.add(i);
            if (!sinkCategories.has(i)) sinkCategories.set(i, new Set());
            sinkCategories.get(i)!.add(sinkDef);
          }
        }
      }

      // Also check template literal arguments
      for (let argIdx = 0; argIdx < allArgs.length; argIdx++) {
        if (sinkDef === 'nosql' && !nosqlAcceptsArgIndex(calleeName, argIdx)) continue;
        const arg = allArgs[argIdx];
        if (arg.getKindName() === 'TemplateExpression') {
          for (const tplSpan of (arg as any).getTemplateSpans()) {
            const expr = tplSpan.getExpression();
            const exprText = expr.getText();
            for (let i = 0; i < params.length; i++) {
              const paramName = params[i].getName();
              if (exprText === paramName || exprText.startsWith(`${paramName}.`)) {
                taintedParamIndices.add(i);
                if (!sinkCategories.has(i)) sinkCategories.set(i, new Set());
                sinkCategories.get(i)!.add(sinkDef);
              }
            }
          }
        }
      }
    }

    if (taintedParamIndices.size > 0) {
      sinkMap.set(name, { name, taintedParamIndices, sinkCategories });
    }
  }

  return sinkMap;
}

// ── Main AST Analysis ───────────────────────────────────────────────────

/**
 * AST-based taint analysis — walks real ts-morph AST nodes instead of regex on strings.
 * Handles destructuring, method chains, computed property access.
 */
export function analyzeTaintAST(_inferred: InferResult[], filePath: string, sourceFile: SourceFile): TaintResult[] {
  const results: TaintResult[] = [];

  // Build intra-file call graph: which internal functions contain sinks?
  const internalSinkMap = buildInternalSinkMap(sourceFile);

  // Collect all function-like AST nodes from the SourceFile. `varName`
  // carries the binding name for `export const GET = async (req) => …`
  // shapes — without it, fnName falls through to 'anonymous' and Next.js
  // route-verb detection in Pass 2 can't classify the handler.
  const allFns: Array<{
    node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration;
    startLine: number;
    varName?: string;
  }> = [];
  const seenFnNodes = new Set<Node>();
  for (const fn of sourceFile.getFunctions()) {
    allFns.push({ node: fn, startLine: fn.getStartLineNumber() });
    seenFnNodes.add(fn);
  }
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init) {
        const initKind = init.getKindName();
        if (initKind === 'ArrowFunction' || initKind === 'FunctionExpression') {
          allFns.push({
            node: init as ArrowFunction | FunctionExpression,
            startLine: stmt.getStartLineNumber(),
            varName: decl.getName(),
          });
          seenFnNodes.add(init);
        }
      }
    }
  }
  for (const cls of sourceFile.getClasses()) {
    for (const method of cls.getMethods()) {
      allFns.push({ node: method, startLine: method.getStartLineNumber() });
      seenFnNodes.add(method);
    }
  }

  // Sweep for callback arrows / function expressions that aren't already
  // covered above. The most common Express handler shape
  // (`app.get('/x', (req, res) => …)`) was previously invisible.
  //
  // Codex impl-review caught the original sweep was too greedy: combined with
  // the name-based `HTTP_PARAM_NAMES` heuristic, an inline callback like
  // `queue.each((req) => exec(req.cmd))` would be classified as an HTTP
  // handler and emit a `taint-command` FP. The gate below requires the
  // inline callback to live in a route-handler call site (`app.get`,
  // `router.use`, …) OR have an explicitly HTTP-typed parameter. Named
  // FunctionDeclarations are exempt — they are deliberately written code,
  // not arbitrary callbacks. Object-literal MethodDeclarations are not yet
  // covered (would require reference tracing for `app.get('/x', ctrl.fn)`).
  sourceFile.forEachDescendant((node) => {
    const k = node.getKindName();
    if (k !== 'ArrowFunction' && k !== 'FunctionExpression' && k !== 'FunctionDeclaration') return;
    if (seenFnNodes.has(node)) return;
    if (k !== 'FunctionDeclaration') {
      const fnNode = node as ArrowFunction | FunctionExpression;
      if (!isRouteHandlerCallback(node) && !hasHttpTypedParam(fnNode)) return;
    }
    allFns.push({
      node: node as ArrowFunction | FunctionExpression | FunctionDeclaration,
      startLine: node.getStartLineNumber(),
    });
    seenFnNodes.add(node);
  });

  const isNextjsRouteFile = NEXTJS_ROUTE_FILE_RE.test(filePath);

  for (const { node: fn, startLine, varName } of allFns) {
    const params = fn.getParameters();
    const declaredName =
      varName ?? ('getName' in fn && typeof fn.getName === 'function' ? fn.getName() || undefined : undefined);
    const fnName = declaredName ?? 'anonymous';

    // Step 1: Classify params as tainted.
    //   1a — type/name match (Express, Fastify, Koa, plain Request)
    //   1b — Next.js route handler verb (`export async function GET(req)`
    //        or `export const GET = async (r) => …`) inside an
    //        `app/**/route.{ts,tsx}` or `pages/api/**` file: taint param 0
    //        regardless of its annotation. Untyped App Router handlers
    //        (`function GET(r) {…}`) were previously invisible because
    //        `r` doesn't match HTTP_PARAM_NAMES.
    const taintedParams: TaintSource[] = [];
    for (const param of params) {
      const name = param.getName();
      const typeText = param.getType().getText(param);
      if (HTTP_PARAM_NAMES.test(name) || HTTP_PARAM_TYPES.test(typeText)) {
        taintedParams.push({ name, origin: `${name} (HTTP input)` });
      }
    }
    // Codex impl-review: require export+top-level. A local helper
    // `function GET(r) {…}` inside route.ts is not a Next.js route.
    const inNextjsRouteContext =
      isNextjsRouteFile && declaredName != null && NEXTJS_ROUTE_VERBS.has(declaredName) && isExportedTopLevel(fn);
    if (inNextjsRouteContext) {
      if (taintedParams.length === 0 && params.length > 0) {
        const first = params[0];
        const name = first.getName();
        taintedParams.push({ name, origin: `${name} (Next.js route handler)` });
      }
      // Gemini impl-review: App Router handlers receive route segments as
      // a second arg `{ params }`. Taint the destructured `params` binding
      // (or the param itself when not destructured).
      if (params.length > 1) {
        const second = params[1];
        const nameNode = second.getNameNode();
        if (nameNode.getKindName() === 'ObjectBindingPattern') {
          for (const element of (nameNode as import('ts-morph').ObjectBindingPattern).getElements()) {
            const elName = element.getName();
            if (!taintedParams.some((p) => p.name === elName)) {
              taintedParams.push({ name: elName, origin: `${elName} (Next.js route context)` });
            }
          }
        } else {
          const name = second.getName();
          if (!taintedParams.some((p) => p.name === name)) {
            taintedParams.push({ name, origin: `${name} (Next.js route context)` });
          }
        }
      }
    }
    if (taintedParams.length === 0) continue;

    // Step 2: AST-based taint propagation through the function body
    const body = fn.getBody();
    if (!body) continue;

    const taintedNames = new Set(taintedParams.map((p) => p.name));
    const taintedVars = new Map<string, TaintSource>();
    for (const p of taintedParams) taintedVars.set(p.name, p);

    // Walk ALL variable declarations including nested scopes (if/for/while)
    // forEachDescendant visits in document order = parent-before-child
    const varDecls: import('ts-morph').VariableDeclaration[] = [];
    body.forEachDescendant((node) => {
      if (node.getKind() === SyntaxKind.VariableDeclaration) {
        varDecls.push(node as import('ts-morph').VariableDeclaration);
      }
    });
    // Multiple passes to handle forward dependencies (max 3 hops)
    for (let hop = 0; hop < 3; hop++) {
      for (const decl of varDecls) {
        const nameNode = decl.getNameNode();
        const nameKind = nameNode.getKindName();

        // Simple name binding: const id = parseInt(req.body.id)
        if (nameKind === 'Identifier') {
          const declName = nameNode.getText();
          if (taintedNames.has(declName)) continue;
          const init = decl.getInitializer();
          if (!init) continue;
          if (astExprRefersToTainted(init, taintedNames)) {
            taintedNames.add(declName);
            const srcName = findTaintedIdentifier(init, taintedNames);
            const srcVar = srcName ? taintedVars.get(srcName) : undefined;
            const srcOrigin = srcVar?.origin;
            taintedVars.set(declName, { name: declName, origin: srcOrigin || 'derived' });
          }
        }

        // Object destructuring: const { x, y } = taintedObj
        if (nameKind === 'ObjectBindingPattern') {
          const init = decl.getInitializer();
          if (!init || !astExprRefersToTainted(init, taintedNames)) continue;
          const srcName = findTaintedIdentifier(init, taintedNames);
          const srcVar2 = srcName ? taintedVars.get(srcName) : undefined;
          const srcOrigin = srcVar2?.origin;
          for (const element of (nameNode as any).getElements()) {
            const elName = element.getName();
            if (!taintedNames.has(elName)) {
              taintedNames.add(elName);
              taintedVars.set(elName, { name: elName, origin: srcOrigin || 'destructured' });
            }
          }
        }

        // Array destructuring: const [a, b] = taintedArr
        if (nameKind === 'ArrayBindingPattern') {
          const init = decl.getInitializer();
          if (!init || !astExprRefersToTainted(init, taintedNames)) continue;
          const srcName = findTaintedIdentifier(init, taintedNames);
          const srcVar3 = srcName ? taintedVars.get(srcName) : undefined;
          const srcOrigin = srcVar3?.origin;
          for (const element of (nameNode as any).getElements()) {
            if (element.getKindName() === 'BindingElement') {
              const elName = (element as any).getName();
              if (!taintedNames.has(elName)) {
                taintedNames.add(elName);
                taintedVars.set(elName, { name: elName, origin: srcOrigin || 'destructured' });
              }
            }
          }
        }
      }
    }

    // Step 3: Find sinks via AST CallExpression walk
    const sinks: TaintSink[] = [];
    const calls: import('ts-morph').CallExpression[] = [];
    body.forEachDescendant((n) => {
      if (n.getKindName() === 'CallExpression') calls.push(n as import('ts-morph').CallExpression);
    });
    for (const call of calls) {
      const resolved = resolveSinkCategory(call);
      if (!resolved) continue;
      const { category: sinkDef, name: calleeName } = resolved;

      // Check if any argument references a tainted variable. The shadowing
      // gate (Gemini impl-review) prevents the parent's body walk from
      // matching `req` inside a nested arrow that re-binds its own `req`
      // param — closure capture of OUTER `req` still works (the gate only
      // fires when the inner scope literally shadows the same name).
      const allArgs = call.getArguments();
      for (let argIdx = 0; argIdx < allArgs.length; argIdx++) {
        // For NoSQL sinks, only scan the method's query positions
        // (filter / update doc) — `find(query, projection)` must not flag
        // the projection argument as injection.
        if (sinkDef === 'nosql' && !nosqlAcceptsArgIndex(calleeName, argIdx)) continue;
        const arg = allArgs[argIdx];
        const taintedArg = findTaintedIdentifier(arg, taintedNames);
        if (!taintedArg) continue;
        if (isTaintedNameShadowedAt(call, taintedArg, body)) continue;
        // findById-style methods: scalar `req.params.*` is not classic
        // operator injection (Mongo treats string as literal _id). Reject
        // unless the tainted source is body/query (object-shaped).
        if (sinkDef === 'nosql' && nosqlByIdRejectsScalarParams(calleeName, arg)) continue;
        // Redirect sinks: `new URL("/literal/path", taintedBase)` constant-
        // folds the path component — the URL constructor discards the path
        // of `base` when the first arg starts with "/". Result is always
        // `<own-origin>/literal/path`, a fixed same-origin redirect. The
        // attacker cannot influence the destination path. See
        // RULE-FEEDBACK.md #2. Pure string-literal first arg only — template
        // literals or non-string args may still carry taint.
        if (sinkDef === 'redirect' && isConstantFoldedUrl(arg)) continue;
        sinks.push({
          name: calleeName,
          category: sinkDef,
          taintedArg,
          line: call.getStartLineNumber(),
        });
        break;
      }

      // Also check template literal arguments
      const templateArgs = call.getArguments().filter((a) => {
        const k = a.getKindName();
        return k === 'TemplateExpression' || k === 'NoSubstitutionTemplateLiteral';
      });
      for (const tpl of templateArgs) {
        if (tpl.getKindName() === 'TemplateExpression') {
          for (const span of (tpl as any).getTemplateSpans()) {
            const expr = span.getExpression();
            const taintedArg = findTaintedIdentifier(expr, taintedNames);
            if (taintedArg && !isTaintedNameShadowedAt(call, taintedArg, body)) {
              sinks.push({
                name: `${calleeName} (template)`,
                category: sinkDef,
                taintedArg,
                line: call.getStartLineNumber(),
              });
            }
          }
        }
      }
    }

    // Step 3b: Interprocedural — check calls to internal functions that contain sinks
    for (const call of calls) {
      // Skip if it's already a known sink (handled above) — use the same
      // full-path-first resolver so qualified sinks like `axios.request` are
      // correctly skipped.
      if (resolveSinkCategory(call)) continue;
      const calleeName = getCalleeBaseName(call);
      const internalFn = internalSinkMap.get(calleeName);
      if (!internalFn) continue;

      // Check if tainted data is passed to a parameter that reaches a sink
      const callArgs = call.getArguments();
      for (const [paramIdx, categories] of internalFn.sinkCategories) {
        if (paramIdx >= callArgs.length) continue;
        const arg = callArgs[paramIdx];
        const taintedArg = findTaintedIdentifier(arg, taintedNames);
        if (taintedArg) {
          // Emit one sink per category (a param may reach both exec() and query())
          for (const sinkCategory of categories) {
            sinks.push({
              name: `${calleeName} → sink`,
              category: sinkCategory,
              taintedArg,
              line: call.getStartLineNumber(),
            });
          }
        }
      }
    }

    if (sinks.length === 0) continue;

    // Step 4: Check for sanitizers (AST-based)
    const foundSanitizers = findSanitizersAST(body, taintedNames);

    // Index sink calls by tainted arg for guard lookup below.
    const sinkCallsByArg = new Map<string, import('ts-morph').CallExpression[]>();
    for (const call of calls) {
      for (const arg of call.getArguments()) {
        const tArg = findTaintedIdentifier(arg, taintedNames);
        if (tArg) {
          const existing = sinkCallsByArg.get(tArg) ?? [];
          existing.push(call);
          sinkCallsByArg.set(tArg, existing);
        }
      }
    }

    // Build paths
    const paths: TaintPath[] = [];
    for (const sink of sinks) {
      const source = taintedVars.get(sink.taintedArg) || taintedParams[0];
      // Subtree matching: sanitize(req.query) covers req.query.id but not req.body.cmd
      // parseInt(req.query.id) does NOT cover exec(req) — only the specific property is safe
      const sanitizer = foundSanitizers.find((s) => {
        for (const sv of s.sanitizedVars) {
          if (sv === sink.taintedArg) return true;
          // Sanitized path is a prefix → covers all sub-properties
          if (sink.taintedArg.startsWith(`${sv}.`)) return true;
        }
        return false;
      });

      // Control-flow guard: was the tainted arg validated in a prior
      // early-exit guard? (e.g. `if (!isValid(x)) return;`) If yes, the sink
      // is dominated by a validation — treat it as sanitized.
      const candidateCalls = sinkCallsByArg.get(sink.taintedArg) ?? [];
      const sinkGuarded = candidateCalls.some((c) => isGuardedByValidation(c, sink.taintedArg, body));

      const hasSanitizer = sanitizer != null || sinkGuarded;
      const sufficient = sanitizer != null ? isSanitizerSufficient(sanitizer.name, sink.category) : sinkGuarded;

      paths.push({
        source,
        sink,
        sanitized: hasSanitizer && sufficient,
        sanitizer: sanitizer?.name ?? (sinkGuarded ? 'cfg-guard' : undefined),
        insufficientSanitizer: sanitizer != null && !sufficient ? sanitizer.name : undefined,
      });
    }

    if (paths.length > 0) {
      results.push({ fnName, filePath, startLine, paths });
    }
  }

  return results;
}

/**
 * True when `arg` has the shape `new URL("/literal/path", anything)`. The
 * URL constructor discards the path of `base` whenever the first arg starts
 * with a leading slash — so the resolved URL is always `<own-origin>/path`
 * regardless of what flows in as `base`. The attacker can only influence
 * the origin (via Host header), not the path. See RULE-FEEDBACK.md #2.
 *
 * Pure StringLiteral first arg only. Template literals or any non-literal
 * expression may carry taint and must keep flagging.
 */
function isConstantFoldedUrl(arg: Node): boolean {
  if (arg.getKindName() !== 'NewExpression') return false;
  const newExpr = arg as import('ts-morph').NewExpression;
  if (newExpr.getExpression().getText() !== 'URL') return false;
  const args = newExpr.getArguments();
  if (args.length < 1) return false;
  const first = args[0];
  if (first.getKindName() !== 'StringLiteral') return false;
  const literal = (first as import('ts-morph').StringLiteral).getLiteralText();
  return literal.startsWith('/');
}

/**
 * True when the given node is a top-level export — either a declaration
 * carrying an `export` modifier directly, or an arrow/function expression
 * whose containing VariableStatement is exported. Required to distinguish
 * Next.js route handlers (always exported) from local helpers in the same
 * file (Codex impl-review).
 */
function isExportedTopLevel(fn: Node): boolean {
  // FunctionDeclaration with `export` modifier.
  if (fn.getKindName() === 'FunctionDeclaration') {
    const decl = fn as import('ts-morph').FunctionDeclaration;
    if (decl.isExported() || decl.isDefaultExport()) return true;
    return false;
  }
  // Arrow / function expression: walk to enclosing VariableStatement.
  let cur: Node | undefined = fn.getParent();
  while (cur) {
    if (cur.getKindName() === 'VariableStatement') {
      const vs = cur as import('ts-morph').VariableStatement;
      return vs.isExported() || vs.hasDefaultKeyword();
    }
    if (cur.getKindName() === 'ExportAssignment') return true;
    cur = cur.getParent();
  }
  return false;
}

// ── Callback-sweep gate ─────────────────────────────────────────────────
//
// Method names that customarily attach an HTTP request handler (Express,
// Koa, Fastify, hapi). The list is deliberately tight — broader entries
// like `on` / `once` would re-introduce the FP class Codex flagged
// (`emitter.on('data', (req) => …)` classifying as an HTTP handler).
const ROUTE_HANDLER_METHODS = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'all',
  'head',
  'options',
  'use',
  'route',
  'param',
  'register',
  'addHook',
]);

/**
 * True when `node` is an inline arrow / function expression / object-method
 * passed as an argument to a known route-handler call, e.g.
 * `app.get('/x', <node>)` or `router.use(<node>)`. Walks one level of
 * call-expression nesting to handle `app.get('/x', mw, <node>)`.
 */
function isRouteHandlerCallback(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || parent.getKindName() !== 'CallExpression') return false;
  const call = parent as import('ts-morph').CallExpression;
  // Make sure `node` is one of the call's arguments, not the callee itself.
  const args = call.getArguments();
  if (!args.includes(node as any)) return false;
  const callee = call.getExpression();
  const calleeName = callee.getKindName() === 'PropertyAccessExpression' ? (callee as any).getName() : callee.getText();
  return typeof calleeName === 'string' && ROUTE_HANDLER_METHODS.has(calleeName);
}

/** True when at least one of the function's params has an HTTP request type annotation. */
function hasHttpTypedParam(node: ArrowFunction | FunctionExpression): boolean {
  for (const param of node.getParameters()) {
    const typeText = param.getType().getText(param);
    if (HTTP_PARAM_TYPES.test(typeText)) return true;
  }
  return false;
}

/**
 * True when the path from `from` up to `rootBody` crosses a function-like
 * scope that re-binds `name` as one of its own parameters — i.e., the
 * tainted name is shadowed locally and the match against the outer scope's
 * tainted set is spurious. Catches `(req) => { const f = (req) => exec(req); }`.
 */
function isTaintedNameShadowedAt(from: Node, name: string, rootBody: Node): boolean {
  let cur: Node | undefined = from.getParent();
  while (cur && cur !== rootBody) {
    const k = cur.getKindName();
    if (
      k === 'ArrowFunction' ||
      k === 'FunctionExpression' ||
      k === 'FunctionDeclaration' ||
      k === 'MethodDeclaration'
    ) {
      const fn = cur as ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;
      for (const p of fn.getParameters()) {
        if (p.getName() === name) return true;
      }
    }
    cur = cur.getParent();
  }
  return false;
}

// ── AST Helpers ─────────────────────────────────────────────────────────

/** Check if an expression references any tainted variable name */
function astExprRefersToTainted(expr: Node, taintedNames: Set<string>): boolean {
  const k = expr.getKindName();
  if (k === 'Identifier' && taintedNames.has(expr.getText())) return true;
  if (k === 'PropertyAccessExpression') {
    return astExprRefersToTainted((expr as any).getExpression(), taintedNames);
  }
  if (k === 'ElementAccessExpression') {
    return astExprRefersToTainted((expr as any).getExpression(), taintedNames);
  }
  if (k === 'CallExpression') {
    if (astExprRefersToTainted((expr as any).getExpression(), taintedNames)) return true;
    for (const arg of (expr as any).getArguments()) {
      if (astExprRefersToTainted(arg, taintedNames)) return true;
    }
    return false;
  }
  if (k === 'AwaitExpression') {
    return astExprRefersToTainted((expr as any).getExpression(), taintedNames);
  }
  // Check all children for complex expressions
  for (const child of expr.getChildren()) {
    if (astExprRefersToTainted(child, taintedNames)) return true;
  }
  return false;
}

/** Get the base name of a callee (e.g., exec from child_process.exec, or db.query) */
function getCalleeBaseName(call: import('ts-morph').CallExpression): string {
  const expr = call.getExpression();
  const k = expr.getKindName();
  if (k === 'Identifier') return expr.getText();
  if (k === 'PropertyAccessExpression') return (expr as any).getName();
  return '';
}

/**
 * Resolve the sink category for a call by trying the full dotted path first
 * (e.g., `axios.request` → ssrf) and falling back to the last-segment base
 * name (e.g., `exec` → command). Without this, qualified sinks like
 * `axios.request`, `http.request`, `https.request`, and `undici.request`
 * never match because their base name (`request`) is too generic to register.
 *
 * Receiver-scoped command sinks: the bare base name `exec` (and friends)
 * collides with `RegExp.prototype.exec` — `/foo/.exec(s)` was firing as
 * command-injection in production (kern-guard PR #316). When matched only
 * by base name, command-class sinks now require the call site to
 * plausibly resolve to a node command-execution module (or a regex
 * receiver disqualifies it). Indirect cases (regex passed in via a
 * param) become acceptable false negatives — much rarer than the FP cost.
 */
function resolveSinkCategory(call: import('ts-morph').CallExpression):
  | {
      category: TaintSink['category'];
      name: string;
    }
  | undefined {
  const expr = call.getExpression();
  const k = expr.getKindName();
  if (k === 'PropertyAccessExpression') {
    const fullPath = getStaticAccessPath(expr);
    if (fullPath) {
      const byFullPath = SINK_NAMES.get(fullPath);
      if (byFullPath) return { category: byFullPath, name: fullPath };
    }
  }
  const baseName = getCalleeBaseName(call);

  // NoSQL receiver-aware match takes priority — these names (find, findOne,
  // updateOne, …) collide with Array.prototype methods and would FP if added
  // flat to SINK_NAMES. Only treat as a Mongo sink when the receiver
  // resembles a Mongoose model or Mongo collection. See taint-types.ts for
  // the gate justification.
  if (k === 'PropertyAccessExpression' && NOSQL_QUERY_ARG_INDEXES[baseName] && isNoSQLSinkContext(call)) {
    return { category: 'nosql', name: baseName };
  }

  const byBase = SINK_NAMES.get(baseName);
  if (!byBase) return undefined;
  if (byBase === 'command' && COMMAND_AMBIGUOUS_BASE_NAMES.has(baseName)) {
    if (!isCommandSinkContext(call)) return undefined;
  }
  return { category: byBase, name: baseName };
}

// ── NoSQL sink receiver gate ────────────────────────────────────────────
//
// Returns true when the call's receiver looks like a Mongo collection /
// Mongoose model rather than a plain JS array. Three accepted shapes:
//   1. Capitalized identifier: `User.find(...)` (Mongoose convention).
//   2. `<x>.collection(name).<sink>(...)` — Mongo driver chained access.
//   3. Receiver name in {db, conn, collection} — for assigned-collection
//      shapes like `const users = db.collection('users'); users.find(...)`
//      after one alias hop.
function isNoSQLSinkContext(call: import('ts-morph').CallExpression): boolean {
  const expr = call.getExpression();
  if (expr.getKindName() !== 'PropertyAccessExpression') return false;
  const receiver = (expr as import('ts-morph').PropertyAccessExpression).getExpression();
  return isLikelyNoSQLReceiver(receiver, new Set(), false);
}

/**
 * Walks the receiver chain bottom-up to decide if it resembles a Mongo
 * collection / Mongoose model. The `sawSqlVerb` flag accumulates as the
 * recursion descends through PropertyAccess nodes whose names match
 * SQL_BUILDER_VERBS — it is only consulted at the NOSQL_RECEIVER_ALLOWLIST
 * Identifier match (`db`/`conn`/`collection`). Capitalized Mongoose Models
 * and `.collection(...)`/`.model(...)` anchors return true regardless of
 * verbs in the chain so Mongoose chains like
 * `User.find().select('x').where(req.body.f)` still fire (Codex/Gemini
 * buddy review caught the prior gate killing those).
 *
 * TypeScript wrappers (`as`, `!`, parens) are unwrapped so chains like
 * `(db.select() as any).from(t).where(req.body.id)` still suppress.
 */
function isLikelyNoSQLReceiver(node: Node, visited: Set<Node>, sawSqlVerb: boolean): boolean {
  if (visited.has(node)) return false;
  visited.add(node);
  const k = node.getKindName();

  // 0) Unwrap TS-only wrapper nodes so `(x as any).y(...)`, `x!.y(...)`,
  //    `<any>x.y(...)`, `(x satisfies T).y(...)`, and `(x).y(...)` are
  //    treated identically to `x.y(...)` (Gemini + OpenCode impl-review).
  if (
    k === 'ParenthesizedExpression' ||
    k === 'NonNullExpression' ||
    k === 'AsExpression' ||
    k === 'TypeAssertionExpression' ||
    k === 'SatisfiesExpression'
  ) {
    const inner = (node as any).getExpression?.();
    if (inner) return isLikelyNoSQLReceiver(inner, visited, sawSqlVerb);
    return false;
  }

  // 1) Identifier — model name, collection-handle alias, or chain root.
  if (k === 'Identifier') {
    const text = node.getText();
    // Capitalized Mongoose Model (User, Post, OrderModel) — strong anchor,
    // never suppressed by upstream SQL verbs in the chain.
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(text)) return true;
    // db / conn / collection — Mongo-shaped names only when no SQL builder
    // verb appeared upstream. Suppressed when sawSqlVerb is true so chains
    // like `db.select().from(t).where(...)` don't FP (kern-guard PR #387).
    if (NOSQL_RECEIVER_ALLOWLIST.has(text)) return !sawSqlVerb;
    // Trace one alias hop — `const users = db.collection('users')`. The
    // initializer's chain is walked independently; sawSqlVerb is reset to
    // the current value so a SQL chain hidden behind an alias
    // (`const q = db.select().from(t); q.where(...)`) is also caught.
    const sym = (node as any).getSymbol?.();
    if (sym && typeof sym.getDeclarations === 'function') {
      for (const decl of sym.getDeclarations() ?? []) {
        if (decl.getKindName?.() !== 'VariableDeclaration') continue;
        const init = (decl as any).getInitializer?.();
        if (init && isLikelyNoSQLReceiver(init, visited, sawSqlVerb)) return true;
      }
    }
    return false;
  }

  // 2) PropertyAccess: x.collection (the property), or chains. Accumulate
  //    SQL builder verbs into sawSqlVerb so the allowlist check downstream
  //    can suppress the Drizzle/Kysely FP path.
  if (k === 'PropertyAccessExpression') {
    const pa = node as import('ts-morph').PropertyAccessExpression;
    const name = pa.getName();
    if (name === 'collection' || name === 'model') return true;
    const next = sawSqlVerb || SQL_BUILDER_VERBS.has(name);
    return isLikelyNoSQLReceiver(pa.getExpression(), visited, next);
  }

  // 3) Call expressions: db.collection('users'), conn.model('User').
  if (k === 'CallExpression') {
    const inner = node as import('ts-morph').CallExpression;
    const innerCallee = inner.getExpression();
    if (innerCallee.getKindName() === 'PropertyAccessExpression') {
      const ipa = innerCallee as import('ts-morph').PropertyAccessExpression;
      if (ipa.getName() === 'collection' || ipa.getName() === 'model') return true;
    }
    return isLikelyNoSQLReceiver(innerCallee, visited, sawSqlVerb);
  }

  return false;
}

/**
 * For NoSQL sinks, restrict tainted-arg detection to the method's query
 * positions and (for findById-style methods) reject scalar `req.params.*`
 * tainted sources. Returns the set of arg indexes worth scanning, or
 * `undefined` when the sink isn't NoSQL.
 */
function nosqlAcceptsArgIndex(methodName: string, argIndex: number): boolean {
  const allowed = NOSQL_QUERY_ARG_INDEXES[methodName];
  return allowed ? allowed.has(argIndex) : false;
}

/**
 * `findById(req.params.id)` with a string is not classic operator injection.
 * Reject when the call is a *ById method AND the arg traces back to a static
 * property chain rooted at `req.params` / `request.params` — those are
 * URL-segment strings, not the object payloads needed for `{$gt:''}`-style
 * bypass. Codex impl-review caught the original check missed common alias
 * shapes (`const id = req.params.id; User.findById(id)` and Fastify-style
 * `request.params.id`); we now trace one alias hop and accept either name.
 */
function nosqlByIdRejectsScalarParams(methodName: string, arg: Node): boolean {
  if (!NOSQL_METHODS_REQUIRING_OBJECT_TAINT.has(methodName)) return false;
  const path = resolveStaticOriginPath(arg);
  if (!path) return false;
  return /^(req|request)\.params(\.|$)/.test(path);
}

/**
 * Like `getStaticAccessPath` but follows a single alias hop when the node is
 * an Identifier whose declaration's initializer is itself a static path.
 * Cycle protection prevents infinite recursion on `let a = a`.
 *
 * For a multi-segment PropertyAccessExpression (`req.params.id`), returns
 * the full path immediately. For a bare Identifier (`id`), tries symbol
 * resolution first (works under a ts-morph project) and falls back to a
 * source-file scan for a matching VariableDeclaration when the symbol
 * resolver returns undefined (common in test harnesses without full type
 * checking).
 */
function resolveStaticOriginPath(node: Node, visited: Set<Node> = new Set()): string | undefined {
  if (visited.has(node)) return undefined;
  visited.add(node);
  if (node.getKindName() === 'PropertyAccessExpression') {
    return getStaticAccessPath(node);
  }
  if (node.getKindName() !== 'Identifier') return undefined;

  const targetName = node.getText();
  const candidates: Node[] = [];

  // Symbol-resolution path (best-effort — needs full project type info).
  const sym = (node as any).getSymbol?.();
  if (sym && typeof sym.getDeclarations === 'function') {
    for (const decl of sym.getDeclarations() ?? []) {
      if (decl.getKindName?.() === 'VariableDeclaration') candidates.push(decl);
    }
  }

  // Fallback: scan the source file for a matching VariableDeclaration. Picks
  // the declaration that lexically precedes the use site to approximate
  // shadowing without a full scope walker.
  if (candidates.length === 0) {
    const sourceFile = node.getSourceFile();
    if (sourceFile) {
      const useStart = node.getStart();
      let best: Node | undefined;
      sourceFile.forEachDescendant((n) => {
        if (n.getKindName() !== 'VariableDeclaration') return;
        const decl = n as import('ts-morph').VariableDeclaration;
        if (decl.getName() !== targetName) return;
        if (decl.getStart() > useStart) return;
        if (!best || decl.getStart() > best.getStart()) best = decl;
      });
      if (best) candidates.push(best);
    }
  }

  for (const decl of candidates) {
    const init = (decl as any).getInitializer?.();
    if (!init) continue;
    const aliased = resolveStaticOriginPath(init, visited);
    if (aliased) return aliased;
  }
  return undefined;
}

/** Get the full static access path (e.g., req.query.id). Returns undefined for dynamic access. */
function getStaticAccessPath(expr: Node): string | undefined {
  const k = expr.getKindName();
  if (k === 'Identifier') return expr.getText();
  if (k === 'PropertyAccessExpression') {
    const obj = getStaticAccessPath((expr as any).getExpression());
    if (obj) return `${obj}.${(expr as any).getName()}`;
  }
  return undefined;
}

/** Find the first tainted identifier in an expression tree */
function findTaintedIdentifier(expr: Node, taintedNames: Set<string>): string | undefined {
  const k = expr.getKindName();
  if (k === 'Identifier' && taintedNames.has(expr.getText())) return expr.getText();
  if (k === 'PropertyAccessExpression') {
    return findTaintedIdentifier((expr as any).getExpression(), taintedNames);
  }
  // Check binary expressions (string concatenation: 'cmd ' + userInput)
  if (k === 'BinaryExpression') {
    return (
      findTaintedIdentifier((expr as any).getLeft(), taintedNames) ||
      findTaintedIdentifier((expr as any).getRight(), taintedNames)
    );
  }
  for (const child of expr.getChildren()) {
    const found = findTaintedIdentifier(child, taintedNames);
    if (found) return found;
  }
  return undefined;
}

// ── Command-sink receiver scoping ───────────────────────────────────────

const COMMAND_AMBIGUOUS_BASE_NAMES = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);

/**
 * True only when the call site is plausibly a command-execution sink
 * rather than `RegExp.prototype.exec`. Two layers of rejection:
 *   1. Syntactic — receiver is a regex literal, `new RegExp(...)`, or an
 *      Identifier whose declaration's initializer is one of those (one
 *      alias hop, with cycle protection).
 *   2. Type-based — TS type checker says the receiver's type is `RegExp`.
 *      Handles chained calls (`/foo/.compile().exec(s)`) and functions
 *      that return regex (`getPattern().exec(s)`) where syntactic
 *      detection would miss.
 *
 * Cases the layers together cover (OpenCode flagged 1 + 2 as blockers):
 *   - `/foo/.exec(s)`                                   → syntactic
 *   - `new RegExp(...).exec(s)`                         → syntactic
 *   - `const re = /foo/; re.exec(s)`                    → syntactic
 *   - `const a = /foo/; const b = a; b.exec(s)`         → syntactic (1 hop)
 *   - `/foo/.compile().exec(s)`                         → type-based
 *   - `getPattern().exec(s)` returning RegExp           → type-based
 *
 * Everything else passes through — matching the existing greedy
 * base-name semantics for the legitimate command-injection paths.
 */
function isCommandSinkContext(call: import('ts-morph').CallExpression): boolean {
  const expr = call.getExpression();
  if (expr.getKindName() === 'PropertyAccessExpression') {
    const receiver = (expr as any).getExpression() as Node;
    if (isRegExpReceiver(receiver, new Set())) return false;
    if (isRegExpTyped(receiver)) return false;
  }
  return true;
}

/**
 * Syntactic detection. Walks at most one alias hop (`const re2 = re`)
 * with a visited set to defang circular aliasing (`const a = b; const b = a`)
 * which would otherwise infinite-recurse.
 */
function isRegExpReceiver(node: Node, visited: Set<Node>): boolean {
  if (visited.has(node)) return false;
  visited.add(node);
  const k = node.getKindName();
  if (k === 'RegularExpressionLiteral') return true;
  if (k === 'NewExpression') {
    const ctor = (node as any).getExpression?.();
    if (ctor && typeof ctor.getText === 'function' && ctor.getText() === 'RegExp') return true;
  }
  if (k === 'Identifier') {
    const sym = (node as any).getSymbol?.();
    if (!sym || typeof sym.getDeclarations !== 'function') return false;
    for (const decl of sym.getDeclarations() ?? []) {
      if (decl.getKindName?.() !== 'VariableDeclaration') continue;
      const init = (decl as any).getInitializer?.();
      if (!init) continue;
      const ik = init.getKindName();
      if (ik === 'RegularExpressionLiteral') return true;
      if (ik === 'NewExpression') {
        const ctor = init.getExpression?.();
        if (ctor && typeof ctor.getText === 'function' && ctor.getText() === 'RegExp') return true;
      }
      if (ik === 'Identifier') {
        if (isRegExpReceiver(init, visited)) return true;
      }
    }
  }
  return false;
}

/**
 * Type-based detection — asks the TS type checker whether the
 * expression's type is `RegExp`. Catches cases the syntactic walk
 * can't see (chained `.compile()`, function return values, generics).
 * Wrapped in try/catch because `getType` can throw on unresolvable
 * symbols — a safe `false` is better than crashing the whole taint pass.
 */
function isRegExpTyped(node: Node): boolean {
  try {
    const type = (node as any).getType?.();
    if (!type) return false;
    const symbol = type.getSymbol?.();
    if (symbol && typeof symbol.getName === 'function' && symbol.getName() === 'RegExp') return true;
    // Fall-through string compare — covers cases where the type symbol
    // isn't directly named (e.g. some intersected types) but the type's
    // text representation pins it to RegExp.
    const text = typeof type.getText === 'function' ? type.getText() : '';
    return text === 'RegExp';
  } catch {
    return false;
  }
}

/** AST-based sanitizer detection */
function findSanitizersAST(body: Node, taintedNames: Set<string>): Array<{ name: string; sanitizedVars: Set<string> }> {
  const sanitizers: Array<{ name: string; sanitizedVars: Set<string> }> = [];

  const allCalls: import('ts-morph').CallExpression[] = [];
  body.forEachDescendant((n) => {
    if (n.getKindName() === 'CallExpression') allCalls.push(n as import('ts-morph').CallExpression);
  });
  for (const call of allCalls) {
    const calleeName = getCalleeBaseName(call);
    const matchedSanitizer = SANITIZER_PATTERN_NAMES.find((s) => calleeName.includes(s));
    if (!matchedSanitizer) continue;

    // Track which tainted vars are sanitized by this call
    const sanitizedVars = new Set<string>();
    for (const arg of call.getArguments()) {
      // Track the FULL access path so parseInt(req.query.id) sanitizes 'req.query.id', not 'req'
      const fullPath = getStaticAccessPath(arg);
      if (fullPath && findTaintedIdentifier(arg, taintedNames)) {
        sanitizedVars.add(fullPath);
      } else {
        const tainted = findTaintedIdentifier(arg, taintedNames);
        if (tainted) sanitizedVars.add(tainted);
      }
    }

    // Also check if the result is assigned to a variable (replacing the tainted value)
    const parent = call.getParent();
    if (parent && parent.getKindName() === 'VariableDeclaration') {
      const declName = (parent as any).getName();
      sanitizedVars.add(declName);
    }

    if (sanitizedVars.size > 0) {
      sanitizers.push({ name: matchedSanitizer, sanitizedVars });
    }
  }

  return sanitizers;
}

// ── Control-Flow Guards ─────────────────────────────────────────────────
//
// A "validation guard" is an early-exit branch that bails out when a tainted
// value FAILS a check, e.g.:
//
//   if (!isValidId(id)) return res.status(400).json({ error: 'bad id' });
//   if (typeof name !== 'string') throw new Error('name must be string');
//   if (!schema.safeParse(body).success) return;
//
// The sink is marked sanitized only when:
//   1. Polarity is correct — the guard exits on the INVALID branch, so
//      subsequent code runs only on validated input. Call-based validators
//      must be negated (`!<validator>(x)`); typeof checks must use `!==`/
//      `!=` so the exit fires when the type is wrong.
//   2. Dominance holds — the guard's `if` must live in a block that
//      contains the sink, and appear textually before the sink inside that
//      block. Guards in sibling branches or appearing after the sink do not
//      count.
//
// Deliberately conservative: null-only checks (`if (!x) return`) never
// qualify as validators.

const VALIDATOR_PREFIXES = [
  'is',
  'validate',
  'check',
  'assert',
  'sanitize',
  'clean',
  'escape',
  'normalize',
  'parse',
  'safeParse',
  'verify',
  'match',
];

function looksLikeValidatorName(name: string): boolean {
  return VALIDATOR_PREFIXES.some((p) => name === p || name.startsWith(p));
}

/**
 * True if `call` is dominated by an earlier early-exit guard that validates
 * `taintedArg` using a recognizable validator/type-guard pattern with the
 * correct exit-on-invalid polarity.
 */
function isGuardedByValidation(call: import('ts-morph').CallExpression, taintedArg: string, fnBody: Node): boolean {
  const guards = collectEarlyExitGuards(fnBody);

  for (const guard of guards) {
    if (!guardDominatesSink(guard, call)) continue;
    if (!guardTestsValidatesVar(guard.test, taintedArg)) continue;
    return true;
  }
  return false;
}

interface EarlyExitGuard {
  test: Node;
  ifStmt: import('ts-morph').IfStatement;
}

/**
 * Find every `if (test) <early-exit>` inside `body` where `<early-exit>` is
 * a `return`, `throw`, or `res.status(4xx)`-style statement.
 */
function collectEarlyExitGuards(body: Node): EarlyExitGuard[] {
  const guards: EarlyExitGuard[] = [];

  body.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.IfStatement) return;
    const ifStmt = node as import('ts-morph').IfStatement;
    const thenStmt = ifStmt.getThenStatement();

    if (!isEarlyExit(thenStmt)) return;

    guards.push({
      test: ifStmt.getExpression(),
      ifStmt,
    });
  });

  return guards;
}

/**
 * Structural dominance: the guard's `if` statement must be a direct child of
 * a block that is an ancestor of (or equal to) the sink's containing block,
 * and appear textually before the sink within that block. This rejects
 * guards nested in sibling branches (`if (cond) { guard } else { sink }`)
 * and guards that appear after the sink.
 */
function guardDominatesSink(guard: EarlyExitGuard, sink: Node): boolean {
  const sinkStart = sink.getStart();
  const guardIf = guard.ifStmt;
  const guardParent = guardIf.getParent();
  if (!guardParent) return false;

  let cur: Node | undefined = sink;
  while (cur) {
    if (cur === guardIf) return false; // sink lives inside guard's test/then
    const parent = cur.getParent();
    if (parent === guardParent) {
      return guardIf.getEnd() < sinkStart;
    }
    cur = parent;
  }
  return false;
}

function isEarlyExit(stmt: Node): boolean {
  const k = stmt.getKindName();
  if (k === 'ReturnStatement' || k === 'ThrowStatement') return true;
  if (k === 'Block') {
    const statements = (stmt as import('ts-morph').Block).getStatements();
    if (statements.length === 0) return false;
    // Accept `{ ...; return; }` patterns. The final stmt must be return/throw.
    const last = statements[statements.length - 1];
    const lk = last.getKindName();
    return lk === 'ReturnStatement' || lk === 'ThrowStatement';
  }
  return false;
}

/**
 * True if the guard's test expression references `varName` through a
 * recognizable validator or type-guard pattern WITH exit-on-invalid polarity:
 *   - typeof varName !== '<literal>'   (exits when type is wrong)
 *   - !<validator>(varName)            (exits when validator rejects)
 *   - !<dotted>.success / !<dotted>.ok (schema result shapes)
 *
 * `if (isValid(x)) return;` is rejected because it exits on VALID input —
 * the subsequent code runs on INVALID input, so taint is still live.
 */
function guardTestsValidatesVar(test: Node, varName: string): boolean {
  if (isNegatedTypeofGuard(test, varName)) return true;
  return containsNegatedValidator(test, varName);
}

/**
 * Matches `typeof x !== '<literal>'` or `typeof x != '<literal>'` where x
 * refers to `varName`. Equality (`===`) is rejected — that polarity exits on
 * VALID input.
 */
function isNegatedTypeofGuard(node: Node, varName: string): boolean {
  if (node.getKind() !== SyntaxKind.BinaryExpression) {
    for (const child of node.getChildren()) {
      if (isNegatedTypeofGuard(child, varName)) return true;
    }
    return false;
  }
  const bin = node as import('ts-morph').BinaryExpression;
  const op = bin.getOperatorToken().getText();
  if (op !== '!==' && op !== '!=') return false;
  for (const side of [bin.getLeft(), bin.getRight()]) {
    if (side.getKind() !== SyntaxKind.TypeOfExpression) continue;
    const operand = (side as import('ts-morph').TypeOfExpression).getExpression();
    if (refersToVar(operand, varName)) return true;
  }
  return false;
}

/**
 * Matches `!<validator>(...)` (PrefixUnary `!`) where the validator's argument
 * subtree references `varName`. Handles nested negation inside logical-or
 * expressions such as `!isValid(x) || !matchesSchema(x)`.
 */
function containsNegatedValidator(node: Node, varName: string): boolean {
  if (node.getKind() === SyntaxKind.PrefixUnaryExpression) {
    const unary = node as import('ts-morph').PrefixUnaryExpression;
    if (unary.getOperatorToken() === SyntaxKind.ExclamationToken) {
      const operand = unary.getOperand();
      if (callIsValidatorOf(operand, varName)) return true;
    }
  }
  for (const child of node.getChildren()) {
    if (containsNegatedValidator(child, varName)) return true;
  }
  return false;
}

function callIsValidatorOf(expr: Node, varName: string): boolean {
  // Unwrap property access on call results: `!schema.safeParse(x).success`
  // — the root is a PropertyAccess whose expression is the CallExpression.
  let cur: Node = expr;
  while (cur.getKind() === SyntaxKind.PropertyAccessExpression) {
    cur = (cur as import('ts-morph').PropertyAccessExpression).getExpression();
  }
  if (cur.getKind() !== SyntaxKind.CallExpression) return false;
  const call = cur as import('ts-morph').CallExpression;
  const calleeText = call.getExpression().getText();
  const lastSegment = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
  if (!looksLikeValidatorName(lastSegment)) return false;
  for (const arg of call.getArguments()) {
    if (refersToVar(arg, varName)) return true;
  }
  return false;
}

function refersToVar(expr: Node, varName: string): boolean {
  if (expr.getKindName() === 'Identifier' && expr.getText() === varName) return true;
  if (expr.getKindName() === 'PropertyAccessExpression') {
    return refersToVar((expr as import('ts-morph').PropertyAccessExpression).getExpression(), varName);
  }
  for (const child of expr.getChildren()) {
    if (refersToVar(child, varName)) return true;
  }
  return false;
}
