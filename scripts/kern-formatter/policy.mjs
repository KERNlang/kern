import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./policy.json', import.meta.url));

function fail(detail) {
  throw new TypeError(`KERN formatter policy rejection: ${detail}`);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    fail(`${label} must contain exactly ${sorted.join(',')}`);
  }
}

function positiveSafe(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
}

export function validateKernFormatterPolicy(value) {
  exactKeys(value, ['format', 'profileLimits', 'runtimeLimits'], 'policy');
  if (value.format !== 'kern.formatter.policy.1') fail('format is unsupported');
  exactKeys(
    value.profileLimits,
    [
      'maxCodePoints',
      'maxInputBytes',
      'maxLexicalDepth',
      'maxRecordCodePoints',
      'maxRecords',
      'maxResultBytes',
      'maxResultCodePoints',
    ],
    'profileLimits',
  );
  exactKeys(
    value.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'],
    'runtimeLimits',
  );
  for (const [key, limit] of Object.entries(value.profileLimits)) positiveSafe(limit, `profileLimits.${key}`);
  for (const [key, limit] of Object.entries(value.runtimeLimits)) positiveSafe(limit, `runtimeLimits.${key}`);
  if (value.profileLimits.maxInputBytes > value.runtimeLimits.maxBytes) fail('maxInputBytes must fit maxBytes');
  if (value.profileLimits.maxResultBytes > value.runtimeLimits.maxBytes) fail('maxResultBytes must fit maxBytes');
  if (value.profileLimits.maxLexicalDepth > value.profileLimits.maxRecordCodePoints) {
    fail('maxLexicalDepth must fit maxRecordCodePoints');
  }
  if (value.profileLimits.maxRecordCodePoints > value.profileLimits.maxCodePoints) {
    fail('maxRecordCodePoints must fit maxCodePoints');
  }
  if (value.profileLimits.maxResultCodePoints < value.profileLimits.maxCodePoints + 2) {
    fail('maxResultCodePoints must admit a missing CRLF terminator');
  }
  if (value.profileLimits.maxRecords > 32768) fail('maxRecords exceeds the compiled reduction network');
  if (value.profileLimits.maxRecords * 8 + 12 > value.runtimeLimits.maxCollectionLength) {
    fail('maxRecords must fit runtime collection length');
  }
  return structuredClone(value);
}

export function kernFormatterPolicySource() {
  return Buffer.from(SOURCE);
}

export function loadKernFormatterPolicy() {
  return validateKernFormatterPolicy(JSON.parse(SOURCE.toString('utf8')));
}
