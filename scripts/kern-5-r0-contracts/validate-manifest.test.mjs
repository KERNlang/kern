import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJsonBytes, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { validateR0ContractBundle } from './validate-manifest.mjs';

function file(root, relative, text) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return { path: relative, kind: 'authority', sha256: sha256Hex(Buffer.from(text, 'utf8')) };
}

function writeManifest(root, inventory) {
  const sortedInventory = [...inventory].sort((left, right) => left.path.localeCompare(right.path));
  const value = {
    abi: {
      compilerRequest: 'kern.compiler.request.r0',
      compilerResult: 'kern.compiler.result.r0',
      runtime: 'kern.runtime.kir.r0',
      targetArtifact: 'kern.target.artifact.r0',
    },
    budgets: {
      'javascript-esm': { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024 * 1024 * 1024, samples: 3, warmups: 1 },
      python: { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024 * 1024 * 1024, samples: 3, warmups: 1 },
    },
    bundleVersion: 1,
    commands: { check: ['node', 'scripts/kern-5-r0-contracts/check.mjs'] },
    format: 'kern.r0.contract-bundle.1',
    inventory: sortedInventory,
    probe: {
      expectedEnvelopes: { path: 'bundle/fixtures/expected.json', sha256: sortedInventory.find((entry) => entry.path.endsWith('expected.json')).sha256 },
      input: { path: 'bundle/fixtures/input.json', sha256: sortedInventory.find((entry) => entry.path.endsWith('input.json')).sha256 },
      topology: { path: 'bundle/fixtures/input.json', sha256: sortedInventory.find((entry) => entry.path.endsWith('input.json')).sha256 },
    },
  };
  mkdirSync(join(root, 'bundle'), { recursive: true });
  writeFileSync(join(root, 'bundle/manifest.json'), canonicalJsonBytes(value));
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kern-r0-manifest-'));
  const input = file(root, 'bundle/fixtures/input.json', '{}\n');
  const expected = file(root, 'bundle/fixtures/expected.json', '{}\n');
  writeManifest(root, [input, expected]);
  return root;
}

test('R0 contract manifest validates canonical digest-bound inventory', () => {
  const root = fixtureRoot();
  try {
    const result = validateR0ContractBundle({ rootDir: root, manifestPath: 'bundle/manifest.json' });
    assert.equal(result.inventory.length, 2);
    assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('R0 contract manifest rejects extras, digest drift, paths, and symlinks', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(join(root, 'bundle/extra.txt'), 'extra\n');
    assert.throws(() => validateR0ContractBundle({ rootDir: root, manifestPath: 'bundle/manifest.json' }), /unexpected R0 bundle file/u);
    rmSync(join(root, 'bundle/extra.txt'));

    writeFileSync(join(root, 'bundle/fixtures/input.json'), '{"changed":true}\n');
    assert.throws(() => validateR0ContractBundle({ rootDir: root, manifestPath: 'bundle/manifest.json' }), /digest drift/u);
    rmSync(root, { force: true, recursive: true });

    const escaped = fixtureRoot();
    try {
      const manifest = JSON.parse(Buffer.from(canonicalJsonBytes({
        abi: { compilerRequest: 'kern.compiler.request.r0', compilerResult: 'kern.compiler.result.r0', runtime: 'kern.runtime.kir.r0', targetArtifact: 'kern.target.artifact.r0' },
        budgets: { 'javascript-esm': { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024, samples: 3, warmups: 1 }, python: { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024, samples: 3, warmups: 1 } },
        bundleVersion: 1, commands: { check: ['node', 'scripts/kern-5-r0-contracts/check.mjs'] }, format: 'kern.r0.contract-bundle.1',
        inventory: [{ kind: 'fixture', path: '../outside', sha256: '0'.repeat(64) }], probe: { expectedEnvelopes: { path: '../outside', sha256: '0'.repeat(64) }, input: { path: 'bundle/fixtures/input.json', sha256: '0'.repeat(64) }, topology: { path: 'bundle/fixtures/input.json', sha256: '0'.repeat(64) } },
      })).toString('utf8'));
      writeFileSync(join(escaped, 'bundle/manifest.json'), canonicalJsonBytes(manifest));
      assert.throws(() => validateR0ContractBundle({ rootDir: escaped, manifestPath: 'bundle/manifest.json' }), /safe repository-relative path/u);
    } finally { rmSync(escaped, { force: true, recursive: true }); }

    const linked = fixtureRoot();
    try {
      const target = join(linked, 'target.json');
      writeFileSync(target, '{}\n');
      rmSync(join(linked, 'bundle/fixtures/input.json'));
      symlinkSync(target, join(linked, 'bundle/fixtures/input.json'));
      assert.throws(() => validateR0ContractBundle({ rootDir: linked, manifestPath: 'bundle/manifest.json' }), /cannot traverse a symlink/u);
    } finally { rmSync(linked, { force: true, recursive: true }); }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
