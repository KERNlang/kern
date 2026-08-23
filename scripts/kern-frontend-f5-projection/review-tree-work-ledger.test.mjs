import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { listTape } from '../kern-frontend-f4-declarations/decoder.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';
import { COMPOSITION_PATHS, loadPinned, validatePolicy } from './policy-validation.mjs';

const POLICY = validatePolicy(JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8')));
const PINNED = loadPinned(POLICY, new URL('../../', import.meta.url));
const SOURCE = COMPOSITION_PATHS.map((path) => PINNED.get(path)).join('\n');
const item = (value) => `i${Array.from(value).length}:${value}`;
const tape = (values) => values.map(item).join('');
const LIMITS = tape([
  POLICY.profileLimits.maxInstructionScalars,
  POLICY.profileLimits.maxWorkSteps,
  POLICY.profileLimits.maxNodes,
  POLICY.profileLimits.maxDepth,
  POLICY.profileLimits.maxCollectionLength,
  POLICY.profileLimits.maxStringCodePoints,
].map(String));

function mutateRow(tapeValue, rowIndex, mutate) {
  const rows = listTape(tapeValue, 'tree mutation rows');
  const row = listTape(rows[rowIndex], 'tree mutation row');
  mutate(row);
  rows[rowIndex] = tape(row);
  return tape(rows);
}

function runTree(source, mutate) {
  const modules = [{ moduleId: 'case.kern', source }];
  const f4 = runModuleSet(modules);
  const fields = structuredClone(f4.documents[0].fields);
  mutate(fields);
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [LIMITS, fields[4], fields[5], fields[6], fields[7], fields[8], [], []],
    identity: {
      handlerName: 'f5projecttree',
      sourcePath: 'examples/kern-frontend/f5-tree-projection.kern',
    },
    source: SOURCE,
  }, { enabled: true, limits: POLICY.runtimeLimits, scheduler: POLICY.scheduler });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.equal(envelope.completion.kind, 'return');
  assert.equal(envelope.events.length, 0);
  return materialize(envelope.result.value);
}

function propertyDrift(index) {
  return runTree('fn name=main returns=void export=true\n', (fields) => {
    fields[5] = mutateRow(fields[5], index, (row) => {
      row[7] = 'invalid-for-f5';
    });
  });
}

test('F5-A3-R2 late property failure retains completed sibling property work', () => {
  const early = propertyDrift(2);
  const late = propertyDrift(1);
  assert.deepEqual(early.slice(0, 1).concat(early.slice(2)), ['2', 'F5_F4_DRIFT']);
  assert.deepEqual(late.slice(0, 1).concat(late.slice(2)), ['2', 'F5_F4_DRIFT']);
  assert.ok(Number(late[1]) > Number(early[1]));
  assert.deepEqual([Number(early[1]), Number(late[1])], [1520, 2312]);
});

test('F5-A3-R2 an unattached decorator bills both discarded constructions', () => {
  const result = runTree('@trace("main")\ntype name=Main\n', () => {});
  assert.equal(result[0], '0');
  assert.equal(Number(result[1]), 8152);
});

test('F5-A3-R2 post-sort attachment failure retains the property sort terminal', () => {
  const result = runTree('fn name=main export=true\n  handler lang=kern\n', (fields) => {
    fields[7] = mutateRow(fields[7], 0, (row) => {
      row[1] = '999';
    });
  });
  assert.deepEqual(result, ['2', '5148', 'F5_F4_DRIFT']);
});

test('F5-A3-R2 post-sort decorator failure retains the property sort terminal', () => {
  const result = runTree('@trace("main")\nfn name=main export=true\n', (fields) => {
    fields[8] = mutateRow(fields[8], 0, (row) => {
      row[0] = '999';
    });
  });
  assert.deepEqual(result, ['2', '6272', 'F5_F4_DRIFT']);
});
