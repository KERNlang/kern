import { readFileSync } from 'node:fs';

import { loadFrontendStitcherPolicy } from '../kern-frontend-stitcher/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));

function fail(detail) {
  throw new TypeError(`frontend lexical policy rejection: ${detail}`);
}

export function validateFrontendLexicalPolicy(extension, stitcher = loadFrontendStitcherPolicy()) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (
    keys.length !== 3 || keys[0] !== 'format' || keys[1] !== 'maxCheckpoints' ||
    keys[2] !== 'maxLexicalDepth'
  ) {
    fail('policy must contain exactly format,maxCheckpoints,maxLexicalDepth');
  }
  if (extension.format !== 'kern.frontend.lexical-checkpoint-shadow.1') fail('format is unsupported');
  for (const key of ['maxCheckpoints', 'maxLexicalDepth']) {
    if (!Number.isSafeInteger(extension[key]) || extension[key] <= 0) fail(`${key} must be positive`);
  }
  if (extension.maxCheckpoints > stitcher.profileLimits.maxPhysicalRecords) {
    fail('maxCheckpoints must fit stitcher maxPhysicalRecords');
  }
  if (extension.maxLexicalDepth > stitcher.profileLimits.maxCodePoints) {
    fail('maxLexicalDepth must fit stitcher maxCodePoints');
  }
  return {
    ...stitcher,
    lexicalFormat: extension.format,
    maxCheckpoints: extension.maxCheckpoints,
    maxLexicalDepth: extension.maxLexicalDepth,
  };
}

export function loadFrontendLexicalPolicy() {
  return validateFrontendLexicalPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
