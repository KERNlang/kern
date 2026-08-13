import assert from 'node:assert/strict';
import test from 'node:test';

import { loadKernCheckerAssets } from '../../packages/cli/dist/kern-checker-assets.js';
import {
  KERN_CHECKER_TABLES,
  estimateKernCheckerNativeWork,
} from '../../packages/cli/dist/kern-checker-contract.js';
import { runKernCheckerFacts } from '../../packages/cli/dist/kern-checker-runtime.js';
import { emptyFlatModule, flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from '../capstone-checker-subset/fixtures.mjs';
import { checkerFactsFromFlatModule } from './contract.mjs';

function fixtureFacts(expected) {
  const fixture = FIXTURES.find((item) => item.expected === expected);
  return checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
}

function highWorkFacts(rows = 2048) {
  const flat = emptyFlatModule('high-work.kern');
  const statementValues = {
    stmtCol: 1,
    stmtExprArgCount: 0,
    stmtLine: 1,
    stmtParent: -1,
  };
  for (let row = 0; row < rows; row += 1) {
    for (const [name, type] of KERN_CHECKER_TABLES.slice(0, 26)) {
      flat[name].push(name === 'stmtKind' ? 'do' : (statementValues[name] ?? (type === 'number' ? 0 : '')));
    }
    for (const [name, type] of KERN_CHECKER_TABLES.slice(32, 41)) {
      const value = name === 'callStmt' ? 0 : name === 'callArgCount' ? 1 : type === 'number' ? 1 : '';
      flat[name].push(value);
    }
    for (const [name, type] of KERN_CHECKER_TABLES.slice(41, 53)) {
      const value = name === 'argCall' ? row : name === 'argOrdinal' ? 0 : type === 'number' ? 0 : '';
      flat[name].push(value);
    }
  }
  return checkerFactsFromFlatModule(flat);
}

test('native work policy admits equality and rejects limit plus one before runtime', () => {
  const assets = loadKernCheckerAssets();
  const facts = fixtureFacts('accept');
  const work = estimateKernCheckerNativeWork(facts);
  const atLimit = {
    ...assets,
    policy: { ...assets.policy, nativeWork: { ...assets.policy.nativeWork, maxNativeWork: work } },
  };
  assert.equal(runKernCheckerFacts(facts, { assets: atLimit }).outcome, 'accept');

  const belowLimit = {
    ...assets,
    policy: { ...assets.policy, nativeWork: { ...assets.policy.nativeWork, maxNativeWork: work - 1 } },
  };
  const rejected = runKernCheckerFacts(facts, { assets: belowLimit });
  assert.equal(rejected.outcome, 'failure');
  assert.equal(rejected.diagnostics[0].code, 'checker-native-work-limit');
});

test('maximum-cardinality multiplicative scans are rejected by the pre-runtime work wall', () => {
  const assets = loadKernCheckerAssets();
  const facts = highWorkFacts();
  assert.equal(
    estimateKernCheckerNativeWork(facts, assets.policy.nativeWork.maxNativeWork),
    assets.policy.nativeWork.maxNativeWork + 1,
  );
  const started = performance.now();
  const rejected = runKernCheckerFacts(facts, { assets });
  assert.equal(rejected.outcome, 'failure');
  assert.equal(rejected.diagnostics[0].code, 'checker-native-work-limit');
  assert.ok(performance.now() - started < 1000, 'work-limit rejection must occur before native multiplicative scans');
});
