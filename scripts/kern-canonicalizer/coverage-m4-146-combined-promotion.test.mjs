import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4146CombinedPromotion,
  m4146ActiveKirLimits,
  m4146ActiveProfile,
  m4146ActiveRuntimeByteLimits,
  m4146ParameterMigration,
} from './coverage-m4-146-combined-promotion.mjs';
import {
  loadCanonicalizerPolicy,
  validateCanonicalizerPolicy,
} from './policy.mjs';

const M4145_RECEIPT_DIGEST =
  'e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';

test('M4.146 promotes only the authenticated combined KIR and profile limits', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(assertM4146CombinedPromotion(policy), {
    kirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
    profileLimits: {
      maxNodeRows: 205,
      maxPropertyRows: 332,
      maxValueRows: 6_304,
    },
    runtimeByteLimits: {
      maxBytes: 2_938_944,
      maxStringBytes: 1_469_472,
    },
  });
  assert.deepEqual(m4146ActiveKirLimits(), {
    maxBytes: 367_368,
    maxDepth: 122,
    maxNodes: 7_136,
  });
  assert.deepEqual(m4146ActiveProfile(), {
    maxNodeRows: 205,
    maxPropertyRows: 332,
    maxValueRows: 6_304,
  });
  assert.deepEqual(m4146ActiveRuntimeByteLimits(), {
    maxBytes: 2_938_944,
    maxStringBytes: 1_469_472,
  });
  assert.deepEqual(policy.expansionLimits, {
    kirToSourceMaxFactor: 4,
    runtimeEnvelopeMaxFactor: 2,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
});

test('M4.146 runtime byte ceilings are exact and fail closed one below either factor', () => {
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

test('M4.146 consumes the exact M4.145 promotion-ready receipt', () => {
  const bytes = readFileSync(
    new URL('./combined-headroom-m4-145.json', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    M4145_RECEIPT_DIGEST,
  );
});

test('M4.146 publishes the exact one-function six-row M4.147 queue', () => {
  assert.deepEqual(m4146ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: WITNESS_ID,
      parameterRows: 6,
      profileRows: { nodes: 205, properties: 332, values: 6_304 },
      tool: 'canonicalizer',
    }],
  });
});

test('M4.146 returned copies cannot mutate the published handoff', () => {
  const queue = m4146ParameterMigration();
  queue.witnesses[0].id = 'substituted';
  queue.witnesses.reverse();
  assert.notDeepEqual(queue, m4146ParameterMigration());

  for (const load of [
    m4146ActiveKirLimits,
    m4146ActiveProfile,
    m4146ActiveRuntimeByteLimits,
  ]) {
    const first = load();
    first[Object.keys(first)[0]] = 1;
    assert.notDeepEqual(first, load());
  }
});

