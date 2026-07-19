import { lowerJsClosureBodyToPython } from '../src/closure-python-lowering.js';

describe('closure Python lowering generated-helper safety', () => {
  const reservedPowerBindingOptions = {
    lowerExpression: (source: string) => source,
    validateBindingName: (name: string) => {
      if (name === '_kern_pow_int') throw new Error('reserved checked-power helper');
    },
    enterBlockScope: () => {},
    exitBlockScope: () => {},
  };

  test.each([
    ['bare assignment', 'for (_kern_pow_int of values)'],
    ['declared local', 'for (const _kern_pow_int of values)'],
  ])('validates a %s for-of target before it becomes a Python binding', (_label, loopHeader) => {
    expect(() =>
      lowerJsClosureBodyToPython(`{ ${loopHeader} { total += 1; } return total; }`, reservedPowerBindingOptions),
    ).toThrow('reserved checked-power helper');
  });

  test('validates a catch target before it can capture the generated Python helper', () => {
    expect(() =>
      lowerJsClosureBodyToPython(
        '{ try { return 2 ** 3; } catch (_kern_pow_int) { return 4 ** 2; } }',
        reservedPowerBindingOptions,
      ),
    ).toThrow('reserved checked-power helper');
  });

  test('normalizes accepted TypeScript-only expression syntax before consumer lowering', () => {
    const loweredExpressions: string[] = [];
    const loweredConditions: string[] = [];
    const result = lowerJsClosureBodyToPython(
      '{ const seen = new Set<string>(); if ((seen.size satisfies number) > 0) { return load<number>(seen); } return 0; }',
      {
        ...reservedPowerBindingOptions,
        lowerExpression: (source) => {
          loweredExpressions.push(source);
          return source;
        },
        lowerCondition: (source) => {
          loweredConditions.push(source);
          return source;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(loweredExpressions).toEqual(['new Set()', 'load(seen)', '0']);
    expect(loweredConditions).toEqual(['(seen.size) > 0']);
  });
});
