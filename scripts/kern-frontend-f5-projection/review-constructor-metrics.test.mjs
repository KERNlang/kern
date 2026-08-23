import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { __test } from './worker.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function limited(expression) {
  return __test.runProjectionWithProfileLimits([{
    moduleId: 'scalar-limit.kern',
    source: `fn name=scalarLimit export=true\n  handler lang=kern\n    return value=${JSON.stringify(expression)}\n`,
  }], { maxStringCodePoints: 32 });
}

test('F5-R10 integer, decimal, text, and record-key scalars are constructor-owned', () => {
  const payload = '1'.repeat(50);
  const cases = [payload, `${payload}.1`, `"${'x'.repeat(50)}"`, `{${'k'.repeat(50)}: 1}`];
  for (const [index, expression] of cases.entries()) {
    const result = limited(expression);
    assert.equal(result.receipt.status, 'fatal', `scalar case ${index}`);
    assert.equal(result.receipt.diagnostics[0].code, 'F5_LIMIT', `scalar case ${index}`);
    assert.equal(result.bytes, null, `scalar case ${index}`);
  }
});

test('F5-R11 discard-only host validation errors are not converted into receipts', () => {
  const error = new TypeError('discard validator failure');
  error.name = 'StructuralKirError';
  assert.throws(() => __test.runProjectionWithValidator([
    { moduleId: 'validator.kern', source: 'fn name=valid export=true\n' },
  ], () => { throw error; }), (caught) => caught === error);
});

test('F5-R8/R9 source wall requires scalar frames and rejects post-hoc authorities', () => {
  const kernDirectory = resolve(ROOT, 'examples/kern-frontend');
  const kern = readdirSync(kernDirectory).filter((name) => /^f5-.*\.kern$/u.test(name))
    .map((name) => readFileSync(resolve(kernDirectory, name), 'utf8')).join('\n');
  const host = ['worker.mjs', 'decoder.mjs'].map((name) =>
    readFileSync(resolve(ROOT, 'scripts/kern-frontend-f5-projection', name), 'utf8')).join('\n');
  assert.match(kern, /\\u001f/u);
  assert.match(kern, /f5resultsuccess\(/u);
  assert.doesNotMatch(`${kern}\n${host}`, /f5measureinstructions|measureInstructionStream/u);
  assert.doesNotMatch(host, /error\?\.name !== 'StructuralKirError'|instanceof StructuralKirError/u);
  assert.doesNotMatch(kern, /requiredNodes|requiredCollection|requiredString/u);
});
