import { readFileSync } from 'node:fs';

import { loadFrontendKnownNodeWarningPolicy } from '../kern-frontend-known-node-warning/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;

function fail(detail) {
  throw new TypeError(`frontend generic-property admission policy rejection: ${detail}`);
}

export function validateFrontendGenericPropertyAdmissionPolicy(
  extension,
  inherited = loadFrontendKnownNodeWarningPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'sourceProfile') {
    fail('policy must contain exactly format,sourceProfile');
  }
  if (extension.format !== 'kern.frontend.generic-property-admission-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'single-immediate-generic-property-v1') fail('sourceProfile is unsupported');
  const maxInheritedFields = inherited.maxKnownNodeWarningEnvelopeFields;
  const maxAuthenticationRecords = Math.ceil(maxInheritedFields / AUTH_PAYLOAD_FIELDS);
  const maxGenericPropertyAdmissionEnvelopeFields = 1 + (maxAuthenticationRecords + 2) * RECORD_WIDTH;
  if (maxGenericPropertyAdmissionEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) {
    fail('success envelope exceeds runtime collection');
  }
  return {
    ...inherited,
    genericPropertyAdmissionFormat: extension.format,
    genericPropertyAdmissionSourceProfile: extension.sourceProfile,
    maxGenericPropertyAdmissionAuthenticationRecords: maxAuthenticationRecords,
    maxGenericPropertyAdmissionEnvelopeFields,
  };
}

export function loadFrontendGenericPropertyAdmissionPolicy() {
  return validateFrontendGenericPropertyAdmissionPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
