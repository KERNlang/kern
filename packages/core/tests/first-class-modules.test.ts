import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { parse, parseDocument, parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
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
    expect(generateCoreNode(node).join('\n')).toBe(`import { Users, Roles as UserRoles } from './users.js';`);
  });

  test('root first-class .kern import canonicalizes through parse()', () => {
    const node = parse('import { Users } from "./users.kern"');

    expect(node).toMatchObject({
      type: 'use',
      props: { path: './users.kern' },
      children: [{ type: 'from', props: { name: 'Users' } }],
    });
    expect(generateCoreNode(node).join('\n')).toBe(`import { Users } from './users.js';`);
  });

  test('root first-class .kern import keeps parse() sibling children', () => {
    // Multi-top-level sources now auto-promote to a document root (see
    // parser-core.ts:903 — hasSiblingTopLevel). The first-class import is
    // canonicalized to `use` and the top-level `fn` is a true sibling
    // instead of being mis-nested as a child of `use`.
    const node = parse(
      ['import { Users } from "./users.kern"', 'fn getUser(): User', '  return Users.get()'].join('\n'),
    );

    expect(node).toMatchObject({
      type: 'document',
      children: [
        { type: 'use', children: [{ type: 'from', props: { name: 'Users' } }] },
        { type: 'fn', props: { name: 'getUser' } },
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

  test('foreign npm import sugar lowers to external import metadata', () => {
    const node = firstChild(
      'import npm "zod" as z version=3 review=known reason="schema validation" runtime=node effects=[validation] serialization=json requiresSidecar=false',
    );

    expect(node).toMatchObject({
      type: 'import',
      props: {
        from: 'zod',
        package: 'zod',
        registry: 'npm',
        target: 'ts',
        default: 'z',
        version: '3',
        review: 'known',
        reason: 'schema validation',
        runtime: 'node',
        effects: '[validation]',
        serialization: 'json',
        requiresSidecar: false,
      },
    });
    expect(node.props).not.toHaveProperty('__firstClassImport');
    expect(generateCoreNode(node).join('\n')).toBe(`import z from 'zod';`);
  });

  test('foreign py import sugar lowers to PyPI metadata and emits callable TS sidecar codegen', () => {
    const node = firstChild('import py "pandas" as pd');

    expect(node).toMatchObject({
      type: 'import',
      props: { from: 'pandas', package: 'pandas', registry: 'pypi', target: 'python', default: 'pd' },
    });
    expect(node.props).not.toHaveProperty('__firstClassImport');
    const output = generateCoreNode(node).join('\n');
    expect(output).toContain('export const pdPandasSidecarManifest = {');
    expect(output).toContain('export const pd = pdPandasSidecarClient.module("pandas");');
    expect(output).not.toContain("from 'pandas'");
  });

  test('capability island syntax records kind/name and emits supported child imports', () => {
    const node = firstChild(
      [
        'island engine Claude runtime=node effects=[network,stream,secret] serialization=stream',
        '  import npm "@anthropic-ai/sdk" as Anthropic',
      ].join('\n'),
    );

    expect(node).toMatchObject({
      type: 'island',
      props: {
        kind: 'engine',
        name: 'Claude',
        runtime: 'node',
        effects: '[network,stream,secret]',
        serialization: 'stream',
      },
      children: [
        {
          type: 'import',
          props: {
            from: '@anthropic-ai/sdk',
            package: '@anthropic-ai/sdk',
            registry: 'npm',
            target: 'ts',
            default: 'Anthropic',
          },
        },
      ],
    });
    expect(generateCoreNode(node).join('\n')).toBe(`import Anthropic from '@anthropic-ai/sdk';`);
  });

  test('capability effects do not trigger pure-function effects diagnostics', () => {
    const result = parseDocumentWithDiagnostics(
      [
        'import npm "zod" as z effects=[validation]',
        'extern package=react registry=npm effects=[state]',
        'island engine OpenCode runtime=node effects=[exec,stream,fs] requiresSidecar=true',
      ].join('\n'),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'INVALID_EFFECTS')).toEqual([]);
  });

  test('capability island kind is optional in positional syntax', () => {
    const node = firstChild('island Claude runtime=node effects=[network]');

    expect(node).toMatchObject({
      type: 'island',
      props: {
        name: 'Claude',
        runtime: 'node',
        effects: '[network]',
      },
    });
    expect(node.props).not.toHaveProperty('kind');
  });

  test('capability island known kind without a name stays invalid', () => {
    const node = firstChild('island engine runtime=node');

    expect(node).toMatchObject({
      type: 'island',
      props: { kind: 'engine', runtime: 'node' },
    });
    expect(node.props).not.toHaveProperty('name');
  });

  test('capability island decompiles to parseable syntax', () => {
    const node = parse('island engine Claude runtime=node effects=[network] serialization=json');
    const code = decompile(node).code;

    expect(code).toBe('island engine Claude runtime=node effects="[network]" serialization=json');
    expect(parse(code)).toMatchObject({
      type: 'island',
      props: { kind: 'engine', name: 'Claude', runtime: 'node', effects: '[network]', serialization: 'json' },
    });
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
