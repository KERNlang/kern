import assert from 'node:assert/strict';

import { parseGenericPropertyStyleThemeEnvelope } from '../check-kern-frontend-generic-property-style-theme.mjs';
import {
  DIAGNOSTIC_RECOVERY_FAILURE_CODES,
  parseBoundCompactFailure,
} from './failure-contract.mjs';

const RECORD_WIDTH = 20;

function fail(detail) {
  throw new Error(`style/theme diagnostic recovery rejection: ${detail}`);
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail(`${label} must be a canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail(`${label} exceeds safe integer`);
  return value;
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function collectAuth(fields, cursor, fieldCount, tag) {
  const authenticated = [];
  let authIndex = 0;
  while (authenticated.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], `${tag} count`);
    if (
      record.length !== RECORD_WIDTH || record[0] !== tag ||
      uint(record[1], `${tag} index`) !== authIndex ||
      uint(record[2], `${tag} start`) !== authenticated.length ||
      count <= 0 || count > 16 || count > fieldCount - authenticated.length ||
      record.slice(4 + count).some(Boolean)
    ) fail(`${tag} authentication drift`);
    authenticated.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { authenticated, cursor };
}

function parseFailure(content, snapshot, fields, policy) {
  return {
    ...parseBoundCompactFailure(content, snapshot, fields, DIAGNOSTIC_RECOVERY_FAILURE_CODES, fail),
    format: policy.genericPropertyStyleThemeDiagnosticRecoveryFormat, status: 'failure',
  };
}

function predecessorThemeFields(predecessorFields) {
  const failure = predecessorFields[1] === 'failure';
  const fieldCount = uint(predecessorFields[failure ? 6 : 5], 'predecessor theme fields');
  return collectAuth(predecessorFields, 21, fieldCount, 'theme-auth').authenticated;
}

function recoveredState(themeFields, policy) {
  if (
    themeFields.length < 21 || (themeFields.length - 1) % RECORD_WIDTH !== 0 ||
    themeFields[0] !== policy.genericPropertyThemeRefsFormat
  ) fail('predecessor theme envelope drift');
  if (themeFields[1] === 'decision') {
    return { admittedType: themeFields[4], knownState: themeFields[3], state: themeFields[2] };
  }
  if (
    themeFields[1] !== 'failure' || themeFields[2] !== 'THEME_PROFILE' || themeFields.length < 81 ||
    themeFields[21] !== 'loop-auth' || themeFields[25] === '' || themeFields[26] !== 'failure' ||
    themeFields[27] !== 'LOOP_PROFILE' || themeFields[41] !== 'loop-auth' ||
    themeFields[50] !== 'admission-auth' || themeFields[54] === '' || themeFields[55] !== 'decision'
  ) fail('predecessor theme recovery path drift');
  return { admittedType: themeFields[58], knownState: themeFields[57], state: 'loop' };
}

export function parseGenericPropertyStyleThemeDiagnosticRecovery(
  content,
  snapshot,
  fields,
  policy,
  predecessorFields,
  originalStreamFields,
) {
  if (
    fields[0] !== policy.genericPropertyStyleThemeDiagnosticRecoveryFormat ||
    fields.length < 41 || (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxGenericPropertyStyleThemeDiagnosticRecoveryFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes
  ) fail('invalid recovery envelope');
  if (fields[1] === 'failure') return parseFailure(content, snapshot, fields, policy);

  parseGenericPropertyStyleThemeEnvelope(content, snapshot, textList(predecessorFields), policy);
  const header = fields.slice(1, 21);
  const predecessorTag = predecessorFields[1];
  const predecessorCode = predecessorTag === 'failure' ? predecessorFields[2] : '';
  const expectedState = recoveredState(predecessorThemeFields(predecessorFields), policy);
  const streamFieldCount = uint(header[6], 'stream field count');
  if (
    header[0] !== 'decision' || header[1] !== predecessorTag || header[2] !== predecessorCode ||
    header[3] !== expectedState.state || header[4] !== expectedState.knownState ||
    header[5] !== expectedState.admittedType || streamFieldCount !== originalStreamFields.length ||
    uint(header[7], 'runtime instance') !== snapshot.runtimeInstance ||
    uint(header[8], 'parse epoch') !== snapshot.parseEpoch ||
    header[9] !== policy.genericPropertyStyleThemeFormat ||
    header[10] !== policy.genericPropertyThemeRefsFormat ||
    header[11] !== policy.retainedTokenStreamFormat ||
    header[12] !== policy.genericPropertyStyleThemeReplayFormat ||
    uint(header[13], 'predecessor fields') !== predecessorFields.length ||
    uint(header[14], 'bound recovery fields') !== policy.maxGenericPropertyStyleThemeDiagnosticRecoveryFields ||
    uint(header[15], 'bound bytes') !== policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes ||
    header.slice(16).some(Boolean)
  ) fail('recovery header drift');

  const streamAuth = collectAuth(fields, 21, streamFieldCount, 'stream-auth');
  if (streamAuth.cursor !== fields.length - RECORD_WIDTH) fail('recovery seal must be terminal');
  assert.deepEqual(streamAuth.authenticated, originalStreamFields);
  const seal = fields.slice(streamAuth.cursor);
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] ||
    seal[3] !== header[3] || seal[4] !== header[4] || seal[5] !== header[5] ||
    seal[6] !== header[6] || seal[7] !== content || seal[8] !== header[7] ||
    seal[9] !== header[8] || seal[10] !== header[9] || seal[11] !== header[10] ||
    seal[12] !== header[11] || seal[13] !== header[12] || seal[14] !== header[13] ||
    seal[15] !== header[14] || seal[16] !== header[15] || seal.slice(17).some(Boolean)
  ) fail('recovery seal drift');
  return {
    ...expectedState,
    format: fields[0],
    predecessorCode,
    predecessorTag,
    status: 'decision',
    streamFields: streamAuth.authenticated,
  };
}
