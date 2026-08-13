#!/usr/bin/env node
import { verifyKernCheckerComposition } from './kern-checker/composition.mjs';
import { checkerFactsFromFlatModule } from './kern-checker/contract.mjs';
import { flattenKernSource } from './capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from './capstone-checker-subset/fixtures.mjs';
import { loadKernCheckerAssets } from '../packages/cli/dist/kern-checker-assets.js';
import { runKernCheckerFacts } from '../packages/cli/dist/kern-checker-runtime.js';
import { verifyKernCheckerNativeWorkPolicy } from './kern-checker/native-work-policy.mjs';

function fail(detail) {
  throw new Error(`KERN checker gate rejection: ${detail}`);
}

const composition = verifyKernCheckerComposition();
const assets = loadKernCheckerAssets();
verifyKernCheckerNativeWorkPolicy(assets.policy);
if (assets.source !== composition.source) fail('packaged source differs from authenticated composition');
if (assets.checker.bytes !== composition.record.composite.bytes ||
    assets.checker.sha256 !== composition.record.composite.sha256) {
  fail('compiled trust anchor differs from repository composition');
}
for (const forbidden of ['checkFlatModule', 'flattenKernSource', 'parseDocument', 'parseExpression', 'spawnSync']) {
  if (assets.source.includes(forbidden)) fail(`packaged source delegates through ${forbidden}`);
}
for (const expected of ['accept', 'reject']) {
  const fixture = FIXTURES.find((item) => item.expected === expected);
  const facts = checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
  const result = runKernCheckerFacts(facts, { assets });
  if (result.outcome !== expected) fail(`packaged source failed ${expected} execution`);
}

process.stdout.write(
  `KERN production checker passed: ${assets.checker.bytes} authenticated bytes, ` +
    `${composition.record.members.length} native members\n`,
);
