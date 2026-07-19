import ts from 'typescript';
import { evaluateCoreContractOperation } from '../src/core-contracts/semantics.js';
import { createCoreRuntimeEnv, evalCoreExpression, toHostValue } from '../src/core-runtime/index.js';
import { evalPortableValueAsync } from '../src/ir/semantics/async-portable-scalar.js';
import { runInternalEffectMachineSync } from '../src/ir/semantics/internal-effect-machine.js';
import { evaluateLambdaEffects } from '../src/ir/semantics/lambda-runtime.js';
import { evalPortableValue } from '../src/ir/semantics/portable-machine-evaluator.js';
import { assertPortableMachineScalarShape } from '../src/ir/semantics/portable-machine-shape.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import { parseExpression } from '../src/parser-expression.js';
import {
  checkedPortablePower,
  KERN_POWER_HELPER_JS,
  PORTABLE_POWER_OPERAND_ERROR,
  PORTABLE_POWER_RESULT_ERROR,
  portablePowerHelperTS,
} from '../src/portable-power.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

describe('portable exponentiation runtime contract', () => {
  test.each([
    [0, 0, 1],
    [0, MAX_SAFE, 0],
    [1, MAX_SAFE, 1],
    [-1, MAX_SAFE, -1],
    [-2, 3, -8],
    [2, 10, 1024],
    [MAX_SAFE, 1, MAX_SAFE],
  ])('checked power owns %p ** %p', (base, exponent, expected) => {
    expect(checkedPortablePower(base, exponent)).toBe(expected);
  });

  test.each([
    [2, -1],
    [2, 0.5],
    [0, -1],
    [-2, 0.5],
    [MAX_SAFE + 1, 1],
    [2, MAX_SAFE + 1],
    [-0, 3],
    [2, -0],
    [true, 2],
  ])('rejects operands outside the integer domain: %p ** %p', (base, exponent) => {
    expect(() => checkedPortablePower(base, exponent)).toThrow(PORTABLE_POWER_OPERAND_ERROR);
  });

  test.each([
    [2, 53],
    [MAX_SAFE, 2],
    [-MAX_SAFE, 2],
  ])('rejects unsafe results before host-sized exponentiation: %p ** %p', (base, exponent) => {
    expect(() => checkedPortablePower(base, exponent)).toThrow(PORTABLE_POWER_RESULT_ERROR);
  });

  test('core contract, core runtime, and portable evaluator agree', () => {
    expect(evaluateCoreContractOperation('Number.power', [-2, 3])).toBe(-8);
    expect(toHostValue(evalCoreExpression('2 ** 3 ** 2', createCoreRuntimeEnv()))).toBe(512);
    expect(evalPortableValue(parseExpression('(2 ** 3) ** 2'), makeEnv())).toBe(64);

    expect(() => evaluateCoreContractOperation('Number.power', [2, -1])).toThrow(PORTABLE_POWER_OPERAND_ERROR);
    expect(() => evalCoreExpression('2 ** 53', createCoreRuntimeEnv())).toThrow(PORTABLE_POWER_RESULT_ERROR);
    expect(() => evalPortableValue(parseExpression('2 ** -1'), makeEnv())).toThrow(PORTABLE_POWER_OPERAND_ERROR);
  });

  test('core and portable evaluators execute a long right-associative chain without host recursion', () => {
    const source = new Array(10_001).fill('1').join(' ** ');
    const parsed = parseExpression(source);
    expect(toHostValue(evalCoreExpression(parsed, createCoreRuntimeEnv()))).toBe(1);
    expect(evalPortableValue(parsed, makeEnv())).toBe(1);
  });

  test('async evaluator and lambda runtime use the same checked contract', async () => {
    const options = {
      runFunctionBody: async () => ({ completion: { kind: 'normal' as const }, events: [] }),
    };
    await expect(evalPortableValueAsync(parseExpression('2 ** 10'), makeEnv(), options)).resolves.toBe(1024);
    await expect(evalPortableValueAsync(parseExpression('2 ** -1'), makeEnv(), options)).rejects.toThrow(
      PORTABLE_POWER_OPERAND_ERROR,
    );

    expect(evaluateLambdaEffects({ type: 'lambda', props: { expr: '2 ** 10' } }, makeEnv()).events).toEqual([
      { op: 'stdout', text: '1024' },
    ]);
    expect(() => evaluateLambdaEffects({ type: 'lambda', props: { expr: '2 ** -1' } }, makeEnv())).toThrow(
      PORTABLE_POWER_OPERAND_ERROR,
    );
  });

  test('portable machine structural admission includes checked power', () => {
    expect(() => assertPortableMachineScalarShape(parseExpression('2 ** 10'), makeEnv())).not.toThrow();
  });

  test('portable machine admission and execution remain stack-safe for a long power chain', () => {
    const source = new Array(10_001).fill('1').join(' ** ');
    const parsed = parseExpression(source);

    expect(() => assertPortableMachineScalarShape(parsed, makeEnv())).not.toThrow(RangeError);
    expect(
      runInternalEffectMachineSync([{ type: 'expression-v1', props: { name: 'result', expr: source } }], makeEnv()),
    ).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'assign', target: 'result', value: 1 }],
    });
    expect(
      runInternalEffectMachineSync(
        [
          {
            type: 'if',
            props: { cond: 'true' },
            children: [{ type: 'expression-v1', props: { name: 'nested', expr: source } }],
          },
        ],
        makeEnv(),
      ).events,
    ).toEqual([{ op: 'assign', target: 'nested', value: 1 }]);
  });

  test('generated JS and typed TS helpers execute the same checked algorithm', () => {
    const runJs = Function(`${KERN_POWER_HELPER_JS}\nreturn __kern_pow_int;`)() as (
      operands: readonly unknown[],
    ) => number;
    const transpiled = ts.transpileModule(portablePowerHelperTS(), {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const runTs = Function(`${transpiled}\nreturn __kern_pow_int;`)() as (operands: readonly unknown[]) => number;

    for (const helper of [runJs, runTs]) {
      expect(helper([-2, 3])).toBe(-8);
      expect(helper([2, 3, 2])).toBe(512);
      expect(helper([1, MAX_SAFE])).toBe(1);
      expect(() => helper([2, -1])).toThrow(PORTABLE_POWER_OPERAND_ERROR);
      expect(() => helper([2, 53])).toThrow(PORTABLE_POWER_RESULT_ERROR);
    }
  });

  test('generated helpers cannot be rebound through direct eval', () => {
    const transpiled = ts.transpileModule(portablePowerHelperTS(), {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    for (const helperSource of [KERN_POWER_HELPER_JS, transpiled]) {
      const result = Function(
        `${helperSource}\ntry { eval("__kern_pow_int = () => 7"); } catch {}\nreturn __kern_pow_int([2, 3]);`,
      )();
      expect(result).toBe(8);
    }
  });

  test('generated TS helper does not resolve safety intrinsics through authored module bindings', () => {
    const shadowed = Function(
      [
        'const Number = { isSafeInteger: () => true, MAX_SAFE_INTEGER: Infinity };',
        'const Math = { abs: () => 0, floor: () => Infinity };',
        'const Object = { is: () => false };',
        'const Error = class ShadowedError {};',
        KERN_POWER_HELPER_JS,
        'return __kern_pow_int;',
      ].join('\n'),
    )() as (operands: readonly unknown[]) => number;

    expect(() => shadowed([2, 53])).toThrow(PORTABLE_POWER_RESULT_ERROR);
    expect(() => shadowed([-0, 3])).toThrow(PORTABLE_POWER_OPERAND_ERROR);
    expect(shadowed([1, MAX_SAFE])).toBe(1);
  });
});
