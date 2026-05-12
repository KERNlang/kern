import { parseDocument } from '@kernlang/core';
import { generatePythonCoreNode } from '../src/codegen-python.js';

describe('first-class KERN syntax — Python target', () => {
  test('http decorators lower to FastAPI router decorators on fn codegen', () => {
    const root = parseDocument(
      [
        '@http.get("/users/:id")',
        'fn getUser(id: string): User',
        '  handler lang="kern"',
        '    return value="{ id: id }"',
      ].join('\n'),
    );
    const fn = root.children?.find((child) => child.type === 'fn');
    if (!fn) throw new Error('expected fn node');

    expect(generatePythonCoreNode(fn).join('\n')).toBe(
      ['@router.get("/users/{id}")', 'def get_user(id: str) -> User:', '    return {"id": id}'].join('\n'),
    );
  });

  test('http decorators rewrite named path args without touching other strings', () => {
    const root = parseDocument(
      [
        '@http.get(name="get:user", path="/users/:id")',
        'fn getUser(id: string): User',
        '  handler lang="kern"',
        '    return value="{ id: id }"',
      ].join('\n'),
    );
    const fn = root.children?.find((child) => child.type === 'fn');
    if (!fn) throw new Error('expected fn node');

    expect(generatePythonCoreNode(fn)[0]).toBe('@router.get(name="get:user", path="/users/{id}")');
  });

  test('non-http decorators preserve empty and non-empty call forms', () => {
    const root = parseDocument(
      [
        '@cached()',
        '@audit.log("users")',
        'fn getUser(id: string): User',
        '  handler <<<',
        '    return User(id=id)',
        '  >>>',
      ].join('\n'),
    );
    const fn = root.children?.find((child) => child.type === 'fn');
    if (!fn) throw new Error('expected fn node');

    expect(generatePythonCoreNode(fn).slice(0, 2)).toEqual(['@cached()', '@audit.log("users")']);
  });
});
