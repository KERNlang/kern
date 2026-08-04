import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import ts from 'typescript';

const runtimeContractProofInventory = JSON.parse(
  readFileSync(new URL('./runtime-contract-v1/proof-inventory.json', import.meta.url), 'utf8'),
);
const forbiddenDynamicBindings = new Set(runtimeContractProofInventory.forbiddenDynamicBindings);
const forbiddenDirectBindings = new Set(
  [...forbiddenDynamicBindings].filter((name) => !['constructor', 'global', 'globalThis', 'module'].includes(name)),
);
export const RUNTIME_DYNAMIC_ESCAPE_BINDINGS = Object.freeze(
  [...runtimeContractProofInventory.forbiddenDynamicBindings],
);

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

function identifierIsNonRuntimeName(node) {
  const parent = node.parent;
  if (ts.isTypeNode(parent) || ts.isQualifiedName(parent)) return true;
  if (
    (ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyAccessExpression(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  );
}

function unwrappedExpression(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isDynamicConstructorAccess(node) {
  if (node.name.text !== 'constructor') return false;
  const parent = node.parent;
  if (
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'constructor')
  ) {
    return true;
  }
  const base = unwrappedExpression(node.expression);
  return ts.isArrowFunction(base) || ts.isFunctionExpression(base) || ts.isClassExpression(base);
}

function hostIdentifier(node) {
  const expression = unwrappedExpression(node);
  return ts.isIdentifier(expression) ? expression.text : null;
}

function isHostLoaderMemberAccess(node) {
  const host = hostIdentifier(node.expression);
  if (host === 'process') return ['_linkedBinding', 'binding', 'getBuiltinModule'].includes(node.name.text);
  if (host === 'module') return node.name.text === 'require';
  return (
    (host === 'globalThis' || host === 'global') &&
    ['Function', 'eval', 'importScripts', 'process', 'require'].includes(node.name.text)
  );
}

function isHostLoaderElementAccess(node) {
  const host = hostIdentifier(node.expression);
  const member = ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
  if (host === 'process') return member === null || ['_linkedBinding', 'binding', 'getBuiltinModule'].includes(member);
  if (host === 'module') return member === null || member === 'require';
  if (host === 'globalThis' || host === 'global') {
    return member === null || ['Function', 'eval', 'importScripts', 'process', 'require'].includes(member);
  }
  if (member !== 'constructor') return false;
  const parent = node.parent;
  return (
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) ||
    (ts.isElementAccessExpression(parent) && parent.expression === node)
  );
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
      ts.isPropertyAccessExpression(node) &&
      (isDynamicConstructorAccess(node) || isHostLoaderMemberAccess(node))
    ) {
      fail(`dynamic loader member ${node.name.text} in ${sourcePath}`);
    } else if (
      ts.isElementAccessExpression(node) &&
      isHostLoaderElementAccess(node)
    ) {
      fail(`computed dynamic binding in ${sourcePath}`);
    } else if (
      ts.isIdentifier(node) &&
      node.text === 'require' &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      fail(`indirect require in ${sourcePath}`);
    } else if (
      ts.isIdentifier(node) &&
      node.text !== 'constructor' &&
      forbiddenDirectBindings.has(node.text) &&
      !identifierIsNonRuntimeName(node)
    ) {
      fail(`forbidden dynamic binding ${node.text} in ${sourcePath}`);
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

function resolveRuntimeImport(
  fromPath,
  specifier,
  allowedBareSpecifiers,
  allowNodeBuiltins,
  preserveJavaScript,
) {
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
  if (preserveJavaScript) return extname(resolved) ? resolved : `${resolved}.js`;
  if (resolved.endsWith('.js') || resolved.endsWith('.mjs')) return resolved.replace(/\.m?js$/u, '.ts');
  return extname(resolved) ? resolved : `${resolved}.ts`;
}

function inspectRuntimeImportClosure(
  entryPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
  allowNodeBuiltins = true,
  preserveJavaScript = false,
) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];

  function visit(path) {
    if (active.has(path)) {
      const cycleStart = stack.indexOf(path);
      cycles.push([...stack.slice(cycleStart), path]);
      return;
    }
    if (visited.has(path)) return;
    active.add(path);
    stack.push(path);
    visited.add(path);
    const source = readText(path);
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      const target = resolveRuntimeImport(
        path,
        specifier,
        allowedBareSpecifiers,
        allowNodeBuiltins,
        preserveJavaScript,
      );
      if (target) visit(target);
    }
    stack.pop();
    active.delete(path);
  }

  for (const entryPath of entryPaths) visit(entryPath);
  return { cycles, visited };
}

function rejectRuntimeModuleCycles(cycles) {
  if (cycles.length === 0) return;
  fail(`runtime module dependency cycle: ${cycles[0].join(' -> ')}`);
}

export function runtimeImportClosure(
  entryPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
  allowNodeBuiltins = true,
) {
  const graph = inspectRuntimeImportClosure(entryPaths, readText, allowedBareSpecifiers, allowNodeBuiltins, false);
  rejectRuntimeModuleCycles(graph.cycles);
  return graph.visited;
}

export function runtimeJavaScriptImportClosure(
  entryPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
  allowNodeBuiltins = false,
) {
  const graph = inspectRuntimeImportClosure(entryPaths, readText, allowedBareSpecifiers, allowNodeBuiltins, true);
  rejectRuntimeModuleCycles(graph.cycles);
  return graph.visited;
}

export function assertRuntimeImportClosureExcludes(
  entryPaths,
  forbiddenPaths,
  readText = (path) => readFileSync(path, 'utf8'),
  allowedBareSpecifiers = new Set(),
  allowNodeBuiltins = true,
) {
  const graph = inspectRuntimeImportClosure(entryPaths, readText, allowedBareSpecifiers, allowNodeBuiltins, false);
  const reachable = graph.visited;
  for (const forbidden of forbiddenPaths) {
    if (reachable.has(forbidden)) fail(`${forbidden} is reachable from ${entryPaths.join(', ')}`);
  }
  rejectRuntimeModuleCycles(graph.cycles);
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
    false,
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
