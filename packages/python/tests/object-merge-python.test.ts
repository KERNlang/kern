import type { IRNode } from '@kernlang/core';
import { generateObjectMerge } from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Python Ground Layer: objectMerge', () => {
  it('emits a shallow dict unpack binding through Python expression lowering', () => {
    const node = mk('objectMerge', { name: 'merged', sources: 'base, overrides, { extra: 1 }' });
    expect(generateObjectMerge(node).join('\n')).toBe('merged = {**(base), **(overrides), **({"extra": 1})}');
  });

  it('rejects propagation in top-level objectMerge sources', () => {
    const node = mk('objectMerge', { name: 'merged', sources: 'load()?, overrides' });
    expect(() => generateObjectMerge(node)).toThrow(/Propagation/);
  });
});
