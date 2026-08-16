import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { FAILURE_FIXTURES, VALID_FIXTURES } from './fixtures.mjs';

export const GENERATOR_VERSION = 'kern.frontend.f2-expression-generator.1';
export const GENERATOR_SEED = '0x4b45524e354632';

const BINARY = ['+', '-', '*', '/', '%', '**', '==', '!=', '===', '!==', '<', '<=', '>', '>=', 'instanceof', '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>'];
const UNARY = ['!', '-', '+', '~', 'typeof', 'void'];
const ATOMS = ['a', 'b', 'c', '1', '2.5', 'true', 'null', '"x"', '"😀"'];

function splitmix64() {
  let state = BigInt(GENERATOR_SEED);
  const mask = (1n << 64n) - 1n;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let value = state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
    return (value ^ (value >> 31n)) & mask;
  };
}

function generatedCases() {
  const next = splitmix64();
  const pick = (values) => values[Number(next() % BigInt(values.length))];
  const cases = [];
  for (let index = 0; index < 32; index += 1) {
    const left = pick(ATOMS);
    const middle = pick(ATOMS);
    const right = pick(ATOMS);
    const first = pick(BINARY);
    let second = pick(BINARY);
    if ((first === '??' && ['&&', '||'].includes(second)) || (second === '??' && ['&&', '||'].includes(first))) {
      second = '+';
    }
    cases.push({
      id: `generated-${String(index).padStart(2, '0')}`,
      rules: ['generator:splitmix64', `operator:${first}`, `operator:${second}`],
      source: `(${left} ${first} ${middle}) ${second} ${right}`,
      status: 'parsed',
    });
  }
  return cases;
}

export function buildCorpus() {
  const operatorCases = [
    ...BINARY.map((operator, index) => ({
      id: `binary-${String(index).padStart(2, '0')}`,
      rules: [`operator:${operator}`],
      source: `left ${operator} right`,
      status: 'parsed',
    })),
    ...UNARY.map((operator, index) => ({
      id: `unary-${String(index).padStart(2, '0')}`,
      rules: [`unary:${operator}`],
      source: `${operator} value`,
      status: 'parsed',
    })),
  ];
  const cases = [
    ...VALID_FIXTURES.map((fixture) => ({ ...fixture, status: 'parsed' })),
    ...FAILURE_FIXTURES.map((fixture) => ({
      id: `reject-${fixture.family}`,
      rules: [`reject:${fixture.family}`],
      source: fixture.source,
      status: 'failure',
    })),
    ...operatorCases,
    ...generatedCases(),
  ];
  return { cases, format: 'kern.frontend.f2-expression-corpus.1', seed: GENERATOR_SEED, version: GENERATOR_VERSION };
}

export function stableCorpusBytes() {
  return `${JSON.stringify(buildCorpus(), null, 2)}\n`;
}

export function buildRuleCoverage(corpus = buildCorpus()) {
  const rules = Object.create(null);
  for (const fixture of corpus.cases) {
    for (const rule of fixture.rules) (rules[rule] ??= []).push(fixture.id);
  }
  return { format: 'kern.frontend.f2-expression-rule-coverage.1', rules };
}

export function stableCoverageBytes() {
  return `${JSON.stringify(buildRuleCoverage(), null, 2)}\n`;
}

export function corpusSha256(bytes = stableCorpusBytes()) {
  return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const corpusUrl = new URL('./conformance-corpus.json', import.meta.url);
  const coverageUrl = new URL('./rule-coverage.json', import.meta.url);
  const digestUrl = new URL('./conformance-corpus.sha256', import.meta.url);
  if (process.argv[2] === '--write') {
    const bytes = stableCorpusBytes();
    writeFileSync(corpusUrl, bytes);
    writeFileSync(coverageUrl, stableCoverageBytes());
    writeFileSync(digestUrl, `${corpusSha256(bytes)}\n`);
  } else {
    const bytes = readFileSync(corpusUrl, 'utf8');
    if (bytes !== stableCorpusBytes()) throw new Error('F2 corpus generation drift');
    if (readFileSync(coverageUrl, 'utf8') !== stableCoverageBytes()) throw new Error('F2 coverage generation drift');
    if (readFileSync(digestUrl, 'utf8') !== `${corpusSha256(bytes)}\n`) throw new Error('F2 corpus digest drift');
  }
}
