import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJsonBytes } from './r0-abi-oracle-helpers.mjs';
import { rebindR0ContractManifest } from './rebind-manifest.mjs';
import { validateR0ContractBundle } from './validate-manifest.mjs';

const MANIFEST_PATH = 'scripts/kern-5-r0-contracts/manifest.json';

function write(root, relative, content) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function manifest() {
  return {
    abi: { compilerRequest: 'kern.compiler.request.r0', compilerResult: 'kern.compiler.result.r0', runtime: 'kern.runtime.kir.r0', targetArtifact: 'kern.target.artifact.r0' },
    budgets: {
      'javascript-esm': { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024, samples: 3, warmups: 1 },
      python: { maxMedianLatencyMs: 1000, maxPeakRssBytes: 1024, samples: 3, warmups: 1 },
    },
    bundleVersion: 1,
    commands: { check: ['node', 'scripts/kern-5-r0-contracts/check.mjs'] },
    format: 'kern.r0.contract-bundle.1',
    inventory: [],
    probe: {
      expectedEnvelopes: { path: 'scripts/kern-5-r0-contracts/fixtures/expected.json', sha256: '0'.repeat(64) },
      input: { path: 'scripts/kern-5-r0-contracts/generated/input.json', sha256: '0'.repeat(64) },
      topology: { path: 'scripts/kern-5-r0-contracts/fixtures/topology.json', sha256: '0'.repeat(64) },
    },
  };
}

test('R0 manifest rebind deterministically inventories every bundle file and preserves probe paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'kern-r0-rebind-'));
  try {
    write(root, 'scripts/kern-5-r0-contracts/check.mjs', 'export {}\n');
    write(root, 'scripts/kern-5-r0-contracts/check.test.mjs', 'export {}\n');
    write(root, 'scripts/kern-5-r0-contracts/fixtures/expected.json', '{}\n');
    write(root, 'scripts/kern-5-r0-contracts/fixtures/topology.json', '[]\n');
    write(root, 'scripts/kern-5-r0-contracts/generated/input.json', '{}\n');
    write(root, 'scripts/kern-5-r0-contracts/schema/example.json', '{}\n');
    write(root, 'scripts/kern-5-r0-contracts/r0-authority.mjs', 'export {}\n');
    write(root, MANIFEST_PATH, canonicalJsonBytes(manifest()));
    const first = rebindR0ContractManifest({ manifestPath: MANIFEST_PATH, rootDir: root });
    const second = rebindR0ContractManifest({ manifestPath: MANIFEST_PATH, rootDir: root });
    assert.deepEqual(first, second);
    assert.deepEqual(first.inventory.map((entry) => entry.path), [...first.inventory.map((entry) => entry.path)].sort());
    assert.deepEqual(first.inventory.map((entry) => entry.kind), ['validation', 'test', 'fixture', 'fixture', 'generated', 'authority', 'schema']);
    assert.equal(first.manifest.probe.input.path, manifest().probe.input.path);
    assert.equal(first.manifest.probe.input.sha256, first.inventory.find((entry) => entry.path === first.manifest.probe.input.path).sha256);
    assert.deepEqual(canonicalJsonBytes(first.manifest), first.bytes);
    write(root, MANIFEST_PATH, first.bytes);
    assert.equal(validateR0ContractBundle({ manifestPath: MANIFEST_PATH, rootDir: root }).inventory.length, first.inventory.length);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
