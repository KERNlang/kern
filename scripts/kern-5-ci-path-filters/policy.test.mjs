import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function policy() {
  return JSON.parse(await readFile(path.join(repoRoot, 'scripts/ci/ci-lane-policy.json'), 'utf8'));
}

async function workflowJobIds() {
  const text = await readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const jobsIndex = text.indexOf('\njobs:\n');
  assert.notEqual(jobsIndex, -1, 'ci.yml must define a jobs: section');
  const jobsSection = text.slice(jobsIndex);
  return [...jobsSection.matchAll(/^ {2}([a-z][\w-]*):\n/gmu)].map((match) => match[1]);
}

const EXPECTED_FULL_LANES = [
  'frontend-composition',
  'frontend-foundation',
  'frontend-language',
  'frontend-properties-core',
  'frontend-properties-extended',
  'frontend-tooling',
  'infrastructure-contracts',
  'kern-5-evidence',
  'package-tests',
  'product-smoke',
  'quality',
  'semantics',
];

test('the policy declares exactly two classes', async () => {
  assert.deepEqual(Object.keys((await policy()).classes).sort(), ['DOCS_ONLY', 'FULL']);
});

test('FULL lists exactly the twelve existing lanes, sorted', async () => {
  const { classes } = await policy();
  assert.deepEqual(classes.FULL, EXPECTED_FULL_LANES);
  assert.deepEqual([...classes.FULL].sort(), classes.FULL);
});

test('DOCS_ONLY lists exactly quality', async () => {
  const { classes } = await policy();
  assert.deepEqual(classes.DOCS_ONLY, ['quality']);
});

test('the lane universe is sorted and self-consistent with the workflow job ids', async () => {
  const { lanes } = await policy();
  assert.deepEqual([...lanes].sort(), lanes);
  const nonLaneJobs = new Set(['detect-changes', 'build-and-test']);
  const workflowLanes = (await workflowJobIds()).filter((id) => !nonLaneJobs.has(id));
  assert.deepEqual([...lanes].sort(), [...workflowLanes].sort());
});
