import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { scalarHelperHistoryOverrides } from './scalar-helper-history-coverage-adapter.mjs';
import { digestM4145CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS as ROWS,
} from './scalar-helper-history-transition.mjs';
import { SCALAR_HELPER_HISTORY_INVENTORY } from './scalar-helper-history-transition-data.mjs';

const DIST = resolve(process.cwd(), 'packages/core/dist');
const FROZEN_M4145_COMPILED_CORE_DIGEST =
  '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const BY_PATH = new Map(ROWS.map((row) => [row.path, row]));

const TEXT_UTF8_LENGTH_CHANGED = Object.freeze([
  Object.freeze({
    path: 'codegen/kern-stdlib.js',
    currentDigest: '27d4291f35a0f900db4379dbd8460e2d339a48d7a5a1b69103babfd6e1e7caa6',
  }),
  Object.freeze({
    path: 'codegen/stdlib-preamble.js',
    currentDigest: '14546a5935ff65ec72f83d74b5a77864a8ff55f03509132c111119893bde5409',
  }),
  Object.freeze({
    path: 'codegen/text-contract.js',
    currentDigest: '1bb2627c84586d6731c5f7555f99f83f9826efeab977a0757c64d7dc31dde148',
  }),
  Object.freeze({
    path: 'ir/semantics/portable-machine-shape.js',
    currentDigest: 'c6411ab25f326941796c4a53d059357a0fecacb5f6741431e1f068f4d971a3f4',
  }),
  Object.freeze({
    path: 'ir/semantics/portable-string.js',
    currentDigest: 'cb07234c90aca9e810cf0f1a9f6338da4d74d54ffbc7f36b6e5ecee8ac479c13',
  }),
]);

const UNCHANGED_SCALAR_HISTORY_PATHS = Object.freeze([
  'ir/semantics/deferred-expression-preflight.js',
  'ir/semantics/internal-effect-machine-expression-bindings.js',
  'ir/semantics/portable-scalar-domain.js',
]);

function currentBytes(path) {
  return readFileSync(resolve(DIST, path));
}

test('Text.utf8Length changes exactly five frozen scalar-history successors', () => {
  assert.deepEqual(
    TEXT_UTF8_LENGTH_CHANGED.map(({ path }) => path),
    [
      'codegen/kern-stdlib.js',
      'codegen/stdlib-preamble.js',
      'codegen/text-contract.js',
      'ir/semantics/portable-machine-shape.js',
      'ir/semantics/portable-string.js',
    ],
  );
  for (const { path, currentDigest } of TEXT_UTF8_LENGTH_CHANGED) {
    const row = BY_PATH.get(path);
    assert.notEqual(row, undefined, path);
    assert.equal(digest(currentBytes(path)), currentDigest, path);
    assert.notEqual(currentDigest, row.currentDigest, path);
  }
});

test('the remaining three scalar-history successors stay byte-identical', () => {
  for (const path of UNCHANGED_SCALAR_HISTORY_PATHS) {
    const row = BY_PATH.get(path);
    assert.notEqual(row, undefined, path);
    assert.equal(digest(currentBytes(path)), row.currentDigest, path);
  }
});

test('a predecessor-edge mutation remains fail-closed without a future bridge', () => {
  const row = BY_PATH.get(UNCHANGED_SCALAR_HISTORY_PATHS[0]);
  const tampered = Buffer.from(currentBytes(row.path));
  tampered[0] ^= 1;
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: tampered,
      expectedTerminalDigest: row.expectedDigest,
      milestone: `Text.utf8Length bridge control ${row.path}`,
      path: row.path,
      stages: [historicalTransitionStage(row)],
    }),
    /broken or misordered successor edge/u,
  );
});

test('the adapter must bridge each current Text.utf8Length successor to its frozen predecessor', () => {
  const overrides = scalarHelperHistoryOverrides(
    DIST,
    SCALAR_HELPER_HISTORY_INVENTORY,
    ROWS.map((row) => row.path),
  );
  for (const { path } of TEXT_UTF8_LENGTH_CHANGED) {
    const row = BY_PATH.get(path);
    assert.deepEqual(overrides.get(path), Buffer.from(row.replacements[0].historical), path);
  }
});

test('the composed 305-path M4.145 replay must reach its frozen terminal digest', () => {
  const actual = digestM4145CompiledCoreJavaScript();
  assert.equal(
    actual,
    FROZEN_M4145_COMPILED_CORE_DIGEST,
    'a scalar-only bridge is nonterminal; all historical path owners must compose',
  );
});
