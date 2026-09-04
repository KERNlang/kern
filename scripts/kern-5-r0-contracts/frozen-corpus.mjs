import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { generateR0AbiArtifacts } from './oracle.mjs';
import { canonicalJsonBytes, parseCanonicalJsonBytes, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { buildCompileCase } from './r0-abi-test-kir.mjs';

export const FROZEN_CASE_ID = 'r0-frozen-baseline';

export function frozenCompileInput() {
  return {
    cases: [
      buildCompileCase({
        entry: { handlerName: 'compose', moduleId: 'r0/compose.kern' },
        id: FROZEN_CASE_ID,
        operations: ['resolve'],
      }),
    ],
    format: 'kern.r0.abi-probe-input.1',
  };
}

export async function generateFrozenArtifacts(outputRoot) {
  return generateR0AbiArtifacts(frozenCompileInput(), { outputRoot });
}

export function frozenRuntimeRequest({ artifactManifestSha256, generated, target }) {
  return {
    arguments: {
      text: '{"items":[1,[2]],"meta":{"mode":"frozen"}}',
      textList: ['frozen', 'baseline'],
    },
    artifactManifestSha256,
    capabilityTranscript: [
      {
        delayTicks: 1,
        input: { presence: 'absent' },
        namespace: 'r0fixture',
        operation: 'resolve',
        result: { presence: 'value', value: { tag: 'text', value: 'capability-frozen' } },
      },
    ],
    control: { cancelAtTick: null, preCancelled: false, timeoutTicks: null },
    entry: frozenCompileInput().cases[0].entry,
    format: 'kern.runtime.kir.r0',
    kirSha256: generated.kirSha256,
    limits: {
      maxBytes: 65536,
      maxCollectionLength: 128,
      maxDepth: 16,
      maxDiagnostics: 8,
      maxEvents: 16,
      maxIterations: 128,
      maxStringBytes: 8192,
    },
    requestId: `r0-${target.target}-frozen`,
  };
}

export function targetManifestFor(outputRoot, target) {
  const bytes = readFileSync(resolve(outputRoot, target.manifest.path));
  return { bytes, value: parseCanonicalJsonBytes(bytes, `${target.target} frozen manifest`) };
}

export function canonicalFixtureBytes(value) {
  return canonicalJsonBytes(value);
}

export function fixtureDigest(value) {
  return sha256Hex(canonicalFixtureBytes(value));
}
