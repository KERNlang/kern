import { analyzeClosurePowerRewrite } from '../src/closure-eligibility.js';
import { rewriteClosurePowerExpressions } from '../src/closure-power-lowering.js';

describe('closure portable-power rewriting', () => {
  test.each([
    ['{ return (2 ** 3 satisfies number) ** 2; }', '(2 ** 3) ** 2'],
    ['{ return (<number>(2 ** 3)) ** 2; }', '((2 ** 3)) ** 2'],
    ['{ return (2 /* base */ ** 3) ** 2; }', '(2   ** 3) ** 2'],
    ['{ return identity<number>(2 ** 3) ** 2; }', 'identity(2 ** 3) ** 2'],
    ['{ return identity < number > (2 ** 3) ** 2; }', 'identity  (2 ** 3) ** 2'],
    ['{ return identity<number /* type */>(2 ** 3) ** 2; }', 'identity(2 ** 3) ** 2'],
    ['{ return identity<number,>(2 ** 3) ** 2; }', 'identity(2 ** 3) ** 2'],
    ['{ return identity<Map<string, number> /* type */>(2 ** 3) ** 2; }', 'identity(2 ** 3) ** 2'],
    ['{ return (2 /* first */ /* second */+ 1) ** 2; }', '(2    + 1) ** 2'],
    ['{ return (/[/*]/.test(s) ? 2 : 3) ** 2; }', '(/[/*]/.test(s) ? 2 : 3) ** 2'],
    ['{ return (/[//]/.test(s) ? 2 : 3) ** 2; }', '(/[//]/.test(s) ? 2 : 3) ** 2'],
    ['{ return (/a\\/*b/.test(s) ? 2 : 3) ** 2; }', '(/a\\/*b/.test(s) ? 2 : 3) ** 2'],
    ['{ return (`${s}/*safe*/${s}//tail` === s ? 2 : 3) ** 2; }', '(`${s}/*safe*/${s}//tail` === s ? 2 : 3) ** 2'],
    ['{ return (`${s /* actual */}/*safe*/` === s ? 2 : 3) ** 2; }', '(`${s  }/*safe*/` === s ? 2 : 3) ** 2'],
  ])('normalizes and rewrites only the outer power expression across TypeScript-only syntax', (body, outerPower) => {
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

  test('normalizes a 1,200-operand closure power chain without recursive transformation', () => {
    const chain = new Array(1_200).fill('1').join(' ** ');
    const body = `{ return ${chain}; }`;
    const lowered: string[] = [];
    const rewritten = rewriteClosurePowerExpressions(body, {
      lowerExpression: (source) => {
        lowered.push(source);
        return '__lowered_power__';
      },
      validateBindingName: () => {},
    });

    expect(lowered).toEqual([chain]);
    expect(rewritten).toBe('{ return __lowered_power__; }');
  });

  test('fails closed when a closure exceeds the TypeScript parser stack', () => {
    const chain = new Array(3_000).fill('1').join(' ** ');
    expect(analyzeClosurePowerRewrite(`{ return ${chain}; }`)).toBe(null);
  });

  test('analyzes a 3,000-operand non-power chain without recursive traversal overflow', () => {
    const chain = new Array(3_000).fill('1').join(' + ');
    const plan = analyzeClosurePowerRewrite(`{ return ${chain}; }`);

    expect(plan).not.toBe(null);
    expect(plan?.expressions).toEqual([]);
  });

  test('collects writes nested beneath a selected outer power expression', () => {
    const plan = analyzeClosurePowerRewrite('{ return ((__kern_pow_int = 2) as number) ** 3; }');

    expect(plan?.writtenNames).toContain('__kern_pow_int');
    expect(plan?.expressions).toHaveLength(1);
  });

  test.each(['of', 'in'])('collects a bare for...%s target before rewriting power', (operator) => {
    const writtenNames: string[] = [];
    rewriteClosurePowerExpressions(`{ for (__kern_pow_int ${operator} values) {} return 2 ** 3; }`, {
      lowerExpression: () => '__lowered_power__',
      validateBindingName: (name) => writtenNames.push(name),
    });

    expect(writtenNames).toContain('__kern_pow_int');
  });
});
