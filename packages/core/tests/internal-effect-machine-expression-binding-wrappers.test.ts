import { internalMachineExpressionBindings } from '../src/ir/semantics/internal-effect-machine-expression-bindings.js';

describe('internal effect-machine expression binding wrappers', () => {
  test.each([
    ['await answer', 'answer'],
    ['[...items]', 'items'],
    ['answer?', 'answer'],
  ])('discovers bindings under %s', (source, binding) => {
    expect(internalMachineExpressionBindings(source)).toEqual(new Set([binding]));
  });
});
