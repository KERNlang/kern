import { readFileSync } from 'node:fs';

import { loadFrontendKeywordHandlerPolicy } from '../kern-frontend-keyword-handlers/policy.mjs';

const SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const CHILD_AUTH_PAYLOAD_FIELDS = 16;
const CHILD_MINIMUM_FIELDS = 41;
const RECORD_WIDTH = 20;
const SUCCESS_HEADER_FIELDS = 21;
const MINIMUM_DECISION_FIELDS = SUCCESS_HEADER_FIELDS +
  Math.ceil(CHILD_MINIMUM_FIELDS / CHILD_AUTH_PAYLOAD_FIELDS) * RECORD_WIDTH + RECORD_WIDTH;

function fail(detail) {
  throw new TypeError(`frontend successful-line policy rejection: ${detail}`);
}

export function validateFrontendSuccessfulLinePolicy(
  extension,
  inherited = loadFrontendKeywordHandlerPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) {
    fail('policy must be a record');
  }
  const expected = ['format', 'maxEnvelopeBytes', 'maxEnvelopeFields', 'sourceProfile'];
  const keys = Object.keys(extension).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`policy must contain exactly ${expected.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.successful-line-composition-shadow.1') {
    fail('format is unsupported');
  }
  if (extension.sourceProfile !== 'single-space-indented-successful-logical-line-v1') {
    fail('sourceProfile is unsupported');
  }
  if (
    !Number.isSafeInteger(extension.maxEnvelopeFields) || extension.maxEnvelopeFields <= 0 ||
    extension.maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength
  ) fail('maxEnvelopeFields must fit the runtime collection limit');
  if (
    !Number.isSafeInteger(extension.maxEnvelopeBytes) || extension.maxEnvelopeBytes <= 0 ||
    extension.maxEnvelopeBytes > inherited.runtimeLimits.maxBytes
  ) fail('maxEnvelopeBytes must fit the runtime byte limit');
  if (extension.maxEnvelopeFields < MINIMUM_DECISION_FIELDS) {
    fail('maxEnvelopeFields cannot fit one authenticated child decision');
  }
  return {
    ...inherited,
    maxSuccessfulLineEnvelopeBytes: extension.maxEnvelopeBytes,
    maxSuccessfulLineEnvelopeFields: extension.maxEnvelopeFields,
    successfulLineFormat: extension.format,
    successfulLineSourceProfile: extension.sourceProfile,
  };
}

export function loadFrontendSuccessfulLinePolicy() {
  return validateFrontendSuccessfulLinePolicy(JSON.parse(SOURCE.toString('utf8')));
}
