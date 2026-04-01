/**
 * TS → .kern Inferrer — scans TypeScript AST and infers KERN IR nodes.
 *
 * Phase 1 (deterministic): type, interface, fn, error, import, const
 * Phase 2 (composite): machine, config, event, module
 *
 * v2: Adds stable nodeId, promptAlias, sourceSpans to InferResult.
 */

import {
  Project,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';
import type { IRNode } from '@kernlang/core';
import { countTokens } from '@kernlang/core';
import type { InferResult, Confidence, SourceSpan } from './types.js';

// ── Create Project ───────────────────────────────────────────────────────

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Walk up from a directory to find the nearest tsconfig.json.
 * Returns the path or undefined if not found.
 */
function findTsConfig(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Create a ts-morph Project for analysis.
 * If startPath is provided, finds the nearest tsconfig.json and uses it
 * for module resolution (paths, references, moduleResolution). This fixes
 * false "Cannot find module" errors in monorepo packages.
 */
export function createProject(startPath?: string): Project {
  const tsConfigFilePath = startPath ? findTsConfig(dirname(startPath)) : undefined;

  if (tsConfigFilePath) {
    return new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true, // Only load files we explicitly add
    });
  }

  // Fallback: no tsconfig found — use strict defaults
  return new Project({
    compilerOptions: { strict: true, target: 99 /* Latest */ },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
}

export function createInMemoryProject(): Project {
  return new Project({
    compilerOptions: { strict: true, target: 99 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

// ── Main Inference Function ──────────────────────────────────────────────

export function inferFromSource(source: string, filePath = 'input.ts'): InferResult[] {
  const project = createInMemoryProject();
  const sourceFile = project.createSourceFile(filePath, source);
  return inferFromSourceFile(sourceFile);
}

export function inferFromFile(filePath: string): InferResult[] {
  const project = createProject(filePath);
  const sourceFile = project.addSourceFileAtPath(filePath);
  return inferFromSourceFile(sourceFile);
}

export function inferFromSourceFile(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  // Phase 1: Deterministic matchers
  results.push(...inferTypes(sourceFile));
  results.push(...inferInterfaces(sourceFile));
  results.push(...inferFunctions(sourceFile));
  results.push(...inferErrors(sourceFile));
  results.push(...inferImports(sourceFile));
  results.push(...inferConsts(sourceFile));
  results.push(...inferExports(sourceFile));

  // Phase 2: Composite patterns
  results.push(...inferMachines(sourceFile, results));
  results.push(...inferConfigs(sourceFile, results));
  results.push(...inferEvents(sourceFile, results));

  // Sort by line number
  results.sort((a, b) => a.startLine - b.startLine);

  // Assign sequential prompt aliases after sorting (stable per file)
  for (let i = 0; i < results.length; i++) {
    results[i].promptAlias = `N${i + 1}`;
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getSpan(sourceFile: SourceFile, startOffset: number, endOffset: number): SourceSpan {
  const filePath = sourceFile.getFilePath() || 'input.ts';
  const startPos = sourceFile.getLineAndColumnAtPos(startOffset);
  const endPos = sourceFile.getLineAndColumnAtPos(endOffset);
  return {
    file: filePath,
    startLine: startPos.line,
    startCol: startPos.column,
    endLine: endPos.line,
    endCol: endPos.column,
  };
}

function makeResult(
  node: IRNode,
  sourceFile: SourceFile,
  startOffset: number,
  endOffset: number,
  startLine: number,
  endLine: number,
  summary: string,
  confidence: Confidence,
  confidencePct: number,
  originalText: string,
): InferResult {
  const filePath = sourceFile.getFilePath() || 'input.ts';
  const name = (node.props?.name as string) || 'anon';
  const nodeId = `${filePath}#${node.type}:${name}@${startOffset}`;

  const kernRepr = serializeKernNode(node);
  const kernTokens = countTokens(kernRepr);
  const tsTokens = countTokens(originalText);

  return {
    node,
    nodeId,
    promptAlias: '', // assigned after sort in inferFromSourceFile
    startLine,
    endLine,
    sourceSpans: [getSpan(sourceFile, startOffset, endOffset)],
    summary,
    confidence,
    confidencePct,
    kernTokens,
    tsTokens,
  };
}

function serializeKernNode(node: IRNode): string {
  const parts: string[] = [node.type];
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (typeof v === 'string') parts.push(`${k}=${v}`);
    }
  }
  if (node.children) {
    for (const child of node.children) {
      parts.push('  ' + serializeKernNode(child));
    }
  }
  return parts.join(' ');
}

// ── Phase 1: Type Aliases ────────────────────────────────────────────────

function inferTypes(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  for (const decl of sourceFile.getTypeAliases()) {
    const name = decl.getName();
    const typeNode = decl.getTypeNode();
    if (!typeNode) continue;

    const text = typeNode.getText();
    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const originalText = decl.getText();
    const startOffset = decl.getStart();
    const endOffset = decl.getEnd();

    // Union of string literals → type name=X values="a|b|c"
    if (typeNode.getKind() === SyntaxKind.UnionType) {
      const unionMembers = text.split('|').map(s => s.trim());
      const allLiterals = unionMembers.every(m => m.startsWith("'") || m.startsWith('"'));

      if (allLiterals) {
        const values = unionMembers.map(m => m.replace(/['"]/g, '')).join('|');
        const node: IRNode = { type: 'type', props: { name, values } };
        results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
          `type ${name} = ${values.split('|').map(v => `'${v}'`).join(' | ')}`,
          'high', 98, originalText));
      } else {
        // Type alias union (non-literal)
        const node: IRNode = { type: 'type', props: { name, alias: text } };
        results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
          `type ${name} = ${text}`,
          'high', 95, originalText));
      }
    } else {
      // Simple type alias
      const node: IRNode = { type: 'type', props: { name, alias: text } };
      results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
        `type ${name} = ${text}`,
        'high', 95, originalText));
    }
  }

  return results;
}

// ── Phase 1: Interfaces ──────────────────────────────────────────────────

function inferInterfaces(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  for (const decl of sourceFile.getInterfaces()) {
    const name = decl.getName();
    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const originalText = decl.getText();
    const startOffset = decl.getStart();
    const endOffset = decl.getEnd();

    const extendsClause = decl.getExtends().map(e => e.getText()).join(', ') || undefined;

    const children: IRNode[] = [];
    for (const prop of decl.getProperties()) {
      const fieldName = prop.getName();
      const fieldType = prop.getType().getText(prop);
      const optional = prop.hasQuestionToken();

      children.push({
        type: 'field',
        props: {
          name: fieldName,
          type: fieldType,
          ...(optional ? { optional: 'true' } : {}),
        },
      });
    }

    const node: IRNode = {
      type: 'interface',
      props: {
        name,
        ...(extendsClause ? { extends: extendsClause } : {}),
      },
      children,
    };

    results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
      `interface ${name} (${children.length} fields)`,
      'high', 97, originalText));
  }

  return results;
}

// ── Phase 1: Functions ───────────────────────────────────────────────────

function inferFunctions(sourceFile: SourceFile): InferResult[] {
  const inferResults: InferResult[] = [];

  // 1. Top-level FunctionDeclarations (original)
  for (const decl of sourceFile.getFunctions()) {
    if (!decl.getName()) continue;
    pushFnResult(inferResults, sourceFile, decl, decl, decl.getName()!, decl.isExported());
  }

  // 2. Arrow functions and function expressions assigned to variables:
  //    const handler = (req, res) => { ... }
  //    export const handler = async (...) => { ... }
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (init.getKind() !== SyntaxKind.ArrowFunction && init.getKind() !== SyntaxKind.FunctionExpression) continue;
      const fn = init as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
      pushFnResult(inferResults, sourceFile, stmt, fn, decl.getName(), stmt.isExported());
    }
  }

  // 3. Class methods
  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName() ?? 'AnonymousClass';
    // Skip Error subclasses — handled by inferErrors
    const extendsExpr = cls.getExtends();
    if (extendsExpr && extendsExpr.getText().includes('Error')) continue;

    for (const method of cls.getMethods()) {
      if (method.isAbstract()) continue;
      pushFnResult(inferResults, sourceFile, method, method, `${className}.${method.getName()}`, false);
    }
  }

  return inferResults;
}

/** Shared helper to emit an fn IR node from any function-like AST node. */
function pushFnResult(
  results: InferResult[],
  sourceFile: SourceFile,
  anchor: import('ts-morph').Node,
  fn: import('ts-morph').FunctionDeclaration | import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression | import('ts-morph').MethodDeclaration,
  name: string,
  isExported: boolean,
): void {
  const params = fn.getParameters()
    .map(p => `${p.getName()}:${p.getType().getText(p)}`)
    .join(',');

  const returnType = fn.getReturnType().getText(fn);
  const isAsync = fn.isAsync();
  const body = fn.getBody();
  let bodyCode = '';
  if (body) {
    const text = body.getText();
    // Block body: strip { } wrapper. Expression body (arrow): wrap in return.
    bodyCode = body.getKind() === SyntaxKind.Block ? text.slice(1, -1).trim() : `return ${text};`;
  }

  const node: IRNode = {
    type: 'fn',
    props: {
      name,
      ...(params ? { params } : {}),
      ...(returnType ? { returns: returnType } : {}),
      ...(isAsync ? { async: 'true' } : {}),
      ...(isExported ? {} : { export: 'false' }),
    },
    children: bodyCode ? [{ type: 'handler', props: { code: bodyCode } }] : [],
  };

  const startLine = anchor.getStartLineNumber();
  const endLine = anchor.getEndLineNumber();

  results.push(makeResult(node, sourceFile, anchor.getStart(), anchor.getEnd(), startLine, endLine,
    `fn ${name}(${params}) → ${returnType}`,
    'high', 95, anchor.getText()));
}

// ── Phase 1: Error Classes ───────────────────────────────────────────────

function inferErrors(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  for (const decl of sourceFile.getClasses()) {
    const name = decl.getName();
    if (!name) continue;

    // Check if extends Error (or any *Error class)
    const extendsExpr = decl.getExtends();
    if (!extendsExpr) continue;
    const baseClass = extendsExpr.getText();
    if (!baseClass.includes('Error')) continue;

    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const originalText = decl.getText();
    const startOffset = decl.getStart();
    const endOffset = decl.getEnd();

    // Extract constructor fields
    const children: IRNode[] = [];
    const ctor = decl.getConstructors()[0];
    if (ctor) {
      for (const param of ctor.getParameters()) {
        const paramName = param.getName();
        const paramType = param.getType().getText(param);
        if (paramName === 'message' && paramType === 'string') {
          children.push({ type: 'field', props: { name: 'message', type: 'string' } });
        } else if (param.isReadonly() || param.hasModifier(SyntaxKind.PublicKeyword)) {
          children.push({ type: 'field', props: { name: paramName, type: paramType } });
        }
      }
    }

    const node: IRNode = {
      type: 'error',
      props: { name, extends: baseClass },
      children,
    };

    results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
      `error ${name} extends ${baseClass}`,
      'high', 96, originalText));
  }

  return results;
}

// ── Phase 1: Imports ─────────────────────────────────────────────────────

function inferImports(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    const from = decl.getModuleSpecifierValue();
    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const originalText = decl.getText();
    const startOffset = decl.getStart();
    const endOffset = decl.getEnd();

    const defaultImport = decl.getDefaultImport()?.getText();
    const namedImports = decl.getNamedImports().map(n => n.getName());
    const isTypeOnly = decl.isTypeOnly();

    const props: Record<string, unknown> = { from };
    if (defaultImport) props.default = defaultImport;
    if (namedImports.length > 0) props.names = namedImports.join(',');
    if (isTypeOnly) props.types = 'true';

    const node: IRNode = { type: 'import', props };

    results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
      `import ${namedImports.length > 0 ? `{ ${namedImports.join(', ')} }` : defaultImport || '*'} from '${from}'`,
      'high', 99, originalText));
  }

  return results;
}

// ── Phase 1: Const Declarations ──────────────────────────────────────────

function inferConsts(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];

  for (const stmt of sourceFile.getVariableStatements()) {
    const isExported = stmt.isExported();
    const startOffset = stmt.getStart();
    const endOffset = stmt.getEnd();

    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      const startLine = stmt.getStartLineNumber();
      const endLine = stmt.getEndLineNumber();
      const originalText = stmt.getText();

      const typeNode = decl.getTypeNode();
      const typeName = typeNode?.getText();
      const initializer = decl.getInitializer()?.getText();

      // Skip if it's a function expression or arrow function
      if (initializer && (
        initializer.startsWith('(') ||
        initializer.startsWith('function') ||
        initializer.startsWith('async') ||
        initializer.includes('=>')
      )) {
        continue;
      }

      const props: Record<string, unknown> = { name };
      if (typeName) props.type = typeName;
      if (initializer) props.value = initializer;
      if (!isExported) props.export = 'false';

      const node: IRNode = { type: 'const', props };

      results.push(makeResult(node, sourceFile, startOffset, endOffset, startLine, endLine,
        `const ${name}${typeName ? ': ' + typeName : ''} = ${initializer || '...'}`,
        'high', 90, originalText));
    }
  }

  return results;
}

// ── Phase 1: Export Declarations ─────────────────────────────────────────

function inferExports(sourceFile: SourceFile): InferResult[] {
  const results: InferResult[] = [];
  const filePath = sourceFile.getFilePath() || 'input.ts';

  // Named re-exports: export { x } from './foo'
  for (const decl of sourceFile.getExportDeclarations()) {
    const startLine = decl.getStartLineNumber();
    const endLine = decl.getEndLineNumber();
    const startOffset = decl.getStart();
    const endOffset = decl.getEnd();
    const text = decl.getText();

    const specifier = decl.getModuleSpecifierValue();
    const namedExports = decl.getNamedExports().map(e => e.getName());
    const isTypeOnly = decl.isTypeOnly();

    const node: IRNode = {
      type: 'export',
      props: {
        ...(specifier ? { from: specifier } : {}),
        ...(namedExports.length > 0 ? (isTypeOnly ? { types: namedExports.join(',') } : { names: namedExports.join(',') }) : {}),
        ...(!specifier && namedExports.length === 0 ? { star: 'true' } : {}),
      },
    };

    const tsTokens = text.split(/\s+/).length;
    const kernTokens = Math.max(1, Math.ceil(tsTokens * 0.4));

    results.push({
      node,
      nodeId: `${filePath}#export@${startOffset}`,
      promptAlias: '',
      startLine,
      endLine,
      sourceSpans: [getSpan(sourceFile, startOffset, endOffset)],
      summary: `re-export${specifier ? ` from ${specifier}` : ''}`,
      confidence: 'high',
      confidencePct: 95,
      kernTokens,
      tsTokens,
    });
  }

  // Export assignments: export default x
  for (const stmt of sourceFile.getStatements()) {
    if (stmt.getKind() === SyntaxKind.ExportAssignment) {
      const startLine = stmt.getStartLineNumber();
      const endLine = stmt.getEndLineNumber();
      const startOffset = stmt.getStart();
      const endOffset = stmt.getEnd();
      const text = stmt.getText();
      const expr = (stmt as import('ts-morph').ExportAssignment).getExpression().getText();

      results.push({
        node: { type: 'export', props: { default: expr } },
        nodeId: `${filePath}#export-default@${startOffset}`,
        promptAlias: '',
        startLine,
        endLine,
        sourceSpans: [getSpan(sourceFile, startOffset, endOffset)],
        summary: `export default ${expr}`,
        confidence: 'high',
        confidencePct: 95,
        kernTokens: 2,
        tsTokens: text.split(/\s+/).length,
      });
    }
  }

  return results;
}

// ── Phase 2: Machine Detection ───────────────────────────────────────────
// Pattern: XState type + XStateError class + transition functions

function inferMachines(sourceFile: SourceFile, existing: InferResult[]): InferResult[] {
  const results: InferResult[] = [];
  const filePath = sourceFile.getFilePath() || 'input.ts';

  // Look for *State type aliases that are string literal unions
  const stateTypes = existing.filter(r =>
    r.node.type === 'type' &&
    r.node.props?.name &&
    (r.node.props.name as string).endsWith('State') &&
    r.node.props.values
  );

  for (const stateResult of stateTypes) {
    const stateName = stateResult.node.props!.name as string;
    const baseName = stateName.replace(/State$/, '');
    const values = (stateResult.node.props!.values as string).split('|');

    // Check for matching XStateError class
    const errorResult = existing.find(r =>
      r.node.type === 'error' &&
      r.node.props?.name === `${baseName}StateError`
    );

    // Check for transition functions matching the pattern: verbBaseName
    const transitionFns = existing.filter(r =>
      r.node.type === 'fn' &&
      r.node.props?.name &&
      (r.node.props.name as string).endsWith(baseName)
    );

    // Need at least the state type + 1 transition OR state type + error
    if (!errorResult && transitionFns.length === 0) continue;

    const startLine = stateResult.startLine;
    const endLine = Math.max(
      errorResult?.endLine || startLine,
      ...transitionFns.map(f => f.endLine),
    );

    // Build machine node
    const children: IRNode[] = [];

    // States
    for (let i = 0; i < values.length; i++) {
      children.push({
        type: 'state',
        props: { name: values[i], ...(i === 0 ? { initial: 'true' } : {}) },
      });
    }

    // Transitions (inferred from function names)
    for (const fn of transitionFns) {
      const fnName = fn.node.props!.name as string;
      const verb = fnName.replace(new RegExp(`${baseName}$`), '');
      if (!verb) continue;

      children.push({
        type: 'transition',
        props: { name: verb },
      });
    }

    const allOriginalText = [stateResult, errorResult, ...transitionFns]
      .filter(Boolean)
      .map(r => r!.tsTokens)
      .reduce((a, b) => a + b, 0);

    const node: IRNode = {
      type: 'machine',
      props: { name: baseName },
      children,
    };

    // Collect sourceSpans from all component results
    const componentSpans: SourceSpan[] = [
      ...stateResult.sourceSpans,
      ...(errorResult?.sourceSpans || []),
      ...transitionFns.flatMap(fn => fn.sourceSpans),
    ];

    const confidence = errorResult && transitionFns.length > 0 ? 90 : 75;
    results.push({
      node,
      nodeId: `${filePath}#machine:${baseName}@L${startLine}`,
      promptAlias: '', // assigned after sort
      startLine,
      endLine,
      sourceSpans: componentSpans,
      summary: `machine ${baseName} (${values.length} states, ${transitionFns.length} transitions)`,
      confidence: confidence >= 85 ? 'high' : 'medium',
      confidencePct: confidence,
      kernTokens: countTokens(serializeKernNode(node)),
      tsTokens: allOriginalText,
    });
  }

  return results;
}

// ── Phase 2: Config Detection ────────────────────────────────────────────
// Pattern: XConfig interface + DEFAULT_X_CONFIG const

function inferConfigs(sourceFile: SourceFile, existing: InferResult[]): InferResult[] {
  const results: InferResult[] = [];
  const filePath = sourceFile.getFilePath() || 'input.ts';

  const configInterfaces = existing.filter(r =>
    r.node.type === 'interface' &&
    r.node.props?.name &&
    (r.node.props.name as string).endsWith('Config')
  );

  for (const ifaceResult of configInterfaces) {
    const name = ifaceResult.node.props!.name as string;
    // Look for DEFAULT_X_CONFIG or DEFAULT_XCONFIG or defaultXConfig
    const upperName = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

    const defaultConst = existing.find(r =>
      r.node.type === 'const' &&
      r.node.props?.name &&
      (
        (r.node.props.name as string) === `DEFAULT_${upperName}` ||
        (r.node.props.name as string).toUpperCase().includes(upperName)
      )
    );

    if (!defaultConst) continue;

    const startLine = Math.min(ifaceResult.startLine, defaultConst.startLine);
    const endLine = Math.max(ifaceResult.endLine, defaultConst.endLine);

    // Build config node from interface fields
    const children: IRNode[] = (ifaceResult.node.children || []).map(field => {
      return { ...field };
    });

    const node: IRNode = {
      type: 'config',
      props: { name },
      children,
    };

    const componentSpans = [
      ...ifaceResult.sourceSpans,
      ...defaultConst.sourceSpans,
    ];

    results.push({
      node,
      nodeId: `${filePath}#config:${name}@L${startLine}`,
      promptAlias: '',
      startLine,
      endLine,
      sourceSpans: componentSpans,
      summary: `config ${name} (${children.length} fields + defaults)`,
      confidence: 'medium',
      confidencePct: 85,
      kernTokens: countTokens(serializeKernNode(node)),
      tsTokens: ifaceResult.tsTokens + defaultConst.tsTokens,
    });
  }

  return results;
}

// ── Phase 2: Event Detection ─────────────────────────────────────────────
// Pattern: XEventType union + XEvent interface + XEventMap

function inferEvents(sourceFile: SourceFile, existing: InferResult[]): InferResult[] {
  const results: InferResult[] = [];
  const filePath = sourceFile.getFilePath() || 'input.ts';

  // Find *EventType type aliases
  const eventTypes = existing.filter(r =>
    r.node.type === 'type' &&
    r.node.props?.name &&
    (r.node.props.name as string).endsWith('EventType') &&
    r.node.props.values
  );

  for (const eventTypeResult of eventTypes) {
    const typeName = eventTypeResult.node.props!.name as string;
    const baseName = typeName.replace(/Type$/, '');

    // Look for matching XEvent interface
    const eventInterface = existing.find(r =>
      r.node.type === 'interface' &&
      r.node.props?.name === baseName
    );

    // Look for matching XEventMap interface
    const eventMap = existing.find(r =>
      r.node.type === 'interface' &&
      r.node.props?.name === `${baseName}Map`
    );

    if (!eventInterface) continue;

    const startLine = Math.min(eventTypeResult.startLine, eventInterface.startLine);
    const endLine = Math.max(
      eventTypeResult.endLine,
      eventInterface.endLine,
      eventMap?.endLine || 0,
    );

    const values = (eventTypeResult.node.props!.values as string).split('|');
    const children: IRNode[] = values.map(v => ({
      type: 'type',
      props: { name: v, value: v },
    }));

    const node: IRNode = {
      type: 'event',
      props: { name: baseName },
      children,
    };

    const componentSpans = [
      ...eventTypeResult.sourceSpans,
      ...eventInterface.sourceSpans,
      ...(eventMap?.sourceSpans || []),
    ];

    const totalTokens = eventTypeResult.tsTokens +
      eventInterface.tsTokens +
      (eventMap?.tsTokens || 0);

    results.push({
      node,
      nodeId: `${filePath}#event:${baseName}@L${startLine}`,
      promptAlias: '',
      startLine,
      endLine,
      sourceSpans: componentSpans,
      summary: `event ${baseName} (${values.length} types)`,
      confidence: eventMap ? 'high' : 'medium',
      confidencePct: eventMap ? 88 : 75,
      kernTokens: countTokens(serializeKernNode(node)),
      tsTokens: totalTokens,
    });
  }

  return results;
}
