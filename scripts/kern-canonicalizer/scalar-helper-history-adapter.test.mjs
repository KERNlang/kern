import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  POST_HOST_COMPANION_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as COMPANION_ROWS,
} from './host-companion-history-4-6-transition-module.mjs';
import {
  reconstructM4145CompiledCoreJavaScriptPaths,
  reconstructRunnerCallCacheCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import { scalarHelperHistoryOverrides } from './scalar-helper-history-coverage-adapter.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as SCALAR4_ROWS,
} from './scalar-helper-history-4-6-transition-module.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS as OLD_ROWS,
} from './scalar-helper-history-transition.mjs';

const ADAPTER_PATH = resolve(process.cwd(), 'scripts/kern-canonicalizer/scalar-helper-history-coverage-adapter.mjs');
const DIST = resolve(process.cwd(), 'packages/core/dist');

function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(relative(DIST, path).split(sep).join('/'));
    }
  }
  return output.sort();
}

function functionBlock(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `missing exported ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing ${name} body`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`unterminated ${name} body`);
}

const FACTORIES = [
  'createValidatedScalarHelperHistory4_6CompiledPredecessor',
  'createValidatedHostCompanionHistory4_6CompiledPredecessor',
  'createValidatedScalarHelperHistoryCompiledPredecessor',
];

function testBlock(source, name) {
  const start = source.indexOf(`test('${name}',`);
  assert.notEqual(start, -1, `missing ${name} test`);
  const next = source.indexOf("\ntest('", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function assertCanonicalRegistryFactory(source) {
  const body = functionBlock(source, 'createScalarHelperHistoryPredecessorRegistry');
  assert.match(body, /return\s+Object\.freeze\(\[/u, 'factory must return an immutable registry');
  assert.equal(
    (body.match(/createValidated[A-Za-z0-9_$]*Predecessor\(/gu) ?? []).length,
    FACTORIES.length,
    'factory must create exactly the three validated stage peelers',
  );
  let previous = -1;
  for (const factory of FACTORIES) {
    const index = body.indexOf(`${factory}(`);
    assert.ok(index > previous, `factory must include ${factory} in canonical order`);
    previous = index;
  }
}

function assertOnceOnlyRegistry(source) {
  assertCanonicalRegistryFactory(source);
  const body = functionBlock(source, 'scalarHelperHistoryOverrides');
  const loop = body.indexOf('for (const path of historicalPaths)');
  assert.notEqual(loop, -1, 'adapter must retain the historical path loop');
  const beforeLoop = body.slice(0, loop);
  const insideLoop = body.slice(loop);
  assert.match(
    beforeLoop,
    /const\s+registry\s*=\s*createScalarHelperHistoryPredecessorRegistry\(/u,
    'adapter must create the canonical registry before the path loop',
  );
  assert.doesNotMatch(
    body,
    /\b(?:Object\.freeze|createValidated[A-Za-z0-9_$]*Predecessor)\(/u,
    'adapter must not reinline the canonical registry or direct factories',
  );
  assert.doesNotMatch(
    insideLoop,
    /\b(?:validate[A-Za-z0-9]*HistoricalTransition|at[A-Za-z0-9]*Predecessor)\(/u,
    'adapter must not validate or invoke direct predecessor APIs per path',
  );
  assert.match(
    insideLoop,
    /const\s+predecessor\s*=\s*composeScalarHelperHistoryPredecessor\(/u,
    'adapter must compose each path through the exported registry composer',
  );
}

function assertRuntimeUsesCanonicalRegistry(source) {
  assert.match(
    source,
    /createScalarHelperHistoryPredecessorRegistry/u,
    'runtime-text-cache test must import the canonical registry factory',
  );
  const body = testBlock(source, 'runtime text cache retained owners reconstruct exact clean baseline bytes');
  assert.match(
    body,
    /const\s+registry\s*=\s*createScalarHelperHistoryPredecessorRegistry\(/u,
    'runtime-text-cache test must create the canonical registry',
  );
  assert.match(
    body,
    /composeScalarHelperHistoryPredecessor\(\s*registry,/u,
    'runtime-text-cache test must use the exported registry composer',
  );
  assert.doesNotMatch(
    body,
    /\b(?:Object\.freeze|createValidated[A-Za-z0-9_$]*Predecessor)\(/u,
    'runtime-text-cache test must not create a local partial registry',
  );
}

test('canonical registry guard rejects omitted stages and re-inlined registries in memory', () => {
  const validAdapter = `export function createScalarHelperHistoryPredecessorRegistry(paths) {
  return Object.freeze([
    createValidatedScalarHelperHistory4_6CompiledPredecessor(),
    createValidatedHostCompanionHistory4_6CompiledPredecessor(),
    createValidatedScalarHelperHistoryCompiledPredecessor(paths),
  ]);
}
export function composeScalarHelperHistoryPredecessor(registry, path, current) { return current; }
export function scalarHelperHistoryOverrides(root, paths, historicalPaths) {
  const registry = createScalarHelperHistoryPredecessorRegistry(paths);
  for (const path of historicalPaths) {
    const predecessor = composeScalarHelperHistoryPredecessor(registry, path, current);
  }
}`;
  const validRuntime = `import {
  composeScalarHelperHistoryPredecessor,
  createScalarHelperHistoryPredecessorRegistry,
} from './scalar-helper-history-coverage-adapter.mjs';
test('runtime text cache retained owners reconstruct exact clean baseline bytes', () => {
  const registry = createScalarHelperHistoryPredecessorRegistry(paths);
  const result = composeScalarHelperHistoryPredecessor(registry, path, current);
});`;
  assert.doesNotThrow(() => assertOnceOnlyRegistry(validAdapter));
  assert.doesNotThrow(() => assertRuntimeUsesCanonicalRegistry(validRuntime));
  const omitted = validAdapter.replace(
    '    createValidatedHostCompanionHistory4_6CompiledPredecessor(),\n',
    '',
  );
  assert.throws(() => assertOnceOnlyRegistry(omitted), /exactly the three/u);
  const reInlined = validAdapter.replace(
    'const registry = createScalarHelperHistoryPredecessorRegistry(paths);',
    'const registry = Object.freeze([createValidatedScalarHelperHistory4_6CompiledPredecessor()]);',
  );
  assert.throws(() => assertOnceOnlyRegistry(reInlined), /canonical registry/u);
  const localPartialRuntime = validRuntime.replace(
    'const registry = createScalarHelperHistoryPredecessorRegistry(paths);',
    'const registry = Object.freeze([createValidatedScalarHelperHistory4_6CompiledPredecessor()]);',
  );
  assert.throws(() => assertRuntimeUsesCanonicalRegistry(localPartialRuntime), /canonical registry/u);
});

test('adapter uses one canonical registry and exported composer before per-path peeling', () => {
  assertOnceOnlyRegistry(readFileSync(ADAPTER_PATH, 'utf8'));
});

test('runtime text cache test uses the canonical registry and exported composer', () => {
  const runtimePath = resolve(process.cwd(), 'scripts/kern-canonicalizer/runtime-text-cache-historical-transition.test.mjs');
  assertRuntimeUsesCanonicalRegistry(readFileSync(runtimePath, 'utf8'));
});

test('adapter produces every disjoint historical predecessor byte map', () => {
  const paths = reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledPaths());
  const historicalPaths = reconstructM4145CompiledCoreJavaScriptPaths(paths);
  const overrides = scalarHelperHistoryOverrides(DIST, paths, historicalPaths);
  const oldByPath = new Map(OLD_ROWS.map((row) => [row.path, row]));
  const scalar4Paths = new Set(SCALAR4_ROWS.map((row) => row.path));

  for (const row of SCALAR4_ROWS) {
    assert.deepEqual(
      overrides.get(row.path),
      Buffer.from(oldByPath.get(row.path).replacements[0].historical),
      `scalar4 ${row.path} must peel through the old scalar predecessor`,
    );
  }
  for (const row of COMPANION_ROWS) {
    assert.deepEqual(
      overrides.get(row.path),
      Buffer.from(row.replacements[0].historical),
      `companion ${row.path} must stop at its 8a predecessor`,
    );
  }
  for (const row of OLD_ROWS.filter((row) => !scalar4Paths.has(row.path))) {
    assert.deepEqual(
      overrides.get(row.path),
      Buffer.from(row.replacements[0].historical),
      `unchanged old scalar ${row.path} must peel directly to 7efa`,
    );
  }
});
