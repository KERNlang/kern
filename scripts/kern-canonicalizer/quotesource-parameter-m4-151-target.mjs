import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { reconstructHistoricalSource } from './historical-source.mjs';

export const QUOTESOURCE_M4151_PATH =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern';
export const PRE_M4151_EXPRESSION_HELPERS_DIGEST =
  '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a';
export const M4151_EXPRESSION_HELPERS_DIGEST =
  'd1128d68913bae87f68ca031d49c440ee2b1f9f5c833efcb60119b484822ef9d';
export const PRE_M4151_COVERAGE_POLICY_DIGEST =
  '45693b57321d2ab074be68657682524c6621f9081a94c32ecbd653534d0cf3bf';
export const M4151_COVERAGE_POLICY_DIGEST =
  '605f091d7fee18ad4cfd4ab130ae7ae89632d7da75c973d04dd6f9b7d5ab833a';

const PARAMETERS = Object.freeze([
  Object.freeze(['value', 'string']),
  Object.freeze(['validated', 'boolean']),
]);
const PROFILE_ROWS = Object.freeze({ nodes: 54, properties: 82, values: 932 });

export const QUOTESOURCE_PARAMETER_TARGET_M4151 = Object.freeze({
  bodyDigest: '5de221c8033b585c8c128def0e3e70cad565be00bd54a493f800e905ab9deb73',
  exported: true,
  functionOrdinal: 5,
  id: `${QUOTESOURCE_M4151_PATH}#5:quotesource`,
  name: 'quotesource',
  parameters: PARAMETERS,
  path: QUOTESOURCE_M4151_PATH,
  profileRows: PROFILE_ROWS,
  quotedReturns: false,
  returns: 'string',
  tool: 'canonicalizer',
});

export const QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT = Object.freeze({
  current:
    'fn name=quotesource returns=string export=true\n' +
    '  param name=value type=string\n' +
    '  param name=validated type=boolean\n',
  historical:
    'fn name=quotesource params="value:string,validated:boolean" returns=string export=true\n',
});

const SOURCE_URL = new URL(`../../${QUOTESOURCE_M4151_PATH}`, import.meta.url);

function fail(message) {
  throw new TypeError(`coverage M4.151 quotesource parameter target rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function readExactM4151ExpressionHelpers() {
  const path = fileURLToPath(SOURCE_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('current expression-helper owner must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  if (digest(source) !== M4151_EXPRESSION_HELPERS_DIGEST) {
    fail('current expression-helper bytes must match the exact M4.151 migration');
  }
  return source;
}

export function reconstructPreM4151ExpressionHelpers(
  currentSource = readExactM4151ExpressionHelpers(),
) {
  return reconstructHistoricalSource({
    currentSource,
    expectedDigest: PRE_M4151_EXPRESSION_HELPERS_DIGEST,
    milestone: 'pre-M4.151 expression helpers',
    replacements: [QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT],
  });
}

export function reconstructPreM4151CoverageInputs(
  currentPolicy,
  currentPolicySource,
) {
  const source = Buffer.from(currentPolicySource).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('current coverage policy must contain JSON');
  }
  if (
    digest(source) !== M4151_COVERAGE_POLICY_DIGEST ||
    !isDeepStrictEqual(currentPolicy, parsed)
  ) {
    fail('current coverage policy must match exact repository bytes');
  }
  const policy = structuredClone(currentPolicy);
  const member = policy.corpus.find(({ path }) => path === QUOTESOURCE_M4151_PATH);
  if (member?.digest !== M4151_EXPRESSION_HELPERS_DIGEST) {
    fail('current coverage policy must authenticate the M4.151 source');
  }
  const occurrences = source.split(M4151_EXPRESSION_HELPERS_DIGEST).length - 1;
  if (occurrences !== 1) fail('current source digest must occur exactly once in policy');
  member.digest = PRE_M4151_EXPRESSION_HELPERS_DIGEST;
  const policySource = source.replace(
    M4151_EXPRESSION_HELPERS_DIGEST,
    PRE_M4151_EXPRESSION_HELPERS_DIGEST,
  );
  if (digest(policySource) !== PRE_M4151_COVERAGE_POLICY_DIGEST) {
    fail('reconstructed pre-M4.151 policy bytes must retain the archived digest');
  }
  return {
    expressionHelpers: reconstructPreM4151ExpressionHelpers(),
    policy,
    policySource,
  };
}
