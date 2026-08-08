import { readFileSync } from 'node:fs';

import { loadFrontendGenericPropertyStyleThemePolicy } from '../kern-frontend-generic-property-style-theme/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 20;
const AUTH_PAYLOAD_FIELDS = 16;

function fail(detail) {
  throw new TypeError(`frontend generic-property style/theme diagnostic policy rejection: ${detail}`);
}

export function validateFrontendGenericPropertyStyleThemeDiagnosticsPolicy(
  extension,
  inherited = loadFrontendGenericPropertyStyleThemePolicy(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const expectedKeys = [
    'format', 'maxEnvelopeBytes', 'maxUnexpectedDiagnostics', 'projectionFormat', 'recoveryFormat', 'sourceProfile',
  ].sort();
  const keys = Object.keys(extension).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(`policy must contain exactly ${expectedKeys.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.generic-property-style-theme-diagnostics-shadow.1') fail('format is unsupported');
  if (extension.projectionFormat !== 'kern.frontend.generic-property-style-theme-diagnostic-projection.1') {
    fail('projectionFormat is unsupported');
  }
  if (extension.recoveryFormat !== 'kern.frontend.generic-property-style-theme-diagnostic-recovery.1') {
    fail('recoveryFormat is unsupported');
  }
  if (extension.sourceProfile !== 'handler-free-style-theme-generic-property-loop-diagnostics-v1') {
    fail('sourceProfile is unsupported');
  }
  for (const key of ['maxEnvelopeBytes', 'maxUnexpectedDiagnostics']) {
    if (!Number.isSafeInteger(extension[key]) || extension[key] <= 0) fail(`${key} must be a positive safe integer`);
  }
  if (extension.maxUnexpectedDiagnostics > inherited.profileLimits.maxTokens) {
    fail('maxUnexpectedDiagnostics exceeds the retained token bound');
  }
  if (extension.maxEnvelopeBytes > inherited.runtimeLimits.maxBytes) fail('maxEnvelopeBytes exceeds runtime bytes');

  const maxProjectionFields = 1 + (
    2 + extension.maxUnexpectedDiagnostics +
    Math.ceil(inherited.maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS)
  ) * RECORD_WIDTH;
  const maxRecoveryFields = 1 + (
    2 + Math.ceil(inherited.maxRetainedTokenStreamEnvelopeFields / AUTH_PAYLOAD_FIELDS)
  ) * RECORD_WIDTH;
  const maxEnvelopeFields = 1 + (
    2 +
    Math.ceil(inherited.maxGenericPropertyStyleThemeEnvelopeFields / AUTH_PAYLOAD_FIELDS) +
    Math.ceil(maxProjectionFields / AUTH_PAYLOAD_FIELDS) +
    Math.ceil(inherited.maxGenericPropertyStyleThemeReplayEnvelopeFields / AUTH_PAYLOAD_FIELDS)
  ) * RECORD_WIDTH;
  if (maxProjectionFields > inherited.runtimeLimits.maxCollectionLength) fail('projection exceeds runtime collection');
  if (maxRecoveryFields > inherited.runtimeLimits.maxCollectionLength) fail('recovery exceeds runtime collection');
  if (maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) fail('success envelope exceeds runtime collection');

  return {
    ...inherited,
    genericPropertyStyleThemeDiagnosticProjectionFormat: extension.projectionFormat,
    genericPropertyStyleThemeDiagnosticRecoveryFormat: extension.recoveryFormat,
    genericPropertyStyleThemeDiagnosticsFormat: extension.format,
    genericPropertyStyleThemeDiagnosticsSourceProfile: extension.sourceProfile,
    maxGenericPropertyStyleThemeDiagnosticProjectionFields: maxProjectionFields,
    maxGenericPropertyStyleThemeDiagnosticRecoveryFields: maxRecoveryFields,
    maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes: extension.maxEnvelopeBytes,
    maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields: maxEnvelopeFields,
    maxGenericPropertyStyleThemeUnexpectedDiagnostics: extension.maxUnexpectedDiagnostics,
  };
}

export function loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy() {
  return validateFrontendGenericPropertyStyleThemeDiagnosticsPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
