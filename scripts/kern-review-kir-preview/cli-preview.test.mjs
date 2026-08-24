import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI_ENTRY = new URL('../../packages/cli/dist/cli.js', import.meta.url);
const REVIEW_ENTRY = new URL('../../packages/review/dist/index.js', import.meta.url);

async function requirePreviewApi() {
  const review = await import(REVIEW_ENTRY.href);
  assert.equal(typeof review.reviewKernModuleSets, 'function', 'missing KIR preview API: reviewKernModuleSets');
}

async function fixtures() {
  const fixtureModule = await import('./fixtures.mjs');
  return fixtureModule.KIR_REVIEW_FIXTURES;
}

function fixtureById(rows, id) {
  const fixture = rows.find((row) => row.id === id);
  assert.ok(fixture, `missing fixture ${id}`);
  return fixture;
}

function runCli(args) {
  const run = spawnSync(process.execPath, [CLI_ENTRY.pathname, 'review', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(run.error, undefined, `CLI must start: ${run.error?.message ?? ''}`);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function withFixtureFile(source, action) {
  const directory = mkdtempSync(join(tmpdir(), 'kern-review-kir-preview-'));
  const file = join(directory, 'fixture.kern');
  writeFileSync(file, source, 'utf8');
  try {
    return action(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('KRI-A10: --analysis-mode selects preview explicitly while no selector stays legacy-byte-compatible', async () => {
  await requirePreviewApi();
  const source = fixtureById(await fixtures(), 'formatting-only').base[0].source;
  withFixtureFile(source, (file) => {
    const implicit = runCli([file, '--json']);
    const explicitLegacy = runCli([file, '--json', '--analysis-mode=legacy-source']);
    assert.equal(implicit.status, 0, implicit.stderr);
    assert.equal(explicitLegacy.status, 0, explicitLegacy.stderr);
    assert.equal(implicit.stdout, explicitLegacy.stdout, 'the unchanged default must remain the legacy output');

    const preview = runCli([file, '--json', '--analysis-mode=canonical-kir-preview']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /canonical-kir-preview/u, 'explicit preview mode must be observable in JSON');
  });
});

test('KRI-A8: canonical failure remains visible in JSON and SARIF rather than becoming empty success', async () => {
  await requirePreviewApi();
  const source = fixtureById(await fixtures(), 'projection-rejection-malformed').base[0].source;
  withFixtureFile(source, (file) => {
    const json = runCli([file, '--json', '--analysis-mode=canonical-kir-preview']);
    assert.notEqual(json.status, 0, 'canonical analysis failure must produce a failing CLI status');
    assert.doesNotThrow(() => JSON.parse(json.stdout), 'failure JSON must remain machine-readable');
    assert.match(json.stdout, /canonical(?:-kir-preview)?/iu);
    assert.match(json.stdout, /failed|failure|projection-rejected/iu);
    assert.doesNotMatch(json.stdout, /"findings"\s*:\s*\[\s*\]\s*\}\s*$/u, 'failure cannot serialize as empty success');

    const sarif = runCli([file, '--sarif', '--analysis-mode=canonical-kir-preview']);
    assert.notEqual(sarif.status, 0, 'canonical analysis failure must produce a failing SARIF CLI status');
    const document = JSON.parse(sarif.stdout);
    assert.equal(document.version, '2.1.0', 'SARIF output must remain valid SARIF');
    assert.match(sarif.stdout, /canonical(?:-kir-preview)?/iu);
    assert.match(sarif.stdout, /failed|failure|projection-rejected/iu);
  });
});

test('KRI-A9: dual CLI output retains canonical failure and labeled legacy divergence', async () => {
  await requirePreviewApi();
  const source = fixtureById(await fixtures(), 'projection-rejection-malformed').base[0].source;
  withFixtureFile(source, (file) => {
    const dual = runCli([file, '--json', '--analysis-mode=dual-compare']);
    assert.notEqual(dual.status, 0, 'dual mode must not mask canonical failure');
    assert.doesNotThrow(() => JSON.parse(dual.stdout));
    assert.match(dual.stdout, /"canonical"/u);
    assert.match(dual.stdout, /"legacy"/u);
    assert.match(dual.stdout, /"divergence"/u);
    assert.match(dual.stdout, /"status"\s*:\s*"failed"/u);
  });
});
