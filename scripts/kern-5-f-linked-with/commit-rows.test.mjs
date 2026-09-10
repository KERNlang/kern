import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { commitRows, commitRowsRaw, repositoryText, specCriteria } from './k0-support.mjs';
import { COMMIT_ROWS_FORMAT, COMMIT_TAGS, EVIDENCE_LEAF, GATED_COMMIT_TAG, PREDECESSOR_LEAF } from './pins.mjs';

// The self-drive re-runs the whole suite, so it is gated on an env var: the evidence leaf must not
// pay for itself twice on every ordinary run. `F_MEASURE_ROWS=1 pnpm test:kern-5-f-linked-with` is
// the command; CHILD_FLAG stops it recursing.
const CHILD_FLAG = 'F_COMMIT_ROWS_CHILD';
const IS_CHILD = process.env[CHILD_FLAG] === '1';
const MEASURE = process.env.F_MEASURE_ROWS === '1' && !IS_CHILD;
const SKIP_REASON = 'set F_MEASURE_ROWS=1 to run the commit-row self-drive';

const SUITE_DIRECTORY = 'scripts/kern-5-f-linked-with';

const PRIOR_SUCCESSOR_LISTS = Object.freeze([
  'scripts/kern-5-d-linked-try/commit-rows.test.mjs',
  'scripts/kern-5-d0-contracts-split/wiring.test.mjs',
]);

function oracleFiles() {
  return readdirSync(new URL('./', import.meta.url))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
}

// node --test exports NODE_TEST_CONTEXT to every file it runs. Inherited by a nested runner it
// switches the child onto the v8 serializer protocol, so nothing reaches stdout and the drive
// reports "no TAP output" rather than a row list.
function childEnvironment() {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env;
  return rest;
}

function tapNames() {
  const child = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      ...oracleFiles()
        .filter((name) => name !== 'commit-rows.test.mjs')
        .map((name) => `${SUITE_DIRECTORY}/${name}`),
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...childEnvironment(), [CHILD_FLAG]: '1' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120 * 60 * 1000,
    },
  );
  assert.equal(
    child.signal,
    null,
    `F_MEASUREMENT_FAILED: the self-drive was killed with ${child.signal}, so its row list is truncated`,
  );
  assert.ok(child.stdout.length > 0, 'F_MEASUREMENT_FAILED: the self-drive produced no TAP output');
  const names = new Set();
  for (const match of child.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gmu)) {
    const name = match[1].replace(/\s+#\s+(?:SKIP|TODO)\b.*$/iu, '').trim();
    if (name.startsWith(SUITE_DIRECTORY) || name.endsWith('.test.mjs')) continue;
    names.add(name);
  }
  return [...names].sort();
}

test('commit-rows.json exists, is canonically serialized, and keys exactly the three commit tags', () => {
  const raw = commitRowsRaw();
  const document = commitRows();
  assert.equal(`${JSON.stringify(document, null, 2)}\n`, raw, 'F_COMMIT_ROWS_SHAPE: the mapping must stay canonical');
  assert.equal(document.format, COMMIT_ROWS_FORMAT);
  assert.deepEqual(
    Object.keys(document.rows).sort(),
    [...COMMIT_TAGS],
    `F_COMMIT_ROWS_SHAPE: rows must be keyed by exactly ${COMMIT_TAGS.join(', ')}`,
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
        `F_COMMIT_ROWS_OVERLAP: ${JSON.stringify(name)} is claimed by both ${seen.get(name)} and ${tag}`,
      );
      seen.set(name, tag);
    }
    assert.deepEqual([...names], [...names].sort(), `F_COMMIT_ROWS_SHAPE: the ${tag} name list must be sorted`);
  }
});

test(
  'the mapping is total: every row the suite actually runs is named exactly once',
  { skip: MEASURE ? false : SKIP_REASON },
  () => {
    const mapped = Object.values(commitRows().rows).flat().sort();
    const measured = tapNames();
    const unmapped = measured.filter((name) => !mapped.includes(name));
    const stale = mapped.filter((name) => !measured.includes(name));
    assert.deepEqual(
      unmapped,
      [],
      `F_COMMIT_ROWS_INCOMPLETE: ${unmapped.length} rows the suite runs are named by no commit tag`,
    );
    assert.deepEqual(stale, [], `F_COMMIT_ROWS_STALE: ${stale.length} mapped names correspond to no row the suite runs`);
  },
);

// Always on, and it needs no drive: the recorded comparison must be arithmetically consistent with
// the mapping the totality row validates, and the gate must not have fired.
test('the abort comparison is recorded with the integers the mapping carries', () => {
  const document = commitRows();
  const counts = Object.fromEntries(Object.entries(document.rows).map(([tag, names]) => [tag, names.length]));
  const preceding = COMMIT_TAGS.filter((tag) => tag !== GATED_COMMIT_TAG).reduce((sum, tag) => sum + counts[tag], 0);
  assert.deepEqual(
    document.abortCriterion,
    { cut: counts[GATED_COMMIT_TAG] > preceding, gated: counts[GATED_COMMIT_TAG], preceding },
    `F_ABORT_CRITERION_STALE: the recorded comparison must be the measured one -- ${GATED_COMMIT_TAG} has ${counts[GATED_COMMIT_TAG]} rows against ${preceding} preceding`,
  );
});

test('every acceptance-criteria group in the spec is claimed by at least one oracle file', () => {
  const { criteria, groups } = specCriteria();
  const document = commitRows();
  assert.ok(criteria.length > 0, 'F_SPEC_SHAPE: the Acceptance Criteria section must carry unchecked criteria');
  assert.equal(
    criteria.length,
    document.criteriaCount,
    `F_CRITERIA_DRIFT: the spec now carries ${criteria.length} criteria against the recorded ${document.criteriaCount}`,
  );
  assert.deepEqual(
    groups.sort(),
    Object.keys(document.groups).sort(),
    'F_CRITERIA_DRIFT: every acceptance-criteria group heading must be claimed in commit-rows.json',
  );
  const present = new Set(oracleFiles());
  for (const [group, files] of Object.entries(document.groups)) {
    assert.ok(files.length > 0, `F_CRITERIA_UNCOVERED: the group ${JSON.stringify(group)} names no oracle file`);
    for (const file of files) {
      assert.ok(present.has(file), `F_CRITERIA_UNCOVERED: ${group} names ${file}, which does not exist`);
    }
  }
});

test('the evidence leaf is wired into the aggregate exactly once, after the slice-E leaf', () => {
  const packageJson = JSON.parse(repositoryText('package.json'));
  assert.equal(
    typeof packageJson.scripts[EVIDENCE_LEAF],
    'string',
    `F_LEAF_UNWIRED: package.json must declare ${EVIDENCE_LEAF}`,
  );
  const segments = packageJson.scripts['test:kern-5-script-family'].split(' && ').map((segment) => segment.trim());
  assert.equal(
    segments.filter((segment) => segment === `pnpm ${EVIDENCE_LEAF}`).length,
    1,
    `F_LEAF_UNWIRED: the aggregate must run ${EVIDENCE_LEAF} exactly once`,
  );
  assert.ok(
    segments.indexOf(`pnpm ${PREDECESSOR_LEAF}`) < segments.indexOf(`pnpm ${EVIDENCE_LEAF}`),
    `F_LEAF_UNWIRED: ${EVIDENCE_LEAF} must be chained after ${PREDECESSOR_LEAF}`,
  );
});

test('the CI tier contract names the evidence leaf, so test:ci-contract cannot go red on it', () => {
  const contract = repositoryText('scripts/ci/test-tier-contract.test.mjs');
  assert.ok(
    contract.includes(`'pnpm ${EVIDENCE_LEAF}'`),
    `F_TIER_CONTRACT_STALE: kern5EvidenceCommands is deepEqual'd against the aggregate, so it must name ${EVIDENCE_LEAF}`,
  );
});

// Appending F to the aggregate turns the prior slices' "only a declared successor may follow me"
// rows red. The slice that appends owns the move -- measured here, not predicted.
test('the prior slice successor lists name the slice-F leaf', () => {
  for (const path of PRIOR_SUCCESSOR_LISTS) {
    assert.ok(
      repositoryText(path).includes(EVIDENCE_LEAF),
      `F_PRIOR_PIN_STALE: ${path} pins the leaves permitted after its own, and must declare ${EVIDENCE_LEAF}`,
    );
  }
});

test('the evidence leaf builds core and runs every oracle file in this suite exactly once', () => {
  const packageJson = JSON.parse(repositoryText('package.json'));
  const leaf = packageJson.scripts[EVIDENCE_LEAF] ?? '';
  assert.ok(
    leaf.includes('pnpm --filter @kernlang/core build'),
    `F_LEAF_UNWIRED: ${EVIDENCE_LEAF} must build core first, or every dist import reads a stale build`,
  );
  for (const name of oracleFiles()) {
    assert.equal(
      leaf.split(`${SUITE_DIRECTORY}/${name}`).length - 1,
      1,
      `F_LEAF_UNWIRED: ${EVIDENCE_LEAF} must run ${name} exactly once`,
    );
  }
});
