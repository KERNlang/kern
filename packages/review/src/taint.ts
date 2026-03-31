/**
 * Taint Tracking — source→sink analysis on KERN IR.
 *
 * Phase 2 of the security pipeline. Works on InferResult[] handler bodies.
 *
 * Two modes:
 *   analyzeTaint()          — intra-procedural (single file)
 *   analyzeTaintCrossFile() — inter-procedural (follows imports across files)
 *
 * Also validates sanitizer sufficiency: parseInt stops SQL injection on
 * numeric values but NOT command injection. DOMPurify stops XSS but
 * NOT SQL injection. The sufficiency matrix catches these mismatches.
 */

import { SyntaxKind, Node, type SourceFile, type FunctionDeclaration, type ArrowFunction, type FunctionExpression, type MethodDeclaration } from 'ts-morph';
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TaintSource {
  name: string;         // Variable name (e.g., "req", "userId")
  origin: string;       // Where it came from (e.g., "req.body", "req.query.id")
  line?: number;        // Approximate line in handler body
}

export interface TaintSink {
  name: string;         // Sink function (e.g., "exec", "writeFileSync")
  category: 'command' | 'fs' | 'sql' | 'redirect' | 'eval' | 'template';
  taintedArg: string;   // The tainted variable used in the call
  line?: number;
}

export interface TaintPath {
  source: TaintSource;
  sink: TaintSink;
  sanitized: boolean;
  sanitizer?: string;              // What sanitized it (e.g., "parseInt", "schema.parse")
  insufficientSanitizer?: string;  // Sanitizer present but wrong for this sink type
}

export interface TaintResult {
  fnName: string;
  filePath: string;
  startLine: number;
  paths: TaintPath[];
}

// ── Source Classification ────────────────────────────────────────────────

/** Param names/types that indicate HTTP handler context */
const HTTP_PARAM_NAMES = /^(req|request)$/i;
const HTTP_PARAM_TYPES = /Request|IncomingMessage|FastifyRequest|KoaContext|Context/;

/** User input access patterns — what flows from HTTP params */
const USER_INPUT_ACCESS = [
  { pattern: /\breq\.body\b/, origin: 'req.body' },
  { pattern: /\breq\.query\b/, origin: 'req.query' },
  { pattern: /\breq\.params\b/, origin: 'req.params' },
  { pattern: /\breq\.headers\b/, origin: 'req.headers' },
  { pattern: /\brequest\.body\b/, origin: 'request.body' },
  { pattern: /\brequest\.query\b/, origin: 'request.query' },
  { pattern: /\brequest\.params\b/, origin: 'request.params' },
  { pattern: /\bprocess\.argv\b/, origin: 'process.argv' },
  { pattern: /\bprocess\.env\b/, origin: 'process.env' },
  // DB read results (indirect injection sources)
  { pattern: /\bdb\.query\b/, origin: 'db.query' },
  { pattern: /\bfindOne\b/, origin: 'findOne' },
  { pattern: /\bfindById\b/, origin: 'findById' },
  { pattern: /\bgetItem\b/, origin: 'getItem' },
  { pattern: /\bcollection\.find\b/, origin: 'collection.find' },
  // RAG/retrieval results
  { pattern: /\bvectorStore\.search\b/, origin: 'vectorStore.search' },
  { pattern: /\bsimilaritySearch\b/, origin: 'similaritySearch' },
  { pattern: /\bindex\.query\b/, origin: 'index.query' },
] as const;

// ── Sink Classification ─────────────────────────────────────────────────

interface SinkPattern {
  pattern: RegExp;
  name: string;
  category: TaintSink['category'];
}

const SINK_PATTERNS: SinkPattern[] = [
  // Command execution
  { pattern: /\bexec\s*\(/, name: 'exec', category: 'command' },
  { pattern: /\bexecSync\s*\(/, name: 'execSync', category: 'command' },
  { pattern: /\bspawn\s*\(/, name: 'spawn', category: 'command' },
  { pattern: /\bspawnSync\s*\(/, name: 'spawnSync', category: 'command' },
  { pattern: /\bexecFile\s*\(/, name: 'execFile', category: 'command' },
  // Filesystem
  { pattern: /\bwriteFile\s*\(/, name: 'writeFile', category: 'fs' },
  { pattern: /\bwriteFileSync\s*\(/, name: 'writeFileSync', category: 'fs' },
  { pattern: /\bcreateWriteStream\s*\(/, name: 'createWriteStream', category: 'fs' },
  { pattern: /\bunlink\s*\(/, name: 'unlink', category: 'fs' },
  { pattern: /\bunlinkSync\s*\(/, name: 'unlinkSync', category: 'fs' },
  // SQL (template literal with query-like calls)
  { pattern: /\bquery\s*\(/, name: 'query', category: 'sql' },
  { pattern: /\b\$execute\s*\(/, name: '$execute', category: 'sql' },
  { pattern: /\braw\s*\(/, name: 'raw', category: 'sql' },
  // Redirect
  { pattern: /\bredirect\s*\(/, name: 'redirect', category: 'redirect' },
  // Eval
  { pattern: /\beval\s*\(/, name: 'eval', category: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function', category: 'eval' },
  // LLM API calls (prompt injection sinks)
  { pattern: /\bgenerateContent\s*\(/, name: 'generateContent', category: 'template' },
  { pattern: /\bsendMessage\s*\(/, name: 'sendMessage', category: 'template' },
  { pattern: /\bchat\.completions\.create\s*\(/, name: 'chat.completions.create', category: 'template' },
  // VM execution sinks (LLM output execution)
  { pattern: /\bvm\.runInContext\s*\(/, name: 'vm.runInContext', category: 'eval' },
  { pattern: /\bvm\.runInNewContext\s*\(/, name: 'vm.runInNewContext', category: 'eval' },
];

// ── Sanitizer Detection ─────────────────────────────────────────────────

const SANITIZER_PATTERNS = [
  // Type coercion (sanitizes to safe type)
  { pattern: /\bparseInt\s*\(/, name: 'parseInt' },
  { pattern: /\bparseFloat\s*\(/, name: 'parseFloat' },
  { pattern: /\bNumber\s*\(/, name: 'Number()' },
  { pattern: /\bBoolean\s*\(/, name: 'Boolean()' },
  // Schema validation
  { pattern: /\.parse\s*\(/, name: 'schema.parse' },
  { pattern: /\.safeParse\s*\(/, name: 'schema.safeParse' },
  { pattern: /\.validate\s*\(/, name: 'schema.validate' },
  { pattern: /\.validateSync\s*\(/, name: 'schema.validateSync' },
  // String sanitization
  { pattern: /\bsanitize\w*\s?\(/, name: 'sanitize()' },
  { pattern: /\bescape\w*\s?\(/, name: 'escape()' },
  { pattern: /\bDOMPurify\b/, name: 'DOMPurify' },
  { pattern: /\bencodeURI(Component)?\s*\(/, name: 'encodeURIComponent' },
  // Path sanitization
  { pattern: /path\.(resolve|normalize|basename)\s*\(/, name: 'path.normalize' },
  { pattern: /\.replace\s*\(\s*\/.*\.\.\//,  name: 'replace(../)' },
  // SQL parameterization
  { pattern: /\$\d+/, name: 'parameterized query ($N)' },
  { pattern: /\?\s*,/, name: 'parameterized query (?)' },
  // Prompt sanitization
  { pattern: /\bsanitizeForPrompt\s*\(/, name: 'sanitizeForPrompt' },
  { pattern: /\bescapePrompt\s*\(/, name: 'escapePrompt' },
  // LLM-specific sanitizers
  { pattern: /\bstripDelimiters\s*\(/, name: 'stripDelimiters' },
  { pattern: /\bcleanForPrompt\s*\(/, name: 'cleanForPrompt' },
];

// ── Sanitizer Sufficiency Matrix ──────────────────────────────────────────
// Not all sanitizers work for all sink types. parseInt prevents SQL injection
// on numeric values but does nothing for command injection.

type SinkCategory = TaintSink['category'];

const SANITIZER_SUFFICIENCY: Record<string, Set<SinkCategory>> = {
  'parseInt':                 new Set(['sql']),
  'parseFloat':               new Set(['sql']),
  'Number()':                 new Set(['sql']),
  'Boolean()':                new Set([]),  // too weak for anything
  'schema.parse':             new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.safeParse':         new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.validate':          new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.validateSync':      new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'sanitize()':               new Set(['template']),
  'escape()':                 new Set(['sql', 'template']),
  'DOMPurify':                new Set(['template']),
  'encodeURIComponent':       new Set(['redirect']),
  'path.normalize':           new Set(['fs']),
  'replace(../)':             new Set(['fs']),
  'parameterized query ($N)': new Set(['sql']),
  'parameterized query (?)':  new Set(['sql']),
  'sanitizeForPrompt':        new Set(['template']),
  'escapePrompt':             new Set(['template']),
  'stripDelimiters':          new Set(['template']),
  'cleanForPrompt':           new Set(['template']),
};

/**
 * Check if a sanitizer is actually sufficient for a given sink category.
 * Returns true if the sanitizer protects against the sink, false if it's
 * a mismatch (e.g., parseInt used to "sanitize" command injection).
 */
export function isSanitizerSufficient(sanitizerName: string, sinkCategory: SinkCategory): boolean {
  const allowed = SANITIZER_SUFFICIENCY[sanitizerName];
  if (!allowed) return false; // Unknown sanitizer — default deny, verify manually
  return allowed.has(sinkCategory);
}

// ── Cross-File Types ─────────────────────────────────────────────────────

export interface CrossFileTaintResult {
  callerFile: string;
  callerFn: string;
  callerLine: number;
  calleeFile: string;
  calleeFn: string;
  taintedArgs: string[];   // Which args are tainted
  sinkInCallee: TaintSink; // The sink reached in the callee
  source: TaintSource;     // Original taint source
}

/** Map of exported function names → file path + param info */
export interface ExportedFunction {
  filePath: string;
  fnName: string;
  params: string;   // Raw params string
  hasSink: boolean;  // Does this function contain a dangerous sink?
  sinks: TaintSink[];
}

// ── Intra-File Call Graph (for interprocedural taint) ────────────────────

/** A function in the file that contains sinks — tracks which params flow to those sinks */
interface InternalSinkFunction {
  name: string;
  /** Parameter indices whose values reach a sink in the function body */
  taintedParamIndices: Set<number>;
  /** Sink categories reachable from each param index (multiple categories per param) */
  sinkCategories: Map<number, Set<TaintSink['category']>>;
}

/**
 * Build a map of internal functions that contain sinks.
 * For each function, determine which parameters flow to sinks.
 * This enables interprocedural taint: processInput(req.body) → exec() is now visible.
 */
function buildInternalSinkMap(sourceFile: SourceFile): Map<string, InternalSinkFunction> {
  const sinkMap = new Map<string, InternalSinkFunction>();

  const allFns: Array<{ name: string; node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration }> = [];
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
    body.forEachDescendant(n => { if (n.getKindName() === 'CallExpression') calls.push(n as import('ts-morph').CallExpression); });

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
          if (argText === paramName || argText.startsWith(paramName + '.') || argText.startsWith(paramName + '[')) {
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
              if (exprText === paramName || exprText.startsWith(paramName + '.')) {
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

// ── Main Analysis ────────────────────────────────────────────────────────

/**
 * Run taint analysis on all fn nodes in inferred results.
 * When sourceFile is provided, uses AST-based analysis (more accurate).
 * Falls back to regex-based analysis when no SourceFile available.
 */
export function analyzeTaint(inferred: InferResult[], filePath: string, sourceFile?: SourceFile): TaintResult[] {
  // Use AST-based analysis when SourceFile is available
  if (sourceFile) {
    return analyzeTaintAST(inferred, filePath, sourceFile);
  }
  return analyzeTaintRegex(inferred, filePath);
}

/**
 * AST-based taint analysis — walks real ts-morph AST nodes instead of regex on strings.
 * Handles destructuring, method chains, computed property access.
 */
function analyzeTaintAST(inferred: InferResult[], filePath: string, sourceFile: SourceFile): TaintResult[] {
  const results: TaintResult[] = [];

  // Build intra-file call graph: which internal functions contain sinks?
  const internalSinkMap = buildInternalSinkMap(sourceFile);

  // Collect all function-like AST nodes from the SourceFile
  const allFns: Array<{ node: FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration; startLine: number }> = [];
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

    const taintedNames = new Set(taintedParams.map(p => p.name));
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
    body.forEachDescendant(n => { if (n.getKindName() === 'CallExpression') calls.push(n as import('ts-morph').CallExpression); });
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
      const templateArgs = call.getArguments().filter(a => {
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
      const sanitizer = foundSanitizers.find(s => {
        for (const sv of s.sanitizedVars) {
          if (sv === sink.taintedArg) return true;
          // Sanitized path is a prefix → covers all sub-properties
          if (sink.taintedArg.startsWith(sv + '.')) return true;
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

/** Find the first tainted identifier in an expression tree */
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

function findTaintedIdentifier(expr: Node, taintedNames: Set<string>): string | undefined {
  const k = expr.getKindName();
  if (k === 'Identifier' && taintedNames.has(expr.getText())) return expr.getText();
  if (k === 'PropertyAccessExpression') {
    return findTaintedIdentifier((expr as any).getExpression(), taintedNames);
  }
  // Check binary expressions (string concatenation: 'cmd ' + userInput)
  if (k === 'BinaryExpression') {
    return findTaintedIdentifier((expr as any).getLeft(), taintedNames) || findTaintedIdentifier((expr as any).getRight(), taintedNames);
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
  body.forEachDescendant(n => { if (n.getKindName() === 'CallExpression') allCalls.push(n as import('ts-morph').CallExpression); });
  for (const call of allCalls) {
    const calleeName = getCalleeBaseName(call);
    const matchedSanitizer = SANITIZER_PATTERN_NAMES.find(s => calleeName.includes(s));
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

// Sink name → category lookup (flat map from SINK_PATTERNS)
const SINK_NAMES = new Map<string, TaintSink['category']>([
  ['exec', 'command'], ['execSync', 'command'], ['spawn', 'command'],
  ['spawnSync', 'command'], ['execFile', 'command'], ['execFileSync', 'command'],
  ['readFile', 'fs'], ['readFileSync', 'fs'],
  ['writeFile', 'fs'], ['writeFileSync', 'fs'], ['createWriteStream', 'fs'], ['createReadStream', 'fs'],
  ['unlink', 'fs'], ['unlinkSync', 'fs'],
  ['query', 'sql'], ['$execute', 'sql'], ['raw', 'sql'],
  ['$queryRaw', 'sql'], ['$queryRawUnsafe', 'sql'],
  ['redirect', 'redirect'],
  ['eval', 'eval'], ['Function', 'eval'],
]);

// Sanitizer names to detect (from SANITIZER_PATTERNS)
const SANITIZER_PATTERN_NAMES = [
  'parseInt', 'parseFloat', 'Number', 'Boolean', 'String',
  'encodeURI', 'encodeURIComponent', 'escape',
  'sanitize', 'DOMPurify', 'purify', 'xss',
  'escapeHtml', 'sqlstring', 'parameterized',
  'parse', 'safeParse', 'validate',
];

/**
 * Regex-based taint analysis — legacy fallback for when no SourceFile is available.
 */
function analyzeTaintRegex(inferred: InferResult[], filePath: string): TaintResult[] {
  const results: TaintResult[] = [];

  for (const r of inferred) {
    if (r.node.type !== 'fn') continue;

    const fnName = (r.node.props?.name as string) || 'anonymous';
    const paramsStr = (r.node.props?.params as string) || '';

    // Get handler body
    const handler = r.node.children?.find(c => c.type === 'handler');
    const code = (handler?.props?.code as string) || '';
    if (!code) continue;

    // Step 1: Classify params as tainted
    const taintedParams = classifyParams(paramsStr);
    if (taintedParams.length === 0) continue;

    // Step 2: Propagate taint through assignments
    const taintedVars = propagateTaint(code, taintedParams);

    // Step 3: Find sinks that use tainted variables
    const sinks = findTaintedSinks(code, taintedVars);
    if (sinks.length === 0) continue;

    // Step 4: Check for sanitizers
    const paths = buildPaths(code, taintedVars, sinks);

    if (paths.length > 0) {
      results.push({
        fnName,
        filePath,
        startLine: r.startLine,
        paths,
      });
    }
  }

  return results;
}

/**
 * Classify function parameters as tainted or safe.
 */
function classifyParams(paramsStr: string): TaintSource[] {
  const sources: TaintSource[] = [];
  if (!paramsStr) return sources;

  const params = paramsStr.split(',').map(p => {
    const parts = p.trim().split(':');
    return { name: parts[0]?.trim(), type: parts[1]?.trim() || '' };
  });

  for (const p of params) {
    if (!p.name) continue;
    if (HTTP_PARAM_NAMES.test(p.name) || HTTP_PARAM_TYPES.test(p.type)) {
      sources.push({ name: p.name, origin: `${p.name} (HTTP input)` });
    }
  }

  return sources;
}

/**
 * Multi-hop taint propagation using worklist algorithm.
 * Propagates until fixed point or configurable depth limit.
 * 
 * Handles all assignment patterns:
 * - const b = a
 * - const b = a.trim()
 * - const {x} = obj
 * - let b; b = a
 * 
 * @param code - Handler code string
 * @param initialTainted - Set of initially tainted variable names
 * @param maxDepth - Maximum propagation depth (default: 3)
 * @returns Set of all tainted variable names after fixed point or depth limit
 */
export function propagateTaintMultiHop(
  code: string,
  initialTainted: Set<string>,
  maxDepth: number = 3,
): Set<string> {
  const tainted = new Set<string>(initialTainted);
  const worklist: Array<{ varName: string; depth: number }> = [];
  const visitedAssignments = new Set<string>();
  const assignmentDepths = new Map<string, number>();

  for (const v of initialTainted) {
    worklist.push({ varName: v, depth: 0 });
  }

  const allAssignments = extractAllAssignments(code);

  while (worklist.length > 0) {
    const { varName: currentVar, depth } = worklist.shift()!;

    if (depth >= maxDepth) continue;

    for (const assignment of allAssignments) {
      const { lhs, rhs, assignId } = assignment;

      if (visitedAssignments.has(`${assignId}:${depth}`)) continue;

      const rhsDeps = extractDependencies(rhs);

      if (rhsDeps.has(currentVar)) {
        visitedAssignments.add(`${assignId}:${depth}`);

        const existingDepth = assignmentDepths.get(lhs);
        if (existingDepth !== undefined && existingDepth <= depth + 1) {
          continue;
        }
        assignmentDepths.set(lhs, depth + 1);

        if (!tainted.has(lhs)) {
          tainted.add(lhs);
          worklist.push({ varName: lhs, depth: depth + 1 });
        }

        if (isCircularAssignment(lhs, rhs, allAssignments)) {
          continue;
        }

        for (const dep of rhsDeps) {
          if (dep !== currentVar && tainted.has(dep)) {
            const depDepth = assignmentDepths.get(dep) ?? 0;
            if (depth + 1 > depDepth) {
              if (!tainted.has(lhs)) {
                tainted.add(lhs);
                worklist.push({ varName: lhs, depth: depth + 1 });
              }
            }
          }
        }
      }
    }
  }

  return tainted;
}

interface Assignment {
  lhs: string;
  rhs: string;
  assignId: string;
}

function extractAllAssignments(code: string): Assignment[] {
  const assignments: Assignment[] = [];

  const lines = code.split('\n');
  let assignCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const assign of parseLineAssignments(trimmed, assignCounter)) {
      assignments.push(assign);
      assignCounter++;
    }
  }

  return assignments;
}

function parseLineAssignments(line: string, lineNum: number): Assignment[] {
  const assignments: Assignment[] = [];

  const constLetVarRegex = /^(?:const|let|var)\s+/;
  const declMatch = line.match(constLetVarRegex);
  if (!declMatch) {
    const reassignRegex = /^(\w+)\s*=\s*(.+)$/;
    const reassign = line.match(reassignRegex);
    if (reassign) {
      assignments.push({
        lhs: reassign[1],
        rhs: reassign[2],
        assignId: `${lineNum}:reassign`,
      });
    }
    return assignments;
  }

  const rest = line.slice(declMatch[0].length);

  const destructRegex = /^\{\s*([^}]+)\}\s*=\s*(.+)$/;
  const destructMatch = rest.match(destructRegex);
  if (destructMatch) {
    const vars = destructMatch[1].split(',').map(v => {
      const name = v.trim().split(':')[0].split('=')[0].trim();
      return name;
    }).filter(v => v && !v.startsWith('...'));
    const rhs = destructMatch[2];
    for (let i = 0; i < vars.length; i++) {
      assignments.push({
        lhs: vars[i],
        rhs: `${rhs}[${i}]`,
        assignId: `${lineNum}:destructure:${i}`,
      });
    }
    return assignments;
  }

  const simpleAssignRegex = /^(\w+)\s*=\s*(.+)$/;
  const simpleMatch = rest.match(simpleAssignRegex);
  if (simpleMatch) {
    assignments.push({
      lhs: simpleMatch[1],
      rhs: simpleMatch[2],
      assignId: `${lineNum}:simple`,
    });
  }

  return assignments;
}

function extractDependencies(rhs: string): Set<string> {
  const deps = new Set<string>();
  const RESERVED = new Set(['undefined', 'null', 'true', 'false', 'const', 'let', 'var', 'new', 'typeof', 'instanceof', 'return', 'await', 'async', 'function', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally']);

  // Match all identifier chains: foo, foo.bar, foo.bar.baz, foo[0].bar
  const chainRegex = /\b([a-zA-Z_$]\w*)(?:\.\w+|\[[^\]]*\])*/g;
  let match;
  while ((match = chainRegex.exec(rhs)) !== null) {
    const base = match[1];
    if (!RESERVED.has(base) && !/^\d/.test(base)) {
      deps.add(base);
    }
  }

  return deps;
}

function isCircularAssignment(lhs: string, rhs: string, allAssignments: Assignment[]): boolean {
  const rhsDeps = extractDependencies(rhs);
  const visited = new Set<string>();
  const stack = [...rhsDeps];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === lhs) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const assign of allAssignments) {
      if (assign.lhs === current) {
        const deps = extractDependencies(assign.rhs);
        for (const dep of deps) {
          if (!visited.has(dep)) {
            stack.push(dep);
          }
        }
      }
    }
  }

  return false;
}

/**
 * Propagate taint through variable assignments in handler body.
 * Tracks: const x = req.body.foo → x is tainted.
 * Returns all tainted variable names with their origins.
 */
function propagateTaint(code: string, params: TaintSource[]): TaintSource[] {
  const tainted = new Map<string, TaintSource>();

  for (const p of params) {
    tainted.set(p.name, p);
  }

  const initialTainted = new Set(tainted.keys());
  const propagated = propagateTaintMultiHop(code, initialTainted);

  for (const v of propagated) {
    if (!tainted.has(v)) {
      tainted.set(v, { name: v, origin: `derived` });
    }
  }

  return Array.from(tainted.values());
}

/**
 * Find sink calls that use tainted variables.
 */
function findTaintedSinks(code: string, taintedVars: TaintSource[]): TaintSink[] {
  const sinks: TaintSink[] = [];
  const taintedNames = new Set(taintedVars.map(v => v.name));

  for (const { pattern, name, category } of SINK_PATTERNS) {
    // Scan ALL matches using a global copy (original patterns are non-global)
    const globalPattern = new RegExp(pattern.source, 'g');
    let match;
    while ((match = globalPattern.exec(code)) !== null) {
      // Extract the argument region after the match
      const callStart = match.index + match[0].length;
      const parenDepth = findClosingParen(code, callStart);
      const argText = code.slice(callStart, parenDepth);

      // Check if any tainted variable is used in the arguments
      for (const tName of taintedNames) {
        if (new RegExp(`\\b${tName}\\b`).test(argText)) {
          sinks.push({ name, category, taintedArg: tName });
          break;
        }
      }

      // Also check for template literals with tainted vars in any sink category
      const templateMatch = argText.match(/`[^`]*\$\{(\w+)\}[^`]*`/);
      if (templateMatch && taintedNames.has(templateMatch[1])) {
        sinks.push({ name: `${name} (template)`, category, taintedArg: templateMatch[1] });
      }
    }
  }

  // Check template literals used in exec/spawn-like contexts
  const templateExecRegex = /`[^`]*\$\{(\w+)\}[^`]*`/g;
  let tm;
  while ((tm = templateExecRegex.exec(code)) !== null) {
    if (taintedNames.has(tm[1])) {
      // Check if this template is used as argument to a command-like function
      const before = code.slice(Math.max(0, tm.index - 50), tm.index);
      if (/exec\s*\(|spawn\s*\(|execSync\s*\(/.test(before)) {
        // Already caught by SINK_PATTERNS, skip duplicate
        continue;
      }
    }
  }

  return sinks;
}

/**
 * Build taint paths and check for sanitizers between source and sink.
 */
function buildPaths(code: string, taintedVars: TaintSource[], sinks: TaintSink[]): TaintPath[] {
  const paths: TaintPath[] = [];
  const foundSanitizers = detectSanitizers(code);

  for (const sink of sinks) {
    // Find the source that produced this tainted arg
    const source = taintedVars.find(v => v.name === sink.taintedArg);
    if (!source) continue;

    // Check if any sanitizer was applied to this specific variable
    const sanitizer = foundSanitizers.find(s =>
      new RegExp(`\\b${sink.taintedArg}\\b`).test(s.context) ||
      new RegExp(`${s.name}\\s*\\([^)]*\\b${sink.taintedArg}\\b`).test(code)
    );

    // Check sanitizer sufficiency — is this the RIGHT sanitizer for this sink?
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

  return paths;
}

function detectSanitizers(code: string): Array<{ name: string; context: string }> {
  const found: Array<{ name: string; context: string }> = [];

  for (const { pattern, name } of SANITIZER_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'g');
    let match;
    while ((match = globalPattern.exec(code)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(code.length, match.index + match[0].length + 50);
      found.push({ name, context: code.slice(start, end) });
    }
  }

  return found;
}

function findClosingParen(code: string, start: number): number {
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '(') depth++;
    if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return Math.min(start + 500, code.length); // fallback
}

// ── Finding Generator ────────────────────────────────────────────────────

/**
 * Convert taint results into ReviewFinding[] for the unified pipeline.
 */
export function taintToFindings(results: TaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const categoryLabels: Record<TaintSink['category'], string> = {
    command: 'command injection',
    fs: 'path traversal / file write',
    sql: 'SQL injection',
    redirect: 'open redirect',
    eval: 'code injection',
    template: 'template injection',
  };

  for (const r of results) {
    // Report unsanitized paths AND insufficient sanitizer paths
    const reportable = r.paths.filter(p => !p.sanitized);
    if (reportable.length === 0) continue;

    for (const path of reportable) {
      const severity = path.sink.category === 'command' || path.sink.category === 'eval'
        ? 'error' as const
        : 'warning' as const;

      const primarySpan: SourceSpan = {
        file: r.filePath,
        startLine: r.startLine,
        startCol: 1,
        endLine: r.startLine,
        endCol: 1,
      };

      if (path.insufficientSanitizer) {
        // Sanitizer present but wrong for this sink type
        findings.push({
          source: 'kern',
          ruleId: `taint-insufficient-sanitizer`,
          severity,
          category: 'bug',
          message: `Insufficient sanitizer: '${path.insufficientSanitizer}' does not protect against ${categoryLabels[path.sink.category]}. ` +
            `${path.source.origin} → ${path.sink.name}() is still exploitable.`,
          primarySpan,
          suggestion: `${path.insufficientSanitizer} is not sufficient for ${path.sink.category} sinks. ${getSuggestion(path.sink.category)}`,
          fingerprint: createFingerprint(`taint-insufficient`, r.startLine, 1),
        });
      } else {
        // No sanitizer at all
        findings.push({
          source: 'kern',
          ruleId: `taint-${path.sink.category}`,
          severity,
          category: 'bug',
          message: `Taint flow: ${path.source.origin} → ${path.sink.name}() — potential ${categoryLabels[path.sink.category]}. ` +
            `Variable '${path.sink.taintedArg}' reaches dangerous sink without sanitization.`,
          primarySpan,
          suggestion: getSuggestion(path.sink.category),
          fingerprint: createFingerprint(`taint-${path.sink.category}`, r.startLine, 1),
        });
      }
    }
  }

  return findings;
}

function getSuggestion(category: TaintSink['category']): string {
  switch (category) {
    case 'command': return 'Use spawn() with array arguments, or validate/escape input before passing to exec()';
    case 'fs': return 'Use path.resolve() + path.normalize() and verify the result stays within allowed directory';
    case 'sql': return 'Use parameterized queries ($1, ?) instead of string interpolation';
    case 'redirect': return 'Validate redirect URL against an allowlist of safe destinations';
    case 'eval': return 'Never pass user input to eval() or new Function() — use safe alternatives';
    case 'template': return 'Sanitize user input before embedding in templates';
  }
}

// ── Cross-File Taint Analysis ────────────────────────────────────────────

/**
 * Build a map of exported functions across all files.
 * Maps "filePath::fnName" → ExportedFunction with sink info.
 */
export function buildExportMap(
  inferredPerFile: Map<string, InferResult[]>,
): Map<string, ExportedFunction> {
  const exportMap = new Map<string, ExportedFunction>();

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;
      const fnName = (r.node.props?.name as string) || '';
      if (!fnName) continue;

      // Check if function is exported (absence of export='false' means exported)
      const isExported = r.node.props?.export !== 'false';
      if (!isExported) continue;

      const params = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';

      // Check if the function body contains dangerous sinks
      const sinks: TaintSink[] = [];
      if (code) {
        const dummyTaint: TaintSource[] = [];
        // Parse params to get variable names for sink detection
        const paramNames = params.split(',').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
        for (const name of paramNames) {
          dummyTaint.push({ name, origin: `param:${name}` });
        }
        if (dummyTaint.length > 0) {
          sinks.push(...findTaintedSinks(code, dummyTaint));
        }
      }

      exportMap.set(`${filePath}::${fnName}`, {
        filePath,
        fnName,
        params,
        hasSink: sinks.length > 0,
        sinks,
      });
    }
  }

  return exportMap;
}

/**
 * Build import→function resolution map.
 * Maps "importingFile::importedName" → absolute file path of the definition.
 */
export function buildImportMap(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>,  // filePath → [resolved import paths]
): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const [filePath, inferred] of inferredPerFile) {
    const resolvedImports = graphImports.get(filePath) || [];

    for (const r of inferred) {
      if (r.node.type !== 'import') continue;
      const from = (r.node.props?.from as string) || '';
      const names = (r.node.props?.names as string) || '';
      const defaultImport = (r.node.props?.default as string) || '';

      if (!from) continue;

      // Find the resolved path for this import specifier
      const resolvedPath = resolvedImports.find(p =>
        p.includes(from.replace(/^\.\//, '').replace(/\.(js|ts|tsx)$/, ''))
      );
      if (!resolvedPath) continue;

      // Map each imported name to its resolved file
      if (names) {
        for (const name of names.split(',').map(n => n.trim())) {
          if (name) importMap.set(`${filePath}::${name}`, resolvedPath);
        }
      }
      if (defaultImport) {
        importMap.set(`${filePath}::${defaultImport}`, resolvedPath);
      }
    }
  }

  return importMap;
}

/**
 * Cross-file taint analysis.
 *
 * For each handler function with tainted params:
 *   1. Find calls to imported functions in the handler body
 *   2. Check if tainted data is passed as an argument
 *   3. Look up the target function — does it have a dangerous sink?
 *   4. If yes and no sanitizer in between → cross-file taint path
 */
export function analyzeTaintCrossFile(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>,
): CrossFileTaintResult[] {
  const exportMap = buildExportMap(inferredPerFile);
  const importMap = buildImportMap(inferredPerFile, graphImports);
  const results: CrossFileTaintResult[] = [];

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;

      const fnName = (r.node.props?.name as string) || 'anonymous';
      const paramsStr = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';
      if (!code) continue;

      // Only analyze functions with tainted params
      const taintedParams = classifyParams(paramsStr);
      if (taintedParams.length === 0) continue;

      const taintedVars = propagateTaint(code, taintedParams);
      const taintedNames = new Set(taintedVars.map(v => v.name));

      // Find calls to imported functions: importedFn(taintedVar)
      const callRegex = /\b(\w+)\s*\(/g;
      let callMatch;
      while ((callMatch = callRegex.exec(code)) !== null) {
        const calledFn = callMatch[0].replace(/\s*\($/, '');

        // Is this an imported function?
        const resolvedFile = importMap.get(`${filePath}::${calledFn}`);
        if (!resolvedFile) continue;

        // Does the target have dangerous sinks?
        const targetFn = exportMap.get(`${resolvedFile}::${calledFn}`);
        if (!targetFn || !targetFn.hasSink) continue;

        // Extract arguments passed to this call
        const callStart = callMatch.index + callMatch[0].length;
        const parenEnd = findClosingParen(code, callStart);
        const argText = code.slice(callStart, parenEnd);

        // Check if any tainted variable is passed as argument
        const taintedArgs: string[] = [];
        for (const tName of taintedNames) {
          if (new RegExp(`\\b${tName}\\b`).test(argText)) {
            taintedArgs.push(tName);
          }
        }

        if (taintedArgs.length === 0) continue;

        // Check for sanitizers between the taint and the call
        const beforeCall = code.slice(0, callMatch.index);
        const foundSanitizers = detectSanitizers(beforeCall);
        const hasSanitizer = taintedArgs.some(arg =>
          foundSanitizers.some(s =>
            new RegExp(`\\b${arg}\\b`).test(s.context)
          )
        );

        if (hasSanitizer) continue; // Sanitized before passing to callee

        // Found cross-file taint path
        for (const sink of targetFn.sinks) {
          const source = taintedVars.find(v => taintedArgs.includes(v.name));
          if (!source) continue;

          results.push({
            callerFile: filePath,
            callerFn: fnName,
            callerLine: r.startLine,
            calleeFile: resolvedFile,
            calleeFn: calledFn,
            taintedArgs,
            sinkInCallee: sink,
            source,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Convert cross-file taint results into ReviewFinding[].
 */
export function crossFileTaintToFindings(results: CrossFileTaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const categoryLabels: Record<TaintSink['category'], string> = {
    command: 'command injection',
    fs: 'path traversal / file write',
    sql: 'SQL injection',
    redirect: 'open redirect',
    eval: 'code injection',
    template: 'template injection',
  };

  for (const r of results) {
    const severity = r.sinkInCallee.category === 'command' || r.sinkInCallee.category === 'eval'
      ? 'error' as const
      : 'warning' as const;

    findings.push({
      source: 'kern',
      ruleId: `taint-crossfile-${r.sinkInCallee.category}`,
      severity,
      category: 'bug',
      message: `Cross-file taint: ${r.source.origin} in ${r.callerFn}() → ${r.calleeFn}() → ${r.sinkInCallee.name}(). ` +
        `Tainted data crosses file boundary to reach ${categoryLabels[r.sinkInCallee.category]} sink.`,
      primarySpan: {
        file: r.callerFile,
        startLine: r.callerLine,
        startCol: 1,
        endLine: r.callerLine,
        endCol: 1,
      },
      relatedSpans: [{
        file: r.calleeFile,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 1,
      }],
      suggestion: `Validate '${r.taintedArgs.join(', ')}' before passing to ${r.calleeFn}(). ${getSuggestion(r.sinkInCallee.category)}`,
      fingerprint: createFingerprint(`taint-xfile-${r.sinkInCallee.category}`, r.callerLine, 1),
    });
  }

  return findings;
}
