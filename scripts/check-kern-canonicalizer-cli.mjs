#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCanonicalizerAssets } from '../packages/cli/dist/commands/canonicalizer-assets.js';
import { canonicalizeKernSource } from '../packages/cli/dist/commands/canonicalize.js';
import { VALID_FIXTURES } from './kern-canonicalizer/fixtures.mjs';
import { PROFILE_LIMIT_FIXTURES } from './kern-canonicalizer/profile-limit-fixtures.mjs';

const CLI = resolve('packages/cli/dist/cli.js');

export function runKernCanonicalizerCliCheck() {
  const assets = loadCanonicalizerAssets();
  for (const fixture of VALID_FIXTURES) {
    const first = canonicalizeKernSource(fixture.source, `${fixture.id}.kern`, assets);
    assert.equal(first.outcome, 'success', `${fixture.id}: first pass`);
    assert.equal(first.canonicalSource, fixture.golden, `${fixture.id}: golden`);
    assert.equal(first.changed, fixture.source !== fixture.golden, `${fixture.id}: changed flag`);

    const second = canonicalizeKernSource(first.canonicalSource, `${fixture.id}.kern`, assets);
    assert.equal(second.outcome, 'success', `${fixture.id}: second pass`);
    assert.equal(second.canonicalSource, fixture.golden, `${fixture.id}: idempotence`);
    assert.equal(second.changed, false, `${fixture.id}: fixed point`);
  }

  for (const fixture of PROFILE_LIMIT_FIXTURES) {
    const report = canonicalizeKernSource(fixture.source, `${fixture.id}.kern`, assets);
    assert.equal(report.outcome, 'failure', `${fixture.id}: bounded profile rejection`);
    assert.equal(report.canonicalSource, null, `${fixture.id}: no partial source`);
  }

  const checkRoot = mkdtempSync(join(tmpdir(), 'kern-canonicalizer-cli-check-'));
  const checkPath = join(checkRoot, 'input.kern');
  try {
    writeFileSync(checkPath, VALID_FIXTURES[0].source);
    const changed = spawnSync(process.execPath, [CLI, 'canonicalize', checkPath, '--check'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(changed.status, 1, '--check must reject noncanonical input');
    assert.equal(changed.stdout, '', '--check must not emit canonical source');
    assert.match(changed.stderr, /would change/u);

    writeFileSync(checkPath, VALID_FIXTURES[0].golden);
    const canonical = spawnSync(process.execPath, [CLI, 'canonicalize', checkPath, '--check'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(canonical.status, 0, '--check must accept canonical input');
    assert.equal(canonical.stdout, '');
    assert.equal(canonical.stderr, '');
  } finally {
    rmSync(checkRoot, { force: true, recursive: true });
  }

  const tamperRoot = mkdtempSync(join(tmpdir(), 'kern-canonicalizer-cli-tamper-'));
  try {
    symlinkSync(resolve('packages/cli/node_modules'), resolve(tamperRoot, 'node_modules'), 'dir');
    const isolatedDist = resolve(tamperRoot, 'dist');
    cpSync(resolve('packages/cli/dist'), isolatedDist, { recursive: true });
    const isolatedAsset = resolve(isolatedDist, 'kern-canonicalizer/canonicalizer.composed.kern');
    const mutated = readFileSync(isolatedAsset);
    mutated[0] ^= 1;
    writeFileSync(isolatedAsset, mutated);
    const isolatedInput = resolve(tamperRoot, 'input.kern');
    writeFileSync(isolatedInput, VALID_FIXTURES[0].source);
    const result = spawnSync(process.execPath, [resolve(isolatedDist, 'cli.js'), 'canonicalize', isolatedInput], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 2, 'tampered dist source must fail with setup status 2');
    assert.equal(result.stdout, '', 'tampered dist source must emit no canonical output');
    assert.match(result.stderr, /composite bytes do not match authenticated metadata/u);

    const libraryScript = [
      `import { canonicalizeKernSource } from ${JSON.stringify(new URL(`file://${resolve(isolatedDist, 'commands/canonicalize.js')}`).href)};`,
      `const report = canonicalizeKernSource(${JSON.stringify(VALID_FIXTURES[0].source)}, 'input.kern');`,
      'process.stdout.write(JSON.stringify(report));',
    ].join('\n');
    const libraryResult = spawnSync(process.execPath, ['--input-type=module', '--eval', libraryScript], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(libraryResult.status, 0, 'library asset rejection must return a report instead of throwing');
    const libraryReport = JSON.parse(libraryResult.stdout);
    assert.equal(libraryReport.outcome, 'failure');
    assert.equal(libraryReport.diagnostics[0]?.code, 'canonicalization-failed');
    assert.match(libraryReport.diagnostics[0]?.message, /composite bytes do not match authenticated metadata/u);

    const policyDist = resolve(tamperRoot, 'policy-dist');
    cpSync(resolve('packages/cli/dist'), policyDist, { recursive: true });
    const policyAsset = resolve(policyDist, 'kern-canonicalizer/policy.json');
    const policySource = readFileSync(policyAsset, 'utf8');
    const widenedPolicy = policySource.replace('"maxNodeRows": 205', '"maxNodeRows": 206');
    assert.notEqual(widenedPolicy, policySource, 'policy tamper fixture must change one limit');
    writeFileSync(policyAsset, widenedPolicy);
    const policyResult = spawnSync(process.execPath, [resolve(policyDist, 'cli.js'), 'canonicalize', isolatedInput], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(policyResult.status, 2, 'tampered dist policy must fail with setup status 2');
    assert.equal(policyResult.stdout, '', 'tampered dist policy must emit no canonical output');
    assert.match(policyResult.stderr, /policy bytes do not match authenticated build metadata/u);

    const codecDist = resolve(tamperRoot, 'codec-dist');
    cpSync(resolve('packages/cli/dist'), codecDist, { recursive: true });
    const codecManifest = JSON.parse(readFileSync(resolve(codecDist, 'kern-canonicalizer/assets.json'), 'utf8'));
    const codecAsset = resolve(codecDist, 'kern-canonicalizer', codecManifest.codec[0].path);
    const codecBytes = readFileSync(codecAsset);
    writeFileSync(codecAsset, Buffer.concat([codecBytes, Buffer.from('\n')]));
    const codecResult = spawnSync(process.execPath, [resolve(codecDist, 'cli.js'), 'canonicalize', isolatedInput], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(codecResult.status, 2, 'tampered private codec must fail with setup status 2');
    assert.equal(codecResult.stdout, '', 'tampered private codec must emit no canonical output');
    assert.match(codecResult.stderr, /codec module .* does not match authenticated build metadata/u);
  } finally {
    rmSync(tamperRoot, { force: true, recursive: true });
  }

  const packRoot = mkdtempSync(join(tmpdir(), 'kern-canonicalizer-cli-pack-'));
  try {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const packed = spawnSync(pnpm, ['pack', '--pack-destination', packRoot], {
      cwd: resolve('packages/cli'),
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(packed.error, undefined, `pnpm pack failed to start: ${packed.error?.message ?? ''}`);
    assert.equal(packed.status, 0, `pnpm pack failed:\n${packed.stderr}`);
    const archives = readdirSync(packRoot).filter((name) => name.endsWith('.tgz'));
    assert.equal(archives.length, 1, 'pnpm pack must emit exactly one tarball');
    const archive = resolve(packRoot, archives[0]);
    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(listed.error, undefined, `tar listing failed to start: ${listed.error?.message ?? ''}`);
    assert.equal(listed.status, 0, `tar listing failed:\n${listed.stderr}`);
    const entries = new Set(listed.stdout.split('\n').filter(Boolean));
    for (const required of [
      'package/dist/kern-canonicalizer/assets.json',
      'package/dist/kern-canonicalizer/canonicalizer.composed.kern',
      'package/dist/kern-canonicalizer/composition.json',
      'package/dist/kern-canonicalizer/policy.json',
      'package/dist/kern-canonicalizer/core/kir-structural/module-canonical.js',
    ]) {
      assert.ok(entries.has(required), `packed CLI is missing ${required}`);
    }

    const extracted = spawnSync('tar', ['-xzf', archive, '-C', packRoot], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(extracted.error, undefined, `tar extraction failed to start: ${extracted.error?.message ?? ''}`);
    assert.equal(extracted.status, 0, `tar extraction failed:\n${extracted.stderr}`);
    const packedPackage = resolve(packRoot, 'package');
    symlinkSync(resolve('packages/cli/node_modules'), resolve(packedPackage, 'node_modules'), 'dir');
    const packedInput = resolve(packRoot, 'packed-input.kern');
    writeFileSync(packedInput, VALID_FIXTURES[0].source);
    const packedCli = spawnSync(process.execPath, [resolve(packedPackage, 'dist/cli.js'), 'canonicalize', packedInput], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(packedCli.status, 0, `packed CLI canonicalization failed:\n${packedCli.stderr}`);
    assert.equal(packedCli.stdout, VALID_FIXTURES[0].golden, 'packed CLI must preserve canonicalizer golden');
    assert.equal(packedCli.stderr, '');
  } finally {
    rmSync(packRoot, { force: true, recursive: true });
  }

  process.stdout.write(
    `KERN canonicalizer CLI: ${VALID_FIXTURES.length} dist goldens/fixed points, ` +
      `${PROFILE_LIMIT_FIXTURES.length} bounded rejections, check-mode parity, asset/codec tamper rejection, and packed-tarball smoke passed.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runKernCanonicalizerCliCheck();
}
