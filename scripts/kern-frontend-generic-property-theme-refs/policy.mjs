import { readFileSync } from 'node:fs';

import { loadFrontendGenericPropertyLoopPolicy } from '../kern-frontend-generic-property-loop/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;

function fail(detail) {
  throw new TypeError(`frontend generic-property theme-ref policy rejection: ${detail}`);
}

export function validateFrontendGenericPropertyThemeRefsPolicy(
  extension,
  inherited = loadFrontendGenericPropertyLoopPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (
    keys.length !== 4 || keys[0] !== 'format' || keys[1] !== 'maxProperties' ||
    keys[2] !== 'maxThemeRefs' || keys[3] !== 'sourceProfile'
  ) fail('policy must contain exactly format,maxProperties,maxThemeRefs,sourceProfile');
  if (extension.format !== 'kern.frontend.generic-property-theme-refs-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'handler-free-theme-enabled-generic-property-loop-v1') {
    fail('sourceProfile is unsupported');
  }
  for (const key of ['maxProperties', 'maxThemeRefs']) {
    if (!Number.isSafeInteger(extension[key]) || extension[key] <= 0) fail(`${key} must be a positive safe integer`);
  }
  if (extension.maxProperties !== inherited.maxGenericPropertyLoopProperties) {
    fail('maxProperties must preserve the inherited loop bound');
  }
  const maxLoopAuthRecords = Math.ceil(inherited.maxGenericPropertyLoopEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxStreamAuthRecords = Math.ceil(inherited.maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxTransitions = extension.maxProperties + extension.maxThemeRefs;
  const maxEnvelopeFields = 1 + (
    2 + maxTransitions + maxLoopAuthRecords + maxStreamAuthRecords
  ) * RECORD_WIDTH;
  if (maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) fail('success envelope exceeds runtime collection');
  return {
    ...inherited,
    genericPropertyThemeRefsFormat: extension.format,
    genericPropertyThemeRefsSourceProfile: extension.sourceProfile,
    maxGenericPropertyThemeRefsEnvelopeFields: maxEnvelopeFields,
    maxGenericPropertyThemeRefsProperties: extension.maxProperties,
    maxGenericPropertyThemeRefsThemeRefs: extension.maxThemeRefs,
    maxGenericPropertyThemeRefsTransitions: maxTransitions,
    maxGenericPropertyThemeRefsLoopAuthRecords: maxLoopAuthRecords,
    maxGenericPropertyThemeRefsStreamAuthRecords: maxStreamAuthRecords,
  };
}

export function loadFrontendGenericPropertyThemeRefsPolicy() {
  return validateFrontendGenericPropertyThemeRefsPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
