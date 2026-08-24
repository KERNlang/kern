import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIR_REVIEW_FIXTURES } from './fixtures/fixtures.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MANIFEST_PATH = path.join(ROOT, 'scripts/kern-review-kir-preview/manifest.json');
const ALLOWED_FACETS = new Set([
  'modules', 'public-api', 'imports', 'dependencies', 'capabilities', 'calls',
  'effects', 'structure', 'target-compatibility', 'formatting',
  'projection-rejection', 'atomicity', 'dual-compare',
]);

function assertRelativeRepoPath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.equal(path.isAbsolute(value), false, `${label} must be relative`);
  assert.equal(value.includes('..'), false, `${label} must not escape the repository`);
}

function validateFixture(fixture, requiredFacets) {
  assert.equal(typeof fixture.id, 'string', 'fixture id');
  assert.ok(fixture.id.length > 0, 'fixture id is non-empty');
  assert.ok(Array.isArray(fixture.facets), `${fixture.id} facets`);
  assert.ok(fixture.facets.length > 0, `${fixture.id} has facets`);
  for (const facet of fixture.facets) {
    assert.ok(ALLOWED_FACETS.has(facet), `${fixture.id} has unknown facet ${facet}`);
  }
  assert.ok(Array.isArray(fixture.base), `${fixture.id} base module set`);
  assert.ok(Array.isArray(fixture.head), `${fixture.id} head module set`);
  for (const side of ['base', 'head']) {
    for (const module of fixture[side]) {
      assert.equal(typeof module.moduleId, 'string', `${fixture.id} ${side} moduleId`);
      assert.ok(module.moduleId.length > 0, `${fixture.id} ${side} moduleId non-empty`);
      assert.equal(typeof module.source, 'string', `${fixture.id} ${side} source`);
      assert.ok(module.source.length > 0, `${fixture.id} ${side} source non-empty`);
    }
  }
  assert.ok(fixture.expected && typeof fixture.expected === 'object', `${fixture.id} expected oracle`);
  for (const facet of fixture.facets) requiredFacets.delete(facet);
}

function runNodeTest(testPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', testPath], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: 1, stdout, stderr: String(error) }));
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function failureExcerpt(result) {
  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u);
  return lines.find((line) => /contract missing|missing KIR|ERR_MODULE_NOT_FOUND|Cannot find package|must be a supported public|missing KIR preview API/iu.test(line))
    ?? lines.find((line) => line.startsWith('not ok'))
    ?? result.stderr.split(/\r?\n/u).find(Boolean)
    ?? 'no failure detail';
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.format, 'kern.review.kir-preview.red-manifest.1');
  assert.equal(manifest.status, 'red');
  assert.equal(manifest.fixtureModule, 'scripts/kern-review-kir-preview/fixtures/fixtures.mjs');
  assert.deepEqual([...new Set(manifest.requiredFacets)], manifest.requiredFacets,
    'manifest requiredFacets must not contain duplicates');
  for (const facet of manifest.requiredFacets) assert.ok(ALLOWED_FACETS.has(facet), `manifest facet ${facet}`);
  assert.ok(Array.isArray(manifest.tests) && manifest.tests.length >= 4, 'manifest test list');
  const ids = new Set();
  for (const entry of manifest.tests) {
    assert.equal(typeof entry.id, 'string', 'manifest test id');
    assert.equal(ids.has(entry.id), false, `duplicate manifest test id ${entry.id}`);
    ids.add(entry.id);
    assertRelativeRepoPath(entry.path, `manifest test ${entry.id} path`);
    assert.equal(typeof entry.lane, 'string', `manifest test ${entry.id} lane`);
  }
  assert.equal(manifest.expectedRed.code, 'KIR_REVIEW_PREVIEW_FEATURE_MISSING');
  assert.equal(manifest.expectedRed.mustRemainVisible, true);
  return manifest;
}

const manifest = await readManifest();
const uncovered = new Set(manifest.requiredFacets);
const fixtureIds = new Set();
assert.ok(KIR_REVIEW_FIXTURES && Array.isArray(KIR_REVIEW_FIXTURES.cases),
  'fixture module must expose KIR_REVIEW_FIXTURES.cases');
for (const fixture of KIR_REVIEW_FIXTURES.cases) {
  assert.equal(fixtureIds.has(fixture.id), false, `duplicate fixture id ${fixture.id}`);
  fixtureIds.add(fixture.id);
  validateFixture(fixture, uncovered);
}
assert.equal(uncovered.size, 0, `fixture coverage missing facets: ${[...uncovered].join(', ')}`);

const missing = [];
const failed = [];
for (const entry of manifest.tests) {
  const testPath = path.join(ROOT, entry.path);
  try {
    await access(testPath);
  } catch {
    missing.push(`${entry.lane}:${entry.path}`);
    continue;
  }
  const result = await runNodeTest(entry.path);
  if (result.status !== 0) failed.push({ entry, result });
}

if (missing.length > 0) {
  console.error(`KIR_REVIEW_PREVIEW_RED ${manifest.expectedRed.code}`);
  console.error(manifest.expectedRed.reason);
  for (const item of missing) console.error(`MISSING_FEATURE_TEST ${item}`);
  if (failed.length > 0) {
    for (const { entry, result } of failed) {
      console.error(`IMPLEMENTATION_TEST_FAILED ${entry.lane}:${entry.path}`);
      console.error(failureExcerpt(result));
    }
  }
  process.exitCode = 1;
} else if (failed.length > 0) {
  for (const { entry, result } of failed) {
    console.error(`KIR_REVIEW_PREVIEW_TEST_FAILED ${entry.lane}:${entry.path}`);
    console.error(failureExcerpt(result));
  }
  process.exitCode = 1;
} else {
  console.log(`KIR review preview gate: manifest and ${manifest.tests.length} implementation tests passed`);
}
