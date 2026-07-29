import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
} from './assignment-target-projection-target.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';

const MIGRATIONS_BY_PATH = new Map([
  ['examples/capstone-assertion-engine/compare.kern', ['compareList', 'compareMap']],
  [
    'examples/capstone-checker-subset/checker-while.kern',
    ['numericBindingProven', 'lengthReceiverProven'],
  ],
  [
    'examples/capstone-checker-subset/checker.kern',
    ['rejectLine', 'paramCallsitesOk', 'mapKeyToken', 'mapKnownBefore', 'checkModule'],
  ],
  [
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    ['emitstatement'],
  ],
  ['examples/selfhost-validator/validator.kern', ['exportkind']],
]);

const PRE_M4113_DIGESTS = new Map([
  [
    'examples/capstone-assertion-engine/compare.kern',
    '1bbcff9ce986ec644d22bfe0a6b358c124ba078a43f9b17fdce4d79ff15cde7e',
  ],
  [
    'examples/capstone-checker-subset/checker-while.kern',
    'df856b8a6a674b0803273a65a755e64ebb13f699fed692fc7dd7db88bee8c802',
  ],
  [
    'examples/capstone-checker-subset/checker.kern',
    '5bc7cacd87bd1093ecbcd2c6dda6d56ff113a8bcbb9e0a26ca327675a4297bee',
  ],
  [
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    '02037b400eb35d2fd61a5eaf06e6b83fbd9bb1c12bbe71da82bc39327169c592',
  ],
  [
    'examples/selfhost-validator/validator.kern',
    'db11517fa7804dac32480bc205bd835b631524a00674e1e85f549dc663d5eb5a',
  ],
]);

const PRE_M4113_POLICY_DIGEST =
  '0285747660651cab2ee1029456dc40c190c42d2515937fa6d3534247df363b54';
const PRE_M4124_CHECKER_DIGEST =
  '934608ea0793197402a48e331142129edb98b26256f48fa897285badbd1d4add';
const PRE_M4124_POLICY_DIGEST =
  'bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534';
const PRE_M4129_POLICY_DIGEST =
  '04a61b18126cac0ddd723fef2686ae2f77c0bba6501c11dee6756fc3c0b0d400';
const CHECKER_PATH = 'examples/capstone-checker-subset/checker.kern';
const STATEMENT_HELPERS_PATH =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern';
const PRE_M4129_STATEMENT_HELPERS_DIGEST =
  '11485f2b657a002e8ff4ca93db7b0122768163c65edecb3a1f13da4906569d75';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function signatureReplacement(source, name) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`fn name=${name} `));
  if (index < 0) throw new TypeError(`historical parameter source rejection: missing ${name}`);
  const parameterLines = [];
  for (let cursor = index + 1; lines[cursor]?.startsWith('  param '); cursor += 1) {
    parameterLines.push(lines[cursor]);
  }
  if (parameterLines.length === 0) {
    throw new TypeError(`historical parameter source rejection: ${name} has no direct parameters`);
  }
  const parameters = parameterLines.map((line) => {
    const match = /^  param name=([^ ]+) type=(.+)$/u.exec(line);
    if (match === null) {
      throw new TypeError(`historical parameter source rejection: malformed ${name} parameter`);
    }
    return `${match[1]}:${match[2]}`;
  });
  return {
    current: `${[lines[index], ...parameterLines].join('\n')}\n`,
    historical:
      `${lines[index].replace(
        `fn name=${name} `,
        `fn name=${name} params=${JSON.stringify(parameters.join(','))} `,
      )}\n`,
  };
}

export function reconstructLegacyParameterSource({
  additionalNames = [],
  currentSource,
  expectedDigest,
  milestone,
  name,
}) {
  return reconstructHistoricalSource({
    currentSource,
    expectedDigest,
    milestone,
    replacements: [...additionalNames, name]
      .map((functionName) =>
        signatureReplacement(currentSource.toString('utf8'), functionName)),
  });
}

export function loadPreM4113CoverageInputs(currentPolicy) {
  const sourceOverrides = new Map();
  for (const [path, names] of MIGRATIONS_BY_PATH) {
    const currentSource = readFileSync(new URL(`../../${path}`, import.meta.url));
    const sourceText = currentSource.toString('utf8');
    sourceOverrides.set(path, reconstructHistoricalSource({
      currentSource,
      expectedDigest: PRE_M4113_DIGESTS.get(path),
      milestone: `pre-M4.113 ${path}`,
      replacements: [
        ...names.map((name) => signatureReplacement(sourceText, name)),
        ...(path === STATEMENT_HELPERS_PATH
          ? [ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT]
          : []),
      ],
    }));
  }
  const policy = structuredClone(currentPolicy);
  for (const member of policy.corpus) {
    if (PRE_M4113_DIGESTS.has(member.path)) member.digest = PRE_M4113_DIGESTS.get(member.path);
  }
  let policySource = readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8');
  for (const [path, historicalDigest] of PRE_M4113_DIGESTS) {
    const currentDigest = currentPolicy.corpus.find((member) => member.path === path)?.digest;
    if (typeof currentDigest !== 'string') {
      throw new TypeError(`historical parameter source rejection: missing policy member ${path}`);
    }
    policySource = policySource.replace(currentDigest, historicalDigest);
  }
  if (digest(policySource) !== PRE_M4113_POLICY_DIGEST) {
    throw new TypeError('historical parameter source rejection: policy digest must remain exact');
  }
  return {
    coveragePolicyDigest: PRE_M4113_POLICY_DIGEST,
    policy,
    sourceOverrides,
  };
}

export function loadPreM4124CoverageInputs(currentPolicy) {
  const currentPolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  if (!isDeepStrictEqual(currentPolicy, JSON.parse(currentPolicySource))) {
    throw new TypeError('pre-M4.124 coverage rejection: caller policy must match repository policy');
  }
  const currentSource = readFileSync(new URL(`../../${CHECKER_PATH}`, import.meta.url));
  const statementHelpersSource = readFileSync(
    new URL(`../../${STATEMENT_HELPERS_PATH}`, import.meta.url),
  );
  const sourceOverrides = new Map([
    [CHECKER_PATH, reconstructLegacyParameterSource({
      currentSource,
      expectedDigest: PRE_M4124_CHECKER_DIGEST,
      milestone: 'pre-M4.124 checker source',
      name: 'rejectLine',
    })],
    [STATEMENT_HELPERS_PATH, reconstructHistoricalSource({
      currentSource: statementHelpersSource,
      expectedDigest: PRE_M4129_STATEMENT_HELPERS_DIGEST,
      milestone: 'pre-M4.129 statement helpers',
      replacements: [ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT],
    })],
  ]);
  const policy = structuredClone(currentPolicy);
  const checker = policy.corpus.find(({ path }) => path === CHECKER_PATH);
  const statementHelpers = policy.corpus.find(
    ({ path }) => path === STATEMENT_HELPERS_PATH,
  );
  if (checker === undefined) {
    throw new TypeError('pre-M4.124 coverage rejection: missing checker corpus member');
  }
  if (statementHelpers === undefined) {
    throw new TypeError('pre-M4.124 coverage rejection: missing statement helpers corpus member');
  }
  const currentDigest = checker.digest;
  const currentStatementHelpersDigest = statementHelpers.digest;
  checker.digest = PRE_M4124_CHECKER_DIGEST;
  statementHelpers.digest = PRE_M4129_STATEMENT_HELPERS_DIGEST;
  const digestOccurrences = currentPolicySource.split(currentDigest).length - 1;
  if (digestOccurrences !== 1) {
    throw new TypeError('pre-M4.124 coverage rejection: checker digest must occur exactly once');
  }
  const statementDigestOccurrences =
    currentPolicySource.split(currentStatementHelpersDigest).length - 1;
  if (statementDigestOccurrences !== 1) {
    throw new TypeError(
      'pre-M4.124 coverage rejection: statement helpers digest must occur exactly once',
    );
  }
  const policySource = currentPolicySource
    .replace(currentDigest, PRE_M4124_CHECKER_DIGEST)
    .replace(currentStatementHelpersDigest, PRE_M4129_STATEMENT_HELPERS_DIGEST);
  if (digest(policySource) !== PRE_M4124_POLICY_DIGEST) {
    throw new TypeError('pre-M4.124 coverage rejection: policy digest must remain exact');
  }
  return {
    coveragePolicyDigest: PRE_M4124_POLICY_DIGEST,
    policy,
    sourceOverrides,
  };
}

export function loadPreM4129CoverageInputs(currentPolicy) {
  const currentPolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  if (!isDeepStrictEqual(currentPolicy, JSON.parse(currentPolicySource))) {
    throw new TypeError('pre-M4.129 coverage rejection: caller policy must match repository policy');
  }
  const currentSource = readFileSync(
    new URL(`../../${STATEMENT_HELPERS_PATH}`, import.meta.url),
  );
  const historicalSource = reconstructHistoricalSource({
    currentSource,
    expectedDigest: PRE_M4129_STATEMENT_HELPERS_DIGEST,
    milestone: 'pre-M4.129 statement helpers',
    replacements: [ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT],
  });
  const policy = structuredClone(currentPolicy);
  const statementHelpers = policy.corpus.find(
    ({ path }) => path === STATEMENT_HELPERS_PATH,
  );
  if (statementHelpers === undefined) {
    throw new TypeError('pre-M4.129 coverage rejection: missing statement helpers corpus member');
  }
  const currentDigest = statementHelpers.digest;
  statementHelpers.digest = PRE_M4129_STATEMENT_HELPERS_DIGEST;
  const digestOccurrences = currentPolicySource.split(currentDigest).length - 1;
  if (digestOccurrences !== 1) {
    throw new TypeError(
      'pre-M4.129 coverage rejection: statement helpers digest must occur exactly once',
    );
  }
  const policySource = currentPolicySource.replace(
    currentDigest,
    PRE_M4129_STATEMENT_HELPERS_DIGEST,
  );
  if (digest(policySource) !== PRE_M4129_POLICY_DIGEST) {
    throw new TypeError('pre-M4.129 coverage rejection: policy digest must remain exact');
  }
  return {
    coveragePolicyDigest: PRE_M4129_POLICY_DIGEST,
    policy,
    sourceOverrides: new Map([[STATEMENT_HELPERS_PATH, historicalSource]]),
  };
}
