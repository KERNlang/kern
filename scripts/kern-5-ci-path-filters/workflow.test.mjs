import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow() {
  return readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
}

function workflowJob(text, id) {
  const marker = `  ${id}:\n`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `workflow must define ${id}`);
  const bodyStart = start + marker.length;
  const next = text.slice(bodyStart).search(/\n  [a-z][\w-]*:\n/u);
  return next < 0 ? text.slice(start) : text.slice(start, bodyStart + next);
}

const SKIPPABLE_LANES = [
  'infrastructure-contracts',
  'package-tests',
  'semantics',
  'frontend-foundation',
  'frontend-properties-core',
  'frontend-properties-extended',
  'frontend-composition',
  'frontend-language',
  'frontend-tooling',
  'product-smoke',
  'kern-5-evidence',
];

test('detect-changes runs the checked-in classifier', async () => {
  const job = workflowJob(await workflow(), 'detect-changes');
  assert.match(job, /run: node scripts\/ci\/classify-ci-changes\.mjs/u);
  assert.match(job, /ci_class/u);
});

test('every skippable lane needs detect-changes and gates on its ci_class output', async () => {
  const text = await workflow();
  for (const lane of SKIPPABLE_LANES) {
    const job = workflowJob(text, lane);
    assert.match(job, /needs:[^\n]*detect-changes/u, `${lane} must need detect-changes`);
    assert.match(job, /if:[^\n]*needs\.detect-changes\.outputs\.ci_class/u, `${lane} must gate on ci_class`);
  }
});

test('quality runs for both classes', async () => {
  const job = workflowJob(await workflow(), 'quality');
  assert.doesNotMatch(job, /if:[^\n]*needs\.detect-changes\.outputs\.ci_class == 'DOCS_ONLY'/u);
});

test('build-and-test needs detect-changes and evaluates lanes against the policy file', async () => {
  const job = workflowJob(await workflow(), 'build-and-test');
  const needs = job.match(/needs: \[([^\]]+)\]/u)?.[1].split(',').map((entry) => entry.trim()) ?? [];
  assert.ok(needs.includes('detect-changes'), 'build-and-test must need detect-changes');
  assert.match(job, /run: node scripts\/ci\/evaluate-ci-lanes\.mjs/u);
  assert.match(job, /ci-lane-policy\.json/u);
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
  assert.doesNotMatch(job, /if:[^\n]*github\.event_name == 'pull_request'/u);
});
