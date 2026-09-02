import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const TOP_LEVEL_KEYS = ['corpus', 'format', 'generated', 'profileLimits', 'runtimeLimits'];
const PROFILE_KEYS = [
  'maxCodePoints',
  'maxDiagnostics',
  'maxOutputJsonBytes',
  'maxRecords',
  'maxSourceBytes',
  'maxTokens',
];
const RUNTIME_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents', 'maxIterations',
  'maxStringBytes',
];
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_PATH_PATTERN = /^examples\/[A-Za-z0-9._/-]+\.kern$/u;

function fail(message) {
  throw new TypeError(`frontend tokenizer policy rejection: ${message}`);
}

function assertExactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
}

function assertPositiveIntegers(value, keys, label) {
  assertExactKeys(value, keys, label);
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) fail(`${label}.${key} must be a positive safe integer`);
  }
}

export function validateFrontendTokenizerPolicy(policy) {
  assertExactKeys(policy, TOP_LEVEL_KEYS, 'policy');
  if (policy.format !== 'kern.frontend.tokenizer-shadow.2') fail('format is unsupported');
  assertPositiveIntegers(policy.profileLimits, PROFILE_KEYS, 'profileLimits');
  assertPositiveIntegers(policy.runtimeLimits, RUNTIME_KEYS, 'runtimeLimits');
  assertPositiveIntegers(policy.generated, ['maxCases'], 'generated');
  if (!Array.isArray(policy.corpus) || policy.corpus.length === 0) fail('corpus must be a non-empty array');
  for (const [index, entry] of policy.corpus.entries()) {
    assertExactKeys(entry, ['maxLines', 'path'], `corpus[${index}]`);
    if (
      typeof entry.path !== 'string' ||
      !CORPUS_PATH_PATTERN.test(entry.path) ||
      entry.path.includes('..') ||
      entry.path.includes('\\')
    ) {
      fail(`corpus[${index}].path must be a contained examples/*.kern path`);
    }
    if (!Number.isSafeInteger(entry.maxLines) || entry.maxLines <= 0) {
      fail(`corpus[${index}].maxLines must be a positive safe integer`);
    }
  }

  const { profileLimits } = policy;
  if (profileLimits.maxRecords < profileLimits.maxTokens + profileLimits.maxDiagnostics) {
    fail('profileLimits.maxRecords must cover tokens plus diagnostics');
  }
  if (policy.runtimeLimits.maxCollectionLength < 1 + (profileLimits.maxRecords + 1) * 4) {
    fail('runtimeLimits.maxCollectionLength must cover records plus the terminal seal');
  }
  if (policy.runtimeLimits.maxStringBytes < profileLimits.maxSourceBytes) {
    fail('runtimeLimits.maxStringBytes must cover maxSourceBytes');
  }
  if (profileLimits.maxOutputJsonBytes > policy.runtimeLimits.maxBytes) {
    fail('profileLimits.maxOutputJsonBytes must not exceed runtimeLimits.maxBytes');
  }
  return policy;
}

export function resolveFrontendTokenizerCorpusPath(entryPath, repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const examplesRoot = realpathSync(resolve(repositoryRoot, 'examples'));
  const candidate = realpathSync(resolve(repositoryRoot, entryPath));
  const contained = relative(examplesRoot, candidate);
  if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    fail('corpus path must resolve beneath the examples directory');
  }
  return candidate;
}

export function loadFrontendTokenizerPolicy() {
  return validateFrontendTokenizerPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}

export function frontendTokenizerPolicySource() {
  return Buffer.from(POLICY_SOURCE);
}
