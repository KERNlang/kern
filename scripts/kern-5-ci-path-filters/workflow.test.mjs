import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { workflowJob } from '../ci/workflow-text.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow() {
  return readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
}

async function policy() {
  return JSON.parse(await readFile(path.join(repoRoot, 'scripts/ci/ci-lane-policy.json'), 'utf8'));
}

async function skippableLanes() {
  const { lanes, classes } = await policy();
  return lanes.filter((lane) => !classes.DOCS_ONLY.includes(lane));
}

test('detect-changes runs the checked-in classifier only for pull_request events', async () => {
  const job = workflowJob(await workflow(), 'detect-changes');
  assert.match(job, /run: node scripts\/ci\/classify-ci-changes\.mjs/u);
  assert.match(job, /ci_class/u);
  assert.match(job, /if: github\.event_name == 'pull_request'/u);
  assert.match(job, /fetch-depth: 1/u);
});

test('every skippable lane needs detect-changes and gates on its ci_class output', async () => {
  const text = await workflow();
  for (const lane of await skippableLanes()) {
    const job = workflowJob(text, lane);
    assert.match(job, /needs:[^\n]*detect-changes/u, `${lane} must need detect-changes`);
    assert.match(job, /if:[^\n]*needs\.detect-changes\.outputs\.ci_class/u, `${lane} must gate on ci_class`);
  }
});

test('quality runs for both classes and is not chained behind detect-changes', async () => {
  const job = workflowJob(await workflow(), 'quality');
  assert.doesNotMatch(job, /if:[^\n]*needs\.detect-changes\.outputs\.ci_class == 'DOCS_ONLY'/u);
  assert.doesNotMatch(job, /needs:[^\n]*detect-changes/u);
});

test('build-and-test needs detect-changes and evaluates lanes against the policy file', async () => {
  const job = workflowJob(await workflow(), 'build-and-test');
  const needs = job.match(/needs: \[([^\]]+)\]/u)?.[1].split(',').map((entry) => entry.trim()) ?? [];
  assert.ok(needs.includes('detect-changes'), 'build-and-test must need detect-changes');
  assert.match(job, /run: node scripts\/ci\/evaluate-ci-lanes\.mjs/u);
  assert.match(job, /ci-lane-policy\.json/u);
  assert.match(job, /toJSON\(needs\)/u);
});

test('no pull_request path filter exists', async () => {
  const text = await workflow();
  assert.doesNotMatch(text, /paths:/u);
  assert.doesNotMatch(text, /paths-ignore:/u);
});

test('no action beyond the four already in use', async () => {
  const text = await workflow();
  const uses = [...text.matchAll(/uses: (\S+)/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(uses)].sort(),
    ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7', 'actions/upload-artifact@v7'],
  );
});

test('the concurrency block is unchanged', async () => {
  const text = await workflow();
  assert.match(
    text,
    /concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/u,
  );
});

test('push to main still classifies FULL', async () => {
  const job = workflowJob(await workflow(), 'detect-changes');
  assert.match(job, /if: github\.event_name != 'pull_request'/u);
  const step = job.match(/id: (\S+)\n\s*run: echo "ci_class=FULL" >> "\$GITHUB_OUTPUT"/u);
  assert.ok(step, 'a step-level guard must default non-pull_request events to FULL');
  assert.match(job, new RegExp(`ci_class: [^\\n]*steps\\.${step[1]}\\.outputs\\.ci_class`, 'u'));
});
