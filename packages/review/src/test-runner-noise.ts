// Globals injected by jest (`types: ["jest"]`), vitest (`globals: true`),
// mocha/jasmine ambient types, and Cypress. Review's ad-hoc Project often
// cannot reach those ambient types in sparse clones, so callers may suppress
// these only after also gating on isTestLikeFilePath.
const TEST_RUNNER_GLOBAL_NAMES = new Set([
  'describe',
  'context',
  'suite',
  'it',
  'specify',
  'test',
  'expect',
  'jest',
  'vi',
  'cy',
  'Cypress',
  'spyOn',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'before',
  'after',
  'setup',
  'teardown',
  'suiteSetup',
  'suiteTeardown',
  // Focus/skip variants (jest/jasmine): a temporarily focused or skipped
  // test committed to a PR would otherwise emit ts2304 sandbox noise.
  'fdescribe',
  'fit',
  'xdescribe',
  'xit',
  'xtest',
]);

const TEST_LIKE_FILE_PATH_PATTERNS = [
  /(?:^|\/|\.)(?:test|spec|cy|e2e)\.[cm]?[jt]sx?$/i,
  /(?:^|\/)__(?:tests?|mocks?)__\//i,
  /(?:^|\/)cypress\/(?:e2e|integration|component|support)\//i,
  /(?:^|\/)(?:tests?|spec|e2e|testing|test-utils?|test-helpers?)(?:\/|\.[cm]?[jt]sx?$)/i,
  /(?:^|\/)(?:jest|vitest)[.-]setup\.[cm]?[jt]sx?$/i,
  /(?:^|\/)(?:setup[.-]?tests?|test[.-]?setup)\.[cm]?[jt]sx?$/i,
];

// Matches both value position ("Cannot find name 'expect'", TS2304/2552) and
// namespace position ("Cannot find namespace 'jest'", TS2503).
export function isTestRunnerGlobalCannotFindName(message: string): boolean {
  const m = message.match(/^Cannot find (?:name|namespace) '([^']+)'\.?/);
  if (!m) return false;
  return TEST_RUNNER_GLOBAL_NAMES.has(m[1]);
}

// Files where test-runner globals are legitimately ambient: *.test.* /
// *.spec.* suffixes; exact test/spec/helper files; __tests__/__test__/
// __mocks__ directories; test/tests/spec/e2e/testing/helper directories; and
// runner setup files (jest.setup.ts, setupTests.ts, test-setup.ts, ...).
export function isTestLikeFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_LIKE_FILE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}
