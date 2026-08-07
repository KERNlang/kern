import assert from 'node:assert/strict';
import test from 'node:test';

import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import { parseWithMutableNodeTypeRegistrySnapshot } from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import {
  evaluateMutableNodeTypeRegistryFixture,
  executeMutableNodeTypeRegistrySnapshot,
  executeMutableNodeTypeRegistrySnapshotFields,
  loadMutableNodeTypeRegistrySnapshotSource,
  parseMutableNodeTypeRegistrySnapshotEnvelope,
  runtimeForFixture,
  validateNativeMutableNodeTypeRegistrySnapshotSource,
} from '../check-kern-frontend-mutable-node-type-registry-snapshot.mjs';
import { MUTABLE_REGISTRY_SNAPSHOT_FIXTURES } from './fixtures.mjs';
import { normalizeMutableNodeTypeRegistrySnapshotOracle } from './oracle.mjs';
import {
  loadFrontendMutableNodeTypeRegistrySnapshotPolicy,
  validateFrontendMutableNodeTypeRegistrySnapshotPolicy,
} from './policy.mjs';

const policy = loadFrontendMutableNodeTypeRegistrySnapshotPolicy();
const source = loadMutableNodeTypeRegistrySnapshotSource();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function parseWithSnapshot(content, runtime) {
  return parseWithMutableNodeTypeRegistrySnapshot(content, runtime, snapshotLimits);
}

function executeRawSnapshot(content, snapshot, kernSource = source) {
  return parseMutableNodeTypeRegistrySnapshotEnvelope(
    content,
    snapshot,
    executeMutableNodeTypeRegistrySnapshotFields(content, snapshot, policy, kernSource),
    policy,
  );
}

function replaceOccurrence(text, search, replacement, occurrence = 0) {
  let from = 0;
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = text.indexOf(search, from);
    assert.notEqual(start, -1, `missing mutation target ${search} occurrence ${occurrence}`);
    from = start + search.length;
  }
  assert.equal(text.indexOf(search, from), -1, `mutation target ${search} has an unscoped extra occurrence`);
  return `${text.slice(0, start)}${replacement}${text.slice(start + search.length)}`;
}

function replaceMemberOccurrence(text, memberStart, memberEnd, search, replacement) {
  const start = text.indexOf(memberStart);
  const end = text.indexOf(memberEnd, start + memberStart.length);
  assert.ok(start >= 0 && end > start, `missing member bounds ${memberStart}..${memberEnd}`);
  const member = text.slice(start, end);
  const replaced = replaceOccurrence(member, search, replacement);
  return `${text.slice(0, start)}${replaced}${text.slice(end)}`;
}

test('native snapshot attestation matches the independent oracle and bootstrap parser', () => {
  for (const fixture of MUTABLE_REGISTRY_SNAPSHOT_FIXTURES) {
    const { result } = evaluateMutableNodeTypeRegistryFixture(fixture, policy, source);
    const runtime = runtimeForFixture(fixture);
    const bound = parseWithSnapshot(fixture.source, runtime);
    assert.deepEqual(
      normalizeMutableNodeTypeRegistrySnapshotOracle(fixture.source, bound.snapshot, policy).mutableAttestation,
      result.mutableAttestation,
      fixture.id,
    );
  }
});

test('runtime identity is isolated and epochs advance across restored membership', () => {
  const left = new KernRuntime();
  const right = new KernRuntime();
  const first = parseWithSnapshot('widget', left);
  left.dynamicNodeTypes.add('temporary');
  left.dynamicNodeTypes.delete('temporary');
  const second = parseWithSnapshot('widget', left);
  const other = parseWithSnapshot('widget', right);
  assert.equal(second.snapshot.parseEpoch, first.snapshot.parseEpoch + 1);
  assert.deepEqual(second.snapshot.evolvedTypes, first.snapshot.evolvedTypes);
  assert.notEqual(first.snapshot.runtimeInstance, other.snapshot.runtimeInstance);
});

test('direct legacy writes and duplicate registrations preserve exact membership semantics', () => {
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('shared');
  runtime.dynamicNodeTypes.add('shared');
  runtime.multilineBlockTypes.add('shared');
  runtime.templateRegistry.set('shared', { name: 'shared', slots: [], imports: [], body: 'one' });
  runtime.templateRegistry.set('shared', { name: 'shared', slots: [], imports: [], body: 'two' });
  const bound = parseWithSnapshot('shared', runtime);
  const result = executeMutableNodeTypeRegistrySnapshot(bound, policy, source);
  assert.deepEqual([result.evolved, result.multiline, result.template], [true, true, true]);
});

test('policy is exact and bounds the maximum possible native envelope', () => {
  assert.ok(policy.maxMutableRegistryEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendMutableNodeTypeRegistrySnapshotPolicy({}), /exactly/);
  assert.throws(
    () => validateFrontendMutableNodeTypeRegistrySnapshotPolicy({
      format: policy.mutableNodeTypeRegistrySnapshotFormat,
      maxNameBytes: 1,
      maxNameCodePoints: 2,
      maxRegistryEntries: 64,
      snapshotFormat: policy.runtimeRegistrySnapshotFormat,
      sourceProfile: policy.mutableNodeTypeRegistrySnapshotSourceProfile,
    }),
    /byte bound/,
  );
});

test('maximum registry membership stays inside the deterministic runtime budget', () => {
  const runtime = new KernRuntime();
  for (let index = 0; index < policy.maxRegistryEntries; index += 1) {
    const name = `e${String(index).padStart(3, '0')}`;
    runtime.dynamicNodeTypes.add(name);
    runtime.templateRegistry.set(name, { name, slots: [], imports: [], body: '' });
    if (index >= 6) runtime.multilineBlockTypes.add(name);
  }
  const bound = parseWithSnapshot('e063', runtime);
  const started = performance.now();
  const result = executeMutableNodeTypeRegistrySnapshot(bound, policy, source);
  assert.equal(result.mutableAttestation, 'registered');
  assert.ok(performance.now() - started < 20_000);
});

test('unsafe identity, noncanonical names, and missing defaults fail in the oracle', () => {
  const runtime = new KernRuntime();
  const { snapshot } = parseWithSnapshot('widget', runtime);
  for (const mutated of [
    { ...snapshot, runtimeInstance: 0 },
    { ...snapshot, parseEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, evolvedTypes: ['z', 'a'] },
    { ...snapshot, multilineTypes: snapshot.multilineTypes.filter((name) => name !== 'handler') },
  ]) {
    assert.equal(normalizeMutableNodeTypeRegistrySnapshotOracle('widget', mutated, policy).status, 'failure');
  }
});

test('native registry validation returns exact failures for unsafe and oversized evidence', () => {
  const runtime = new KernRuntime();
  const { snapshot } = parseWithSnapshot('widget', runtime);
  for (const mutated of [
    { ...snapshot, runtimeInstance: 0 },
    { ...snapshot, evolvedTypes: ['z', 'a'] },
    { ...snapshot, evolvedTypes: ['x'.repeat(policy.maxNameCodePoints + 1)] },
    { ...snapshot, multilineTypes: snapshot.multilineTypes.filter((name) => name !== 'handler') },
  ]) {
    assert.deepEqual(
      executeRawSnapshot('widget', mutated),
      { code: 'REGISTRY_INVALID', detail: '', status: 'failure' },
    );
  }
  assert.deepEqual(
    executeRawSnapshot('', snapshot),
    { code: 'EMPTY_RETAINED_CODE', detail: '', status: 'failure' },
  );
});

test('stale snapshot evidence cannot be rebound to a later parse or different source', () => {
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('widget');
  const first = parseWithSnapshot('widget', runtime);
  parseWithSnapshot('other', runtime);
  assert.throws(
    () => executeMutableNodeTypeRegistrySnapshot(first, policy, source),
    /evidence|epoch|source|replay/,
  );

  const current = parseWithSnapshot('widget', runtime);
  assert.throws(
    () => executeMutableNodeTypeRegistrySnapshot({ ...current }, policy, source),
    /evidence|forged/,
  );
  assert.equal(executeMutableNodeTypeRegistrySnapshot(current, policy, source).mutableAttestation, 'registered');
  assert.throws(
    () => executeMutableNodeTypeRegistrySnapshot(current, policy, source),
    /evidence|consumed|replay/,
  );
});

test('forged inherited M4.161 failure padding is rejected before propagation', () => {
  const runtime = new KernRuntime();
  const { snapshot } = parseWithSnapshot('', runtime);
  const mutant = replaceMemberOccurrence(
    source,
    'fn name=attestationfailure',
    'fn name=validadmissionfailurecode',
    'do value="out.push(\\"\\")"',
    'do value="out.push(\\"FORGED\\")"',
  );
  assert.throws(() => executeRawSnapshot('', snapshot, mutant));
});

test('host envelope parser rejects decision, registry, epoch, and seal mutations', () => {
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('widget');
  const { snapshot } = parseWithSnapshot('widget', runtime);
  const value = executeMutableNodeTypeRegistrySnapshotFields('widget', snapshot, policy, source);
  const fields = value.value.map((entry) => entry.value);
  for (const index of [6, 10, fields.indexOf('evolved'), fields.length - 9]) {
    const mutated = [...fields];
    mutated[index] = `${mutated[index]}x`;
    assert.throws(
      () => parseMutableNodeTypeRegistrySnapshotEnvelope(
        'widget', snapshot, { tag: 'list', value: mutated.map((entry) => ({ tag: 'text', value: entry })) }, policy,
      ),
    );
  }
});

test('native source composes M4.161 exactly once without parser or registry delegation', () => {
  assert.equal(validateNativeMutableNodeTypeRegistrySnapshotSource(source), source);
  assert.throws(() => validateNativeMutableNodeTypeRegistrySnapshotSource(`${source}\n# UNKNOWN_NODE_TYPE`), /delegation/);
  assert.throws(
    () => validateNativeMutableNodeTypeRegistrySnapshotSource(source.replace(
      'observebuiltinnodetypeattestation(content,',
      'observebuiltinnodetypeattestation(content, observebuiltinnodetypeattestation(content,',
    )),
    /exactly once/,
  );
});

test('named verdict, category, epoch, and default mutations are rejected', () => {
  const mutants = [
    replaceOccurrence(source, 'assign target=mutableVerdict value="\\"registered\\""', 'assign target=mutableVerdict value="\\"unresolved\\""'),
    replaceOccurrence(source, 'assign target=evolved value="registrycontains(evolvedTypes, admittedType)"', 'assign target=evolved value="false"'),
    replaceOccurrence(source, 'do value="out.push(String(parseEpoch))"', 'do value="out.push(\\"0\\")"', 1),
    replaceOccurrence(source, 'do value="out.push(inheritedAttestation)"', 'do value="out.push(\\"builtin\\")"'),
  ];
  const fixture = MUTABLE_REGISTRY_SNAPSHOT_FIXTURES.find(({ id }) => id === 'all-overlap');
  for (const [index, mutant] of mutants.entries()) {
    assert.throws(() => evaluateMutableNodeTypeRegistryFixture(fixture, policy, mutant), `mutant ${index}`);
  }
  const runtime = new KernRuntime();
  const valid = parseWithSnapshot('widget', runtime).snapshot;
  const missingBody = { ...valid, multilineTypes: valid.multilineTypes.filter((name) => name !== 'body') };
  const defaultMutant = replaceOccurrence(
    source,
    'if cond="requireDefaults && defaultCount != 6"',
    'if cond="false"',
  );
  assert.throws(() => executeRawSnapshot('widget', missingBody, defaultMutant));
});
