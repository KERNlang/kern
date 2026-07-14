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

function exportHasRuntimeValue(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

export function runtimeModuleSpecifiers(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail(`cannot parse ${sourcePath}`);
  const specifiers = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && importHasRuntimeValue(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal import in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = node.moduleReference.expression;
      if (!specifier || !ts.isStringLiteral(specifier)) fail(`non-literal import-equals in ${sourcePath}`);
      specifiers.push(specifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && exportHasRuntimeValue(node)) {
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
    } else if (
      ts.isIdentifier(node) &&
      node.text === 'require' &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      fail(`indirect require in ${sourcePath}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function barePackageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function resolveTypeScriptImport(fromPath, specifier, allowedBareSpecifiers) {
  if (specifier === '@kernlang/core' || specifier.startsWith('@kernlang/core/')) {
    fail(`own-package import ${specifier} in ${fromPath} is forbidden inside a checked runtime closure`);
  }
  if (!specifier.startsWith('.')) {
    if (allowedBareSpecifiers.has(barePackageName(specifier))) return null;
    fail(`unapproved bare import ${specifier} in ${fromPath}`);
  }
  const resolved = resolve(dirname(fromPath), specifier);
  if (resolved.endsWith('.js') || resolved.endsWith('.mjs')) return resolved.replace(/\.m?js$/u, '.ts');
  return extname(resolved) ? resolved : `${resolved}.ts`;
}

export function runtimeImportClosure(
  entryPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
) {
  const visited = new Set();
  const pending = [...entryPaths];
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readText(path);
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      const target = resolveTypeScriptImport(path, specifier, allowedBareSpecifiers);
      if (target && !visited.has(target)) pending.push(target);
    }
  }
  return visited;
}

export function assertRuntimeImportClosureExcludes(
  entryPaths,
  forbiddenPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
) {
  const reachable = runtimeImportClosure(entryPaths, readText, allowedBareSpecifiers);
  for (const forbidden of forbiddenPaths) {
    if (reachable.has(forbidden)) fail(`${forbidden} is reachable from ${entryPaths.join(', ')}`);
  }
  return reachable;
}

function semanticPath(coreSourceRoot, file) {
  return resolve(coreSourceRoot, 'ir/semantics', file);
}

function runtimeEnvelopePath(coreSourceRoot, file) {
  return resolve(coreSourceRoot, 'runtime-envelope', file);
}

const EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS = new Set(['decimal.js']);

function runtimeDependencies(coreSourceRoot) {
  const manifest = JSON.parse(readFileSync(resolve(coreSourceRoot, '../package.json'), 'utf8'));
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

/** One production policy for both the runtime checker and its mutation tests. */
export function assertStableEffectMachineClosure(
  coreSourceRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const forbidden = [
    'async-reference-runner.ts',
    'branch.ts',
    'each.ts',
    'for.ts',
    'if.ts',
    'portable-scalar.ts',
    'portable-reference-body.ts',
    'portable-reference-evaluator.ts',
    'portable-reference-host.ts',
    'reference-runner.ts',
    'semantic-sequence-runtime.ts',
    'try.ts',
    'while.ts',
  ].map((file) => semanticPath(coreSourceRoot, file));
  return assertRuntimeImportClosureExcludes(
    [semanticPath(coreSourceRoot, 'internal-effect-machine.ts')],
    forbidden,
    readText,
    runtimeDependencies(coreSourceRoot),
  );
}

/** The scalar machine host itself must remain independent of every reference host. */
export function assertPortableMachineEvaluatorClosure(
  coreSourceRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const forbidden = [
    'async-reference-runner.ts',
    'portable-scalar.ts',
    'portable-reference-body.ts',
    'portable-reference-evaluator.ts',
    'portable-reference-host.ts',
    'reference-runner.ts',
    'semantic-sequence-runtime.ts',
  ].map((file) => semanticPath(coreSourceRoot, file));
  return assertRuntimeImportClosureExcludes(
    [semanticPath(coreSourceRoot, 'portable-machine-evaluator.ts')],
    forbidden,
    readText,
    runtimeDependencies(coreSourceRoot),
  );
}

/** The direct executable envelope is a machine-only production boundary. */
export function assertExecutableEnvelopeDirectClosure(
  coreSourceRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const forbidden = [
    runtimeEnvelopePath(coreSourceRoot, 'execute-compat.ts'),
    runtimeEnvelopePath(coreSourceRoot, 'internal-legacy-engine.ts'),
    runtimeEnvelopePath(coreSourceRoot, 'normalize-compat.ts'),
    semanticPath(coreSourceRoot, 'index.ts'),
    semanticPath(coreSourceRoot, 'doc-generator.ts'),
    semanticPath(coreSourceRoot, 'register-all.ts'),
    semanticPath(coreSourceRoot, 'async-reference-runner.ts'),
    semanticPath(coreSourceRoot, 'reference-runner.ts'),
    semanticPath(coreSourceRoot, 'portable-scalar.ts'),
    semanticPath(coreSourceRoot, 'async-portable-scalar.ts'),
    semanticPath(coreSourceRoot, 'portable-reference-body.ts'),
    semanticPath(coreSourceRoot, 'portable-reference-evaluator.ts'),
    semanticPath(coreSourceRoot, 'portable-reference-host.ts'),
    semanticPath(coreSourceRoot, 'semantic-sequence-runtime.ts'),
    semanticPath(coreSourceRoot, 'assign.ts'),
    semanticPath(coreSourceRoot, 'branch.ts'),
    semanticPath(coreSourceRoot, 'capability.ts'),
    semanticPath(coreSourceRoot, 'do.ts'),
    semanticPath(coreSourceRoot, 'each.ts'),
    semanticPath(coreSourceRoot, 'expression-v1.ts'),
    semanticPath(coreSourceRoot, 'fmt.ts'),
    semanticPath(coreSourceRoot, 'for.ts'),
    semanticPath(coreSourceRoot, 'if.ts'),
    semanticPath(coreSourceRoot, 'lambda.ts'),
    semanticPath(coreSourceRoot, 'let.ts'),
    semanticPath(coreSourceRoot, 'primitives.ts'),
    semanticPath(coreSourceRoot, 'print.ts'),
    semanticPath(coreSourceRoot, 'try.ts'),
    semanticPath(coreSourceRoot, 'while.ts'),
    resolve(coreSourceRoot, 'runner.ts'),
  ];
  return assertRuntimeImportClosureExcludes(
    [
      runtimeEnvelopePath(coreSourceRoot, 'execute.ts'),
      runtimeEnvelopePath(coreSourceRoot, 'internal-engine.ts'),
    ],
    forbidden,
    readText,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
  );
}
