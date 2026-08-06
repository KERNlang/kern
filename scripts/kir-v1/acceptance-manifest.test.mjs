import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateKirV1AcceptanceManifest,
  validateKirV1AcceptancePolicy,
} from './acceptance-manifest.mjs';

const firstSha = '0123456789abcdef0123456789abcdef01234567';
const secondSha = '89abcdef0123456789abcdef0123456789abcdef';

function policy() {
  return {
    bindings: ['frozen.txt', 'scripts/kir-v1/acceptance-policy.json'],
    exclusions: [{ id: 'public-release', reason: 'deferred-to-r4' }],
    format: 'kern.kir.v1-alpha-acceptance.1',
    maxCommandOutputBytes: 65_536,
    oracleTimeoutMs: 5_000,
    oracles: [{ argv: ['pnpm', 'test:kern-ir-profile'], id: 'kir-v1-profile' }],
    outputRoot: 'scripts/kir-v1/acceptance',
    status: {
      alphaAccepted: true,
      kirV1Frozen: true,
      publicReaderExport: false,
      runtimeCutover: false,
      runtimeHandlerAbi: true,
      semanticSelfHosting: false,
    },
  };
}

function fixture() {
  const rootDir = path.join(os.tmpdir(), `kern-kir-v1-acceptance-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path.join(rootDir, 'scripts/kir-v1'), { recursive: true });
  writeFileSync(path.join(rootDir, 'frozen.txt'), 'frozen\n');
  writeFileSync(path.join(rootDir, 'scripts/kir-v1/acceptance-policy.json'), JSON.stringify(policy()));
  return rootDir;
}

function runner({ headChanges = false } = {}) {
  let headCalls = 0;
  return (argv) => {
    if (argv[0] === 'git' && argv[1] === 'status') return { status: 0, stdout: '' };
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      headCalls += 1;
      return { status: 0, stdout: `${headChanges && headCalls > 1 ? secondSha : firstSha}\n` };
    }
    return { status: 0, stdout: 'pass\n' };
  };
}

test('accepted claims are exact and forbidden promotion rejects', () => {
  assert.equal(validateKirV1AcceptancePolicy(policy()).status.kirV1Frozen, true);
  for (const claim of ['publicReaderExport', 'runtimeCutover', 'semanticSelfHosting']) {
    const mutated = structuredClone(policy());
    mutated.status[claim] = true;
    assert.throws(() => validateKirV1AcceptancePolicy(mutated), /status/u);
  }
});

test('clean stable HEAD produces an immutable SHA-named manifest', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const first = generateKirV1AcceptanceManifest({ rootDir, policy: policy(), runCommand: runner() });
  const bytes = readFileSync(first.outputPath);
  const second = generateKirV1AcceptanceManifest({ rootDir, policy: policy(), runCommand: runner() });
  assert.equal(second.outputPath, first.outputPath);
  assert.deepEqual(readFileSync(second.outputPath), bytes);
  assert.equal(first.manifest.acceptedCommitSha, firstSha);
  assert.equal(first.manifest.status.kirV1Frozen, true);
});

test('HEAD movement during oracle execution fails before a manifest escapes', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  assert.throws(
    () => generateKirV1AcceptanceManifest({ rootDir, policy: policy(), runCommand: runner({ headChanges: true }) }),
    /HEAD changed/u,
  );
});
