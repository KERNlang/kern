import { readFileSync } from 'node:fs';

import { loadFrontendBuiltinNodeTypeAttestationPolicy } from '../kern-frontend-builtin-node-type-attestation/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 16;
const AUTH_PAYLOAD_FIELDS = 12;

function fail(detail) {
  throw new TypeError(`frontend mutable registry snapshot policy rejection: ${detail}`);
}

export function validateFrontendMutableNodeTypeRegistrySnapshotPolicy(
  extension,
  inherited = loadFrontendBuiltinNodeTypeAttestationPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  const expected = ['format', 'maxNameBytes', 'maxNameCodePoints', 'maxRegistryEntries', 'snapshotFormat', 'sourceProfile'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`policy must contain exactly ${expected.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.mutable-node-type-registry-snapshot-shadow.1') fail('format is unsupported');
  if (extension.snapshotFormat !== 'kern.frontend.mutable-node-type-registry-snapshot.1') fail('snapshotFormat is unsupported');
  if (extension.sourceProfile !== 'single-mutable-node-type-registry-snapshot-v1') fail('sourceProfile is unsupported');
  for (const key of ['maxNameBytes', 'maxNameCodePoints', 'maxRegistryEntries']) {
    if (!Number.isSafeInteger(extension[key]) || extension[key] <= 0) fail(`${key} must be a positive safe integer`);
  }
  if (extension.maxNameBytes < extension.maxNameCodePoints) fail('name byte bound cannot be below scalar bound');
  if (extension.maxRegistryEntries < 6) fail('registry bound must fit default multiline types');
  const maxRegistryRecords = extension.maxRegistryEntries * 3;
  const maxFields = 1 + (
    2 + Math.ceil(inherited.maxAttestationEnvelopeFields / AUTH_PAYLOAD_FIELDS) + maxRegistryRecords
  ) * RECORD_WIDTH;
  if (maxFields > inherited.runtimeLimits.maxCollectionLength) fail('success envelope exceeds runtime collection');
  return {
    ...inherited,
    maxMutableRegistryEnvelopeFields: maxFields,
    maxNameBytes: extension.maxNameBytes,
    maxNameCodePoints: extension.maxNameCodePoints,
    maxRegistryEntries: extension.maxRegistryEntries,
    mutableNodeTypeRegistrySnapshotFormat: extension.format,
    mutableNodeTypeRegistrySnapshotSourceProfile: extension.sourceProfile,
    runtimeRegistrySnapshotFormat: extension.snapshotFormat,
  };
}

export function loadFrontendMutableNodeTypeRegistrySnapshotPolicy() {
  return validateFrontendMutableNodeTypeRegistrySnapshotPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
