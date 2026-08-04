import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

import {
  RUNTIME_DYNAMIC_ESCAPE_BINDINGS,
  RUNTIME_REFLECTIVE_ESCAPE_MEMBERS,
  runtimeModuleSpecifiers,
} from './runtime-contract-v1/runtime-dynamic-loader-boundary.mjs';
import {
  assertExactRuntimeMachineOwners,
  runtimeMachineOwnerPaths,
} from './runtime-contract-v1/runtime-machine-owner-allowlist.mjs';

export { RUNTIME_DYNAMIC_ESCAPE_BINDINGS, RUNTIME_REFLECTIVE_ESCAPE_MEMBERS, runtimeModuleSpecifiers };

function fail(message) {
  throw new Error(`runtime-envelope import closure: ${message}`);
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
  const allowed = runtimeMachineOwnerPaths(coreSourceRoot, '.ts');
  const guardedRead = (path) => {
    if (!allowed.has(path)) fail(`unapproved machine owner ${path}`);
    return readText(path);
  };
  const visited = assertRuntimeImportClosureExcludes(
    [resolve(coreSourceRoot, 'runtime-handler.ts')],
    handlerEnvelopeForbiddenPaths(coreSourceRoot),
    guardedRead,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
    false,
  );
  return assertExactRuntimeMachineOwners(coreSourceRoot, visited, '.ts');
}

/** The emitted public entry must contain the identical enumerated owner graph. */
export function assertPublicHandlerBuiltAbiClosure(
  coreDistRoot,
  readText = (path) => readFileSync(path, 'utf8'),
) {
  const allowed = runtimeMachineOwnerPaths(coreDistRoot, '.js');
  const guardedRead = (path) => {
    if (!allowed.has(path)) fail(`unapproved machine owner ${path}`);
    return readText(path);
  };
  const visited = runtimeJavaScriptImportClosure(
    [resolve(coreDistRoot, 'runtime-handler.js')],
    guardedRead,
    EXECUTABLE_ENVELOPE_ALLOWED_BARE_SPECIFIERS,
    false,
  );
  return assertExactRuntimeMachineOwners(coreDistRoot, visited, '.js');
}
