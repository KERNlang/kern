import type { IRNode } from '@kernlang/core';
import { generateObjectOmit, generateObjectPick } from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Python Ground Layer: objectPick / objectOmit', () => {
  it('emits shallow own-key objectPick with a real keys list expression', () => {
    const node = mk('objectPick', { name: 'publicUser', in: 'user', keys: "['id', 'name']" });
    expect(generateObjectPick(node).join('\n')).toBe(
      'public_user = (lambda __kern_source: {key: (__kern_source[key] if key in __kern_source else None) for key in ["id", "name"]})(user)',
    );
  });

  it('evaluates complex objectPick source expressions once', () => {
    const node = mk('objectPick', { name: 'publicUser', in: 'load_user()', keys: "['id']" });
    expect(generateObjectPick(node).join('\n')).toBe(
      'public_user = (lambda __kern_source: {key: (__kern_source[key] if key in __kern_source else None) for key in ["id"]})(load_user())',
    );
  });

  it('emits shallow immutable objectOmit', () => {
    const node = mk('objectOmit', { name: 'safeUser', in: 'user', keys: "['password', 'token']" });
    expect(generateObjectOmit(node).join('\n')).toBe(
      'safe_user = {key: value for key, value in user.items() if key not in ["password", "token"]}',
    );
  });

  it('rejects empty and non-string keys', () => {
    expect(() => generateObjectPick(mk('objectPick', { name: 'x', in: 'user', keys: '[]' }))).toThrow(/non-empty/);
    expect(() => generateObjectOmit(mk('objectOmit', { name: 'x', in: 'user', keys: '[id]' }))).toThrow(/string/);
  });
});
