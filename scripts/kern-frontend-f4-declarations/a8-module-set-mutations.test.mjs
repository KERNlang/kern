import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureF4BModuleSet,
  decodeCapturedModuleSet,
  executeF4BComposition,
  loadPristineF4BComposition,
  replaceF4BExactly,
  runA8ModuleSetControls,
  runA8PostSortMutation,
} from './a8-module-set-support.mjs';
import { referenceModuleGraph } from './m2-reference-graph.mjs';

const FACT_MODULES = Object.freeze([
  { moduleId: 'a.kern', source: 'use path="./missing-a"\nfn name=a export=true\n' },
  { moduleId: 'b.kern', source: 'use path="./missing-b"\nfn name=b export=true\n' },
]);

function comparable(receipt) {
  return {
    rejected: receipt.rejected,
    blocked: receipt.blocked,
    linkFacts: receipt.linkFacts,
    validatedComponents: receipt.validatedComponents.map(({ componentMinimumId, members }) => ({
      componentMinimumId,
      members,
    })),
    bindings: receipt.bindings,
  };
}

test('A8.3 primitives capture, execute, replace, decode, and reference authentic F4B state', () => {
  const captured = captureF4BModuleSet(FACT_MODULES);
  assert.equal(captured.args.length, 18);
  assert.equal(captured.moduleSetRuntimeInvocations, 1);
  assert.equal(captured.receipt.linkFacts.length, 2);
  assert.deepEqual(comparable(captured.receipt), referenceModuleGraph(FACT_MODULES, captured.documents));

  const executed = executeF4BComposition(
    loadPristineF4BComposition(captured.policy),
    structuredClone(captured.args),
    captured.policy,
  );
  assert.equal(executed.envelope, 'success');
  assert.equal(executed.runtimeInvocations, 1);
  assert.deepEqual(executed.fields, captured.fields);
  assert.deepEqual(decodeCapturedModuleSet(executed.fields, captured), captured.receipt);

  assert.deepEqual(replaceF4BExactly('before TARGET after', 'TARGET', 'replacement'), {
    source: 'before replacement after',
    replacementCount: 1,
  });
  assert.throws(() => replaceF4BExactly('no target', 'TARGET', 'replacement'), /exactly one|replacement/iu);
  assert.throws(() => replaceF4BExactly('TARGET TARGET', 'TARGET', 'replacement'), /exactly one|replacement/iu);
  assert.throws(() => replaceF4BExactly('TARGET', 'TARGET', 'TARGET'), /no-op|replacement/iu);
});

test('A8.3 F7 post-sort omission decodes and only the independent M2 reference kills it', () => {
  assert.deepEqual(runA8PostSortMutation(FACT_MODULES), {
    id: 'A8-F7',
    control: 'passed',
    sentinel: 'reached',
    abi: 18,
    runtimeInvocations: 1,
    replacementCount: 1,
    envelope: 'success',
    decoder: 'passed',
    pristineFactCount: 2,
    mutantFactCount: 1,
    omittedCode: 'missing-module',
    omittedModuleId: 'a.kern',
    omittedDetail: 'missing-a.kern',
    retainedExactSuffix: true,
    killedBy: 'm2-reference-mismatch',
  });
});

test('A8.3 twenty permutations and four M2 oracle self-kills are complete', () => {
  assert.deepEqual(runA8ModuleSetControls(), {
    permutationsGenerated: 20,
    permutationsAttempted: 20,
    permutationsMatched: 20,
    oracleCanariesRejected: 4,
  });
});
