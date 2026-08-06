import { readFileSync } from 'node:fs';

import { loadFrontendLexicalPolicy } from '../kern-frontend-lexical/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 18;

function fail(detail) {
  throw new TypeError(`frontend whitespace trim policy rejection: ${detail}`);
}

export function validateFrontendWhitespaceTrimPolicy(extension, lexical = loadFrontendLexicalPolicy()) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) {
    fail('policy must be a record');
  }
  const keys = Object.keys(extension).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'sourceProfile') {
    fail('policy must contain exactly format,sourceProfile');
  }
  if (extension.format !== 'kern.frontend.whitespace-trim-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'single-parser-content-record-v1') fail('sourceProfile is unsupported');
  if (1 + 2 * RECORD_WIDTH > lexical.runtimeLimits.maxCollectionLength) {
    fail('success envelope must fit runtime maxCollectionLength');
  }
  return {
    ...lexical,
    tokenizerMaxRecords: lexical.profileLimits.maxEnvelopeRecords,
    whitespaceTrimFormat: extension.format,
    whitespaceTrimSourceProfile: extension.sourceProfile,
  };
}

export function loadFrontendWhitespaceTrimPolicy() {
  return validateFrontendWhitespaceTrimPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
