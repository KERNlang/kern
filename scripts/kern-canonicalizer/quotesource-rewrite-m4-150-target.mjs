import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  reconstructPreM4151CoverageInputs,
  reconstructPreM4151ExpressionHelpers,
} from './quotesource-parameter-m4-151-target.mjs';

export const QUOTESOURCE_M4150_PATH =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern';
export const PRE_M4150_EXPRESSION_HELPERS_DIGEST =
  'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f';
export const M4150_EXPRESSION_HELPERS_DIGEST =
  '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a';
export const PRE_M4150_COVERAGE_POLICY_DIGEST =
  '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019';
export const M4150_COVERAGE_POLICY_DIGEST =
  '45693b57321d2ab074be68657682524c6621f9081a94c32ecbd653534d0cf3bf';
export const M4150_CURRENT_PREDICATE =
  'c < " " || c == "\\u007f" || (c >= "\\u0080" && c <= "\\u009f") || ' +
  'c == "\\u2028" || c == "\\u2029" || c == "\\ufeff"';
export const M4150_CANDIDATE_PREDICATE =
  'c < " " || (c > "~" && c < "\\u00a0") || ' +
  '(c > "\\u2027" && c < "\\u202a") || (c > "\\ufefe" && c < "\\uff00")';

function fail(message) {
  throw new TypeError(`coverage M4.150 quotesource target rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function predicateLine(predicate) {
  return `                if cond=${JSON.stringify(predicate)}\n`;
}

export const QUOTESOURCE_M4150_SOURCE_REPLACEMENT = Object.freeze({
  current: predicateLine(M4150_CANDIDATE_PREDICATE),
  historical: predicateLine(M4150_CURRENT_PREDICATE),
});

export function readExactM4150ExpressionHelpers() {
  const source = reconstructPreM4151ExpressionHelpers();
  if (digest(source) !== M4150_EXPRESSION_HELPERS_DIGEST) {
    fail('M4.151 predecessor bytes must match the exact M4.150 rewrite');
  }
  return source;
}

export function reconstructPreM4150ExpressionHelpers(
  currentSource = readExactM4150ExpressionHelpers(),
) {
  return reconstructHistoricalSource({
    currentSource,
    expectedDigest: PRE_M4150_EXPRESSION_HELPERS_DIGEST,
    milestone: 'pre-M4.150 expression helpers',
    replacements: [QUOTESOURCE_M4150_SOURCE_REPLACEMENT],
  });
}

export function reconstructPreM4150CoverageInputs(
  currentPolicy,
  currentPolicySource,
) {
  let preM4151;
  try {
    preM4151 = reconstructPreM4151CoverageInputs(currentPolicy, currentPolicySource);
  } catch (cause) {
    throw new TypeError(
      'coverage M4.150 quotesource target rejection: successor M4.151 input is not exact',
      { cause },
    );
  }
  const source = preM4151.policySource;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('current coverage policy must contain JSON');
  }
  if (
    digest(source) !== M4150_COVERAGE_POLICY_DIGEST ||
    !isDeepStrictEqual(preM4151.policy, parsed)
  ) {
    fail('current coverage policy must match exact repository bytes');
  }
  const policy = structuredClone(preM4151.policy);
  const member = policy.corpus.find(({ path }) => path === QUOTESOURCE_M4150_PATH);
  if (member?.digest !== M4150_EXPRESSION_HELPERS_DIGEST) {
    fail('current coverage policy must authenticate the M4.150 source');
  }
  const occurrences = source.split(M4150_EXPRESSION_HELPERS_DIGEST).length - 1;
  if (occurrences !== 1) fail('current source digest must occur exactly once in policy');
  member.digest = PRE_M4150_EXPRESSION_HELPERS_DIGEST;
  const policySource = source.replace(
    M4150_EXPRESSION_HELPERS_DIGEST,
    PRE_M4150_EXPRESSION_HELPERS_DIGEST,
  );
  if (digest(policySource) !== PRE_M4150_COVERAGE_POLICY_DIGEST) {
    fail('reconstructed pre-M4.150 policy bytes must retain the archived digest');
  }
  return {
    expressionHelpers: reconstructPreM4150ExpressionHelpers(preM4151.expressionHelpers),
    policy,
    policySource,
  };
}
