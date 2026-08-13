import { bindInternalEffectMachineState } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import type { InternalEffectMachineState } from '../src/ir/semantics/internal-effect-machine-types.js';
import {
  acquireInternalTextCodePoints,
  installInternalTextCodePointCache,
} from '../src/ir/semantics/internal-text-code-point-cache.js';
import { evalPortableValue } from '../src/ir/semantics/portable-machine-evaluator.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import { parseExpression } from '../src/parser-expression.js';

function state(budget: number): InternalEffectMachineState {
  const machine = { remainingIterations: 1 };
  installInternalTextCodePointCache(machine, budget);
  return machine;
}

function evaluate(expression: string, source: string, machine: InternalEffectMachineState) {
  const env = makeEnv({ bindings: new Map([['source', source]]) });
  const restore = bindInternalEffectMachineState(env, machine);
  try {
    return evalPortableValue(parseExpression(expression), env);
  } finally {
    restore();
  }
}

describe('internal effect-machine Text code-point cache', () => {
  test('retains one frozen scalar materialization per immutable value', () => {
    const source = 'a😀b';
    const machine = state(1024);

    expect(evaluate('Text.length(source)', source, machine)).toBe(3);
    expect(evaluate('Text.charAt(source, 1)', source, machine)).toBe('😀');
    expect(evaluate('Text.slice(source, 1, 3)', source, machine)).toBe('😀b');
    expect(evaluate('Text.indexOf(source, "b")', source, machine)).toBe(2);

    const retained = acquireInternalTextCodePoints(machine, source, 'Text.test');
    const retainedAgain = acquireInternalTextCodePoints(machine, source, 'Text.test');
    expect(retained).toEqual(['a', '😀', 'b']);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(retainedAgain).toBe(retained);
    expect(Object.keys(machine)).toEqual(['remainingIterations']);
  });

  test('fails closed without retention when the execution budget is exhausted', () => {
    const machine = state(1);
    expect(() => evaluate('Text.charAt(source, 2)', 'abcd', machine)).toThrow(/cache budget exhausted/u);
    expect(() => acquireInternalTextCodePoints(machine, 'a', 'Text.test')).toThrow(/cache budget exhausted/u);
  });

  test('rejects malformed UTF-16 before insertion', () => {
    const machine = state(1024);
    expect(() => evaluate('Text.length(source)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(acquireInternalTextCodePoints(machine, 'a', 'Text.test')).toEqual(['a']);
  });

  test('does not share retained arrays between execution states', () => {
    const first = state(1024);
    const second = state(1024);
    expect(evaluate('Text.length(source)', 'same', first)).toBe(4);
    expect(evaluate('Text.length(source)', 'same', second)).toBe(4);
    expect(acquireInternalTextCodePoints(first, 'same', 'Text.test')).not.toBe(
      acquireInternalTextCodePoints(second, 'same', 'Text.test'),
    );
  });
});
