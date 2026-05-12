import { generateCoreNode } from '../src/codegen-core.js';
import { importTypeScript } from '../src/importer.js';
import { parseDocument, parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function firstFn(source: string): IRNode {
  const root = parseDocument(source);
  const fn = root.children?.find((child) => child.type === 'fn');
  if (!fn) throw new Error('expected fn node');
  return fn;
}

describe('first-class KERN syntax', () => {
  test('fn signature syntax lowers to canonical fn props', () => {
    const fn = firstFn('fn add(a: number, b: number): number');
    expect(fn.props).toMatchObject({
      name: 'add',
      params: 'a:number,b:number',
      returns: 'number',
    });
  });

  test('decorators attach to the following fn as metadata children', () => {
    const fn = firstFn(['@http.get("/users/:id")', 'fn getUser(id: string): User'].join('\n'));
    expect(fn.props).toMatchObject({
      name: 'getUser',
      params: 'id:string',
      returns: 'User',
    });
    expect(fn.children?.[0]).toMatchObject({
      type: 'decorator',
      props: { name: 'http.get', args: '"/users/:id"' },
    });
  });

  test('fn signature syntax handles nested generics and trailing props', () => {
    const fn = firstFn('fn pair<T extends Map<K, V>>(x: T): T async=true export=false');
    expect(fn.props).toMatchObject({
      name: 'pair',
      generics: '<T extends Map<K, V>>',
      params: 'x:T',
      returns: 'T',
      async: true,
      export: false,
    });
  });

  test('fn signature syntax handles arrow function types inside type annotations', () => {
    expect(firstFn('fn run<T extends () => void>(callback: T): () => void async=true').props).toMatchObject({
      name: 'run',
      generics: '<T extends () => void>',
      params: 'callback:T',
      returns: '() => void',
      async: true,
    });
  });

  test('signature syntax reuses existing TypeScript fn codegen', () => {
    expect(generateCoreNode(firstFn('fn add(a: number, b: number): number')).join('\n')).toBe(
      ['export function add(a: number, b: number): number {', '}'].join('\n'),
    );
  });

  test('TypeScript codegen preserves decorator metadata as comments', () => {
    expect(
      generateCoreNode(firstFn(['@http.get("/users/:id")', 'fn getUser(id: string): User'].join('\n'))).join('\n'),
    ).toContain('// @http.get("/users/:id")');
  });

  test('TypeScript import preserves function decorators as KERN metadata', () => {
    const imported = importTypeScript(
      ['@http.get("/users/:id")', 'export function getUser(id: string): User {', '  return { id } as User;', '}'].join(
        '\n',
      ),
    ).kern;
    expect(imported).toContain('@http.get("/users/:id")');
    const fn = firstFn(imported);
    expect(fn.children?.[0]).toMatchObject({
      type: 'decorator',
      props: { name: 'http.get', args: '"/users/:id"' },
    });
  });

  test('TypeScript import preserves KERN decorator comments from generated TS', () => {
    const imported = importTypeScript(
      [
        '// @http.get("/users/:id")',
        'export function getUser(id: string): User {',
        '  return { id } as User;',
        '}',
      ].join('\n'),
    ).kern;
    expect(imported).toContain('@http.get("/users/:id")');
  });

  test('decorator before non-fn reports a warning instead of disappearing silently', () => {
    const result = parseDocumentWithDiagnostics(['@deprecated', 'type name=User alias=string'].join('\n'));
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DROPPED_DECORATOR',
          severity: 'warning',
        }),
      ]),
    );
  });

  test('orphan and wrong-indented decorators report warnings', () => {
    expect(parseDocumentWithDiagnostics('@deprecated').diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DROPPED_DECORATOR', severity: 'warning' })]),
    );

    const result = parseDocumentWithDiagnostics(['  @deprecated', 'fn run(): void'].join('\n'));
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DROPPED_DECORATOR', severity: 'warning' })]),
    );
  });

  test('empty decorator argument lists are preserved', () => {
    const fn = firstFn(['@deprecated()', 'fn run(): void'].join('\n'));
    expect(fn.children?.[0]).toMatchObject({ type: 'decorator', props: { name: 'deprecated', args: '' } });
    expect(generateCoreNode(fn).join('\n')).toContain('// @deprecated()');
  });
});
