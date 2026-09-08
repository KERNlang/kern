import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { COMMIT_TAGS, EVIDENCE_LEAF, GATED_COMMIT_TAG, PREDECESSOR_LEAF } from './pins.mjs';
import { commitRows, commitRowsRaw, repositoryText, specCriteria } from './k0-support.mjs';

// D-7f's measurement is a deliberate pre-merge command, not a per-run cost: the drive re-runs the
// whole suite, so gating it on an env var keeps the evidence leaf from paying for itself twice.
// `D_MEASURE_ROWS=1 pnpm test:kern-5-d-linked-try` is the command; CHILD_FLAG stops it recursing.
const CHILD_FLAG = 'D_COMMIT_ROWS_CHILD';
const IS_CHILD = process.env[CHILD_FLAG] === '1';
const MEASURE = process.env.D_MEASURE_ROWS === '1' && !IS_CHILD;
const SKIP_REASON = 'set D_MEASURE_ROWS=1 to run the D-7f self-drive';

const SUITE_DIRECTORY = 'scripts/kern-5-d-linked-try';

function oracleFiles() {
  return readdirSync(new URL('./', import.meta.url))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
}

// D-7f prescribes `node --test scripts/kern-5-d-linked-try/`. Node 22 resolves a bare directory as
// a module path and dies with MODULE_NOT_FOUND, so the measurement passes the files explicitly --
// same rows, a command that runs.
function tapNames() {
  const child = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      ...oracleFiles().map((name) => `${SUITE_DIRECTORY}/${name}`),
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, [CHILD_FLAG]: '1' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90 * 60 * 1000,
    },
  );
  assert.equal(
    child.signal,
    null,
    `D_MEASUREMENT_FAILED: the self-drive was killed with ${child.signal}, so its row list is truncated`,
  );
  assert.ok(child.stdout.length > 0, 'D_MEASUREMENT_FAILED: the self-drive produced no TAP output');
  const names = new Set();
  for (const match of child.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gmu)) {
    const name = match[1].trim();
    if (name.startsWith(SUITE_DIRECTORY) || name.endsWith('.test.mjs')) continue;
    names.add(name);
  }
  return [...names].sort();
}

test('commit-rows.json exists, is canonically serialized, and keys exactly the five commit tags', () => {
  const raw = commitRowsRaw();
  const document = commitRows();
  assert.equal(`${JSON.stringify(document, null, 2)}\n`, raw, 'D_COMMIT_ROWS_SHAPE: the mapping must stay canonical');
  assert.equal(document.format, 'kern.oracle.d-linked-try.commit-rows.v1');
  assert.deepEqual(
    Object.keys(document.rows).sort(),
    [...COMMIT_TAGS],
    `D_COMMIT_ROWS_SHAPE: rows must be keyed by exactly ${COMMIT_TAGS.join(', ')}`,
  );
});

test('every row name is claimed by exactly one commit tag, so the mapping is disjoint', () => {
  const document = commitRows();
  const seen = new Map();
  for (const [tag, names] of Object.entries(document.rows)) {
    for (const name of names) {
      assert.equal(
        seen.has(name),
        false,
        `D_COMMIT_ROWS_OVERLAP: ${JSON.stringify(name)} is claimed by both ${seen.get(name)} and ${tag}`,
      );
      seen.set(name, tag);
    }
    assert.deepEqual([...names], [...names].sort(), `D_COMMIT_ROWS_SHAPE: the ${tag} name list must be sorted`);
  }
});

// D-7f's own words: "the measurement is a command, not a judgement". The command is run here and the
// integers it produces go into the assertion message, so the gate decision is evidence rather than
// an estimate.
test('the mapping is total: every row the suite actually runs is named exactly once', { skip: MEASURE ? false : SKIP_REASON }, () => {
  const document = commitRows();
  const mapped = Object.values(document.rows).flat().sort();
  const measured = tapNames();
  const unmapped = measured.filter((name) => !mapped.includes(name));
  const stale = mapped.filter((name) => !measured.includes(name));
  assert.deepEqual(
    unmapped,
    [],
    `D_COMMIT_ROWS_INCOMPLETE: ${unmapped.length} rows the suite runs are named by no commit tag`,
  );
  assert.deepEqual(stale, [], `D_COMMIT_ROWS_STALE: ${stale.length} mapped names correspond to no row the suite runs`);
});

// Always on, and it needs no drive: the recorded comparison must be arithmetically consistent with
// the mapping the totality row above validates, and the gate must not have fired.
test('the D-7f abort comparison is recorded with the integers the mapping carries', () => {
  const document = commitRows();
  const counts = Object.fromEntries(Object.entries(document.rows).map(([tag, names]) => [tag, names.length]));
  const preceding = COMMIT_TAGS.filter((tag) => tag !== GATED_COMMIT_TAG).reduce(
    (sum, tag) => sum + counts[tag],
    0,
  );
  assert.deepEqual(
    document.abortCriterion,
    { gated: counts[GATED_COMMIT_TAG], preceding, cut: counts[GATED_COMMIT_TAG] > preceding },
    `D_ABORT_CRITERION_STALE: the recorded comparison must be the measured one -- ${GATED_COMMIT_TAG} has ${counts[GATED_COMMIT_TAG]} rows against ${preceding} preceding`,
  );
  assert.equal(
    document.abortCriterion.cut,
    false,
    `D_ABORT_CRITERION_FIRED: ${GATED_COMMIT_TAG} has ${counts[GATED_COMMIT_TAG]} rows against ${preceding} across ${COMMIT_TAGS.length - 1} preceding commits, so the finally commit is cut to D2 and the four finally labels return to unspent`,
  );
});

// The spec's acceptance criteria carry no IDs, so the coverage row cannot grep an ID against a test
// title. It pins the criteria count and the group headings instead, and asserts each group is
// claimed by at least one oracle file -- which is the strongest honest substitute.
test('every acceptance-criteria group in the spec is claimed by at least one oracle file', () => {
  const { criteria, groups } = specCriteria();
  const document = commitRows();
  assert.ok(criteria.length > 0, 'D_SPEC_SHAPE: the Acceptance Criteria section must carry unchecked criteria');
  assert.equal(
    criteria.length,
    document.criteriaCount,
    `D_CRITERIA_DRIFT: the spec now carries ${criteria.length} criteria against the recorded ${document.criteriaCount}`,
  );
  assert.deepEqual(
    groups.sort(),
    Object.keys(document.groups).sort(),
    'D_CRITERIA_DRIFT: every acceptance-criteria group heading must be claimed in commit-rows.json',
  );
  const present = new Set(oracleFiles());
  for (const [group, files] of Object.entries(document.groups)) {
    assert.ok(files.length > 0, `D_CRITERIA_UNCOVERED: the group ${JSON.stringify(group)} names no oracle file`);
    for (const file of files) {
      assert.ok(present.has(file), `D_CRITERIA_UNCOVERED: ${group} names ${file}, which does not exist`);
    }
  }
});

// The wiring trap D.0's STEP-0-g names: the leaf must land in package.json's aggregate AND in the
// tier contract's own list, or test:ci-contract goes red.
test('the evidence leaf is wired into the aggregate exactly once, after the D.0 leaf', () => {
  const packageJson = JSON.parse(repositoryText('package.json'));
  assert.equal(
    typeof packageJson.scripts[EVIDENCE_LEAF],
    'string',
    `D_LEAF_UNWIRED: package.json must declare ${EVIDENCE_LEAF}`,
  );
  const aggregate = packageJson.scripts['test:kern-5-script-family'];
  const segments = aggregate.split(' && ').map((segment) => segment.trim());
  assert.equal(
    segments.filter((segment) => segment === `pnpm ${EVIDENCE_LEAF}`).length,
    1,
    `D_LEAF_UNWIRED: the aggregate must run ${EVIDENCE_LEAF} exactly once`,
  );
  assert.equal(
    segments.at(-1),
    `pnpm ${EVIDENCE_LEAF}`,
    `D_LEAF_UNWIRED: ${EVIDENCE_LEAF} must be the last segment, so it runs after ${PREDECESSOR_LEAF}`,
  );
  assert.ok(
    segments.indexOf(`pnpm ${PREDECESSOR_LEAF}`) < segments.indexOf(`pnpm ${EVIDENCE_LEAF}`),
    `D_LEAF_UNWIRED: ${EVIDENCE_LEAF} must be chained after ${PREDECESSOR_LEAF}`,
  );
});

// D.0's own aggregate row asserted its leaf ran LAST, so appending D's leaf turns it RED. The
// invariant was never "last" but "after every prior slice", and D is the first legitimate successor.
// Measured, not predicted: this fired on the first neighbour run.
test('the D.0 aggregate row has been moved from last to before its declared successors', () => {
  const wiring = repositoryText('scripts/kern-5-d0-contracts-split/wiring.test.mjs');
  assert.equal(
    wiring.includes('so it runs last'),
    false,
    'D_PRIOR_PIN_STALE: D.0 asserts its leaf is the last aggregate segment; D appends after it and must move that row',
  );
  assert.ok(
    wiring.includes(EVIDENCE_LEAF),
    `D_PRIOR_PIN_STALE: D.0's aggregate row must declare ${EVIDENCE_LEAF} as its permitted successor`,
  );
});

test('the CI tier contract names the evidence leaf, so test:ci-contract cannot go red on it', () => {
  const contract = repositoryText('scripts/ci/test-tier-contract.test.mjs');
  assert.ok(
    contract.includes(`'pnpm ${EVIDENCE_LEAF}'`),
    `D_TIER_CONTRACT_STALE: kern5EvidenceCommands is deepEqual'd against the aggregate, so it must name ${EVIDENCE_LEAF}`,
  );
});

test('the evidence leaf builds core and runs every oracle file in this suite exactly once', () => {
  const packageJson = JSON.parse(repositoryText('package.json'));
  const leaf = packageJson.scripts[EVIDENCE_LEAF] ?? '';
  assert.ok(
    leaf.includes('pnpm --filter @kernlang/core build'),
    `D_LEAF_UNWIRED: ${EVIDENCE_LEAF} must build core first, or every dist import reads a stale build`,
  );
  for (const name of oracleFiles()) {
    assert.equal(
      leaf.split(`${SUITE_DIRECTORY}/${name}`).length - 1,
      1,
      `D_LEAF_UNWIRED: ${EVIDENCE_LEAF} must run ${name} exactly once`,
    );
  }
});
