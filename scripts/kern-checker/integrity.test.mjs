import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from '../capstone-checker-subset/fixtures.mjs';
import { checkerFactsFromFlatModule } from './contract.mjs';
import { FROZEN_CHECKER_LINES, FROZEN_CHECKER_SHA256, createKernCheckerComposition } from './composition.mjs';
import { runKernCheckerFacts } from './production.mjs';
import { loadKernCheckerAssets } from '../../packages/cli/dist/kern-checker-assets.js';
import { KERN_CHECKER_TABLES } from '../../packages/cli/dist/kern-checker-contract.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';

function facts(expected) {
  const fixture = FIXTURES.find((item) => item.expected === expected);
  return checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
}

test('frozen oversized legacy source remains byte-identical', () => {
  const composition = createKernCheckerComposition();
  assert.equal(composition.record.members[1].sha256, FROZEN_CHECKER_SHA256);
  assert.equal(FROZEN_CHECKER_LINES, 613);
});

test('valid format-check mutation is killed', () => {
  const composition = createKernCheckerComposition();
  const source = composition.compositeBytes.toString('utf8').replace(
    'format != \\"kern.checker.facts.2\\"',
    'format == \\"kern.checker.facts.2\\"',
  );
  assert.notEqual(source, composition.compositeBytes.toString('utf8'));
  const result = runKernCheckerFacts(facts('accept'), { composition: { ...composition, source } });
  assert.equal(result.outcome, 'failure');
});

test('always-accept mutation is killed by result-tape authentication', () => {
  const composition = createKernCheckerComposition();
  const source = composition.compositeBytes.toString('utf8').replace(
    'let name=outcome value="\\"reject\\""',
    'let name=outcome value="\\"accept\\""',
  );
  assert.notEqual(source, composition.compositeBytes.toString('utf8'));
  const result = runKernCheckerFacts(facts('reject'), { composition: { ...composition, source } });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0].code, 'checker-malformed-result');
});

test('host contract rejects unsafe references before runtime', () => {
  const input = facts('accept');
  input.tables.stmtParent[0] = 0;
  const result = runKernCheckerFacts(input);
  assert.equal(result.outcome, 'failure');
  assert.match(result.diagnostics[0].message, /must reference an earlier statement/);
});

test('direct native entry is pre-authenticated-only for unconsumed count metadata', () => {
  const input = facts('accept');
  const call = input.tables.callArgCount.findIndex((count) => count > 0);
  assert.notEqual(call, -1);
  input.tables.callArgCount[call] += 100;
  assert.equal(runKernCheckerFacts(input).outcome, 'failure');

  const assets = loadKernCheckerAssets();
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        input.format,
        input.path,
        ...KERN_CHECKER_TABLES.map(([name]) => input.tables[name]),
        assets.policy.profileLimits.maxRowsPerFamily,
        assets.policy.profileLimits.maxFactCells,
        assets.policy.profileLimits.maxDiagnostics,
      ],
      identity: { handlerName: 'checkFacts', sourcePath: '@kernlang/cli/dist/kern-checker/checker.composed.kern' },
      source: assets.source,
    },
    { enabled: true, limits: assets.policy.runtimeLimits },
  );
  assert.equal(envelope.outcome, 'success');
  assert.equal(envelope.result.value.value[1].value, 'accept');
});
