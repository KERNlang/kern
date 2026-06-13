/**
 * Phase-2 census-v3 discriminator self-test.
 *
 * The discriminator is the denominator authority: it must call real JS
 * expressions EXPRESSION and prose PROSE_NOT_EXPR (so prose in a `value=` prop
 * cannot inflate the ratchet denominator). This exercises `classifyValueProp` on
 * expression vs prose samples and the bucket report.
 */

import {
  classify,
  classifyValueProp,
  DISCRIMINATOR_VERSION,
  denominatorReport,
} from '../../../../scripts/phase2/lib/discriminator.mjs';

describe('phase2 discriminator (census-v3)', () => {
  test('version id', () => {
    expect(DISCRIMINATOR_VERSION).toBe('census-v3');
  });

  test('authoritative sources count as EXPRESSION automatically', () => {
    expect(classify({ source: 'whatever prose', sourceKind: 'hand-authored' }).kind).toBe('EXPRESSION');
    expect(classify({ source: 'a || b', sourceKind: 'conformance:expr' }).kind).toBe('EXPRESSION');
  });

  test('expression-shaped value props classify EXPRESSION', () => {
    for (const expr of ['a || b', 'x.length', 'foo(1, 2)', '`tpl ${x}`', '-3.9', 'count === 0', '[1, 2]']) {
      const cls = classifyValueProp(expr);
      expect(cls.kind).toBe('EXPRESSION');
    }
  });

  test('prose value props classify PROSE_NOT_EXPR with a bucket', () => {
    const sentence = classifyValueProp('This is a full sentence.');
    expect(sentence.kind).toBe('PROSE_NOT_EXPR');

    const titleCase = classifyValueProp('Save Changes');
    expect(titleCase.kind).toBe('PROSE_NOT_EXPR');

    const label = classifyValueProp('username');
    expect(label.kind).toBe('PROSE_NOT_EXPR');
    expect((label as { bucket: string }).bucket).toBe('identifier-code-label');

    const empty = classifyValueProp('');
    expect(empty.kind).toBe('PROSE_NOT_EXPR');
  });

  test('an unclassifiable sourceKind throws DENOMINATOR_UNCLASSIFIED', () => {
    expect(() => classify({ source: 'x', sourceKind: 'mystery' })).toThrow(/DENOMINATOR_UNCLASSIFIED/);
  });

  test('bucket report sums correctly', () => {
    const cases = [
      { source: 'a || b', sourceKind: 'hand-authored' },
      { source: 'x.y', sourceKind: 'conformance:expr' },
      { source: 'Hello World.', sourceKind: 'repo-kern:value-props' },
      { source: 'username', sourceKind: 'repo-kern:value-props' },
    ];
    const report = denominatorReport(cases);
    expect(report.discriminatorVersion).toBe('census-v3');
    expect(report.rawOccurrences).toBe(4);
    expect(report.expressionDenominator).toBe(2);
    expect(report.proseNotExpr).toBe(2);
    expect(report.expressionDenominator + report.proseNotExpr + report.escapedArtifacts).toBe(4);
  });
});
