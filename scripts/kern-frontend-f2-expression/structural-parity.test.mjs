import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectExpressionText,
  validateExpressionValue,
} from '../../packages/core/dist/kir-structural/expression.js';
import { decodedToStructural } from './structural-oracle.mjs';
import { runExpression } from './worker.mjs';

const OVERLAP = [
  'answer', 'null', 'true', '42', '3.14', '"a\\n😀"',
  '[a, 2, "c"]', '{b: 2, a: 1}', 'a.b', 'a?.b', 'a[b]', 'a?.[b]',
  'f(a, b)', 'f?.(a)', 'new Map()', 'new Error(problem)',
  'a => b', '(a, b) => a + b', 'a + b * c', 'a ** b ** c',
  '!a', '-a', '~a', 'typeof a', 'a ? b : c ? d : e', '(a ?? b) || c',
];

test('decoded F2 postorder tape matches the independent structural projector', () => {
  for (const source of OVERLAP) {
    const decoded = runExpression(source).decoded;
    assert.equal(decoded.status, 'parsed', source);
    const structural = decodedToStructural(decoded);
    assert.deepEqual(structural, projectExpressionText(source, `f2.overlap.${source}`), source);
    assert.doesNotThrow(() => validateExpressionValue(structural, `f2.overlap.${source}`), source);
  }
});

test('F2-only adopted forms validate without bootstrap parser comparison', () => {
  for (const source of ['+value', 'void value', 'none']) {
    const decoded = runExpression(source).decoded;
    assert.equal(decoded.status, 'parsed', source);
    assert.doesNotThrow(() => validateExpressionValue(decodedToStructural(decoded), `f2.only.${source}`), source);
  }
});
