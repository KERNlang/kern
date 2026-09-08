import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { EVIDENCE_LEAF, FILE_LINE_CEILING } from './pins.mjs';
import { lineCount, occurrences, readRepositoryText, repositoryPath } from './support.mjs';

const ORACLE_DIR = 'scripts/kern-5-d0-contracts-split';
const TIER_CONTRACT = 'scripts/ci/test-tier-contract.test.mjs';

function scripts() {
  return JSON.parse(readRepositoryText('package.json')).scripts;
}

function segments(command) {
  return command.split(' && ').map((segment) => segment.trim());
}

function oracleTestFiles() {
  return readdirSync(repositoryPath(ORACLE_DIR))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
}

test('the D.0 leaf builds core and runs every oracle file exactly once', () => {
  const command = scripts()[EVIDENCE_LEAF];
  assert.equal(typeof command, 'string', `D0_LEAF_MISSING: package.json has no ${EVIDENCE_LEAF}`);
  const parts = segments(command);
  assert.equal(
    parts[0],
    'pnpm --filter @kernlang/core build',
    'D0_LEAF_SHAPE: the leaf must build @kernlang/core first',
  );
  const invoked = parts.slice(1).map((segment) => {
    assert.match(segment, /^node --test scripts\/kern-5-d0-contracts-split\/[a-z-]+\.test\.mjs$/u);
    return segment.split('/').at(-1);
  });
  assert.deepEqual(
    [...invoked].sort(),
    oracleTestFiles(),
    'D0_LEAF_COVERAGE: the leaf does not run every oracle file in this directory',
  );
  assert.equal(new Set(invoked).size, invoked.length, 'D0_LEAF_SHAPE: an oracle file runs twice');
});

test('the evidence aggregate appends the D.0 leaf exactly once, last', () => {
  const family = segments(scripts()['test:kern-5-script-family']);
  assert.equal(
    family.filter((segment) => segment === `pnpm ${EVIDENCE_LEAF}`).length,
    1,
    'D0_AGGREGATE: the D.0 leaf must appear exactly once in the evidence family',
  );
  assert.equal(
    family.at(-1),
    `pnpm ${EVIDENCE_LEAF}`,
    'D0_AGGREGATE: D.0 depends on every prior slice, so it runs last',
  );
});

test('the tier contract pin and the aggregate name the same commands', () => {
  const source = readRepositoryText(TIER_CONTRACT);
  const open = source.indexOf('const kern5EvidenceCommands = [');
  assert.ok(open >= 0, 'D0_TIER_ANCHOR: kern5EvidenceCommands moved');
  const close = source.indexOf('];', open);
  const pinned = [...source.slice(open, close).matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  assert.deepEqual(
    pinned,
    segments(scripts()['test:kern-5-script-family']),
    'D0_TIER_SKEW: the tier-contract pin and the evidence aggregate disagree',
  );
  assert.ok(
    pinned.includes(`pnpm ${EVIDENCE_LEAF}`),
    `D0_TIER_SKEW: the tier-contract pin does not name ${EVIDENCE_LEAF}`,
  );
});

test('the CI workflow still runs the evidence aggregate exactly once', () => {
  const workflow = readRepositoryText('.github/workflows/ci.yml');
  assert.equal(
    occurrences(workflow, 'run: pnpm test:kern-5-script-family'),
    1,
    'D0_CI_DRIFT: the evidence aggregate must run exactly once',
  );
  assert.equal(
    occurrences(workflow, EVIDENCE_LEAF),
    0,
    'D0_CI_DRIFT: the D.0 leaf must reach CI through the aggregate, not its own job',
  );
});

test('every D.0 oracle file is under the 500-line rule', () => {
  for (const name of readdirSync(repositoryPath(ORACLE_DIR))) {
    if (!name.endsWith('.mjs')) continue;
    const lines = lineCount(`${ORACLE_DIR}/${name}`);
    assert.ok(
      lines < FILE_LINE_CEILING,
      `D0_ORACLE_LINE_RULE: ${name} is ${lines} lines, which is not under ${FILE_LINE_CEILING}`,
    );
  }
});
