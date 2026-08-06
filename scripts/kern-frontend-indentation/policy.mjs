import { readFileSync } from 'node:fs';

import { loadFrontendStitcherPolicy } from '../kern-frontend-stitcher/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));

function fail(detail) {
  throw new TypeError(`frontend indentation policy rejection: ${detail}`);
}

export function validateFrontendIndentationPolicy(extension, stitcher = loadFrontendStitcherPolicy()) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'maxObservations') {
    fail('policy must contain exactly format,maxObservations');
  }
  if (extension.format !== 'kern.frontend.indentation-shadow.1') fail('format is unsupported');
  if (!Number.isSafeInteger(extension.maxObservations) || extension.maxObservations <= 0) {
    fail('maxObservations must be positive');
  }
  if (extension.maxObservations > stitcher.profileLimits.maxGroups) {
    fail('maxObservations must fit stitcher maxGroups');
  }
  return { ...stitcher, indentationFormat: extension.format, maxObservations: extension.maxObservations };
}

export function loadFrontendIndentationPolicy() {
  return validateFrontendIndentationPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
