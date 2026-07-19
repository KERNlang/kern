import { rewriteClosurePowerExpressions } from '../src/closure-power-lowering.js';

describe('closure portable-power rewriting', () => {
  test.each([
    ['{ return (2 ** 3 satisfies number) ** 2; }', '(2 ** 3 satisfies number) ** 2'],
    ['{ return (<number>(2 ** 3)) ** 2; }', '(<number>(2 ** 3)) ** 2'],
  ])('rewrites only the outer power expression across transparent TypeScript wrappers', (body, outerPower) => {
    const lowered: string[] = [];
    const rewritten = rewriteClosurePowerExpressions(body, {
      lowerExpression: (source) => {
        lowered.push(source);
        return '__lowered_power__';
      },
      validateBindingName: () => {},
    });

    expect(lowered).toEqual([outerPower]);
    expect(rewritten).toBe('{ return __lowered_power__; }');
  });
});
