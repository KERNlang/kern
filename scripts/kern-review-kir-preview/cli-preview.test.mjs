import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI_ENTRY = new URL('../../packages/cli/dist/cli.js', import.meta.url);
const REVIEW_CANONICAL_ENTRY = new URL('../../packages/review/dist/kir-preview/public.js', import.meta.url);
const REVIEW_DUAL_ENTRY = new URL('../../packages/review/dist/kir-preview/dual-public.js', import.meta.url);

async function requirePreviewApi() {
  const canonical = await import(REVIEW_CANONICAL_ENTRY.href);
  const dual = await import(REVIEW_DUAL_ENTRY.href);
  assert.equal(typeof canonical.reviewKernModuleSets, 'function', 'missing canonical KIR preview API');
  assert.equal(typeof dual.reviewKernModuleSets, 'function', 'missing dual KIR preview API');
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

function runCli(args, cwd) {
  const run = spawnSync(process.execPath, [CLI_ENTRY.pathname, 'review', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    cwd,
  });
  assert.equal(run.error, undefined, `CLI must start: ${run.error?.message ?? ''}`);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function git(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
}

function withGitFixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'kern-review-kir-preview-git-'));
  try {
    git(directory, ['init', '-q']);
    git(directory, ['config', 'user.email', 'kern@example.com']);
    git(directory, ['config', 'user.name', 'KERN Preview Test']);
    mkdirSync(join(directory, 'api'));
    writeFileSync(join(directory, 'api', 'users.kern'), [
      'fn name=getUser returns=string export=true',
      '  handler lang="kern"',
      '    return value="before"',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(directory, 'api', 'keep.kern'), [
      'fn name=keep returns=string export=true',
      '  handler lang="kern"',
      '    return value="stable"',
      '',
    ].join('\n'), 'utf8');
    git(directory, ['add', '.']);
    git(directory, ['commit', '-qm', 'base']);
    git(directory, ['mv', 'api/users.kern', 'api/accounts.kern']);
    writeFileSync(join(directory, 'api', 'accounts.kern'), [
      'fn name=getAccount returns=string export=true',
      '  handler lang="kern"',
      '    return value="after"',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(directory, 'api', 'audit.kern'), [
      'fn name=recordAudit returns=string export=true',
      '  handler lang="kern"',
      '    return value="event"',
      '',
    ].join('\n'), 'utf8');
    rmSync(join(directory, 'api', 'keep.kern'));
    return action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    assert.match(preview.stdout, /"comparison"\s*:\s*"snapshot"/u, 'a diff-less canonical run is labeled as a snapshot');
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

test('KRI-A9: dual CLI without --diff fails visibly instead of manufacturing a same-set comparison', async () => {
  await requirePreviewApi();
  const source = fixtureById(await fixtures(), 'formatting-only').base[0].source;
  withFixtureFile(source, (file) => {
    const dual = runCli([file, '--json', '--analysis-mode=dual-compare']);
    assert.notEqual(dual.status, 0, 'dual mode must not mask canonical failure');
    assert.doesNotThrow(() => JSON.parse(dual.stdout));
    assert.match(dual.stdout, /"status"\s*:\s*"failed"/u);
    assert.match(dual.stdout, /requires --diff/u);
  });
});

test('KRI-A7/A9: --diff materializes independent Git base/head sets, including rename and addition', async () => {
  await requirePreviewApi();
  withGitFixture((directory) => {
    const canonical = runCli(['--diff=HEAD', '--json', '--analysis-mode=canonical-kir-preview'], directory);
    assert.equal(canonical.status, 0, canonical.stderr);
    const result = JSON.parse(canonical.stdout);
    assert.equal(result.comparison, 'git-diff');
    assert.equal(result.status, 'complete');
    // The fixture has two base blobs (users + keep), exercising the bounded
    // batched Git object read rather than a one-blob happy path.
    assert.ok(result.findings.length > 0, 'base/head changes must not collapse to the snapshot same-set result');
    assert.ok(result.findings.some((finding) => finding.moduleId === 'api/users.kern' && finding.change === 'removed'));
    assert.ok(result.findings.some((finding) => finding.moduleId === 'api/accounts.kern' && finding.change === 'added'));
    assert.ok(result.findings.some((finding) => finding.moduleId === 'api/audit.kern' && finding.change === 'added'));
    assert.ok(result.findings.some((finding) => finding.moduleId === 'api/keep.kern' && finding.change === 'removed'));

    const dual = runCli(['--diff=HEAD', '--json', '--analysis-mode=dual-compare'], directory);
    assert.equal(dual.status, 0, dual.stderr);
    const dualResult = JSON.parse(dual.stdout);
    assert.equal(dualResult.comparison, 'git-diff');
    assert.equal(dualResult.canonical.status, 'complete');
    assert.equal(dualResult.legacy.analysisMode, 'legacy-source');
    assert.equal(typeof dualResult.divergence, 'boolean');

    const badBase = runCli(['--diff=does-not-exist', '--json', '--analysis-mode=canonical-kir-preview'], directory);
    assert.notEqual(badBase.status, 0, 'an unresolved Git baseline must be a typed CLI failure');
    const failure = JSON.parse(badBase.stdout);
    assert.equal(failure.status, 'failed');
    assert.equal(failure.diagnostics[0].code, 'canonical-kir-preview-cli-failure');

    const optionLike = runCli(['--diff=--help', '--json', '--analysis-mode=canonical-kir-preview'], directory);
    assert.notEqual(optionLike.status, 0, 'option-like Git baselines must be rejected before invoking rev parsing');
    assert.match(optionLike.stdout, /option-like Git baselines/u);
  });
});

test('KRI-A8: Git module materialization rejects symlinks on both worktree and base sides', async () => {
  await requirePreviewApi();
  withGitFixture((directory) => {
    const outside = join(tmpdir(), `kern-review-kir-preview-outside-${process.pid}.kern`);
    const linked = join(directory, 'api', 'linked.kern');
    const special = join(directory, 'api', 'keep.kern');
    writeFileSync(outside, 'fn name=outside returns=string export=true\n  handler lang="kern"\n    return value="outside"\n', 'utf8');
    execFileSync('mkfifo', [special]);
    try {
      const nonRegular = runCli(['--diff=HEAD', '--json', '--analysis-mode=canonical-kir-preview'], directory);
      assert.notEqual(nonRegular.status, 0, 'a special .kern file must not be opened as source');
      assert.match(nonRegular.stdout, /regular|unsafe/i);
      rmSync(special);

      symlinkSync(outside, linked);
      const worktree = runCli(['--diff=HEAD', '--json', '--analysis-mode=canonical-kir-preview'], directory);
      assert.notEqual(worktree.status, 0, 'an untracked .kern symlink must not be followed from the worktree');
      assert.match(worktree.stdout, /symlink|regular|unsafe/i);

      git(directory, ['add', 'api/linked.kern']);
      git(directory, ['commit', '-qm', 'tracked symlink']);
      const base = runCli(['--diff=HEAD', '--json', '--analysis-mode=canonical-kir-preview'], directory);
      assert.notEqual(base.status, 0, 'a mode 120000 .kern entry must not be read with git show');
      assert.match(base.stdout, /symlink|regular|unsafe/i);
    } finally {
      try { unlinkSync(linked); } catch {}
      try { rmSync(special); } catch {}
      try { rmSync(outside); } catch {}
    }
  });
});

test('KRI-A8: snapshot materialization rejects an explicit .kern symlink', async () => {
  await requirePreviewApi();
  const directory = mkdtempSync(join(tmpdir(), 'kern-review-kir-preview-snapshot-link-'));
  const outside = join(tmpdir(), `kern-review-kir-preview-snapshot-outside-${process.pid}.kern`);
  const linked = join(directory, 'linked.kern');
  try {
    writeFileSync(outside, 'fn name=outside export=true\n', 'utf8');
    symlinkSync(outside, linked);
    const result = runCli([linked, '--json', '--analysis-mode=canonical-kir-preview'], directory);
    assert.notEqual(result.status, 0, 'snapshot mode must not follow an explicit .kern symlink');
    assert.match(result.stdout, /symlink|regular|unsafe/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    try { rmSync(outside); } catch {}
  }
});
