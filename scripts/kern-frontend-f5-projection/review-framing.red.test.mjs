import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';
import { decodeResult } from './decoder.mjs';
import { COMPOSITION_PATHS, loadPinned, validatePolicy } from './policy-validation.mjs';

const MODULES = [
  { moduleId: 'lib/a.kern', source: 'fn name=a export=true\n' },
  {
    moduleId: 'main.kern',
    source: 'use path="./lib/a"\n  from name=a kind=fn\nfn name=main export=true\n',
  },
];

function directResult(modules, f4, receiptSeals = f4.documents.map(({ receipt }) => receipt.seal)) {
  const policy = validatePolicy(JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8')));
  const pinned = loadPinned(policy, new URL('../../', import.meta.url));
  const source = COMPOSITION_PATHS.map((path) => pinned.get(path)).join('\n');
  const normativeArgs = [
    modules.map(({ moduleId }) => moduleId), f4.documents.flatMap(({ fields }) => fields),
    receiptSeals, f4.fields,
    1, 1, 1, 1, 1, 1, 1,
  ];
  const legacyArgs = [normativeArgs[0], normativeArgs[1], normativeArgs[3], 1, 1];
  const args = /param name=documentReceiptSeals/u.test(source) ? normativeArgs : legacyArgs;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI, arguments: structuredClone(args),
    identity: { handlerName: 'projectf5moduleset', sourcePath: 'examples/kern-frontend/f5-projection-main.kern' },
    source,
  }, { enabled: true, limits: policy.runtimeLimits, scheduler: policy.scheduler });
  assert.equal(envelope.outcome, 'success');
  return decodeResult(materialize(envelope.result.value), policy);
}

function fatalDrift(f4, modules = MODULES) {
  const result = directResult(modules, f4);
  assert.equal(result.status, 'fatal');
  assert.equal(result.code, 'F5_F4_DRIFT');
  assert.equal(result.instructions, null);
}

function changedScalar(value) {
  if (value === '') return 'i0:';
  const points = Array.from(value);
  const colon = points.indexOf(':');
  const index = points.findIndex((point, candidate) =>
    candidate > colon && /[A-Za-z0-9]/u.test(point));
  assert.notEqual(index, -1);
  points[index] = points[index] === 'x' ? 'y' : 'x';
  return points.join('');
}

test('F5-R7 raw F4A fields 3-16 reject shape-preserving drift before low limits', () => {
  const baseline = runModuleSet(MODULES);
  for (let field = 3; field <= 16; field += 1) {
    const mutant = structuredClone(baseline);
    mutant.documents[0].fields[field] = changedScalar(mutant.documents[0].fields[field]);
    assert.doesNotThrow(() => fatalDrift(mutant), `F4A field ${field}`);
  }
});

test('F5-R7 raw F4B fields 2-9 reject framed drift before low limits', () => {
  const baseline = runModuleSet(MODULES);
  for (let field = 2; field <= 9; field += 1) {
    const mutant = structuredClone(baseline);
    mutant.fields[field] = changedScalar(mutant.fields[field]);
    assert.doesNotThrow(() => fatalDrift(mutant), `F4B field ${field}`);
  }
});

test('F5-R7 opaque document seals bind position and cardinality without using field 16', () => {
  const baseline = runModuleSet(MODULES);
  const permuted = structuredClone(baseline);
  [permuted.documents[0].receipt.seal, permuted.documents[1].receipt.seal] =
    [permuted.documents[1].receipt.seal, permuted.documents[0].receipt.seal];
  fatalDrift(permuted);

  const missing = structuredClone(baseline);
  const missingSeals = missing.documents.slice(0, 1).map(({ receipt }) => receipt.seal);
  const missingResult = directResult(MODULES, missing, missingSeals);
  assert.equal(missingResult.status, 'fatal');
  assert.equal(missingResult.code, 'F5_F4_DRIFT');
  assert.equal(missingResult.instructions, null);

  const descriptorIsNotReceiptSeal = structuredClone(baseline);
  descriptorIsNotReceiptSeal.documents[0].receipt.seal = descriptorIsNotReceiptSeal.documents[0].fields[16];
  fatalDrift(descriptorIsNotReceiptSeal);
});

test('F5-R7 duplicate decorator and impossible tree states are drift before limits', () => {
  const decoratedModules = [{
    moduleId: 'decorated.kern',
    source: '@trace("main")\nfn name=main export=true\n',
  }];
  const baseline = runModuleSet(decoratedModules);
  const duplicate = structuredClone(baseline);
  duplicate.documents[0].fields[8] += duplicate.documents[0].fields[8];
  fatalDrift(duplicate, decoratedModules);

  const impossible = structuredClone(runModuleSet(MODULES));
  impossible.documents[0].fields[7] = 'i13:i1:0i1:9i8:attached';
  fatalDrift(impossible);
});
