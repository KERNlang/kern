import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT,
} from './assignment-target-projection-target.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  PRE_M4135_CANONICALIZER_MAIN_DIGEST,
  PRE_M4135_COVERAGE_POLICY_DIGEST,
  PRE_M4135_COVERAGE_POLICY_REPLACEMENTS,
} from './new-expression-coverage-target.mjs';
import {
  NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
} from './new-expression-emission-target.mjs';

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
  ['examples/selfhost-validator/validator.kern', ['exportkind', 'validate']],
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
const CANONICALIZER_MAIN_PATH = 'examples/kern-canonicalizer/canonicalizer.kern';
const VALIDATOR_PATH = 'examples/selfhost-validator/validator.kern';
const STATEMENT_HELPERS_PATH =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern';
const PRE_M4129_STATEMENT_HELPERS_DIGEST =
  '11485f2b657a002e8ff4ca93db7b0122768163c65edecb3a1f13da4906569d75';
const PRE_M4131_VALIDATOR_DIGEST =
  '96a1c96800132f2401d743eac02f0efe8cb0717980ceb56c2af531798790eaac';
const PRE_M4131_POLICY_DIGEST =
  'dcc9cc2db3478bd92370a373cf519ef192365bc8181bc5c726a9cce5bd4d80d6';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function preM4135CoveragePolicy(currentPolicy, currentPolicySource) {
  if (!isDeepStrictEqual(currentPolicy, JSON.parse(currentPolicySource))) {
    throw new TypeError('pre-M4.135 coverage rejection: caller policy must match repository policy');
  }
  const policySource = reconstructHistoricalSource({
    currentSource: currentPolicySource,
    expectedDigest: PRE_M4135_COVERAGE_POLICY_DIGEST,
    milestone: 'pre-M4.135 coverage policy',
    replacements: PRE_M4135_COVERAGE_POLICY_REPLACEMENTS,
  }).toString('utf8');
  const mainSource = reconstructHistoricalSource({
    currentSource: readFileSync(new URL(`../../${CANONICALIZER_MAIN_PATH}`, import.meta.url)),
    expectedDigest: PRE_M4135_CANONICALIZER_MAIN_DIGEST,
    milestone: 'pre-M4.135 canonicalizer main source',
    replacements: NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS,
  });
  return {
    policy: JSON.parse(policySource),
    policySource,
    sourceOverrides: new Map([[CANONICALIZER_MAIN_PATH, mainSource]]),
  };
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

function preM4131CoverageInputs(currentPolicy, currentPolicySource) {
  const preM4135 = preM4135CoveragePolicy(currentPolicy, currentPolicySource);
  const currentSource = readFileSync(new URL(`../../${VALIDATOR_PATH}`, import.meta.url));
  const historicalSource = reconstructLegacyParameterSource({
    currentSource,
    expectedDigest: PRE_M4131_VALIDATOR_DIGEST,
    milestone: 'pre-M4.131 validator source',
    name: 'validate',
  });
  const policy = structuredClone(preM4135.policy);
  const validator = policy.corpus.find(({ path }) => path === VALIDATOR_PATH);
  if (validator === undefined) {
    throw new TypeError('pre-M4.131 coverage rejection: missing validator corpus member');
  }
  const currentDigest = validator.digest;
  validator.digest = PRE_M4131_VALIDATOR_DIGEST;
  const digestOccurrences = currentPolicySource.split(currentDigest).length - 1;
  if (digestOccurrences !== 1) {
    throw new TypeError('pre-M4.131 coverage rejection: validator digest must occur exactly once');
  }
  const policySource = preM4135.policySource.replace(currentDigest, PRE_M4131_VALIDATOR_DIGEST);
  if (digest(policySource) !== PRE_M4131_POLICY_DIGEST) {
    throw new TypeError('pre-M4.131 coverage rejection: policy digest must remain exact');
  }
  return {
    policy,
    policySource,
    sourceOverrides: new Map([
      ...preM4135.sourceOverrides,
      [VALIDATOR_PATH, historicalSource],
    ]),
  };
}

export function loadPreM4135CoverageInputs(currentPolicy) {
  const currentPolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  const historical = preM4135CoveragePolicy(currentPolicy, currentPolicySource);
  return {
    coveragePolicyDigest: PRE_M4135_COVERAGE_POLICY_DIGEST,
    coveragePolicySource: Buffer.from(historical.policySource),
    policy: historical.policy,
    sourceOverrides: historical.sourceOverrides,
  };
}

export function loadPreM4131CoverageInputs(currentPolicy) {
  const currentPolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  const historical = preM4131CoverageInputs(currentPolicy, currentPolicySource);
  return {
    coveragePolicyDigest: PRE_M4131_POLICY_DIGEST,
    coveragePolicySource: Buffer.from(historical.policySource),
    policy: historical.policy,
    sourceOverrides: historical.sourceOverrides,
  };
}

export function loadPreM4113CoverageInputs(currentPolicy) {
  const livePolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  const preM4135 = preM4135CoveragePolicy(currentPolicy, livePolicySource);
  const sourceOverrides = new Map(preM4135.sourceOverrides);
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
  const policy = structuredClone(preM4135.policy);
  for (const member of policy.corpus) {
    if (PRE_M4113_DIGESTS.has(member.path)) member.digest = PRE_M4113_DIGESTS.get(member.path);
  }
  let policySource = preM4135.policySource;
  for (const [path, historicalDigest] of PRE_M4113_DIGESTS) {
    const currentDigest = preM4135.policy.corpus.find((member) => member.path === path)?.digest;
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
  const livePolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  if (!isDeepStrictEqual(currentPolicy, JSON.parse(livePolicySource))) {
    throw new TypeError('pre-M4.124 coverage rejection: caller policy must match repository policy');
  }
  const preM4131 = preM4131CoverageInputs(currentPolicy, livePolicySource);
  const currentPolicySource = preM4131.policySource;
  const currentSource = readFileSync(new URL(`../../${CHECKER_PATH}`, import.meta.url));
  const statementHelpersSource = readFileSync(
    new URL(`../../${STATEMENT_HELPERS_PATH}`, import.meta.url),
  );
  const sourceOverrides = new Map(preM4131.sourceOverrides);
  sourceOverrides.set(CHECKER_PATH, reconstructLegacyParameterSource({
      currentSource,
      expectedDigest: PRE_M4124_CHECKER_DIGEST,
      milestone: 'pre-M4.124 checker source',
      name: 'rejectLine',
    }));
  sourceOverrides.set(STATEMENT_HELPERS_PATH, reconstructHistoricalSource({
      currentSource: statementHelpersSource,
      expectedDigest: PRE_M4129_STATEMENT_HELPERS_DIGEST,
      milestone: 'pre-M4.129 statement helpers',
      replacements: [ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT],
    }));
  const policy = preM4131.policy;
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
  const livePolicySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  if (!isDeepStrictEqual(currentPolicy, JSON.parse(livePolicySource))) {
    throw new TypeError('pre-M4.129 coverage rejection: caller policy must match repository policy');
  }
  const preM4131 = preM4131CoverageInputs(currentPolicy, livePolicySource);
  const currentPolicySource = preM4131.policySource;
  const currentSource = readFileSync(
    new URL(`../../${STATEMENT_HELPERS_PATH}`, import.meta.url),
  );
  const historicalSource = reconstructHistoricalSource({
    currentSource,
    expectedDigest: PRE_M4129_STATEMENT_HELPERS_DIGEST,
    milestone: 'pre-M4.129 statement helpers',
    replacements: [ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT],
  });
  const policy = preM4131.policy;
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
    sourceOverrides: new Map([
      ...preM4131.sourceOverrides,
      [STATEMENT_HELPERS_PATH, historicalSource],
    ]),
  };
}
