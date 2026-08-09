import { readFileSync } from 'node:fs';

import { loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy } from '../kern-frontend-generic-property-style-theme-diagnostics/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;

function fail(detail) {
  throw new TypeError(`frontend evolved-hints policy rejection: ${detail}`);
}

export function validateFrontendEvolvedHintsPolicy(
  extension,
  inherited = loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const expectedKeys = ['format', 'maxEnvelopeBytes', 'sourceProfile'].sort();
  const keys = Object.keys(extension).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(`policy must contain exactly ${expectedKeys.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.evolved-hints-shadow.1') fail('format is unsupported');
  if (extension.sourceProfile !== 'handler-free-evolved-hints-style-theme-diagnostics-v1') {
    fail('sourceProfile is unsupported');
  }
  if (!Number.isSafeInteger(extension.maxEnvelopeBytes) || extension.maxEnvelopeBytes <= 0) {
    fail('maxEnvelopeBytes must be a positive safe integer');
  }
  if (extension.maxEnvelopeBytes > inherited.runtimeLimits.maxBytes) fail('maxEnvelopeBytes exceeds runtime bytes');
  const maxWrites = inherited.profileLimits.maxTokens;
  const maxEnvelopeFields = 1 + (
    2 + maxWrites +
    Math.ceil(inherited.maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields / AUTH_PAYLOAD_FIELDS) +
    2 * Math.ceil(inherited.maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS)
  ) * RECORD_WIDTH;
  if (maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) {
    fail('success envelope exceeds runtime collection');
  }
  return {
    ...inherited,
    evolvedHintsFormat: extension.format,
    evolvedHintsSourceProfile: extension.sourceProfile,
    maxEvolvedHintsEnvelopeBytes: extension.maxEnvelopeBytes,
    maxEvolvedHintsEnvelopeFields: maxEnvelopeFields,
    maxEvolvedHintWrites: maxWrites,
  };
}

export function loadFrontendEvolvedHintsPolicy() {
  return validateFrontendEvolvedHintsPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
