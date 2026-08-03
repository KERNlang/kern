import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  M4149_CANDIDATE_PREDICATE,
  M4149_CURRENT_PREDICATE,
} from './canonical-surface-analysis-m4-149.mjs';
import { assertM4150QuotesourceRewrite } from './quotesource-rewrite-m4-150.mjs';

const SOURCE_URL = new URL(
  '../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
  import.meta.url,
);
const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';

function predicateLine(predicate) {
  return `                if cond=${JSON.stringify(predicate)}\n`;
}

test('M4.150 applies only the exact M4.149 quotesource predicate rewrite', () => {
  const source = readFileSync(SOURCE_URL, 'utf8');
  assert.equal(source.split(predicateLine(M4149_CURRENT_PREDICATE)).length - 1, 0);
  assert.equal(source.split(predicateLine(M4149_CANDIDATE_PREDICATE)).length - 1, 1);
});

test('M4.150 exposes the last function as an exact terminal parameter queue', () => {
  const handoff = assertM4150QuotesourceRewrite();
  assert.deepEqual(handoff.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 2,
    witnesses: [{
      id: QUOTESOURCE_ID,
      parameterRows: 2,
      profileRows: { nodes: 54, properties: 82, values: 932 },
      tool: 'canonicalizer',
    }],
  });
  assert.deepEqual(handoff.selectedNextAction, {
    action: 'consume-exact-parameter-queue',
    milestone: 'M4.151',
    witness: QUOTESOURCE_ID,
  });
});
