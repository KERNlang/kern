import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import ts from 'typescript';

function fail(message) {
  throw new Error(`runtime-envelope import closure: ${message}`);
}

function importHasRuntimeValue(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
}

export function runtimeModuleSpecifiers(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail(`cannot parse ${sourcePath}`);
  const specifiers = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && importHasRuntimeValue(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal import in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal export in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal dynamic import in ${sourcePath}`);
      specifiers.push(argument.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal require in ${sourcePath}`);
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function resolveTypeScriptImport(fromPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = resolve(dirname(fromPath), specifier);
  if (resolved.endsWith('.js') || resolved.endsWith('.mjs')) return resolved.replace(/\.m?js$/u, '.ts');
  return extname(resolved) ? resolved : `${resolved}.ts`;
}

export function runtimeImportClosure(entryPaths, readText = (path) => readFileSync(path, 'utf8')) {
  const visited = new Set();
  const pending = [...entryPaths];
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readText(path);
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      const target = resolveTypeScriptImport(path, specifier);
      if (target && !visited.has(target)) pending.push(target);
    }
  }
  return visited;
}

export function assertRuntimeImportClosureExcludes(
  entryPaths,
  forbiddenPaths,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const reachable = runtimeImportClosure(entryPaths, readText);
  for (const forbidden of forbiddenPaths) {
    if (reachable.has(forbidden)) fail(`${forbidden} is reachable from ${entryPaths.join(', ')}`);
  }
  return reachable;
}
