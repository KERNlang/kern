import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_LINE_COUNTS,
  DIST_RUNTIME_EXPORTS,
  EXPECTED_IMPORT_EDGES,
  EXPECTED_LINKED_TS_NAMES,
  FILE_LINE_CEILING,
  LINE_BUDGETS,
  SOURCE_EXPORTS,
  WALKER_RESOURCED_EXPORTS,
} from './pins.mjs';
import {
  LINKED_DIR,
  importSpecifiers,
  lineCount,
  linkedTypeScriptNames,
  reExportBlocks,
  readLinkedSource,
} from './support.mjs';

const DIST_INDEX = '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
const DIST_CONTRACTS = '../../packages/core/dist/kir-runtime/linked-kir-program/contracts.js';

test('the linked-kir-program directory holds exactly the seven pinned TypeScript files', () => {
  assert.deepEqual(
    linkedTypeScriptNames(),
    [...EXPECTED_LINKED_TS_NAMES].sort(),
    'D0_FILE_SET_DRIFT: the linked-kir-program TypeScript file set is not the pinned seven',
  );
});

test('every linked-kir-program file is under the 500-line rule', () => {
  for (const name of linkedTypeScriptNames()) {
    const lines = lineCount(`${LINKED_DIR}/${name}`);
    assert.ok(
      lines < FILE_LINE_CEILING,
      `D0_LINE_RULE: ${name} is ${lines} lines, which is not under ${FILE_LINE_CEILING}`,
    );
  }
});

test('each split file lands inside its own headroom budget', () => {
  for (const name of EXPECTED_LINKED_TS_NAMES) {
    const budget = LINE_BUDGETS[name];
    assert.equal(typeof budget, 'number', `D0_BUDGET_MISSING: ${name} has no pinned budget`);
    const lines = lineCount(`${LINKED_DIR}/${name}`);
    assert.ok(
      lines <= budget,
      `D0_HEADROOM: ${name} is ${lines} lines, over its ${budget}-line budget`,
    );
  }
});

test('contracts.ts and link.ts actually shrink from their base sizes', () => {
  for (const [name, base] of Object.entries(BASE_LINE_COUNTS)) {
    const lines = lineCount(`${LINKED_DIR}/${name}`);
    if (name === 'contracts.ts' || name === 'link.ts') {
      assert.ok(lines < base, `D0_NO_SHRINK: ${name} is still ${lines} lines, not below ${base}`);
    } else {
      assert.equal(lines, base, `D0_UNRELATED_TOUCH: ${name} moved from ${base} to ${lines} lines`);
    }
  }
});

test('the intra-directory import graph is exactly the acyclic INV-2 shape', () => {
  const edges = {};
  for (const name of linkedTypeScriptNames()) {
    edges[name] = [...new Set(importSpecifiers(readLinkedSource(name)))].sort();
  }
  assert.deepEqual(
    edges,
    Object.fromEntries(
      Object.entries(EXPECTED_IMPORT_EDGES).map(([name, specifiers]) => [name, [...specifiers]]),
    ),
    'D0_IMPORT_GRAPH: the intra-directory import graph is not the pinned INV-2 DAG',
  );
});

test('the intra-directory import graph has no cycle', () => {
  const edges = new Map(
    linkedTypeScriptNames().map((name) => [
      name,
      importSpecifiers(readLinkedSource(name)).map((specifier) => specifier.replace(/\.js$/u, '.ts')),
    ]),
  );
  const state = new Map();
  function visit(name, trail) {
    if (state.get(name) === 'done') return;
    assert.notEqual(
      state.get(name),
      'open',
      `D0_IMPORT_CYCLE: ${[...trail, name].join(' -> ')} is a cycle`,
    );
    state.set(name, 'open');
    for (const next of edges.get(name) ?? []) visit(next, [...trail, name]);
    state.set(name, 'done');
  }
  for (const name of edges.keys()) visit(name, []);
});

test('index.ts re-exports the same thirty-nine source names', () => {
  const names = [...reExportBlocks(readLinkedSource('index.ts')).values()].flat();
  assert.deepEqual(
    [...new Set(names)].sort(),
    [...SOURCE_EXPORTS].sort(),
    'D0_PUBLIC_SURFACE: the index.ts source re-export list drifted from the pinned thirty-nine',
  );
  assert.equal(names.length, 39, 'D0_PUBLIC_SURFACE: a name is re-exported from two source files');
});

test('the four walker names are re-sourced from ./walkers.js', () => {
  const blocks = reExportBlocks(readLinkedSource('index.ts'));
  assert.deepEqual(
    blocks.get('./walkers.js') ?? [],
    [...WALKER_RESOURCED_EXPORTS].sort(),
    'D0_PUBLIC_SURFACE: the ./walkers.js re-export block is not the four pinned names',
  );
});

test('the built index.js exposes exactly the eighteen pinned runtime bindings', async () => {
  const module = await import(new URL(DIST_INDEX, import.meta.url).href);
  assert.deepEqual(
    Object.keys(module).sort(),
    [...DIST_RUNTIME_EXPORTS].sort(),
    'D0_PUBLIC_SURFACE: the built linked-kir-program runtime surface drifted',
  );
});

test('the built contracts.js keeps LINKED_KIR_TYPE_ADMISSION for rt6', async () => {
  const module = await import(new URL(DIST_CONTRACTS, import.meta.url).href);
  assert.ok(
    'LINKED_KIR_TYPE_ADMISSION' in module,
    'D0_RT6_REACH_PAST: dist contracts.js must keep exporting LINKED_KIR_TYPE_ADMISSION',
  );
});
