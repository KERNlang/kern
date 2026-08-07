import { readFileSync } from 'node:fs';

import { loadFrontendMutableNodeTypeRegistrySnapshotPolicy } from '../kern-frontend-mutable-node-type-registry-snapshot/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 16;
const AUTH_PAYLOAD_FIELDS = 12;

function fail(detail) {
  throw new TypeError(`frontend known-node warning policy rejection: ${detail}`);
}

export function validateFrontendKnownNodeWarningPolicy(
  extension,
  inherited = loadFrontendMutableNodeTypeRegistrySnapshotPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  const expected = ['diagnosticCode', 'diagnosticSeverity', 'format', 'sourceProfile'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`policy must contain exactly ${expected.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.known-node-warning-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'single-retained-known-node-warning-v1') fail('sourceProfile is unsupported');
  if (extension.diagnosticCode !== 'UNKNOWN_NODE_TYPE') fail('diagnosticCode is unsupported');
  if (extension.diagnosticSeverity !== 'warning') fail('diagnosticSeverity is unsupported');
  const maxInheritedFields = inherited.maxMutableRegistryEnvelopeFields;
  const maxAuthenticationRecords = Math.ceil(maxInheritedFields / AUTH_PAYLOAD_FIELDS);
  const maxKnownNodeWarningEnvelopeFields = 1 + (maxAuthenticationRecords + 3) * RECORD_WIDTH;
  if (maxKnownNodeWarningEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) {
    fail('success envelope exceeds runtime collection');
  }
  return {
    ...inherited,
    knownNodeWarningDiagnosticCode: extension.diagnosticCode,
    knownNodeWarningDiagnosticSeverity: extension.diagnosticSeverity,
    knownNodeWarningFormat: extension.format,
    knownNodeWarningSourceProfile: extension.sourceProfile,
    maxKnownNodeWarningAuthenticationRecords: maxAuthenticationRecords,
    maxKnownNodeWarningEnvelopeFields,
  };
}

export function loadFrontendKnownNodeWarningPolicy() {
  return validateFrontendKnownNodeWarningPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
