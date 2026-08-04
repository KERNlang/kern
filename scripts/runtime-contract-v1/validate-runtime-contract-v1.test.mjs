import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RUNTIME_CONTRACT_PATHS, validateRuntimeContractV1 } from './validate-runtime-contract-v1.mjs';

const texts = Object.fromEntries(Object.entries(RUNTIME_CONTRACT_PATHS).map(([id, path]) => [id, readFileSync(path, 'utf8')]));

function overlay(id, transform) {
  return {
    readText(path) {
      const entry = Object.entries(RUNTIME_CONTRACT_PATHS).find(([, candidate]) => candidate === path);
      if (!entry) throw new Error(`unexpected path ${path}`);
      const [candidateId] = entry;
      return candidateId === id ? transform(texts[candidateId]) : texts[candidateId];
    },
  };
}

function mutateJson(id, change) {
  return overlay(id, (text) => {
    const value = JSON.parse(text);
    change(value);
    return `${JSON.stringify(value, null, 2)}\n`;
  });
}

test('candidate constitution, literal goldens, and lineage validate without promotion', () => {
  const result = validateRuntimeContractV1();
  assert.equal(result.abi, 'kern.runtime.handler.v1');
  assert.equal(result.caseCount, 12);
  assert.equal(result.runtimeAbiFrozen, false);
});

for (const [name, id, change, error] of [
  ['promoted candidate claim', 'constitution', (value) => { value.claims.runtimeAbiFrozen = true; }, /must not promote/u],
  ['invented diagnostic', 'constitution', (value) => value.diagnostics.codes.push('invented'), /diagnostic codes drifted/u],
  ['raw Trace admission', 'constitution', (value) => value.forbiddenPublicTypes.shift(), /lineage constitution digest drifted/u],
  ['unconditional determinism', 'constitution', (value) => { value.determinism.unconditional = true; }, /unconditional determinism/u],
  ['self authority', 'constitution', (value) => { value.authority = 'self'; }, /keys drifted|supplies its own authority/u],
  ['deleted proof cell', 'proofInventory', (value) => value.behavior.pop(), /behavior proof ids drifted/u],
  ['dynamic-loader proof shrink', 'proofInventory', (value) => value.forbiddenDynamicBindings.pop(), /forbidden dynamic bindings drifted/u],
  ['declaration schema widening', 'declarationSchema', (value) => { value.declarations[10] = value.declarations[10].replace('unknown', 'any'); }, /lineage declaration schema digest drifted/u],
  ['deleted golden', 'goldens', (value) => value.cases.pop(), /golden case ids drifted/u],
  ['changed golden bytes', 'goldens', (value) => { value.envelopes['success-typed-return'].outcome = 'failure'; }, /lineage goldens digest drifted/u],
  ['scheduler witness imbalance', 'goldens', (value) => { value.schedulerEffects[1].listenerRemoves = 0; }, /golden scheduler effect witnesses drifted/u],
  ['rewritten lineage digest', 'lineage', (value) => { value.versions[0].constitutionSha256 = '0'.repeat(64); }, /digest drifted/u],
  ['self-validating lineage', 'lineage', (value) => { value.versions[0].commit = '0'.repeat(40); }, /keys drifted|supplies its own authority/u],
]) {
  test(`validator rejects ${name}`, () => {
    assert.throws(() => validateRuntimeContractV1(mutateJson(id, change)), error);
  });
}

test('noncanonical bytes reject before semantic validation', () => {
  assert.throws(() => validateRuntimeContractV1(overlay('constitution', (text) => ` ${text}`)), /bytes must remain canonical/u);
});
