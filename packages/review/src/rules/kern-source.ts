/**
 * .kern source review rules that operate on flattened IRNode[] plus file path.
 *
 * These are distinct from ground-layer lint rules because they need file-aware
 * spans and scope-sensitive analysis over handler/expr bodies.
 */

import type { IRNode } from '@kernlang/core';
import { countTokens } from '@kernlang/core';
import { type Project, SyntaxKind } from 'ts-morph';
import { createInMemoryProject } from '../inferrer.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

export type KernSourceRule = (nodes: IRNode[], filePath: string) => ReviewFinding[];

interface BindingInfo {
  kind: string;
  node: IRNode;
  typeName?: string;
}

interface UnionAliasInfo {
  node: IRNode;
  variants: string[];
  literalKind: 'string' | 'number' | 'boolean' | 'mixed';
}

interface SnippetAnalysis {
  localBindings: Set<string>;
  referenceNames: Set<string>;
  propertyAccesses: Array<{ baseName: string; propertyName: string }>;
  elementAccesses: Array<{ baseName: string; propertyName?: string }>;
  objectDestructures: Array<{ sourceName: string }>;
}

const SCOPE_NODE_TYPES = new Set([
  'screen',
  'hook',
  'provider',
  'fn',
  'callback',
  'memo',
  'effect',
  'on',
  'route',
  'server',
  'service',
  'method',
  'singleton',
  'constructor',
  'middleware',
  'cli',
  'command',
  'test',
  'describe',
  'it',
  // Template node types + CLI
  'arrow-fn',
  'swr-hook',
  'zustand-store',
  'zustand-selector',
  'module',
  'cli',
]);

const DIRECT_BINDING_NODE_TYPES = new Set([
  'state',
  'const',
  'fn',
  'derive',
  'import',
  'ref',
  'context',
  'callback',
  'memo',
  'effect',
  'middleware',
  'hook',
  'method',
  'arg',
  'flag',
  // Top-level declaration types (visible to all handlers in the file)
  'screen',
  'type',
  'interface',
  'union',
  'service',
  'machine',
  'singleton',
  'signal',
  // Template node types that declare a name binding
  'arrow-fn',
  'swr-hook',
  'zustand-store',
  'zustand-selector',
]);

const TYPE_POSITION_KINDS = new Set([
  SyntaxKind.TypeReference,
  SyntaxKind.ExpressionWithTypeArguments,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeParameter,
  SyntaxKind.TypeLiteral,
  SyntaxKind.UnionType,
  SyntaxKind.IntersectionType,
  SyntaxKind.LiteralType,
  SyntaxKind.ArrayType,
  SyntaxKind.TupleType,
  SyntaxKind.TypeOperator,
  SyntaxKind.ParenthesizedType,
  SyntaxKind.FunctionType,
  SyntaxKind.ConstructorType,
  SyntaxKind.ConditionalType,
  SyntaxKind.IndexedAccessType,
  SyntaxKind.MappedType,
  SyntaxKind.ImportType,
  SyntaxKind.TypePredicate,
  SyntaxKind.ThisType,
  SyntaxKind.QualifiedName,
  SyntaxKind.HeritageClause,
]);

const SAFE_STRING_MEMBERS = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'concat',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'length',
  'localeCompare',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'repeat',
  'replace',
  'replaceAll',
  'search',
  'slice',
  'split',
  'startsWith',
  'substring',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLowerCase',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);

const AMBIENT_NAMES = new Set([
  // JS globals
  'Array',
  'AbortController',
  'Boolean',
  'Buffer',
  'Date',
  'Error',
  'Headers',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'Promise',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'String',
  'URL',
  'URLSearchParams',
  'console',
  'crypto',
  'clearInterval',
  'clearTimeout',
  'document',
  'fetch',
  'globalThis',
  'location',
  'navigator',
  'process',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'setTimeout',
  'window',
  'undefined',
  'NaN',
  'Infinity',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'Reflect',
  'queueMicrotask',
  'structuredClone',
  'atob',
  'btoa',
  // JS global functions
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'eval',
  // TypedArrays and other constructors
  'Uint8Array',
  'Int8Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
  'DataView',
  'TextEncoder',
  'TextDecoder',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'Blob',
  'File',
  'FormData',
  'Event',
  'EventTarget',
  'CustomEvent',
  // Node.js globals
  'require',
  '__dirname',
  '__filename',
  'module',
  'exports',
  // React/JSX globals
  'React',
  'Fragment',
  'JSX',
  // HTTP handler context (injected by framework)
  'req',
  'res',
  'ctx',
  'next',
  'params',
  'query',
  'body',
  'headers',
  'event',
  'env',
  'emit',
  'send',
  'status',
  // State/dispatch (React/KERN runtime)
  'state',
  'dispatch',
  'get',
  'set',
  'props',
  'self',
  'this',
  // Common external service references (injected via DI or app context)
  'db',
  'redis',
  'cache',
  'store',
  'config',
  'logger',
  'app',
  // CLI context (common in KERN CLI examples)
  'opts',
  'args',
  'options',
  'argv',
  // SWR/hook context (data comes from framework)
  'data',
  'error',
  'isLoading',
  'mutate',
  'isValidating',
]);

const EXTERNAL_SIGNAL_RE =
  /\b(fetch|axios|db|redis|stripe|openai|supabase|client|api|provider|registry|http|https)\b|await\s+[A-Za-z_$]/;
const UNCERTAIN_SIGNAL_RE =
  /\b(guess|heuristic|fallback|bestEffort|approx|uncertain|unknown|maybe)\b|Math\.random|Date\.now/;

function props(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function loc(node: IRNode): { line: number; col: number } {
  return { line: node.loc?.line || 1, col: node.loc?.col || 1 };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  filePath: string,
  node: IRNode,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  const { line, col } = loc(node);
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: { file: filePath, startLine: line, startCol: col, endLine: line, endCol: col },
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildParentMap(nodes: IRNode[]): Map<IRNode, IRNode | undefined> {
  const parentMap = new Map<IRNode, IRNode | undefined>();
  // Mark top-level nodes as having no parent
  for (const node of nodes) {
    parentMap.set(node, undefined);
  }
  // Recursively map all descendants to their parents
  function walk(parent: IRNode): void {
    for (const child of parent.children || []) {
      parentMap.set(child, parent);
      walk(child);
    }
  }
  for (const node of nodes) {
    walk(node);
  }
  return parentMap;
}

function isScopeNode(node: IRNode): boolean {
  return SCOPE_NODE_TYPES.has(node.type);
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote && (ch === '<' || ch === '(' || ch === '{' || ch === '[')) {
      depth++;
    } else if (!inQuote && depth > 0 && (ch === '>' || ch === ')' || ch === '}' || ch === ']')) {
      depth--;
    }

    if (!inQuote && depth === 0 && ch === separator) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findTopLevelChar(text: string, wanted: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (ch === '<' || ch === '(' || ch === '{' || ch === '[')) depth++;
    else if (!inQuote && depth > 0 && (ch === '>' || ch === ')' || ch === '}' || ch === ']')) depth--;
    else if (!inQuote && depth === 0 && ch === wanted) return i;
  }
  return -1;
}

function parseParamBindings(raw: unknown): Array<{ name: string; typeName?: string }> {
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  const bindings: Array<{ name: string; typeName?: string }> = [];
  for (const part of splitTopLevel(raw, ',')) {
    const colonIdx = findTopLevelChar(part, ':');
    const eqIdx = findTopLevelChar(part, '=');
    const rawNameRaw =
      colonIdx >= 0 ? part.slice(0, colonIdx).trim() : eqIdx >= 0 ? part.slice(0, eqIdx).trim() : part.trim();
    const rawName = rawNameRaw.endsWith('?') ? rawNameRaw.slice(0, -1) : rawNameRaw;
    if (!/^[A-Za-z_$][\w$]*$/.test(rawName)) continue;

    let typeName: string | undefined;
    if (colonIdx >= 0) {
      const rawType = (eqIdx >= 0 ? part.slice(colonIdx + 1, eqIdx) : part.slice(colonIdx + 1)).trim();
      const directAlias = getDirectTypeAlias(rawType);
      if (directAlias) typeName = directAlias;
    }

    bindings.push({ name: rawName, typeName });
  }
  return bindings;
}

function getDirectTypeAlias(typeText: string | undefined): string | undefined {
  if (!typeText) return undefined;
  const compact = typeText.replace(/\s+/g, '');
  if (!compact) return undefined;
  if (compact.includes('<') || compact.includes('[') || compact.includes('{') || compact.includes('&'))
    return undefined;

  const parts = compact.split('|').filter((part) => part !== 'null' && part !== 'undefined');
  if (parts.length !== 1) return undefined;

  return /^[A-Za-z_$][\w$]*$/.test(parts[0]) ? parts[0] : undefined;
}

function getUnionLiteralKind(variants: string[]): UnionAliasInfo['literalKind'] {
  const trimmed = variants.map((variant) => variant.trim()).filter(Boolean);
  if (trimmed.length === 0) return 'mixed';
  if (trimmed.every((variant) => variant === 'true' || variant === 'false')) return 'boolean';
  if (trimmed.every((variant) => /^-?\d+(?:\.\d+)?$/.test(variant))) return 'number';
  if (
    trimmed.every(
      (variant) => /^".*"$/.test(variant) || /^'.*'$/.test(variant) || /^[A-Za-z_][A-Za-z0-9_-]*$/.test(variant),
    )
  ) {
    return 'string';
  }
  return 'mixed';
}

function buildUnionAliasMap(nodes: IRNode[]): Map<string, UnionAliasInfo> {
  const unions = new Map<string, UnionAliasInfo>();
  for (const node of nodes) {
    if (node.type !== 'type') continue;
    const p = props(node);
    if (typeof p.name !== 'string' || typeof p.values !== 'string') continue;

    const variants = p.values
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    if (variants.length < 2) continue;

    unions.set(p.name, {
      node,
      variants,
      literalKind: getUnionLiteralKind(variants),
    });
  }
  return unions;
}

function addBinding(target: Map<string, BindingInfo>, name: string, info: BindingInfo): void {
  if (!name || target.has(name)) return;
  target.set(name, info);
}

function addBindingsFromScopeNode(scopeNode: IRNode, target: Map<string, BindingInfo>): void {
  const p = props(scopeNode);

  for (const binding of parseParamBindings(p.params)) {
    addBinding(target, binding.name, { kind: 'param', node: scopeNode, typeName: binding.typeName });
  }

  // Inject framework callback parameters for known event types
  if (scopeNode.type === 'on') {
    const event = (p.event || p.name) as string;
    if (event === 'input' || event === 'key') {
      // Ink useInput((input, key) => ...) callback parameters
      addBinding(target, 'input', { kind: 'param', node: scopeNode, typeName: 'string' });
      addBinding(target, 'key', { kind: 'param', node: scopeNode, typeName: 'Key' });
    } else if (event === 'stdout' || event === 'stderr') {
      addBinding(target, 'data', { kind: 'param', node: scopeNode, typeName: 'string' });
    }
  }

  if (DIRECT_BINDING_NODE_TYPES.has(scopeNode.type) && typeof p.name === 'string') {
    addBinding(target, p.name, {
      kind: scopeNode.type,
      node: scopeNode,
      typeName: typeof p.type === 'string' ? getDirectTypeAlias(p.type) : undefined,
    });
    if (scopeNode.type === 'state') {
      addBinding(target, `set${capitalize(p.name)}`, { kind: 'state-setter', node: scopeNode });
    }
  }

  for (const child of scopeNode.children || []) {
    const cp = props(child);
    if (child.type === 'params' && Array.isArray(cp.items)) {
      for (const item of cp.items as Array<{ name?: unknown; type?: unknown }>) {
        if (typeof item.name !== 'string') continue;
        addBinding(target, item.name, {
          kind: 'param',
          node: child,
          typeName: typeof item.type === 'string' ? getDirectTypeAlias(item.type) : undefined,
        });
      }
      continue;
    }

    if (!DIRECT_BINDING_NODE_TYPES.has(child.type)) continue;

    // Import nodes: handle 'names' (comma-separated named imports), 'default' (default import),
    // and 'namespace' (namespace import)
    if (child.type === 'import') {
      if (typeof cp.names === 'string') {
        for (const importedName of cp.names
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)) {
          addBinding(target, importedName, { kind: 'import', node: child });
        }
      }
      if (typeof cp.default === 'string' && cp.default) {
        addBinding(target, cp.default as string, { kind: 'import', node: child });
      }
      if (typeof cp.namespace === 'string' && cp.namespace) {
        addBinding(target, cp.namespace as string, { kind: 'import', node: child });
      }
      continue;
    }

    if (typeof cp.name !== 'string') continue;
    addBinding(target, cp.name, {
      kind: child.type,
      node: child,
      typeName: typeof cp.type === 'string' ? getDirectTypeAlias(cp.type) : undefined,
    });
    if (child.type === 'state') {
      addBinding(target, `set${capitalize(cp.name)}`, { kind: 'state-setter', node: child });
    }
  }
}

function addTopLevelBindingsFrom(rootNode: IRNode, target: Map<string, BindingInfo>): void {
  const p = props(rootNode);

  // Root-level import: register its imported names without descending further
  if (rootNode.type === 'import') {
    if (typeof p.names === 'string') {
      for (const importedName of p.names
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)) {
        addBinding(target, importedName, { kind: 'import', node: rootNode });
      }
    }
    if (typeof p.default === 'string' && p.default) {
      addBinding(target, p.default as string, { kind: 'import', node: rootNode });
    }
    if (typeof p.namespace === 'string' && p.namespace) {
      addBinding(target, p.namespace as string, { kind: 'import', node: rootNode });
    }
    return;
  }

  // Only the root node's own name — NOT its nested children. Recursing here would
  // leak e.g. a top-level `fn a`'s inner `const x` into sibling `fn b`'s scope.
  if (DIRECT_BINDING_NODE_TYPES.has(rootNode.type) && typeof p.name === 'string') {
    addBinding(target, p.name, {
      kind: rootNode.type,
      node: rootNode,
      typeName: typeof p.type === 'string' ? getDirectTypeAlias(p.type) : undefined,
    });
    if (rootNode.type === 'state') {
      addBinding(target, `set${capitalize(p.name)}`, { kind: 'state-setter', node: rootNode });
    }
  }
}

function collectVisibleBindings(
  node: IRNode,
  parentMap: Map<IRNode, IRNode | undefined>,
  rootNodes: IRNode[],
): Map<string, BindingInfo> {
  const bindings = new Map<string, BindingInfo>();

  // Walk innermost → outermost first. `addBinding` is first-write-wins, so nearer
  // scopes take precedence over file-level declarations seeded afterwards.
  let current = parentMap.get(node);
  while (current) {
    if (isScopeNode(current) || parentMap.get(current) === undefined) {
      addBindingsFromScopeNode(current, bindings);
    }
    current = parentMap.get(current);
  }

  // Seed file-level bindings LAST so local params/state/consts can shadow them.
  // Use the narrow helper so nested declarations of one top-level scope don't
  // leak into siblings.
  for (const root of rootNodes) {
    addTopLevelBindingsFrom(root, bindings);
  }

  return bindings;
}

function createSnippetAnalysis(project: Project, code: string, key: string, mode: 'block' | 'expr'): SnippetAnalysis {
  const filePath = `__kern_${key.replace(/[^A-Za-z0-9_]/g, '_')}_${Math.random().toString(36).slice(2)}.tsx`;
  const wrapped =
    mode === 'expr' ? `async function __kern__() { return (${code}); }\n` : `async function __kern__() {\n${code}\n}\n`;
  const sourceFile = project.createSourceFile(filePath, wrapped, { overwrite: true });

  const localBindings = collectLocalBindings(sourceFile);
  const referenceNames = new Set<string>();
  const propertyAccesses: Array<{ baseName: string; propertyName: string }> = [];
  const elementAccesses: Array<{ baseName: string; propertyName?: string }> = [];
  const objectDestructures: Array<{ sourceName: string }> = [];

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = identifier.getText();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    if (AMBIENT_NAMES.has(name)) continue;
    if (isDeclarationIdentifier(identifier)) continue;
    if (isTypeOnlyIdentifier(identifier)) continue;
    if (isNonReferencePropertyName(identifier)) continue;
    referenceNames.add(name);
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const expr = access.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    const baseName = expr.getText();
    if (!/^[A-Za-z_$][\w$]*$/.test(baseName)) continue;
    propertyAccesses.push({ baseName, propertyName: access.getName() });
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const expr = access.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    const baseName = expr.getText();
    if (!/^[A-Za-z_$][\w$]*$/.test(baseName)) continue;
    const arg = access.getArgumentExpression();
    let propertyName: string | undefined;
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      propertyName = arg.getText().slice(1, -1);
    }
    elementAccesses.push({ baseName, propertyName });
  }

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) continue;
    const init = decl.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.Identifier) continue;
    objectDestructures.push({ sourceName: init.getText() });
  }

  sourceFile.forget();
  return { localBindings, referenceNames, propertyAccesses, elementAccesses, objectDestructures };
}

function collectLocalBindings(sourceFile: import('ts-morph').SourceFile): Set<string> {
  const bindings = new Set<string>();

  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    addBindingNamesFromNode(decl.getNameNode(), bindings);
  }
  for (const param of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
    addBindingNamesFromNode(param.getNameNode(), bindings);
  }
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = fn.getName();
    if (name) bindings.add(name);
  }
  for (const cls of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const name = cls.getName();
    if (name) bindings.add(name);
  }
  for (const catchClause of sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const variable = catchClause.getVariableDeclaration();
    if (variable) addBindingNamesFromNode(variable.getNameNode(), bindings);
  }

  return bindings;
}

function addBindingNamesFromNode(node: import('ts-morph').Node, bindings: Set<string>): void {
  if (node.getKind() === SyntaxKind.Identifier) {
    bindings.add(node.getText());
    return;
  }
  if (node.getKind() === SyntaxKind.ObjectBindingPattern || node.getKind() === SyntaxKind.ArrayBindingPattern) {
    for (const descendant of node.getDescendantsOfKind(SyntaxKind.BindingElement)) {
      addBindingNamesFromNode(descendant.getNameNode(), bindings);
    }
  }
}

function isDeclarationIdentifier(identifier: import('ts-morph').Identifier): boolean {
  const parent = identifier.getParent();
  if (!parent) return false;

  if (
    parent.getKind() === SyntaxKind.BindingElement &&
    (parent as import('ts-morph').BindingElement).getNameNode() === identifier
  ) {
    return true;
  }
  if (
    parent.getKind() === SyntaxKind.Parameter &&
    (parent as import('ts-morph').ParameterDeclaration).getNameNode() === identifier
  ) {
    return true;
  }
  if (
    parent.getKind() === SyntaxKind.VariableDeclaration &&
    (parent as import('ts-morph').VariableDeclaration).getNameNode() === identifier
  ) {
    return true;
  }

  const parentAny = parent as { getNameNode?: () => import('ts-morph').Node; getName?: () => string | undefined };
  return parentAny.getNameNode?.() === identifier;
}

function isNonReferencePropertyName(identifier: import('ts-morph').Identifier): boolean {
  const parent = identifier.getParent();
  if (!parent) return false;

  switch (parent.getKind()) {
    case SyntaxKind.PropertyAccessExpression:
      return (parent as import('ts-morph').PropertyAccessExpression).getNameNode() === identifier;
    case SyntaxKind.PropertyAssignment:
      return (parent as import('ts-morph').PropertyAssignment).getNameNode() === identifier;
    case SyntaxKind.PropertyDeclaration:
    case SyntaxKind.PropertySignature:
    case SyntaxKind.MethodDeclaration:
    case SyntaxKind.GetAccessor:
    case SyntaxKind.SetAccessor:
      return (parent as unknown as { getNameNode(): import('ts-morph').Node }).getNameNode() === identifier;
    case SyntaxKind.BindingElement:
      return (parent as import('ts-morph').BindingElement).getPropertyNameNode() === identifier;
    case SyntaxKind.LabeledStatement:
      // { fn: null } at statement level is parsed as a label, not object literal — skip
      return true;
    case SyntaxKind.ShorthandPropertyAssignment:
      // { fn } shorthand in object literal — the name is both a key and a reference,
      // but when it appears as shorthand property, skip it (it will be caught as the value ref)
      return false;
    default:
      return false;
  }
}

function isTypeOnlyIdentifier(identifier: import('ts-morph').Identifier): boolean {
  let current: import('ts-morph').Node | undefined = identifier.getParent();
  while (current) {
    if (TYPE_POSITION_KINDS.has(current.getKind())) return true;
    if (
      current.getKind() === SyntaxKind.ExpressionStatement ||
      current.getKind() === SyntaxKind.ReturnStatement ||
      current.getKind() === SyntaxKind.VariableDeclaration ||
      current.getKind() === SyntaxKind.CallExpression ||
      current.getKind() === SyntaxKind.BinaryExpression ||
      current.getKind() === SyntaxKind.IfStatement
    ) {
      return false;
    }
    current = current.getParent();
  }
  return false;
}

function getCodeProp(node: IRNode, key = 'code'): string | undefined {
  const value = props(node)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function getExprCode(node: IRNode, key = 'expr'): string | undefined {
  const value = props(node)[key];
  if (!value || typeof value !== 'object') return undefined;
  const expr = value as { code?: unknown };
  return typeof expr.code === 'string' && expr.code.trim() !== '' ? expr.code : undefined;
}

function walkSubtree(node: IRNode, visit: (current: IRNode) => void): void {
  visit(node);
  for (const child of node.children || []) {
    walkSubtree(child, visit);
  }
}

function stringifyPropValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyPropValue).join(' ');
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([key, nested]) => `${key} ${stringifyPropValue(nested)}`).join(' ');
  }
  return String(value);
}

function countStructuralTokens(node: IRNode): number {
  const parts: string[] = [node.type];
  for (const [key, value] of Object.entries(props(node))) {
    if (key === 'code') continue;
    parts.push(key);
    parts.push(stringifyPropValue(value));
  }
  return countTokens(parts.join(' '));
}

function describeNode(node: IRNode, parentMap: Map<IRNode, IRNode | undefined>): string {
  const p = props(node);
  if (typeof p.name === 'string' && p.name) return p.name;
  const parent = parentMap.get(node);
  const parentName = parent ? props(parent).name : undefined;
  if (typeof parentName === 'string' && parentName) return `${parentName}.${node.type}`;
  return `${node.type}@L${loc(node).line}`;
}

export const undefinedReference: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const parentMap = buildParentMap(nodes);
  const rootNodes = nodes.filter((n) => parentMap.get(n) === undefined);
  const project = createInMemoryProject();

  // Iterate ALL nodes in the tree (not just top-level) to find deeply nested handlers
  for (const node of parentMap.keys()) {
    if (node.type !== 'handler') continue;
    const code = getCodeProp(node);
    if (!code) continue;

    const visibleBindings = collectVisibleBindings(node, parentMap, rootNodes);
    const analysis = createSnippetAnalysis(project, code, `undef_${loc(node).line}`, 'block');
    const unresolved = [...analysis.referenceNames]
      .filter((name) => !analysis.localBindings.has(name))
      .filter((name) => !visibleBindings.has(name))
      .filter((name) => !AMBIENT_NAMES.has(name))
      .sort();

    if (unresolved.length === 0) continue;

    findings.push(
      finding(
        'undefined-reference',
        'error',
        'bug',
        `Handler references name(s) that are not declared in visible KERN scope: ${unresolved.join(', ')}`,
        filePath,
        node,
        {
          suggestion:
            'Declare the value as state/const/fn/derive, add it as a param, or qualify it through an existing scoped object.',
        },
      ),
    );
  }

  return findings;
};

export const typeModelMismatch: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const parentMap = buildParentMap(nodes);
  const rootNodes = nodes.filter((n) => parentMap.get(n) === undefined);
  const unionAliases = buildUnionAliasMap(nodes);
  if (unionAliases.size === 0) return findings;

  const project = createInMemoryProject();

  for (const node of nodes) {
    if (node.type !== 'handler') continue;
    const code = getCodeProp(node);
    if (!code) continue;

    const visibleBindings = collectVisibleBindings(node, parentMap, rootNodes);
    const unionBindings = new Map<string, { alias: string; union: UnionAliasInfo; sourceNode: IRNode }>();
    for (const [name, binding] of visibleBindings) {
      if (!binding.typeName) continue;
      const union = unionAliases.get(binding.typeName);
      if (!union) continue;
      unionBindings.set(name, { alias: binding.typeName, union, sourceNode: binding.node });
    }
    if (unionBindings.size === 0) continue;

    const analysis = createSnippetAnalysis(project, code, `type_mismatch_${loc(node).line}`, 'block');
    const mismatches = new Map<string, Set<string>>();

    for (const access of analysis.propertyAccesses) {
      const binding = unionBindings.get(access.baseName);
      if (!binding) continue;
      if (binding.union.literalKind === 'string' && SAFE_STRING_MEMBERS.has(access.propertyName)) continue;
      const key = `${access.baseName}:${binding.alias}`;
      if (!mismatches.has(key)) mismatches.set(key, new Set<string>());
      mismatches.get(key)!.add(access.propertyName);
    }

    for (const access of analysis.elementAccesses) {
      const binding = unionBindings.get(access.baseName);
      if (!binding) continue;
      const key = `${access.baseName}:${binding.alias}`;
      if (!mismatches.has(key)) mismatches.set(key, new Set<string>());
      mismatches.get(key)!.add(access.propertyName || '[computed]');
    }

    for (const destructure of analysis.objectDestructures) {
      const binding = unionBindings.get(destructure.sourceName);
      if (!binding) continue;
      const key = `${destructure.sourceName}:${binding.alias}`;
      if (!mismatches.has(key)) mismatches.set(key, new Set<string>());
      mismatches.get(key)!.add('{...}');
    }

    for (const [key, members] of mismatches) {
      const [bindingName, alias] = key.split(':');
      const union = unionAliases.get(alias);
      const relatedInfo =
        union != null
          ? {
              relatedSpans: [
                {
                  file: filePath,
                  startLine: loc(union.node).line,
                  startCol: loc(union.node).col,
                  endLine: loc(union.node).line,
                  endCol: loc(union.node).col,
                },
              ],
              suggestion: `Use '${bindingName}' as a literal value, or change '${alias}' to an interface/union with object variants if field access is intended.`,
            }
          : undefined;
      findings.push(
        finding(
          'type-model-mismatch',
          'warning',
          'type',
          `Literal-union type '${alias}' is used like an object in handler code: ${bindingName}.${[...members].join(', ')}`,
          filePath,
          node,
          relatedInfo,
        ),
      );
    }
  }

  return findings;
};

export const unusedState: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const parentMap = buildParentMap(nodes);
  const project = createInMemoryProject();

  for (const node of nodes) {
    if (node.type !== 'state') continue;
    const p = props(node);
    if (typeof p.name !== 'string' || !p.name) continue;

    const scopeRoot = parentMap.get(node);
    if (!scopeRoot) continue;

    // Skip states inside machine nodes — they're used by transitions (from=/to= props)
    if (scopeRoot.type === 'machine') continue;

    const stateName = p.name as string;
    const setterName = `set${capitalize(stateName)}`;
    let used = false;

    walkSubtree(scopeRoot, (current) => {
      if (used || current === node) return;

      // Check bind= attribute (e.g., input bind=query)
      const cp = props(current);
      if (typeof cp.bind === 'string' && cp.bind === stateName) {
        used = true;
        return;
      }

      // Check value/initial/expr props for direct state references (e.g., value={{ query }})
      for (const val of Object.values(cp)) {
        if (typeof val === 'string' && new RegExp(`\\b${stateName}\\b`).test(val)) {
          used = true;
          return;
        }
      }

      const blockCode =
        current.type === 'handler' || current.type === 'logic' || current.type === 'body'
          ? getCodeProp(current)
          : undefined;
      if (blockCode) {
        const analysis = createSnippetAnalysis(project, blockCode, `state_${stateName}_${loc(current).line}`, 'block');
        const readsState = analysis.referenceNames.has(stateName) && !analysis.localBindings.has(stateName);
        const usesSetter = analysis.referenceNames.has(setterName) && !analysis.localBindings.has(setterName);
        if (readsState || usesSetter) used = true;
        return;
      }

      const exprCode = current.type === 'guard' || current.type === 'derive' ? getExprCode(current) : undefined;
      if (!exprCode) return;

      const analysis = createSnippetAnalysis(project, exprCode, `state_expr_${stateName}_${loc(current).line}`, 'expr');
      const readsState = analysis.referenceNames.has(stateName) && !analysis.localBindings.has(stateName);
      if (readsState) used = true;
    });

    if (used) continue;

    findings.push(
      finding(
        'unused-state',
        'warning',
        'structure',
        `State '${p.name}' is declared but never referenced in handlers, derives, guards, or logic within its scope`,
        filePath,
        node,
        {
          suggestion: `Remove '${p.name}' or wire it into the surrounding KERN logic.`,
        },
      ),
    );
  }

  return findings;
};

export const handlerHeavy: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  const handlers = nodes.filter((node) => node.type === 'handler' && getCodeProp(node));
  if (handlers.length === 0) return [];

  let handlerTokens = 0;
  let structureTokens = 0;
  for (const node of nodes) {
    structureTokens += countStructuralTokens(node);
    if (node.type === 'handler') {
      const code = getCodeProp(node);
      if (code) handlerTokens += countTokens(code);
    }
  }

  const totalTokens = handlerTokens + structureTokens;
  if (totalTokens === 0) return [];

  const ratio = handlerTokens / totalTokens;
  if (ratio <= 0.6) return [];

  const anchor = handlers[0];
  return [
    finding(
      'handler-heavy',
      'warning',
      'structure',
      `Embedded handler code accounts for ${(ratio * 100).toFixed(0)}% of file tokens (${handlerTokens}/${totalTokens}); this file is mostly inline JS with a thin KERN wrapper`,
      filePath,
      anchor,
      {
        suggestion:
          'Promote repeated handler logic into native KERN nodes such as derive, guard, collect, respond, or named fn blocks.',
      },
    ),
  ];
};

export const missingConfidence: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  if (nodes.some((node) => props(node).confidence !== undefined)) return [];
  if (nodes.length === 0) return [];

  const parentMap = buildParentMap(nodes);
  const candidates = new Set<string>();

  for (const node of nodes) {
    const code = getCodeProp(node) || getExprCode(node);
    if (!code) continue;
    if (!EXTERNAL_SIGNAL_RE.test(code) && !UNCERTAIN_SIGNAL_RE.test(code)) continue;
    candidates.add(describeNode(node.type === 'handler' ? parentMap.get(node) || node : node, parentMap));
    if (candidates.size >= 3) break;
  }

  const anchor = nodes[0];
  const suffix = candidates.size > 0 ? ` Candidate nodes: ${[...candidates].join(', ')}.` : '';

  return [
    finding(
      'missing-confidence',
      'info',
      'pattern',
      `No confidence annotations found in this .kern file. Add confidence props to external-service calls or uncertain logic.${suffix}`,
      filePath,
      anchor,
      {
        suggestion:
          'Annotate critical nodes with confidence=0.x, confidence=from:name, or confidence=min:a,b to make trust levels explicit.',
      },
    ),
  ];
};

export function lintKernSourceIR(
  nodes: IRNode[],
  filePath: string,
  rules: KernSourceRule[] = KERN_SOURCE_RULES,
): ReviewFinding[] {
  return rules.flatMap((rule) => rule(nodes, filePath));
}

export const KERN_SOURCE_RULES: KernSourceRule[] = [
  undefinedReference,
  typeModelMismatch,
  unusedState,
  handlerHeavy,
  missingConfidence,
];
