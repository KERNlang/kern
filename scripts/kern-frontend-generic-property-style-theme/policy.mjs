import { readFileSync } from 'node:fs';

import { loadFrontendGenericPropertyThemeRefsPolicy } from '../kern-frontend-generic-property-theme-refs/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 24;
const OUTER_RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;

function fail(detail) {
  throw new TypeError(`frontend generic-property style/theme policy rejection: ${detail}`);
}

export function validateFrontendGenericPropertyStyleThemePolicy(
  extension,
  inherited = loadFrontendGenericPropertyThemeRefsPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const expectedKeys = [
    'format', 'maxEnvelopeBytes', 'maxProperties', 'maxStyleBlockBytes', 'maxStyleBlockCodePoints',
    'maxStyleBlockUtf16Units', 'maxStylePairs', 'maxStyleParenDepth', 'maxStyleSegments', 'maxStyleTokens',
    'maxStyleWrites', 'maxThemeRefs', 'replayFormat', 'sourceProfile', 'styleFormat',
  ].sort();
  const keys = Object.keys(extension).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(`policy must contain exactly ${expectedKeys.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.generic-property-style-theme-shadow.1') fail('format is unsupported');
  if (extension.replayFormat !== 'kern.frontend.generic-property-style-theme-replay.1') {
    fail('replayFormat is unsupported');
  }
  if (extension.styleFormat !== 'kern.frontend.style-block-evidence.1') fail('styleFormat is unsupported');
  if (extension.sourceProfile !== 'handler-free-style-theme-generic-property-loop-v1') {
    fail('sourceProfile is unsupported');
  }
  for (const key of expectedKeys.filter((key) => key.startsWith('max'))) {
    if (!Number.isSafeInteger(extension[key]) || extension[key] <= 0) fail(`${key} must be a positive safe integer`);
  }
  if (extension.maxProperties !== inherited.maxGenericPropertyThemeRefsProperties) {
    fail('maxProperties must preserve the inherited property bound');
  }
  if (extension.maxThemeRefs !== inherited.maxGenericPropertyThemeRefsThemeRefs) {
    fail('maxThemeRefs must preserve the inherited theme bound');
  }
  if (extension.maxStylePairs > extension.maxStyleSegments) fail('maxStylePairs exceeds maxStyleSegments');
  if (extension.maxStyleWrites > extension.maxStylePairs) fail('maxStyleWrites exceeds maxStylePairs');
  if (extension.maxEnvelopeBytes > inherited.runtimeLimits.maxBytes) fail('maxEnvelopeBytes exceeds runtime bytes');

  const maxTransitions = extension.maxProperties + extension.maxThemeRefs + extension.maxStyleTokens;
  const maxFinalRecords = extension.maxStyleWrites * 3;
  const maxReplayRecords = 2 + maxTransitions + extension.maxStyleSegments + extension.maxStylePairs +
    extension.maxStyleWrites + maxFinalRecords;
  const maxReplayEnvelopeFields = 1 + maxReplayRecords * RECORD_WIDTH;
  const maxThemeAuthRecords = Math.ceil(inherited.maxGenericPropertyThemeRefsEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxStreamAuthRecords = Math.ceil(inherited.maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxReplayAuthRecords = Math.ceil(maxReplayEnvelopeFields / AUTH_PAYLOAD_FIELDS);
  const maxEnvelopeFields = 1 + (
    2 + maxThemeAuthRecords + maxStreamAuthRecords + maxReplayAuthRecords
  ) * OUTER_RECORD_WIDTH;
  if (maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) fail('success envelope exceeds runtime collection');
  return {
    ...inherited,
    genericPropertyStyleThemeFormat: extension.format,
    genericPropertyStyleThemeReplayFormat: extension.replayFormat,
    genericPropertyStyleThemeSourceProfile: extension.sourceProfile,
    maxGenericPropertyStyleThemeEnvelopeBytes: extension.maxEnvelopeBytes,
    maxGenericPropertyStyleThemeEnvelopeFields: maxEnvelopeFields,
    maxGenericPropertyStyleThemeFinalRecords: maxFinalRecords,
    maxGenericPropertyStyleThemeProperties: extension.maxProperties,
    maxGenericPropertyStyleThemeReplayEnvelopeFields: maxReplayEnvelopeFields,
    maxGenericPropertyStyleThemeStyleBlockBytes: extension.maxStyleBlockBytes,
    maxGenericPropertyStyleThemeStyleBlockCodePoints: extension.maxStyleBlockCodePoints,
    maxGenericPropertyStyleThemeStyleBlockUtf16Units: extension.maxStyleBlockUtf16Units,
    maxGenericPropertyStyleThemeStylePairs: extension.maxStylePairs,
    maxGenericPropertyStyleThemeStyleParenDepth: extension.maxStyleParenDepth,
    maxGenericPropertyStyleThemeStyleSegments: extension.maxStyleSegments,
    maxGenericPropertyStyleThemeStyleTokens: extension.maxStyleTokens,
    maxGenericPropertyStyleThemeStyleWrites: extension.maxStyleWrites,
    maxGenericPropertyStyleThemeThemeRefs: extension.maxThemeRefs,
    maxGenericPropertyStyleThemeTransitions: maxTransitions,
    styleBlockEvidenceFormat: extension.styleFormat,
  };
}

export function loadFrontendGenericPropertyStyleThemePolicy() {
  return validateFrontendGenericPropertyStyleThemePolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
