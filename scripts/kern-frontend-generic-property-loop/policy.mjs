import { readFileSync } from 'node:fs';

import { loadFrontendGenericPropertyAdmissionPolicy } from '../kern-frontend-generic-property-admission/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;
const STREAM_RECORD_WIDTH = 10;

function fail(detail) {
  throw new TypeError(`frontend generic-property loop policy rejection: ${detail}`);
}

export function validateFrontendGenericPropertyLoopPolicy(
  extension,
  inherited = loadFrontendGenericPropertyAdmissionPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (keys.length !== 3 || keys[0] !== 'format' || keys[1] !== 'maxProperties' || keys[2] !== 'sourceProfile') {
    fail('policy must contain exactly format,maxProperties,sourceProfile');
  }
  if (extension.format !== 'kern.frontend.generic-property-loop-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'handler-free-generic-property-loop-v1') fail('sourceProfile is unsupported');
  if (!Number.isSafeInteger(extension.maxProperties) || extension.maxProperties <= 0) {
    fail('maxProperties must be a positive safe integer');
  }
  const maxAdmissionAuthRecords = Math.ceil(
    inherited.maxGenericPropertyAdmissionEnvelopeFields / AUTH_PAYLOAD_FIELDS,
  );
  const maxRetainedTokenStreamEnvelopeFields = 1 + (inherited.maxStreamRecords + 2) * STREAM_RECORD_WIDTH;
  const maxStreamAuthRecords = Math.ceil(maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxVariableRecords = extension.maxProperties * 4;
  const maxGenericPropertyLoopEnvelopeFields = 1 + (
    2 + maxVariableRecords + maxAdmissionAuthRecords + maxStreamAuthRecords
  ) * RECORD_WIDTH;
  if (maxGenericPropertyLoopEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) {
    fail('success envelope exceeds runtime collection');
  }
  return {
    ...inherited,
    genericPropertyLoopFormat: extension.format,
    genericPropertyLoopSourceProfile: extension.sourceProfile,
    maxGenericPropertyLoopEnvelopeFields,
    maxGenericPropertyLoopProperties: extension.maxProperties,
    maxGenericPropertyLoopAdmissionAuthRecords: maxAdmissionAuthRecords,
    maxGenericPropertyLoopStreamAuthRecords: maxStreamAuthRecords,
    maxRetainedTokenStreamEnvelopeFields,
  };
}

export function loadFrontendGenericPropertyLoopPolicy() {
  return validateFrontendGenericPropertyLoopPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
