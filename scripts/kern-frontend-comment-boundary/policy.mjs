import { readFileSync } from 'node:fs';

import { loadFrontendLexicalPolicy } from '../kern-frontend-lexical/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 16;

function fail(detail) {
  throw new TypeError(`frontend comment boundary policy rejection: ${detail}`);
}

export function validateFrontendCommentBoundaryPolicy(extension, lexical = loadFrontendLexicalPolicy()) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) {
    fail('policy must be a record');
  }
  const keys = Object.keys(extension).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'maxPartitions') {
    fail('policy must contain exactly format,maxPartitions');
  }
  if (extension.format !== 'kern.frontend.inline-comment-boundary-shadow.1') fail('format is unsupported');
  if (!Number.isSafeInteger(extension.maxPartitions) || extension.maxPartitions <= 0) {
    fail('maxPartitions must be positive');
  }
  if (extension.maxPartitions > lexical.maxCheckpoints) {
    fail('maxPartitions must fit lexical maxCheckpoints');
  }
  if (1 + (extension.maxPartitions + 1) * RECORD_WIDTH > lexical.runtimeLimits.maxCollectionLength) {
    fail('partition envelope must fit runtime maxCollectionLength');
  }
  return {
    ...lexical,
    commentBoundaryFormat: extension.format,
    maxPartitions: extension.maxPartitions,
  };
}

export function loadFrontendCommentBoundaryPolicy() {
  return validateFrontendCommentBoundaryPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
