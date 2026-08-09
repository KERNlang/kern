// Closed over every failure code reachable through the exact M4.153-M4.167
// native predecessor composition. A new predecessor failure is a contract
// change and must be admitted here explicitly.
const STYLE_THEME_FAILURE_CODES = Object.freeze([
  'ADMISSION_INVALID',
  'ATTESTATION_INVALID',
  'CODE_POINTS_LIMIT',
  'DIAGNOSTIC_LIMIT',
  'EMPTY_RETAINED_CODE',
  'INVALID_BIGINT',
  'INVALID_LIMITS',
  'LEXICAL_DEPTH_LIMIT',
  'LOOP_INVALID',
  'LOOP_LIMIT',
  'LOOP_PROFILE',
  'PROPERTY_INVALID',
  'RECORD_LIMIT',
  'REGISTRY_INVALID',
  'STREAM_INVALID',
  'STYLE_BLOCK_BYTES_LIMIT',
  'STYLE_BLOCK_CODE_POINTS_LIMIT',
  'STYLE_BLOCK_UTF16_LIMIT',
  'STYLE_ENVELOPE_BYTES_LIMIT',
  'STYLE_ENVELOPE_FIELDS_LIMIT',
  'STYLE_INVALID',
  'STYLE_INVALID_LIMITS',
  'STYLE_PAIR_LIMIT',
  'STYLE_PAREN_DEPTH_LIMIT',
  'STYLE_PROFILE',
  'STYLE_SEGMENT_LIMIT',
  'STYLE_TOKEN_LIMIT',
  'STYLE_WRITE_LIMIT',
  'THEME_INVALID',
  'THEME_LIMIT',
  'THEME_PROFILE',
  'TOKEN_LIMIT',
  'TRIM_INVALID',
  'UNCLOSED_EXPR',
  'UNCLOSED_STRING',
  'UNCLOSED_STYLE',
  'UNSUPPORTED_UNKNOWN',
  'WARNING_INVALID',
]);

const PROJECTION_FAILURE_CODES = Object.freeze([
  'STYLE_DIAGNOSTIC_BYTES_LIMIT',
  'STYLE_DIAGNOSTIC_FIELDS_LIMIT',
  'STYLE_DIAGNOSTIC_INVALID',
  'STYLE_DIAGNOSTIC_INVALID_LIMITS',
  'STYLE_DIAGNOSTIC_LIMIT',
]);

const RECOVERY_FAILURE_CODES = Object.freeze([
  'STYLE_DIAGNOSTIC_BYTES_LIMIT',
  'STYLE_DIAGNOSTIC_FIELDS_LIMIT',
  'STYLE_DIAGNOSTIC_INVALID',
  'STYLE_DIAGNOSTIC_INVALID_LIMITS',
  ...STYLE_THEME_FAILURE_CODES,
]);

export const DIAGNOSTIC_PROJECTION_FAILURE_CODES = PROJECTION_FAILURE_CODES;
export const DIAGNOSTIC_RECOVERY_FAILURE_CODES = RECOVERY_FAILURE_CODES;
export const DIAGNOSTICS_FAILURE_CODES = Object.freeze([
  'STYLE_DIAGNOSTICS_BYTES_LIMIT',
  'STYLE_DIAGNOSTICS_FIELDS_LIMIT',
  'STYLE_DIAGNOSTICS_INVALID',
  'STYLE_DIAGNOSTICS_INVALID_LIMITS',
  ...PROJECTION_FAILURE_CODES,
  ...RECOVERY_FAILURE_CODES,
]);

export function parseBoundCompactFailure(content, snapshot, fields, allowedCodes, fail) {
  if (fields.length !== 41 || fields[1] !== 'failure' || fields[21] !== 'failure-seal') {
    fail('invalid bounded failure envelope');
  }
  if (
    fields[2] !== fields[22] || fields[3] !== fields[23] || fields[24] !== content ||
    fields[4] !== fields[25] || fields[5] !== fields[26] || fields.slice(6, 21).some(Boolean) ||
    fields.slice(27).some(Boolean)
  ) fail('failure seal drift');
  if (
    fields[4] !== String(snapshot.runtimeInstance) ||
    fields[5] !== String(snapshot.parseEpoch)
  ) fail('failure identity drift');
  if (!allowedCodes.includes(fields[2])) fail('failure code contract drift');
  return { code: fields[2], detail: fields[3], status: 'failure' };
}
