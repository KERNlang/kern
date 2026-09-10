import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { occurrencesOf, repositoryLineCount, repositoryText } from './k0-support.mjs';
import {
  BASE_COMMIT,
  BYTE_IDENTICAL_MODULES,
  EXTRACTED_MODULES,
  EXTRACTION_LINE_BUDGET,
  FILE_LINE_CEILING,
  LINE_BUDGETS,
} from './pins.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const LINKED_DIR = 'packages/core/src/kir-runtime/linked-kir-program';

function importSpecifiers(source) {
  return [...source.matchAll(/from\s+'\.\/([A-Za-z0-9._-]+\.js)'/gu)].map((match) => match[1]);
}

test('every file the extraction touches is inside its pinned budget and under the ceiling', () => {
  for (const [path, budget] of Object.entries(LINE_BUDGETS)) {
    const lines = repositoryLineCount(path);
    assert.ok(lines <= budget, `E0_HEADROOM: ${path} is ${lines} lines, over its ${budget}-line budget`);
    assert.ok(lines < FILE_LINE_CEILING, `E0_LINE_RULE: ${path} is ${lines} lines, not under ${FILE_LINE_CEILING}`);
    assert.ok(
      lines < EXTRACTION_LINE_BUDGET,
      `E0_WORKING_CEILING: ${path} is ${lines} lines, and E.0 exists to keep it under ${EXTRACTION_LINE_BUDGET}`,
    );
  }
});

test('the three extracted modules exist and each carries the declarations it was given', () => {
  const markers = {
    'packages/core/src/compiler/kir-js-esm/statement-source.ts': [
      'export function blockSource(',
      'function forSource(',
      'function whileSource(',
      'function leafSource(',
      'function capabilitySource(',
      'function expressionSource(',
      'export function statementsContainTryFamily(',
    ],
    'packages/core/src/kir-runtime/linked-kir-program/loop-statements.ts': [
      'export function compileFor(',
      'export function compileWhile(',
      'function loopBound(',
      'const LOOP_STEP_ONE:',
    ],
    'packages/core/src/kir-runtime/statement-walker.ts': [
      'export function* walkStatements(',
      'const enterTrip = ',
      'interface ForLoopState {',
      'interface WalkFrame {',
      'function* statementValue(',
    ],
  };
  for (const path of EXTRACTED_MODULES) {
    const source = repositoryText(path);
    for (const marker of markers[path]) {
      assert.equal(occurrencesOf(source, marker), 1, `E0_EXTRACTION_MISSING: ${path} must declare ${marker} once`);
    }
  }
});

// The kernel concatenation is what both frozen SHA pins hash. If it travelled with the statement
// lowering, the digests would move and every downstream pin with it.
test('the kernel concatenation and its digest stayed in emitter.ts', () => {
  const emitter = repositoryText('packages/core/src/compiler/kir-js-esm/emitter.ts');
  assert.equal(occurrencesOf(emitter, 'const KERNEL_SOURCE = '), 1);
  assert.equal(occurrencesOf(emitter, 'export const TARGET_KERNEL_SHA256 = sha256(KERNEL_SOURCE);'), 1);
  const moved = repositoryText('packages/core/src/compiler/kir-js-esm/statement-source.ts');
  assert.equal(occurrencesOf(moved, 'KERNEL_SOURCE'), 0, 'E0_KERNEL_MOVED: the kernel must not travel with the lowering');
  assert.equal(occurrencesOf(moved, 'TARGET_KERNEL_SHA256'), 0);
});

test('the Python emitter is byte-identical to the extraction base', () => {
  for (const path of BYTE_IDENTICAL_MODULES) {
    const diff = execFileSync('git', ['diff', '--numstat', BASE_COMMIT, '--', path], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(diff.trim(), '', `E0_PYTHON_TOUCHED: ${path} must be byte-identical to ${BASE_COMMIT}`);
  }
});

// d0 pins this DAG for the linked directory and E.0 must not be the slice that breaks it: the loop
// compilers take the block compiler as an argument precisely so this row stays green.
test('the linked-kir-program import graph is still a DAG and holds loop-statements.ts', () => {
  const names = readdirSync(`${ROOT}${LINKED_DIR}`)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.ok(names.includes('loop-statements.ts'), 'E0_EXTRACTION_MISSING: loop-statements.ts is not in the directory');
  const edges = new Map(
    names.map((name) => [
      name,
      importSpecifiers(repositoryText(`${LINKED_DIR}/${name}`)).map((specifier) => specifier.replace(/\.js$/u, '.ts')),
    ]),
  );
  const state = new Map();
  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    assert.notEqual(state.get(name), 'open', `E0_IMPORT_CYCLE: ${[...trail, name].join(' -> ')} is a cycle`);
    state.set(name, 'open');
    for (const next of edges.get(name) ?? []) visit(next, [...trail, name]);
    state.set(name, 'done');
  };
  for (const name of edges.keys()) visit(name, []);
  assert.equal(
    edges.get('loop-statements.ts').includes('statements.ts'),
    false,
    'E0_IMPORT_CYCLE: loop-statements.ts must not import the dispatcher back',
  );
});

// The RT-1 walk and the expression evaluator ARE mutually recursive, so their split is a real ESM
// cycle. It is allowed only because it is provably safe: both modules export hoisted declarations
// and read nothing across the cycle at module-evaluation time. This row proves it loads either way.
test('the walker cycle resolves in both import orders', async () => {
  const walkerFirst = await import('../../packages/core/dist/kir-runtime/statement-walker.js');
  const evaluatorAfter = await import('../../packages/core/dist/kir-runtime/expression.js');
  assert.equal(typeof walkerFirst.walkStatements, 'function');
  assert.equal(typeof evaluatorAfter.evaluateExpression, 'function');
  assert.equal(walkerFirst.ENTRY_WALK_POLICY.returnCode, 'invalid-handler-result');
  for (const name of ['ENTRY_WALK_POLICY', 'HELPER_WALK_POLICY', 'WALK_SEED', 'walkStatements']) {
    assert.ok(name in evaluatorAfter, `E0_SURFACE_LOST: expression.js must still export ${name}`);
  }
});
