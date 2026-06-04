import type { IRNode } from '@kernlang/core';
import { generateFirstTruthy } from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Python Ground Layer: firstTruthy', () => {
  it('emits ordered short-circuit fallback logic', () => {
    const node = mk('firstTruthy', { name: 'label', values: "preferred, nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe('label = preferred or nickname or "Anonymous"');
  });

  it('parenthesizes conditional operands before joining fallbacks', () => {
    const node = mk('firstTruthy', { name: 'label', values: "ready ? preferred : nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe('label = (preferred if ready else nickname) or "Anonymous"');
  });

  it('rejects missing, unary, and propagated values', () => {
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x' }))).toThrow(/values/);
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x', values: 'preferred' }))).toThrow(/at least two/);
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x', values: 'load()?, fallback' }))).toThrow(
      /Propagation/,
    );
  });
});
