import { readFileSync } from 'node:fs';

import { loadFrontendWhitespaceTrimPolicy } from '../kern-frontend-whitespace-trim/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 10;

function fail(detail) {
  throw new TypeError(`frontend retained token stream policy rejection: ${detail}`);
}

export function validateFrontendRetainedTokenStreamPolicy(
  extension,
  whitespaceTrim = loadFrontendWhitespaceTrimPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'sourceProfile') {
    fail('policy must contain exactly format,sourceProfile');
  }
  if (extension.format !== 'kern.frontend.retained-token-stream-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'single-retained-token-stream-v1') fail('sourceProfile is unsupported');
  const maxStreamRecords = whitespaceTrim.profileLimits.maxTokens + whitespaceTrim.profileLimits.maxDiagnostics;
  if (!Number.isSafeInteger(maxStreamRecords) || maxStreamRecords <= 0) fail('derived stream record ceiling is invalid');
  if (1 + (maxStreamRecords + 2) * RECORD_WIDTH > whitespaceTrim.runtimeLimits.maxCollectionLength) {
    fail('success envelope must fit runtime maxCollectionLength');
  }
  if (whitespaceTrim.profileLimits.maxOutputJsonBytes > whitespaceTrim.runtimeLimits.maxBytes) {
    fail('output JSON ceiling must fit runtime maxBytes');
  }
  return {
    ...whitespaceTrim,
    maxStreamRecords,
    retainedTokenStreamFormat: extension.format,
    retainedTokenStreamSourceProfile: extension.sourceProfile,
  };
}

export function loadFrontendRetainedTokenStreamPolicy() {
  return validateFrontendRetainedTokenStreamPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
