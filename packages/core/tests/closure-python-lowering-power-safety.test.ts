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

  test('validates a bare for-of assignment target before it becomes a Python binding', () => {
    expect(() =>
      lowerJsClosureBodyToPython(
        '{ for (_kern_pow_int of values) { total += 1; } return total; }',
        reservedPowerBindingOptions,
      ),
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
});
