import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalImplementationHandoffBytes,
  implementationHandoffTargetIdentity,
  loadCanonicalizerExceptionFlowImplementationHandoff,
  validateCanonicalizerExceptionFlowImplementationHandoff,
  validateCanonicalizerImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import { CURRENT_EMITSTATEMENT_TARGET_M4139 } from './emitstatement-target.mjs';
import { CURRENT_VALIDSTATEMENT_TARGET_M4139 } from './validstatement-target.mjs';

const M4138_EXCEPTION_FLOW_DIGEST =
  '2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('M4.140 freezes the exact published M4.139 exception-flow implementation', () => {
  const handoff = loadCanonicalizerExceptionFlowImplementationHandoff();
  assert.deepEqual(handoff.record.source, {
    canonicalizerSha256: 'd96dee80f12236a3d9089bf44aeee699e6a3c35856e71f79a0743691248ea16e',
    commit: 'e3090ad1ac18d49ff1c0eb7d2de167a23e9b70a8',
    coverageImplementationDigest: '5864acd99c1c1c3bd7d82776e0898082933d9970dafe5eba7fd753840741e9e4',
    coveragePolicySha256: '5a909a0b0d17ab3fafdeb8223bd2b9acd8c491f68284c338ac0a80f3075636c3',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '551d55389b8cfd5bcd93ec9552a78876711b79c8eb03dd026f648cd5342268b2',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: '5b09615e2a0216689429e803291281b01ae678a9a79ca7d6a5fa56279445257d',
  });
  assert.deepEqual(handoff.record.prerequisite, {
    digest: M4138_EXCEPTION_FLOW_DIGEST,
    family: 'exception-flow',
  });
  assert.deepEqual(handoff.record.targets, [
    implementationHandoffTargetIdentity(CURRENT_VALIDSTATEMENT_TARGET_M4139),
    implementationHandoffTargetIdentity(CURRENT_EMITSTATEMENT_TARGET_M4139),
  ]);
  const bytes = readFileSync(
    new URL('./coverage-exception-flow-implementation-handoff.json', import.meta.url),
  );
  assert.deepEqual(canonicalImplementationHandoffBytes(handoff.record), bytes);
  assert.equal(sha256(bytes), handoff.digest);
});

test('M4.140 handoff rejects structural, causal, target, and data-shape drift', () => {
  const handoff = loadCanonicalizerExceptionFlowImplementationHandoff();
  const mutations = [
    (copy) => { copy.extra = true; },
    (copy) => { copy.family = 'future'; },
    (copy) => { copy.milestone = 'M4.141'; },
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.source.coveragePolicySha256 = '0'.repeat(64); },
    (copy) => { copy.source.canonicalizerSha256 = '0'.repeat(64); },
    (copy) => { copy.prerequisite.digest = '0'.repeat(64); },
    (copy) => { copy.prerequisite.family = 'new-expression'; },
    (copy) => { copy.targets.reverse(); },
    (copy) => { copy.targets.pop(); },
    (copy) => { copy.targets[0] = copy.targets[1]; },
    (copy) => { copy.targets[0].bodyDigest = '0'.repeat(64); },
    (copy) => { copy.targets[0].functionOrdinal += 1; },
    (copy) => { copy.targets[0].id = 'future'; },
    (copy) => { copy.targets[0].sourceSha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerExceptionFlowImplementationHandoff(copy),
      /implementation handoff rejection/u,
    );
  }

  const decorated = structuredClone(handoff.record);
  Object.defineProperty(decorated.source, 'commit', {
    enumerable: true,
    get: () => handoff.record.source.commit,
  });
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(decorated),
    /implementation handoff rejection/u,
  );

  const shared = structuredClone(handoff.record);
  shared.targets[1] = shared.targets[0];
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(shared),
    /implementation handoff rejection/u,
  );

  const spoofedTargets = structuredClone(handoff.record);
  spoofedTargets.targets = [null, null];
  spoofedTargets.targets.map = () => handoff.record.targets;
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(spoofedTargets),
    /implementation handoff rejection/u,
  );

  const sparseTargets = structuredClone(handoff.record);
  delete sparseTargets.targets[1];
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(sparseTargets),
    /implementation handoff rejection/u,
  );

  const symbolDecoratedTargets = structuredClone(handoff.record);
  symbolDecoratedTargets.targets[Symbol('hidden')] = true;
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(symbolDecoratedTargets),
    /implementation handoff rejection/u,
  );

  const accessorTargets = structuredClone(handoff.record);
  let accessorRead = false;
  Object.defineProperty(accessorTargets.targets, '0', {
    enumerable: true,
    get: () => {
      accessorRead = true;
      return handoff.record.targets[0];
    },
  });
  assert.throws(
    () => validateCanonicalizerExceptionFlowImplementationHandoff(accessorTargets),
    /implementation handoff rejection/u,
  );
  assert.equal(accessorRead, false);
});

test('generic implementation handoff validation admits ordinal zero and rejects malformed values', () => {
  const record = loadCanonicalizerExceptionFlowImplementationHandoff().record;
  const ordinalZero = structuredClone(record);
  ordinalZero.targets[0].functionOrdinal = 0;
  ordinalZero.targets[0].id =
    `${ordinalZero.targets[0].path}#0:${ordinalZero.targets[0].name}`;
  assert.equal(
    validateCanonicalizerImplementationHandoff(ordinalZero).targets[0].functionOrdinal,
    0,
  );

  const mutations = [
    (copy) => { copy.family = ''; },
    (copy) => { copy.milestone = ''; },
    (copy) => { copy.prerequisite.digest = 'a'.repeat(63); },
    (copy) => { copy.prerequisite.family = ''; },
    (copy) => { copy.source.canonicalizerSha256 = 'A'.repeat(64); },
    (copy) => { copy.source.commit = 'a'.repeat(39); },
    (copy) => { copy.source.coverageImplementationDigest = null; },
    (copy) => { copy.source.coveragePolicySha256 = 'not-a-digest'; },
    (copy) => { copy.source.coverageSummaryFormat = ''; },
    (copy) => { copy.source.coverageSummarySha256 = 'g'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummaryFormat = ''; },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(65); },
    (copy) => { copy.targets[0].bodyDigest = '0'.repeat(63); },
    (copy) => { copy.targets[0].functionOrdinal = -1; },
    (copy) => { copy.targets[0].functionOrdinal = 1.5; },
    (copy) => { copy.targets[0].functionOrdinal = Number.MAX_SAFE_INTEGER + 1; },
    (copy) => { copy.targets[0].id = ''; },
    (copy) => { copy.targets[0].name = ''; },
    (copy) => { copy.targets[0].path = ''; },
    (copy) => { copy.targets[0].sourceSha256 = 'xyz'; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerImplementationHandoff(copy),
      /implementation handoff rejection/u,
    );
  }
});
