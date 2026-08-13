import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadKernFormatterAssets } from '../../packages/cli/dist/kern-formatter-assets.js';
import { createKernFormatterComposition, KERN_FORMATTER_MEMBERS } from './composition.mjs';
import { formatKernSource } from './production.mjs';

const assets = loadKernFormatterAssets();

function mutated(oldText, newText) {
  const source = assets.source.replaceAll(oldText, newText);
  assert.notEqual(source, assets.source, `missing mutation target: ${oldText}`);
  return { ...assets, source };
}

test('composition is reproducible, split below 500 lines, and delegation-free', () => {
  const composition = createKernFormatterComposition();
  assert.equal(composition.record.composite.sha256, assets.formatter.sha256);
  for (const member of composition.record.members) {
    assert.ok(KERN_FORMATTER_MEMBERS.includes(member.path));
    assert.ok(readFileSync(member.path, 'utf8').split('\n').length - 1 < 500, member.path);
  }
  const source = composition.compositeBytes.toString('utf8');
  for (const forbidden of ['formatWithBiome', 'biome', 'tokenizeLineInternal', 'parseDocument', 'spawnSync']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('extent corruption is killed by KERN tape authentication', () => {
  const changed = mutated('reconstructed + extent', 'reconstructed + content');
  const result = formatKernSource('x\n', { assets: changed });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0].code, 'MALFORMED_PHYSICAL_RECORDS');
});

test('blank-collapse and trailing-policy mutations are killed by output oracles', () => {
  const blank = mutated(
    'content == \\"\\" || leadingWidth == Text.length(content)',
    'content == \\"impossible\\"',
  );
  assert.notEqual(formatKernSource('   \n', { assets: blank }).source, '   \n');

  const overreach = mutated('recordClass == \\"code\\"', 'recordClass != \\"raw-body\\"');
  assert.notEqual(formatKernSource('# comment   \n', { assets: overreach }).source, '# comment   \n');
});

test('constant-output and EOF-policy mutations are killed', () => {
  const constant = mutated('out.push(formatted)', 'out.push(source)');
  assert.notEqual(formatKernSource('x   \n', { assets: constant }).source, 'x\n');

  const eof = mutated(
    'source != \\"\\" && finalTerminator == \\"none\\"',
    'source == \\"\\" && finalTerminator == \\"none\\"',
  );
  assert.notEqual(formatKernSource('x', { assets: eof }).source, 'x\n');
});
