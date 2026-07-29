import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  canonicalCompositionRecordBytes,
  CANONICALIZER_COMPOSITE_PATH,
  CANONICALIZER_COMPOSITION_FORMAT,
  CANONICALIZER_COMPOSITION_MEMBERS,
  CANONICALIZER_COMPOSITION_RECIPE,
} from './composition.mjs';
import {
  ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
} from './assignment-target-projection-target.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { EMITSTATEMENT_M4113_TARGET } from './emitstatement-target.mjs';
import { TYPE_FIELD_INDEX_M4117_REPLACEMENT } from './type-field-index-target.mjs';
import { NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS } from './new-expression-emission-target.mjs';
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

const PRE_M4129_DIGESTS = Object.freeze({
  canonicalizerCompositeSha256:
    'f40d056b2aac947350f297196cbe71d5acdb5b82d245963adee910620c7b7180',
  compositionRecordSha256:
    'a98f58589b8e0d8006970aa5e530b393e8f3cd247bea1e86f922b98a89d5649e',
  expressionHelpersSha256:
    'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  statementHelpersSha256:
    '11485f2b657a002e8ff4ca93db7b0122768163c65edecb3a1f13da4906569d75',
});

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
  expressionHelperReplacements = [TYPE_FIELD_INDEX_M4117_REPLACEMENT],
  mainSourceReplacements = NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
  statementHelperReplacements = [
    ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
  ],
}) {
  const expected = exactExpectedDigests(expectedDigests, milestone);
  if (!Array.isArray(sources) || sources.length !== CANONICALIZER_COMPOSITION_MEMBERS.length) {
    fail(milestone, 'sources must contain the exact three ordered canonicalizer members');
  }
  const [currentExpressionHelpers, currentStatementHelpers, mainSource] =
    sources.map((source) => Buffer.from(source));
  const expressionHelpers = expressionHelperReplacements.length === 0
    ? currentExpressionHelpers
    : reconstructHistoricalSource({
      currentSource: currentExpressionHelpers,
      expectedDigest: expected.expressionHelpersSha256,
      milestone: `${milestone} expression helpers`,
      replacements: expressionHelperReplacements,
    });
  if (
    !Array.isArray(statementHelperTargets) ||
    !Array.isArray(statementHelperReplacements) ||
    !Array.isArray(mainSourceReplacements)
  ) {
    fail(milestone, 'source reconstruction inputs must be arrays');
  }
  const statementReplacements = [
    ...statementHelperTargets.map(parameterSignatureReplacement),
    ...statementHelperReplacements,
  ];
  const statementHelpers = statementReplacements.length === 0
    ? currentStatementHelpers
    : reconstructHistoricalSource({
      currentSource: currentStatementHelpers,
      expectedDigest: expected.statementHelpersSha256,
      milestone: `${milestone} statement helpers`,
      replacements: statementReplacements,
    });
  const historicalMainSource = mainSourceReplacements.length === 0
    ? mainSource
    : reconstructHistoricalSource({
      currentSource: mainSource,
      expectedDigest: expected.mainSourceSha256,
      milestone: `${milestone} main source`,
      replacements: mainSourceReplacements,
    });
  const members = [expressionHelpers, statementHelpers, historicalMainSource];
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
    mainSourceSha256: digest(historicalMainSource),
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
    expressionHelpers,
    mainSource: historicalMainSource,
    record,
    recordBytes,
    source: composite.toString('utf8'),
    statementHelpers,
  };
}

export function loadPreM4129CanonicalizerComposition() {
  return loadHistoricalCanonicalizerComposition({
    expectedDigests: PRE_M4129_DIGESTS,
    expressionHelperReplacements: [],
    mainSourceReplacements: NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
    milestone: 'pre-M4.129',
    statementHelperReplacements: [
      ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
    ],
    statementHelperTargets: [],
  });
}
