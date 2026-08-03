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
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';
import {
  EXPRESSIONSOURCES_PARAMETER_TARGET_M4147,
} from './expressionsources-parameter-target.mjs';
import {
  ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
} from './assignment-target-projection-target.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { EMITSTATEMENT_M4113_TARGET } from './emitstatement-target.mjs';
import { EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS } from './exception-flow-emission-target.mjs';
import {
  QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
} from './quotesource-rewrite-m4-150-target.mjs';
import {
  QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
} from './quotesource-parameter-m4-151-target.mjs';
import { TYPE_FIELD_INDEX_M4117_REPLACEMENT } from './type-field-index-target.mjs';
import { NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS } from './new-expression-emission-target.mjs';
import { VALIDSTATEMENT_DIRECT_TARGET } from './validstatement-target.mjs';
import {
  reconstructPreM4142CanonicalizerMemberLayout,
} from './historical-canonicalizer-member-layout.mjs';

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
const PRE_M4142_DIGESTS = Object.freeze({
  canonicalizerCompositeSha256:
    'd96dee80f12236a3d9089bf44aeee699e6a3c35856e71f79a0743691248ea16e',
  compositionRecordSha256:
    '1ff804b6fad70ce49c4d55bdb70b4b2f1bdd9456bcdfac58ec691c09063d3676',
  expressionHelpersSha256:
    'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  mainSourceSha256:
    '959481ea210be8b1740400fe53ed999f08c61232de7855457f54a21f43213b0c',
  statementHelpersSha256:
    '604c0e05b3b3d08560df7738ce2d80bc50a0fa38901a2f2eb415767ac1ec4e5b',
});
const PRE_M4147_DIGESTS = Object.freeze({
  canonicalizerCompositeSha256:
    '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
  compositionRecordSha256:
    '3093e49e5c543d874a30bf501cb364e192d3dcb17fdad010204997b71ea99726',
  expressionHelpersSha256:
    'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  mainSourceSha256:
    'a7dab28a69cf8b7b14e4747f586526eabfc87b22bd2eca6e648b89695195f598',
  statementHelpersSha256:
    'bf8d34b94cb5871b6f63bca8a982fd0a592f81cd513290ad7bd2cbaef459e05a',
});
const PRE_M4151_DIGESTS = Object.freeze({
  canonicalizerCompositeSha256:
    'd3671c6647993e13cc09e3ebb9ffb18a20009b27761d2d8bb29a2a64d093b8c2',
  compositionRecordSha256:
    '89f0b37cd9ca2e40bfe4fd3998816990720ff6306001c1f93289e3b80bb977a0',
  expressionHelpersSha256:
    '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a',
  mainSourceSha256:
    '59469585c235eec61ea9b695cae3ce2ec94677eb0fdef6a88f41801d8191a0da',
  statementHelpersSha256:
    'bf8d34b94cb5871b6f63bca8a982fd0a592f81cd513290ad7bd2cbaef459e05a',
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
  expressionHelperReplacements = [
    QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
    QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
    TYPE_FIELD_INDEX_M4117_REPLACEMENT,
  ],
  mainSourceReplacements = [
    parameterSignatureReplacement(EXPRESSIONSOURCES_PARAMETER_TARGET_M4147),
    parameterSignatureReplacement(CANONICALIZE_PARAMETER_TARGET_M4142),
    ...NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
  ],
  reconstructMemberLayout = true,
  statementHelperReplacements = [
    ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
    ...EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS,
  ],
}) {
  const expected = exactExpectedDigests(expectedDigests, milestone);
  if (!Array.isArray(sources) || sources.length !== CANONICALIZER_COMPOSITION_MEMBERS.length) {
    fail(milestone, 'sources must contain the exact three ordered canonicalizer members');
  }
  const [currentExpressionHelpers, liveStatementHelpers, liveMainSource] =
    sources.map((source) => Buffer.from(source));
  const historicalLayout = reconstructMemberLayout
    ? reconstructPreM4142CanonicalizerMemberLayout({
      mainSource: liveMainSource,
      statementHelpersSource: liveStatementHelpers,
    })
    : {
      mainSource: liveMainSource,
      statementHelpersSource: liveStatementHelpers,
    };
  const currentStatementHelpers = historicalLayout.statementHelpersSource;
  const mainSource = historicalLayout.mainSource;
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
    expressionHelperReplacements: [
      QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
      QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
    ],
    mainSourceReplacements: [
      parameterSignatureReplacement(EXPRESSIONSOURCES_PARAMETER_TARGET_M4147),
      parameterSignatureReplacement(CANONICALIZE_PARAMETER_TARGET_M4142),
      ...NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
    ],
    milestone: 'pre-M4.129',
    statementHelperReplacements: [
      ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
      ...EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS,
    ],
    statementHelperTargets: [],
  });
}

export function loadPreM4142CanonicalizerComposition() {
  return loadHistoricalCanonicalizerComposition({
    expectedDigests: PRE_M4142_DIGESTS,
    expressionHelperReplacements: [
      QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
      QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
    ],
    mainSourceReplacements: [
      parameterSignatureReplacement(EXPRESSIONSOURCES_PARAMETER_TARGET_M4147),
      parameterSignatureReplacement(CANONICALIZE_PARAMETER_TARGET_M4142),
    ],
    milestone: 'pre-M4.142',
    statementHelperReplacements: [],
    statementHelperTargets: [],
  });
}

export function loadPreM4147CanonicalizerComposition() {
  return loadHistoricalCanonicalizerComposition({
    expectedDigests: PRE_M4147_DIGESTS,
    expressionHelperReplacements: [
      QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
      QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
    ],
    mainSourceReplacements: [
      parameterSignatureReplacement(EXPRESSIONSOURCES_PARAMETER_TARGET_M4147),
    ],
    milestone: 'pre-M4.147',
    reconstructMemberLayout: false,
    statementHelperReplacements: [],
    statementHelperTargets: [],
  });
}

export function loadPreM4151CanonicalizerComposition() {
  return loadHistoricalCanonicalizerComposition({
    expectedDigests: PRE_M4151_DIGESTS,
    expressionHelperReplacements: [QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT],
    mainSourceReplacements: [],
    milestone: 'pre-M4.151',
    reconstructMemberLayout: false,
    statementHelperReplacements: [],
    statementHelperTargets: [],
  });
}
