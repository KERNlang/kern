import assert from 'node:assert/strict';
import test from 'node:test';

import { listTape } from './decoder.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';
import { __test as moduleSetTest } from './module-set-worker.mjs';
import { loadPolicy, runDocument, runModuleSet } from './worker.mjs';

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
}

function tape(values) {
  return values.map(frame).join('');
}

function rows(value, label) {
  return listTape(value, label).map((row, index) => listTape(row, `${label} ${index}`));
}

function policyWith(overrides) {
  const state = loadPolicy();
  const policy = structuredClone(state.policy);
  Object.assign(policy.profileLimits, overrides);
  return { ...state, policy };
}

function identityContext(result, moduleIds, mode, resourceKind) {
  return {
    moduleCount: moduleIds.length,
    moduleIds,
    mode,
    resourceKind,
    inputSeal: result.receipt.header.inputSeal,
    inputIdentities: result.documents.map(({ receipt }) => ({
      moduleId: receipt.header.moduleId,
      format: receipt.header.format,
      status: receipt.status,
      seal: receipt.seal,
    })),
  };
}

function fullResult() {
  const modules = [
    { moduleId: 'one.kern', source: 'fn name=one export=true\n' },
    { moduleId: 'two.kern', source: 'fn name=two export=true\n' },
  ];
  return { modules, result: runModuleSet(modules) };
}

function proofResult() {
  const modules = [
    { moduleId: 'one.kern', source: 'fn name=one export=true\n' },
    { moduleId: 'two.kern', source: 'fn name=two export=true\n' },
  ];
  const seen = [];
  const result = moduleSetTest.runModuleSetWithOptions(
    runDocument, () => policyWith({ maxModules: 1 }), modules,
    { observe: (event) => seen.push(event) },
  );
  const invocation = seen.find(({ stage }) => stage === 'f4b');
  assert.ok(invocation, 'proof control must capture one real F4B invocation');
  return { modules, result, f4bArguments: invocation.args };
}

function symbolProofResult() {
  const modules = [
    { moduleId: 'one.kern', source: 'fn name=one export=true\n' },
    { moduleId: 'two.kern', source: 'fn name=two export=true\n' },
  ];
  const seen = [];
  const result = moduleSetTest.runModuleSetWithOptions(
    runDocument, () => policyWith({ maxSymbols: 0 }), modules,
    { observe: (event) => seen.push(event) },
  );
  const invocation = seen.find(({ stage }) => stage === 'f4b');
  assert.ok(invocation, 'symbol proof must capture one real F4B invocation');
  return { modules, result, f4bArguments: invocation.args };
}

function coordinatedWitness(fields, mutate) {
  const witness = rows(fields[8], 'witness');
  mutate(witness[0]);
  fields[8] = tape(witness.map(tape));
  fields[9] = `module-set:fatal:${witness[0][2]}:0:0:1:0:0:0:${Array.from(fields[8]).length}:${witness[0][1]}:closed`;
}

function assertDecoderRejects(fields, context, label) {
  assert.throws(() => decodeModuleSet(fields, context), /identity|input|fatal|witness|terminal|fact|field/u, label);
}

test('RP9 decoder accepts a real full .4 result, rejects .3, then rejects each sealed identity coordinate', async (t) => {
  const { modules, result } = fullResult();
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-module-set.4');
  const context = identityContext(result, modules.map(({ moduleId }) => moduleId), 'full', '');
  assert.doesNotThrow(() => decodeModuleSet(result.fields, context));
  const legacy = [...result.fields];
  legacy[0] = 'kern.frontend.f4-module-set.3';
  assertDecoderRejects(legacy, context, 'legacy .3 identity');
  const coordinates = ['moduleId', 'format', 'status', 'seal'];
  for (const [index, coordinate] of coordinates.entries()) {
    await t.test(coordinate, () => {
      const fields = [...result.fields];
      const identities = rows(fields[7], 'full identity');
      const row = identities.at(-1);
      row[index] = index === 0 ? 'other.kern' : index === 1 ? 'kern.frontend.f4-document.1' :
        index === 2 ? 'fatal' : 'b'.repeat(64);
      fields[7] = tape(identities.map(tape));
      assertDecoderRejects(fields, context, `full identity ${coordinate}`);
    });
  }
});

test('RP8/RP9 decoder accepts a real compact proof then rejects proof-only field and terminal drift', async (t) => {
  const { modules, result, f4bArguments } = proofResult();
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-module-set.4');
  const context = {
    ...identityContext(result, modules.map(({ moduleId }) => moduleId), 'resource-prefix', 'maxModules'),
    f4bArguments,
  };
  assert.doesNotThrow(() => decodeModuleSet(result.fields, context));
  const mutations = [
    ['fatal input identity is nonempty', (fields) => { fields[7] = frame('unexpected'); }],
    ['witness kind', (fields) => {
      const witness = rows(fields[8], 'witness');
      witness[0][1] = 'maxBindings';
      fields[8] = tape(witness.map(tape));
    }],
    ['witness crossing count', (fields) => {
      const witness = rows(fields[8], 'witness');
      witness[0][6] = String(Number(witness[0][6]) + 1);
      fields[8] = tape(witness.map(tape));
    }],
    ['F4_LIMIT fact', (fields) => {
      const facts = rows(fields[4], 'facts');
      facts[0][0] = 'F4_INVALID_REQUEST';
      fields[4] = tape(facts.map(tape));
    }],
    ['proof terminal', (fields) => { fields[9] = 'failure'; }],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const fields = [...result.fields];
      mutate(fields);
      assertDecoderRejects(fields, context, label);
    });
  }
});

test('RP9 RED: decoder recomputes compact proof prefix and S/B counts from the captured 18-argument input', async (t) => {
  const { modules, result, f4bArguments } = symbolProofResult();
  assert.equal(f4bArguments.length, 18);
  const context = {
    ...identityContext(result, modules.map(({ moduleId }) => moduleId), 'resource-prefix', 'maxSymbols'),
    f4bArguments,
  };
  assert.doesNotThrow(() => decodeModuleSet(result.fields, context), 'real proof control');

  for (const [label, mutate] of [
    ['prefixCount', (row) => {
      row[3] = '2'; row[4] = '1'; row[6] = '2'; row[7] = '0';
    }],
    ['crossing S/B', (row) => {
      row[4] = '0'; row[5] = '0'; row[6] = '2'; row[7] = '1';
    }],
  ]) {
    await t.test(label, () => {
      const fields = [...result.fields];
      coordinatedWitness(fields, mutate);
      assert.throws(() => decodeModuleSet(fields, context), /resource witness (input|prefix|counts)|input proof drift/u);
    });
  }
});
