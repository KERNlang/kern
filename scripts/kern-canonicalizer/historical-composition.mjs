import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  canonicalCompositionRecordBytes,
  CANONICALIZER_COMPOSITE_PATH,
  CANONICALIZER_COMPOSITION_FORMAT,
  CANONICALIZER_COMPOSITION_MEMBERS,
  CANONICALIZER_COMPOSITION_RECIPE,
} from './composition.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { EMITSTATEMENT_M4113_TARGET } from './emitstatement-target.mjs';
import { VALIDSTATEMENT_DIRECT_TARGET } from './validstatement-target.mjs';

function parameterSignatureReplacement(target) {
  const returnSource = target.quotedReturns ? JSON.stringify(target.returns) : target.returns;
  const exportSource = target.exported ? ' export=true' : '';
  const current = [
    `fn name=${target.name} returns=${returnSource}${exportSource}`,
    ...target.parameters.map(([name, type]) => `  param name=${name} type=${type}`),
    '',
  ].join('\n');
  const legacyParameters = target.parameters.map(([name, type]) => `${name}:${type}`).join(',');
  const historical =
    `fn name=${target.name} params=${JSON.stringify(legacyParameters)} ` +
    `returns=${returnSource}${exportSource}\n`;
  return { current, historical };
}

const DEFAULT_SOURCE_URLS = [
  new URL(
    '../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    import.meta.url,
  ),
  new URL(
    '../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    import.meta.url,
  ),
  new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function metadata(path, bytes) {
  return { bytes: bytes.length, path, sha256: digest(bytes) };
}

function fail(milestone, message) {
  throw new TypeError(`${milestone} historical composition rejection: ${message}`);
}

function exactExpectedDigests(expectedDigests, milestone) {
  const expectedKeys = [
    'canonicalizerCompositeSha256',
    'compositionRecordSha256',
    'expressionHelpersSha256',
    'mainSourceSha256',
    'statementHelpersSha256',
  ];
  if (
    expectedDigests === null ||
    typeof expectedDigests !== 'object' ||
    Array.isArray(expectedDigests) ||
    Reflect.ownKeys(expectedDigests).length !== expectedKeys.length ||
    expectedKeys.some((key) =>
      typeof expectedDigests[key] !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(expectedDigests[key]))
  ) {
    fail(milestone, 'expected digests must be the exact five lowercase SHA-256 fields');
  }
  return expectedDigests;
}

export function loadHistoricalCanonicalizerComposition({
  expectedDigests,
  milestone,
  sources = DEFAULT_SOURCE_URLS.map((url) => readFileSync(url)),
  statementHelperTargets = [
    VALIDSTATEMENT_DIRECT_TARGET,
    EMITSTATEMENT_M4113_TARGET,
  ],
}) {
  const expected = exactExpectedDigests(expectedDigests, milestone);
  if (!Array.isArray(sources) || sources.length !== CANONICALIZER_COMPOSITION_MEMBERS.length) {
    fail(milestone, 'sources must contain the exact three ordered canonicalizer members');
  }
  const [expressionHelpers, currentStatementHelpers, mainSource] =
    sources.map((source) => Buffer.from(source));
  const statementHelpers = reconstructHistoricalSource({
    currentSource: currentStatementHelpers,
    expectedDigest: expected.statementHelpersSha256,
    milestone: `${milestone} statement helpers`,
    replacements: statementHelperTargets.map(parameterSignatureReplacement),
  });
  const members = [expressionHelpers, statementHelpers, mainSource];
  const composite = Buffer.concat(members);
  const record = {
    composite: metadata(CANONICALIZER_COMPOSITE_PATH, composite),
    format: CANONICALIZER_COMPOSITION_FORMAT,
    members: members.map((bytes, index) =>
      metadata(CANONICALIZER_COMPOSITION_MEMBERS[index], bytes)),
    recipe: CANONICALIZER_COMPOSITION_RECIPE,
  };
  const recordBytes = canonicalCompositionRecordBytes(record);
  const actual = {
    canonicalizerCompositeSha256: digest(composite),
    compositionRecordSha256: digest(recordBytes),
    expressionHelpersSha256: digest(expressionHelpers),
    mainSourceSha256: digest(mainSource),
    statementHelpersSha256: digest(statementHelpers),
  };
  for (const key of Object.keys(actual)) {
    if (actual[key] !== expected[key]) {
      fail(milestone, `${key} must reconstruct the archived digest`);
    }
  }
  return {
    composite,
    digests: actual,
    record,
    recordBytes,
    statementHelpers,
  };
}
