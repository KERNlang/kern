import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { reconstructHistoricalSource } from './historical-source.mjs';

const MIGRATIONS_BY_PATH = new Map([
  ['examples/capstone-assertion-engine/compare.kern', ['compareList', 'compareMap']],
  [
    'examples/capstone-checker-subset/checker-while.kern',
    ['numericBindingProven', 'lengthReceiverProven'],
  ],
  [
    'examples/capstone-checker-subset/checker.kern',
    ['paramCallsitesOk', 'mapKeyToken', 'mapKnownBefore'],
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

export function loadPreM4113CoverageInputs(currentPolicy) {
  const sourceOverrides = new Map();
  for (const [path, names] of MIGRATIONS_BY_PATH) {
    const currentSource = readFileSync(new URL(`../../${path}`, import.meta.url));
    const sourceText = currentSource.toString('utf8');
    sourceOverrides.set(path, reconstructHistoricalSource({
      currentSource,
      expectedDigest: PRE_M4113_DIGESTS.get(path),
      milestone: `pre-M4.113 ${path}`,
      replacements: names.map((name) => signatureReplacement(sourceText, name)),
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
