import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4107TripleRowPromotion,
  m4107ActiveProfile,
  m4107ParameterMigration,
} from './coverage-m4-107-triple-row-promotion.mjs';

test('M4.107 archives only the authenticated triple-row profile', () => {
  assertM4107TripleRowPromotion();
  assert.deepEqual(m4107ActiveProfile(), {
    maxNodeRows: 89,
    maxPropertyRows: 125,
    maxValueRows: 2100,
  });
});

test('M4.107 publishes the exact validstatement parameter queue', () => {
  assert.deepEqual(m4107ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 14,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
      parameterRows: 14,
      profileRows: { nodes: 89, properties: 125, values: 1873 },
      tool: 'canonicalizer',
    }],
  });
});

test('M4.107 pins its M4.106 runtime input', () => {
  const bytes = readFileSync(new URL('./runtime-cost-m4-106.json', import.meta.url));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '827525373e1716137b53e322c913ec7dcb4f8ea0cd12dc1d8d77605c692a886a',
  );
});
