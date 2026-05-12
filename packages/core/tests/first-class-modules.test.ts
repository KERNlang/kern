import { generateCoreNode } from '../src/codegen-core.js';
import { parseDocument, parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';
import type { IRNode } from '../src/types.js';

function children(source: string): IRNode[] {
  return parseDocument(source).children ?? [];
}

function firstChild(source: string): IRNode {
  const child = children(source)[0];
  if (!child) throw new Error('expected child node');
  return child;
}

describe('first-class module syntax', () => {
  test('named .kern import lowers to canonical use/from IR', () => {
    const node = firstChild('import { Users, Roles as UserRoles } from "./users.kern"');

    expect(node).toMatchObject({
      type: 'use',
      props: { path: './users.kern' },
      children: [
        { type: 'from', props: { name: 'Users' } },
        { type: 'from', props: { name: 'Roles', as: 'UserRoles' } },
      ],
    });
  });

  test('type-only .kern import lowers to use/from kind metadata and type import codegen', () => {
    const node = firstChild('import type { User, Role as UserRole } from "./types.kern"');

    expect(node).toMatchObject({
      type: 'use',
      props: { path: './types.kern' },
      children: [
        { type: 'from', props: { name: 'User', kind: 'type' } },
        { type: 'from', props: { name: 'Role', as: 'UserRole', kind: 'type' } },
      ],
    });
    expect(generateCoreNode(node).join('\n')).toBe(`import type { User, Role as UserRole } from './types.js';`);
  });

  test('external named import remains canonical import IR', () => {
    const node = firstChild('import type { ReactNode, Component as ReactComponent } from "react"');

    expect(node).toMatchObject({
      type: 'import',
      props: { from: 'react', names: 'ReactNode,Component as ReactComponent', types: true },
    });
    expect(node.props).not.toHaveProperty('__firstClassImport');
    expect(generateCoreNode(node).join('\n')).toBe(
      `import type { ReactNode, Component as ReactComponent } from 'react';`,
    );
  });

  test('side-effect imports preserve .kern path translation and external paths', () => {
    const kernImport = firstChild('import "./register.kern"');
    expect(kernImport).toMatchObject({ type: 'use', props: { path: './register.kern' }, children: [] });
    expect(generateCoreNode(kernImport).join('\n')).toBe(`import './register.js';`);

    const externalImport = firstChild('import "./polyfill.js"');
    expect(externalImport).toMatchObject({ type: 'import', props: { from: './polyfill.js' } });
    expect(externalImport.props).not.toHaveProperty('__firstClassImport');
    expect(generateCoreNode(externalImport).join('\n')).toBe(`import './polyfill.js';`);
  });

  test('legacy import from syntax is not rewritten as cross-kern use syntax', () => {
    const node = firstChild('import from="./users.kern" names=Users');

    expect(node).toMatchObject({ type: 'import', props: { from: './users.kern', names: 'Users' } });
    expect(generateCoreNode(node).join('\n')).toBe(`import { Users } from './users.kern';`);
  });

  test('export fn syntax marks the function as exported', () => {
    const node = firstChild('export fn getUser(id: string): User');

    expect(node).toMatchObject({
      type: 'fn',
      props: { name: 'getUser', params: 'id:string', returns: 'User', export: true },
    });
    expect(node.loc?.col).toBe('export '.length + 1);
  });

  test('exported decorator exports the following function', () => {
    const fn = firstChild(['export   @http.get("/users/:id")', 'fn getUser(id: string): User'].join('\n'));

    expect(fn).toMatchObject({
      type: 'fn',
      props: { name: 'getUser', export: true },
      children: [{ type: 'decorator', props: { name: 'http.get', args: '"/users/:id"' } }],
    });
    expect(fn.children?.[0].props).not.toHaveProperty('__exportNextFn');
  });

  test('exported decorator before non-fn reports the existing decorator warning', () => {
    const result = parseDocumentWithDiagnostics(['export @deprecated', 'type name=User alias=string'].join('\n'));
    const typeNode = result.root.children?.find((child) => child.type === 'type');
    expect(typeNode?.props).not.toHaveProperty('export');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DROPPED_DECORATOR', severity: 'warning' })]),
    );
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'DROPPED_DECORATOR')?.col).toBe(
      'export '.length + 1,
    );
  });

  test('first-class imports and exported functions are schema-valid after canonicalization', () => {
    const root = parseDocumentStrict(
      [
        'import { Users } from "./users.kern"',
        'import type { User } from "./types.kern"',
        'export @http.get("/users/:id")',
        'fn getUser(id: string): User',
        '  let user = Users.get(id)?',
        '  return user',
      ].join('\n'),
    );

    expect(validateSchema(root)).toEqual([]);
  });
});
