import { readFileSync } from 'node:fs';

import { loadFrontendRetainedTokenStreamPolicy } from '../kern-frontend-retained-token-stream/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 16;
const STREAM_AUTH_PAYLOAD_FIELDS = 12;
const RETAINED_RECORD_WIDTH = 10;
const BASE_SUCCESS_RECORDS = 4;

function fail(detail) {
  throw new TypeError(`frontend node-type-token admission policy rejection: ${detail}`);
}

export function validateFrontendNodeTypeTokenAdmissionPolicy(
  extension,
  retained = loadFrontendRetainedTokenStreamPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (
    keys.length !== 4 || keys[0] !== 'format' || keys[1] !== 'maxDiagnostics' ||
    keys[2] !== 'maxTokens' || keys[3] !== 'sourceProfile'
  ) {
    fail('policy must contain exactly format,maxDiagnostics,maxTokens,sourceProfile');
  }
  if (extension.format !== 'kern.frontend.node-type-token-admission-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'single-retained-node-type-token-admission-v1') fail('sourceProfile is unsupported');
  if (!Number.isSafeInteger(extension.maxTokens) || extension.maxTokens <= 0 || extension.maxTokens > retained.profileLimits.maxTokens) {
    fail('maxTokens must be a positive integer within the retained-stream profile');
  }
  if (
    !Number.isSafeInteger(extension.maxDiagnostics) || extension.maxDiagnostics <= 0 ||
    extension.maxDiagnostics > retained.profileLimits.maxDiagnostics
  ) {
    fail('maxDiagnostics must be a positive integer within the retained-stream profile');
  }
  const maxStreamRecords = extension.maxTokens + extension.maxDiagnostics;
  const maxInheritedStreamFields = 1 + (maxStreamRecords + 2) * RETAINED_RECORD_WIDTH;
  const maxStreamAuthRecords = Math.ceil(maxInheritedStreamFields / STREAM_AUTH_PAYLOAD_FIELDS);
  if (1 + (BASE_SUCCESS_RECORDS + maxStreamAuthRecords) * RECORD_WIDTH > retained.runtimeLimits.maxCollectionLength) {
    fail('success envelope must fit runtime maxCollectionLength');
  }
  const maxOutputJsonBytes = retained.profileLimits.maxOutputJsonBytes * 2;
  if (!Number.isSafeInteger(maxOutputJsonBytes) || maxOutputJsonBytes > retained.runtimeLimits.maxBytes) {
    fail('output JSON ceiling must fit runtime maxBytes');
  }
  return {
    ...retained,
    maxStreamRecords,
    profileLimits: {
      ...retained.profileLimits,
      maxDiagnostics: extension.maxDiagnostics,
      maxOutputJsonBytes,
      maxTokens: extension.maxTokens,
    },
    nodeTypeTokenAdmissionFormat: extension.format,
    nodeTypeTokenAdmissionSourceProfile: extension.sourceProfile,
  };
}

export function loadFrontendNodeTypeTokenAdmissionPolicy() {
  return validateFrontendNodeTypeTokenAdmissionPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
