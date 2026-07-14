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

function resolveTypeScriptImport(fromPath, specifier, allowedBareSpecifiers, allowNodeBuiltins) {
  if (specifier === '@kernlang/core' || specifier.startsWith('@kernlang/core/')) {
    fail(`own-package import ${specifier} in ${fromPath} is forbidden inside a checked runtime closure`);
  }
  if (!specifier.startsWith('.')) {
    if (specifier.startsWith('node:')) {
      if (allowNodeBuiltins) return null;
      fail(`unapproved Node builtin ${specifier} in ${fromPath}`);
    }
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
  allowNodeBuiltins = true,
) {
  const visited = new Set();
  const pending = [...entryPaths];
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readText(path);
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      const target = resolveTypeScriptImport(path, specifier, allowedBareSpecifiers, allowNodeBuiltins);
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
  allowNodeBuiltins = true,
) {
  const reachable = runtimeImportClosure(entryPaths, readText, allowedBareSpecifiers, allowNodeBuiltins);
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

export const EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS = Object.freeze([
  './execute-compat.js',
  './internal-legacy-engine.js',
  './normalize-compat.js',
  '../ir/semantics/index.js',
  '../ir/semantics/doc-generator.js',
  '../ir/semantics/register-all.js',
  '../ir/semantics/async-reference-runner.js',
  '../ir/semantics/reference-runner.js',
  '../ir/semantics/portable-scalar.js',
  '../ir/semantics/async-portable-scalar.js',
  '../ir/semantics/portable-reference-body.js',
  '../ir/semantics/portable-reference-evaluator.js',
  '../ir/semantics/portable-reference-host.js',
  '../ir/semantics/semantic-sequence-runtime.js',
  '../ir/semantics/assign.js',
  '../ir/semantics/branch.js',
  '../ir/semantics/capability.js',
  '../ir/semantics/do.js',
  '../ir/semantics/each.js',
  '../ir/semantics/expression-v1.js',
  '../ir/semantics/fmt.js',
  '../ir/semantics/for.js',
  '../ir/semantics/if.js',
  '../ir/semantics/lambda.js',
  '../ir/semantics/let.js',
  '../ir/semantics/primitives.js',
  '../ir/semantics/print.js',
  '../ir/semantics/try.js',
  '../ir/semantics/while.js',
  '../runner.js',
]);

export const HANDLER_ENVELOPE_ADDITIONAL_FORBIDDEN_SPECIFIERS = Object.freeze([
  '../runtime.js',
  '../app-descriptor.js',
  '../runner-capability-plan.js',
]);

function emittedPolicyPath(coreSourceRoot, specifier) {
  return resolve(coreSourceRoot, 'runtime-envelope', specifier).replace(/\.js$/u, '.ts');
}

function executableEnvelopeForbiddenPaths(coreSourceRoot) {
  return EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS.map((specifier) =>
    emittedPolicyPath(coreSourceRoot, specifier),
  );
}

export function handlerEnvelopeForbiddenPaths(coreSourceRoot) {
  return [
    ...executableEnvelopeForbiddenPaths(coreSourceRoot),
    ...HANDLER_ENVELOPE_ADDITIONAL_FORBIDDEN_SPECIFIERS.map((specifier) =>
      emittedPolicyPath(coreSourceRoot, specifier),
    ),
  ];
}

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
  return assertRuntimeImportClosureExcludes(
    [
      runtimeEnvelopePath(coreSourceRoot, 'execute.ts'),
      runtimeEnvelopePath(coreSourceRoot, 'internal-engine.ts'),
    ],
    executableEnvelopeForbiddenPaths(coreSourceRoot),
    readText,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
  );
}

/** Existing typed handler and source-handler entries are machine-only roots. */
export function assertHandlerEnvelopeDirectClosure(
  coreSourceRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  return assertRuntimeImportClosureExcludes(
    [
      runtimeEnvelopePath(coreSourceRoot, 'handler-entry.ts'),
      runtimeEnvelopePath(coreSourceRoot, 'source-handler.ts'),
    ],
    handlerEnvelopeForbiddenPaths(coreSourceRoot),
    readText,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
    false,
  );
}

/** The public source-handler ABI stays on the same machine-only production closure. */
export function assertPublicHandlerAbiClosure(
  coreSourceRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  return assertRuntimeImportClosureExcludes(
    [resolve(coreSourceRoot, 'runtime-handler.ts')],
    handlerEnvelopeForbiddenPaths(coreSourceRoot),
    readText,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
    false,
  );
}
