import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4130CombinedPromotion,
  m4130ActiveKirLimits,
  m4130ActiveProfile,
  m4130ActiveRuntimeByteLimits,
  m4130ParameterMigration,
} from './coverage-m4-130-combined-promotion.mjs';
import {
  loadCanonicalizerPolicy,
  validateCanonicalizerPolicy,
} from './policy.mjs';

const M4129_RECEIPT_DIGEST =
  'e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';

test('M4.130 promotes only the authenticated combined KIR and profile limits', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(assertM4130CombinedPromotion(policy), {
    kirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    profileLimits: {
      maxNodeRows: 202,
      maxPropertyRows: 308,
      maxValueRows: 4_493,
    },
    runtimeByteLimits: {
      maxBytes: 2_184_408,
      maxStringBytes: 1_092_204,
    },
  });
  assert.deepEqual(m4130ActiveKirLimits(), {
    maxBytes: 273_051,
    maxDepth: 98,
    maxNodes: 5_313,
  });
  assert.deepEqual(m4130ActiveProfile(), {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  });
  assert.deepEqual(m4130ActiveRuntimeByteLimits(), {
    maxBytes: 2_184_408,
    maxStringBytes: 1_092_204,
  });
  assert.deepEqual(policy.expansionLimits, {
    kirToSourceMaxFactor: 4,
    runtimeEnvelopeMaxFactor: 2,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
});

test('M4.130 runtime byte ceilings are exact and fail closed one below either factor', () => {
  const policy = loadCanonicalizerPolicy();
  assert.equal(
    policy.runtimeLimits.maxStringBytes,
    policy.kirLimits.maxBytes * policy.expansionLimits.kirToSourceMaxFactor,
  );
  assert.equal(
    policy.runtimeLimits.maxBytes,
    policy.runtimeLimits.maxStringBytes *
      policy.expansionLimits.runtimeEnvelopeMaxFactor,
  );
  for (const key of ['maxStringBytes', 'maxBytes']) {
    const copy = structuredClone(policy);
    copy.runtimeLimits[key] -= 1;
    assert.throws(
      () => validateCanonicalizerPolicy(copy),
      /canonicalizer policy rejection/u,
    );
  }
});

test('M4.130 consumes the exact M4.129 promotion-ready receipt', () => {
  const bytes = readFileSync(new URL('./runtime-cost-m4-129.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), M4129_RECEIPT_DIGEST);
});

test('M4.130 publishes the exact one-function 41-row M4.131 queue', () => {
  assert.deepEqual(m4130ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 41,
    witnesses: [{
      id: WITNESS_ID,
      parameterRows: 41,
      profileRows: { nodes: 202, properties: 308, values: 4_493 },
      tool: 'validator',
    }],
  });
});

test('M4.130 queue copies cannot mutate the published handoff', () => {
  const first = m4130ParameterMigration();
  first.witnesses[0].id = 'substituted';
  first.witnesses.reverse();
  assert.notDeepEqual(first, m4130ParameterMigration());
});
