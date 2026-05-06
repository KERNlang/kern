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
  SANITIZER_PATTERN_NAMES,
  SINK_NAMES,
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
      const sinkDef = resolved.category;

      // Check which parameter names appear in the sink's arguments
      for (const arg of call.getArguments()) {
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
      for (const arg of call.getArguments()) {
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

  // Collect all function-like AST nodes from the SourceFile
  const allFns: Array<{
    node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration;
    startLine: number;
  }> = [];
  for (const fn of sourceFile.getFunctions()) allFns.push({ node: fn, startLine: fn.getStartLineNumber() });
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init) {
        const initKind = init.getKindName();
        if (initKind === 'ArrowFunction' || initKind === 'FunctionExpression') {
          allFns.push({ node: init as any, startLine: stmt.getStartLineNumber() });
        }
      }
    }
  }
  for (const cls of sourceFile.getClasses()) {
    for (const method of cls.getMethods()) {
      allFns.push({ node: method, startLine: method.getStartLineNumber() });
    }
  }

  for (const { node: fn, startLine } of allFns) {
    const params = fn.getParameters();
    const fnName = 'getName' in fn && typeof fn.getName === 'function' ? fn.getName() || 'anonymous' : 'anonymous';

    // Step 1: Classify params as tainted using type info
    const taintedParams: TaintSource[] = [];
    for (const param of params) {
      const name = param.getName();
      const typeText = param.getType().getText(param);
      if (HTTP_PARAM_NAMES.test(name) || HTTP_PARAM_TYPES.test(typeText)) {
        taintedParams.push({ name, origin: `${name} (HTTP input)` });
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

      // Check if any argument references a tainted variable
      for (const arg of call.getArguments()) {
        const taintedArg = findTaintedIdentifier(arg, taintedNames);
        if (taintedArg) {
          sinks.push({
            name: calleeName,
            category: sinkDef,
            taintedArg,
            line: call.getStartLineNumber(),
          });
          break;
        }
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
            if (taintedArg) {
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
  const byBase = SINK_NAMES.get(baseName);
  if (!byBase) return undefined;
  if (byBase === 'command' && COMMAND_AMBIGUOUS_BASE_NAMES.has(baseName)) {
    if (!isCommandSinkContext(call)) return undefined;
  }
  return { category: byBase, name: baseName };
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
