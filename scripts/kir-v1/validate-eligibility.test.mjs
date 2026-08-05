import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateKirV1Eligibility } from './validate-eligibility.mjs';
import { validateRunnerComposedEvidence } from './validate-runner-composed-evidence.mjs';
import { verifyFixtureWitness } from './verify-fixture-witness.mjs';
import { hostileModules } from '../kir-seam-probe/fixtures.mjs';
import { projectModules as projectModulesForTest } from '../kir-seam-probe/project.mjs';

const policy = JSON.parse(readFileSync('scripts/kir-v1/eligibility.json', 'utf8'));
const acceptedRuntimeAuthority = () => ({ runtimeAbiFrozen: true });

function withRuntimeAuthority(options = {}) {
  return { ...options, validateRuntimeAuthority: acceptedRuntimeAuthority };
}

function mutate(change, options) {
  const copy = structuredClone(policy);
  change(copy);
  return () => validateKirV1Eligibility(copy, withRuntimeAuthority(options));
}

function overlay(path, source) {
  return withRuntimeAuthority({
    readText(sourcePath) {
      return sourcePath === path ? source : readFileSync(sourcePath, 'utf8');
    },
  });
}

test('repository inventory is an explicit Alpha no-go proof', () => {
  const result = validateKirV1Eligibility(structuredClone(policy), withRuntimeAuthority());
  assert.equal(result.proofLabel, 'ALPHA-NO-GO');
  assert.equal(result.sourceNodeCount, policy.sourceCatalog.nodes.length);
  assert.equal(result.witnessedNodeCount, 7);
  assert.equal(result.coveredSourceNodeCount, 302);
  assert.equal(result.unresolvedSourceNodeCount, 0);
  assert.equal(result.runnerContractCount, 16);
  assert.equal(result.witnessedRunnerContractCount, 13);
  assert.equal(result.structurallyBlockedRunnerContractCount, 3);
  assert.equal(result.unclassifiedRunnerContractCount, 0);
});

const inventoryMutations = [
  ['deleted source node', (copy) => copy.sourceCatalog.nodes.pop(), /nodes inventory drifted.*missing/u],
  ['invented source node', (copy) => copy.sourceCatalog.nodes.push('invented-node'), /nodes inventory drifted.*unexpected/u],
  ['reordered source nodes', (copy) => copy.sourceCatalog.nodes.reverse(), /nodes inventory drifted/u],
  ['duplicate source node', (copy) => copy.sourceCatalog.nodes.push(copy.sourceCatalog.nodes[0]), /duplicate/u],
  ['deleted runner contract', (copy) => copy.runnerCatalog.contracts.pop(), /contracts inventory drifted.*missing/u],
  ['invented runner contract', (copy) => copy.runnerCatalog.contracts.push('invented-contract'), /contracts inventory drifted/u],
  ['reordered runner contracts', (copy) => copy.runnerCatalog.contracts.reverse(), /contracts inventory drifted/u],
];

for (const [name, change, error] of inventoryMutations) {
  test(`rejects ${name}`, () => assert.throws(mutate(change), error));
}

test('new live NODE_TYPES entry cannot be absorbed silently', () => {
  const source = readFileSync('packages/core/src/spec.ts', 'utf8').replace(
    "  'expression-v1',\n] as const;",
    "  'expression-v1',\n  'future-node',\n] as const;",
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay('packages/core/src/spec.ts', source)),
    /nodes inventory drifted.*missing future-node/u,
  );
});

test('matching catalog edits still require an explicit coverage row', () => {
  const source = readFileSync('packages/core/src/spec.ts', 'utf8').replace(
    "  'expression-v1',\n] as const;",
    "  'expression-v1',\n  'future-node',\n] as const;",
  );
  const copy = structuredClone(policy);
  copy.sourceCatalog.nodes.push('future-node');
  assert.throws(
    () => validateKirV1Eligibility(copy, overlay('packages/core/src/spec.ts', source)),
    /coverage ledger node ids drifted.*missing future-node/u,
  );
});

test('catalog source binding rejects before repository I/O', () => {
  assert.throws(
    mutate((copy) => { copy.sourceCatalog.path = 'missing/source.ts'; }),
    /nodes source binding changed/u,
  );
});

test('dynamic source catalogs fail closed', () => {
  const source = readFileSync('packages/core/src/spec.ts', 'utf8').replace(
    'export const NODE_TYPES = [',
    "const PREFIX_TYPES = ['screen'];\nexport const NODE_TYPES = [...PREFIX_TYPES,",
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay('packages/core/src/spec.ts', source)),
    /NODE_TYPES\[0\] must remain a string literal/u,
  );
});

test('nested same-name declarations cannot replace the top-level catalog', () => {
  const source = readFileSync('packages/core/src/spec.ts', 'utf8')
    .replace('export const NODE_TYPES = [', 'const REMOVED_NODE_TYPES = [')
    .concat('\nfunction hiddenCatalog() { const NODE_TYPES = [\'screen\']; return NODE_TYPES; }\n');
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay('packages/core/src/spec.ts', source)),
    /missing top-level NODE_TYPES/u,
  );
});

test('candidate witness must match the live internal candidate exactly', () => {
  assert.throws(
    mutate((copy) => copy.candidateWitness.nodeKinds.push('assign')),
    /candidate node kinds drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.candidateWitness.format = 'kern.semantic-kir.v1'; }),
    /candidate format changed or was promoted/u,
  );
});

test('candidate source drift cannot be hidden by editing the inventory', () => {
  const sourcePath = 'packages/core/src/kir-reader-candidate/types.ts';
  const source = readFileSync(sourcePath, 'utf8').replace("  'print',\n", "  'print',\n  'assign',\n");
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, source)),
    /candidate node kinds drifted/u,
  );
});

test('candidate node-kind type union cannot widen by losing its const assertion', () => {
  const sourcePath = 'packages/core/src/kir-reader-candidate/types.ts';
  const source = readFileSync(sourcePath, 'utf8').replace(
    "  'print',\n] as const;",
    "  'print',\n];",
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, source)),
    /KIR_READER_CANDIDATE_NODE_KINDS .* must retain its const assertion/u,
  );
});

test('candidate format is AST-bound independent of quote and spacing style', () => {
  const sourcePath = 'packages/core/src/kir-reader-candidate/types.ts';
  const source = readFileSync(sourcePath, 'utf8').replace(
    "KIR_READER_CANDIDATE_FORMAT = 'kern.semantic-kir.probe.1'",
    'KIR_READER_CANDIDATE_FORMAT=\"kern.semantic-kir.probe.1\"',
  );
  assert.doesNotThrow(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, source)),
  );
  const drifted = source.replace('kern.semantic-kir.probe.1', 'kern.semantic-kir.probe.2');
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, drifted)),
    /candidate format evidence drifted/u,
  );
});

test('candidate fixture is executed through the selected projector', () => {
  assert.deepEqual(new Set(verifyFixtureWitness(policy)), new Set(policy.candidateWitness.nodeKinds));
  const inputs = structuredClone(hostileModules);
  inputs[1].source = inputs[1].source.replace('    print value=twice(21)\n', '    return value=twice(21)\n');
  assert.throws(() => verifyFixtureWitness(policy, inputs), /do not exactly witness/u);
  assert.throws(
    () => verifyFixtureWitness(policy, hostileModules, (modules) => ({
      ...projectModulesForTest(modules),
      format: 'kern.semantic-kir.probe.2',
    })),
    /projected fixture format .* does not match/u,
  );
  const sameKinds = structuredClone(hostileModules);
  sameKinds[1].source = sameKinds[1].source.replace('print value=twice(21)', 'print value=twice(22)');
  assert.throws(() => verifyFixtureWitness(policy, sameKinds), /projected fixture digest .* does not match/u);
});

test('every source node has an explicit exact coverage disposition', () => {
  const included = policy.sourceCoverage.find((row) => row.disposition === 'included-structural');
  assert.throws(
    mutate((copy) => { copy.sourceCoverage = copy.sourceCoverage.filter((row) => row.id !== included.id); }),
    /must exactly match the coverage ledger|source coverage ids drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.sourceCoverage.find((row) => row.id === included.id).witnessId = 'invented'; }),
    /must exactly match the coverage ledger/u,
  );
  assert.throws(
    mutate((copy) => { copy.sourceCoverage.find((row) => row.id === included.id).disposition = 'unresolved'; }),
    /must exactly match the coverage ledger/u,
  );
});

test('every runner contract has an exact composed witness or mechanically derived structural blocker', () => {
  assert.throws(
    mutate((copy) => { copy.runnerCoverage[0].semanticEnvelopeId = 'invented'; }),
    /runner coverage assign drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.runnerCoverage[1].blockerId = 'invented'; }),
    /runner coverage branch drifted/u,
  );
  assert.throws(
    mutate((copy) => copy.runnerCoverage.reverse()),
    /runner coverage while drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.runnerCoverage[0].witnessedRunnerContractCount = 12; }),
    /runnerCoverage\[0\] must contain exactly/u,
  );
});

test('expression-v1 admission leaves exactly the three constitution-derived blockers', () => {
  assert.deepEqual(
    policy.runnerCoverage.filter((row) => row.disposition === 'structural-blocker'),
    [
      {
        id: 'branch',
        disposition: 'structural-blocker',
        blockerId: 'required-on:excluded-host-expression',
        nextMilestone: 'P1-constitution-expansion',
      },
      {
        id: 'each',
        disposition: 'structural-blocker',
        blockerId: 'required-in:excluded-host-expression',
        nextMilestone: 'P1-constitution-expansion',
      },
      {
        id: 'lambda',
        disposition: 'structural-blocker',
        blockerId: 'source-node-absent',
        nextMilestone: 'P1-constitution-expansion',
      },
    ],
  );
  assert.deepEqual(
    policy.runnerCoverage.find((row) => row.id === 'expression-v1'),
    {
      id: 'expression-v1',
      witnessId: 'kir-runtime-compose.expression-v1.v1',
      semanticEnvelopeId: 'binary-seven',
      fixtureId: 'expression-v1-binary-seven',
      oracleId: 'exact-expression-v1-result',
      excludedProperties: ['type:excluded-host-type'],
      disposition: 'internal-composed-witness',
    },
  );
  assert.throws(
    mutate((copy) => {
      copy.runnerCoverage[copy.runnerCoverage.findIndex((row) => row.id === 'expression-v1')] = {
        id: 'expression-v1',
        disposition: 'structural-blocker',
        blockerId: 'required-expr:excluded-host-expression',
        nextMilestone: 'P1-constitution-expansion',
      };
    }),
    /runnerCoverage\[5\] must contain exactly/u,
  );
  assert.throws(
    mutate((copy) => {
      copy.runnerCoverage.find((row) => row.id === 'expression-v1').excludedProperties = [];
    }),
    /runner coverage expression-v1 drifted/u,
  );
});

test('runner witness catalog is AST-bound and digest-bound', () => {
  assert.throws(
    mutate((copy) => { copy.runnerWitnessCatalog.canonicalSha256 = '0'.repeat(64); }),
    /runner witness catalog digest drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.runnerWitnessCatalog.format = 'kern.kir.runner-composed-witnesses.p1.2'; }),
    /runner witness format changed/u,
  );
  const sourcePath = policy.runnerWitnessCatalog.path;
  const source = readFileSync(sourcePath, 'utf8').replace(
    "semanticEnvelopeId: 'integer-seven'",
    "semanticEnvelopeId: 'integer-eight'",
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, source)),
    /runner witness catalog digest drifted/u,
  );
  const dynamic = readFileSync(sourcePath, 'utf8').replace(
    'export const COMPOSED_RUNNER_WITNESSES = [',
    'const PREFIX = [];\nexport const COMPOSED_RUNNER_WITNESSES = [...PREFIX,',
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), overlay(sourcePath, dynamic)),
    /must remain a static object literal/u,
  );
});

test('optional excluded properties stay fully disclosed', () => {
  assert.throws(
    mutate((copy) => { copy.runnerCoverage.find((row) => row.id === 'capability').excludedProperties = []; }),
    /runner coverage capability drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.runnerCoverage.find((row) => row.id === 'assign').excludedProperties = ['invented:excluded-host-type']; }),
    /runner coverage assign drifted/u,
  );
});

test('runner coverage object key order is not policy-significant', () => {
  const copy = structuredClone(policy);
  copy.runnerCoverage[0] = Object.fromEntries(Object.entries(copy.runnerCoverage[0]).reverse());
  assert.doesNotThrow(() => validateKirV1Eligibility(copy, withRuntimeAuthority()));
});

test('constitution property order is not evidence-significant and duplicate exclusions reject', () => {
  const constitutionPath = 'scripts/kir-structural/constitution.json';
  const constitution = JSON.parse(readFileSync(constitutionPath, 'utf8'));
  constitution.properties.reverse();
  assert.doesNotThrow(() => validateRunnerComposedEvidence(
    policy.runnerWitnessCatalog,
    policy.runnerCoverage,
    policy.runnerCatalog.contracts,
    (sourcePath) => sourcePath === constitutionPath ? JSON.stringify(constitution) : readFileSync(sourcePath, 'utf8'),
  ));

  const witnessPath = policy.runnerWitnessCatalog.path;
  const witnessSource = readFileSync(witnessPath, 'utf8').replace(
    "excludedProperties: ['input:excluded-host-expression']",
    "excludedProperties: ['input:excluded-host-expression', 'input:excluded-host-expression']",
  );
  assert.throws(
    () => validateRunnerComposedEvidence(
      policy.runnerWitnessCatalog,
      policy.runnerCoverage,
      policy.runnerCatalog.contracts,
      (sourcePath) => sourcePath === witnessPath ? witnessSource : readFileSync(sourcePath, 'utf8'),
    ),
    /must not contain duplicates/u,
  );
});

test('structural blockers are derived from the live constitution', () => {
  const constitutionPath = 'scripts/kir-structural/constitution.json';
  const constitution = JSON.parse(readFileSync(constitutionPath, 'utf8'));
  constitution.nodes.push({
    id: 'lambda',
    schemaStatus: 'bound',
    allowedChildren: null,
    disposition: 'structural-candidate',
    reasonId: 'schema-bound',
  });
  assert.throws(
    () => validateRunnerComposedEvidence(
      policy.runnerWitnessCatalog,
      policy.runnerCoverage,
      policy.runnerCatalog.contracts,
      (sourcePath) => sourcePath === constitutionPath
        ? JSON.stringify(constitution)
        : readFileSync(sourcePath, 'utf8'),
    ),
    /runner lambda requires a composed witness/u,
  );

  const branch = JSON.parse(readFileSync(constitutionPath, 'utf8'));
  branch.properties.find((property) => property.nodeKind === 'branch' && property.propertyName === 'on').required = false;
  assert.throws(
    () => validateRunnerComposedEvidence(
      policy.runnerWitnessCatalog,
      policy.runnerCoverage,
      policy.runnerCatalog.contracts,
      (sourcePath) => sourcePath === constitutionPath ? JSON.stringify(branch) : readFileSync(sourcePath, 'utf8'),
    ),
    /runner branch requires a composed witness/u,
  );
});

test('blocker identity and scope cannot be weakened', () => {
  assert.throws(mutate((copy) => copy.blockers.pop()), /blocker ids drifted/u);
  assert.throws(
    mutate((copy) => { copy.blockers[0].appliesTo = 'optional'; }),
    /diagnostic-location-evidence changed scope/u,
  );
  assert.throws(
    mutate((copy) => { copy.blockers[0].detail = ''; }),
    /blockers\[0\]\.detail must be non-empty/u,
  );
});

test('coverage ledger binding is digest-bound and cannot be promoted silently', () => {
  assert.throws(
    mutate((copy) => { copy.coverageWitnessLedger.canonicalSha256 = '0'.repeat(64); }),
    /coverage ledger digest drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.coverageWitnessLedger.format = 'kern.kir.v1'; }),
    /coverage ledger format changed/u,
  );
});

test('semantic identity cannot admit trivia or evidence', () => {
  assert.throws(
    mutate((copy) => copy.identity.semanticIncludes.push('comments')),
    /semantic identity inclusions drifted/u,
  );
  assert.throws(
    mutate((copy) => copy.identity.semanticExcludes.splice(copy.identity.semanticExcludes.indexOf('source-locations'), 1)),
    /semantic identity exclusions drifted/u,
  );
  assert.throws(
    mutate((copy) => { copy.identity.evidenceEnvelopeVersionedSeparately = false; }),
    /evidenceEnvelopeVersionedSeparately changed/u,
  );
});

test('portable location decisions cannot drift', () => {
  assert.throws(
    mutate((copy) => { copy.identity.locationOffsets = 'utf16-code-units'; }),
    /locationOffsets changed/u,
  );
  assert.throws(
    mutate((copy) => { copy.identity.locationEnd = 'inclusive'; }),
    /locationEnd changed/u,
  );
});

test('resource policy cannot hide or duplicate a required config key', () => {
  assert.throws(
    mutate((copy) => copy.requiredLimitConfigKeys.pop()),
    /required limit config keys drifted/u,
  );
  assert.throws(
    mutate((copy) => copy.requiredLimitConfigKeys.push(copy.requiredLimitConfigKeys[0])),
    /duplicate/u,
  );
});

test('unknown input and fallback policy remain fail closed', () => {
  for (const key of Object.keys(policy.skewPolicy)) {
    assert.throws(
      mutate((copy) => { copy.skewPolicy[key] = key === 'fallback' ? 'source' : 'ignore'; }),
      new RegExp(`skewPolicy\\.${key}`),
      key,
    );
  }
});

test('Phase 1.1 claims only the independently frozen runtime ABI', () => {
  for (const claim of ['kirV1Frozen', 'alphaAccepted', 'publicExport', 'semanticCutover']) {
    assert.throws(
      mutate((copy) => { copy.claims[claim] = true; }),
      new RegExp(`${claim} must remain false`),
      claim,
    );
  }
  assert.throws(
    mutate((copy) => { copy.claims.runtimeAbiFrozen = false; }),
    /runtimeAbiFrozen must remain true/u,
  );
  assert.throws(
    mutate((copy) => { copy.decision = 'go'; }),
    /must remain ALPHA-NO-GO/u,
  );
  assert.throws(
    () => validateKirV1Eligibility(structuredClone(policy), {
      validateRuntimeAuthority: () => ({ runtimeAbiFrozen: false }),
    }),
    /requires anchored runtime contract evidence/u,
  );
});

test('only public versioned KIR-to-runtime cutover remains deferred', () => {
  assert.throws(
    mutate((copy) => { copy.deferredContracts[0].id = 'internal-decoded-module-kir-binding'; }),
    /Phase 1 deferred contracts changed/u,
  );
  assert.throws(
    mutate((copy) => { copy.deferredContracts[0].milestone = 'M3'; }),
    /Phase 1 deferred contracts changed/u,
  );
  assert.throws(
    mutate((copy) => copy.deferredContracts.pop()),
    /Phase 1 deferred contracts changed/u,
  );
});
