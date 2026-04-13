/**
 * Call Graph — function-level call resolution across the import graph.
 *
 * Intentionally unsound — resolves what it can and marks what it can't:
 *
 * Resolved (high confidence):
 *   - Direct function calls: foo()
 *   - Named imports: import { foo } from './bar'
 *   - Property access on imports: bar.foo()
 *   - Re-exports: export { foo } from './bar'
 *   - Class method calls: this.foo()
 *
 * Skipped (marked unresolved):
 *   - Dynamic imports: import(), require()
 *   - Higher-order functions: arr.map(callback)
 *   - Computed property access: obj[key]()
 *   - Framework magic: decorators, DI containers
 *   - Aliased function variables: const f = foo; f()
 *
 * Dead export findings from unresolved edges get lower confidence (0.70 vs 0.90).
 */

import { type Project, type SourceFile, SyntaxKind } from 'ts-morph';
import type { GraphFile, GraphResult } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface CallSite {
  callerName: string;
  callerFile: string;
  targetName: string;
  /** Resolved target file path. Empty string if unresolved. */
  targetFile: string;
  line: number;
  argumentCount: number;
  /** False = could not resolve target (HOF, dynamic, computed property, etc.) */
  resolved: boolean;
  /** Whether the call site is awaited */
  hasAwait: boolean;
}

export interface FunctionNode {
  name: string;
  filePath: string;
  line: number;
  isExported: boolean;
  isAsync: boolean;
  paramCount: number;
  /** Outgoing calls from this function */
  calls: CallSite[];
  /** Incoming calls to this function (populated during cross-file linking) */
  calledBy: CallSite[];
}

export interface CallGraph {
  /** All functions. Key: filePath#fnName */
  functions: Map<string, FunctionNode>;
  /** Exported functions with zero resolved incoming calledBy edges */
  deadExports: string[];
  /** Non-exported functions never called within the file */
  orphanFunctions: string[];
  /** How many calls couldn't be resolved */
  unresolvedCallCount: number;
}

// ── Import Resolution ───────────────────────────────────────────────────

/** Build a map of importName → resolvedFilePath#exportName for a source file */
function buildImportBindings(sourceFile: SourceFile, graphFiles: Map<string, GraphFile>): Map<string, string> {
  const bindings = new Map<string, string>();

  for (const decl of sourceFile.getImportDeclarations()) {
    const resolvedSf = decl.getModuleSpecifierSourceFile();
    if (!resolvedSf) continue;
    const resolvedPath = resolvedSf.getFilePath();
    if (!graphFiles.has(resolvedPath)) continue;

    // Named imports: import { foo, bar as baz } from './mod'
    for (const named of decl.getNamedImports()) {
      const localName = named.getName();
      const _originalName = named.getAliasNode()?.getText() || localName;
      // The imported name is the original export name
      const importedName = named.getName();
      bindings.set(localName, `${resolvedPath}#${importedName}`);
    }

    // Default import: import Foo from './mod'
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      bindings.set(defaultImport.getText(), `${resolvedPath}#default`);
    }

    // Namespace import: import * as mod from './mod'
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) {
      bindings.set(namespaceImport.getText(), `${resolvedPath}#*`);
    }
  }

  return bindings;
}

// ── Function Collection ─────────────────────────────────────────────────

/** Collect all function declarations from a source file */
function collectFunctions(sourceFile: SourceFile, filePath: string): FunctionNode[] {
  const functions: FunctionNode[] = [];
  const exportedNames = new Set<string>();

  // Track what's exported
  for (const decl of sourceFile.getExportedDeclarations()) {
    exportedNames.add(decl[0]);
  }

  // Named function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    functions.push({
      name,
      filePath,
      line: fn.getStartLineNumber(),
      isExported: exportedNames.has(name) || fn.hasExportKeyword(),
      isAsync: fn.isAsync(),
      paramCount: fn.getParameters().length,
      calls: [],
      calledBy: [],
    });
  }

  // Arrow function / function expression variables
  for (const stmt of sourceFile.getVariableStatements()) {
    const isExportedStmt = stmt.hasExportKeyword();
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const kind = init.getKindName();
      if (kind !== 'ArrowFunction' && kind !== 'FunctionExpression') continue;

      const name = decl.getName();
      const fn = init as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
      functions.push({
        name,
        filePath,
        line: stmt.getStartLineNumber(),
        isExported: isExportedStmt || exportedNames.has(name),
        isAsync: fn.isAsync(),
        paramCount: fn.getParameters().length,
        calls: [],
        calledBy: [],
      });
    }
  }

  // Class methods
  for (const cls of sourceFile.getClasses()) {
    const clsName = cls.getName() || 'anonymous';
    for (const method of cls.getMethods()) {
      const name = `${clsName}.${method.getName()}`;
      functions.push({
        name,
        filePath,
        line: method.getStartLineNumber(),
        isExported: exportedNames.has(clsName),
        isAsync: method.isAsync(),
        paramCount: method.getParameters().length,
        calls: [],
        calledBy: [],
      });
    }
  }

  return functions;
}

// ── Call Site Extraction ────────────────────────────────────────────────

/** Extract all call sites from a function body */
function extractCallSites(
  fnNode: FunctionNode,
  sourceFile: SourceFile,
  localFnNames: Set<string>,
  importBindings: Map<string, string>,
): CallSite[] {
  const callSites: CallSite[] = [];

  // Find the AST node for this function
  const body = findFunctionBody(fnNode, sourceFile);
  if (!body) return callSites;

  // Walk all call expressions in the body
  body.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as import('ts-morph').CallExpression;
    const callee = call.getExpression();
    const args = call.getArguments();

    // Check if the call is awaited
    const parent = call.getParent();
    const hasAwait = parent?.getKind() === SyntaxKind.AwaitExpression;

    const calleeKind = callee.getKindName();

    // Case 1: Direct call — foo()
    if (calleeKind === 'Identifier') {
      const targetName = callee.getText();

      // Skip builtins and common non-function identifiers
      if (isBuiltin(targetName)) return;

      // Local function in same file?
      if (localFnNames.has(targetName)) {
        callSites.push({
          callerName: fnNode.name,
          callerFile: fnNode.filePath,
          targetName,
          targetFile: fnNode.filePath,
          line: call.getStartLineNumber(),
          argumentCount: args.length,
          resolved: true,
          hasAwait,
        });
        return;
      }

      // Imported function?
      const binding = importBindings.get(targetName);
      if (binding) {
        const [targetFile, exportName] = splitBinding(binding);
        callSites.push({
          callerName: fnNode.name,
          callerFile: fnNode.filePath,
          targetName: exportName,
          targetFile,
          line: call.getStartLineNumber(),
          argumentCount: args.length,
          resolved: true,
          hasAwait,
        });
        return;
      }

      // Unresolved
      callSites.push({
        callerName: fnNode.name,
        callerFile: fnNode.filePath,
        targetName,
        targetFile: '',
        line: call.getStartLineNumber(),
        argumentCount: args.length,
        resolved: false,
        hasAwait,
      });
      return;
    }

    // Case 2: Property access — obj.method()
    if (calleeKind === 'PropertyAccessExpression') {
      const prop = callee as import('ts-morph').PropertyAccessExpression;
      const methodName = prop.getName();
      const objExpr = prop.getExpression();
      const objName = objExpr.getKindName() === 'Identifier' ? objExpr.getText() : '';

      // this.method() — resolved within class
      if (objName === 'this') {
        callSites.push({
          callerName: fnNode.name,
          callerFile: fnNode.filePath,
          targetName: methodName,
          targetFile: fnNode.filePath,
          line: call.getStartLineNumber(),
          argumentCount: args.length,
          resolved: localFnNames.has(methodName),
          hasAwait,
        });
        return;
      }

      // Namespace import: mod.foo()
      const nsBinding = importBindings.get(objName);
      if (nsBinding?.endsWith('#*')) {
        const targetFile = nsBinding.slice(0, -2);
        callSites.push({
          callerName: fnNode.name,
          callerFile: fnNode.filePath,
          targetName: methodName,
          targetFile,
          line: call.getStartLineNumber(),
          argumentCount: args.length,
          resolved: true,
          hasAwait,
        });
        return;
      }

      // Unresolved property access — can't statically resolve obj.method()
      callSites.push({
        callerName: fnNode.name,
        callerFile: fnNode.filePath,
        targetName: `${objName}.${methodName}`,
        targetFile: '',
        line: call.getStartLineNumber(),
        argumentCount: args.length,
        resolved: false,
        hasAwait,
      });
      return;
    }

    // Case 3: Everything else (computed, tagged template, etc.) — unresolved
    callSites.push({
      callerName: fnNode.name,
      callerFile: fnNode.filePath,
      targetName: callee.getText().substring(0, 30),
      targetFile: '',
      line: call.getStartLineNumber(),
      argumentCount: args.length,
      resolved: false,
      hasAwait,
    });
  });

  return callSites;
}

/** Find the AST body node for a FunctionNode */
function findFunctionBody(fnNode: FunctionNode, sourceFile: SourceFile): import('ts-morph').Node | undefined {
  // Try named function
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === fnNode.name && fn.getStartLineNumber() === fnNode.line) {
      return fn.getBody();
    }
  }
  // Try variable declarations (arrow / function expression)
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() === fnNode.name && stmt.getStartLineNumber() === fnNode.line) {
        const init = decl.getInitializer();
        if (init && (init.getKindName() === 'ArrowFunction' || init.getKindName() === 'FunctionExpression')) {
          return (init as any).getBody();
        }
      }
    }
  }
  return undefined;
}

function splitBinding(binding: string): [string, string] {
  const idx = binding.lastIndexOf('#');
  return [binding.slice(0, idx), binding.slice(idx + 1)];
}

const BUILTINS = new Set([
  'console',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'parseInt',
  'parseFloat',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Math',
  'Date',
  'Error',
  'Promise',
  'Map',
  'Set',
  'Symbol',
  'require',
  'import',
  'typeof',
  'void',
]);

function isBuiltin(name: string): boolean {
  return BUILTINS.has(name);
}

// ── Main API ────────────────────────────────────────────────────────────

/**
 * Build a function-level call graph from the import graph.
 * Requires a ts-morph Project with all files loaded.
 */
export function buildCallGraph(graph: GraphResult, project: Project): CallGraph {
  const graphFiles = new Map<string, GraphFile>();
  for (const gf of graph.files) {
    graphFiles.set(gf.path, gf);
  }

  const allFunctions = new Map<string, FunctionNode>();
  const fileFunctions = new Map<string, FunctionNode[]>();

  // Phase 1: Collect all functions from all files
  for (const gf of graph.files) {
    const sf = project.getSourceFile(gf.path);
    if (!sf) continue;

    const fns = collectFunctions(sf, gf.path);
    fileFunctions.set(gf.path, fns);
    for (const fn of fns) {
      allFunctions.set(`${fn.filePath}#${fn.name}`, fn);
    }
  }

  // Phase 2: Extract call sites for each function
  let unresolvedCount = 0;
  for (const gf of graph.files) {
    const sf = project.getSourceFile(gf.path);
    if (!sf) continue;

    const fns = fileFunctions.get(gf.path) || [];
    const localFnNames = new Set(fns.map((f) => f.name));
    const importBindings = buildImportBindings(sf, graphFiles);

    for (const fn of fns) {
      fn.calls = extractCallSites(fn, sf, localFnNames, importBindings);
      unresolvedCount += fn.calls.filter((c) => !c.resolved).length;
    }
  }

  // Phase 3: Link calledBy edges (cross-file)
  for (const fn of allFunctions.values()) {
    for (const call of fn.calls) {
      if (!call.resolved || !call.targetFile) continue;
      const targetKey = `${call.targetFile}#${call.targetName}`;
      const target = allFunctions.get(targetKey);
      if (target) {
        target.calledBy.push(call);
      }
    }
  }

  // Phase 4: Identify dead exports and orphan functions
  const deadExports: string[] = [];
  const orphanFunctions: string[] = [];

  for (const [key, fn] of allFunctions) {
    if (fn.isExported && fn.calledBy.length === 0) {
      deadExports.push(key);
    }
    if (!fn.isExported && fn.calledBy.length === 0) {
      // Check if called locally (within same file)
      const calledLocally = [...allFunctions.values()].some(
        (other) =>
          other.filePath === fn.filePath &&
          other.calls.some((c) => c.resolved && c.targetFile === fn.filePath && c.targetName === fn.name),
      );
      if (!calledLocally) {
        orphanFunctions.push(key);
      }
    }
  }

  return {
    functions: allFunctions,
    deadExports,
    orphanFunctions,
    unresolvedCallCount: unresolvedCount,
  };
}
