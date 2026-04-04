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
      const calleeName = getCalleeBaseName(call);
      const sinkDef = SINK_NAMES.get(calleeName);
      if (!sinkDef) continue;

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
      const calleeName = getCalleeBaseName(call);
      const sinkDef = SINK_NAMES.get(calleeName);
      if (!sinkDef) continue;

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
      const calleeName = getCalleeBaseName(call);
      // Skip if it's already a known sink (handled above)
      if (SINK_NAMES.has(calleeName)) continue;
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
      const hasSanitizer = sanitizer != null;
      const sufficient = sanitizer != null ? isSanitizerSufficient(sanitizer.name, sink.category) : false;

      paths.push({
        source,
        sink,
        sanitized: hasSanitizer && sufficient,
        sanitizer: sanitizer?.name,
        insufficientSanitizer: hasSanitizer && !sufficient ? sanitizer.name : undefined,
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
