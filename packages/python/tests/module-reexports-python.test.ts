import { parseDocumentWithDiagnostics } from '../../core/src/parser.js';
import { generatePythonCoreNode } from '../src/codegen-python.js';

describe('FastAPI KERN module re-export metadata', () => {
  test('generates parent-relative Python module imports with correct dot depth', () => {
    const oneUp = parseDocumentWithDiagnostics('use path="../setup.kern"').root.children?.[0];
    const twoUp = parseDocumentWithDiagnostics('use path="../../pkg/setup.kern"').root.children?.[0];

    expect(oneUp ? generatePythonCoreNode(oneUp).join('\n') : '').toBe('from .. import setup');
    expect(twoUp ? generatePythonCoreNode(twoUp).join('\n') : '').toBe('from ...pkg import setup');
  });

  test('combines local value and type exports into one Python __all__ list', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      [
        'module name=domain',
        '  fn name=makeUser returns=string',
        '    handler <<<',
        '      return "ok"',
        '    >>>',
        '  type name=UserProfile values="{ id: string }"',
        '  export names=makeUser types=UserProfile',
      ].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain('__all__ = ["make_user", "UserProfile"]');
    expect(output.match(/__all__ =/gu)).toHaveLength(1);
  });

  test('deduplicates repeated local public exports', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      [
        'module name=domain',
        '  type name=UserProfile values="{ id: string }"',
        '  export names=UserProfile types=UserProfile',
      ].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain('__all__ = ["UserProfile"]');
  });

  test('combines multiple local export nodes into one Python __all__ list', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      [
        'module name=domain',
        '  fn name=makeUser returns=string',
        '    handler <<<',
        '      return "ok"',
        '    >>>',
        '  type name=UserProfile values="{ id: string }"',
        '  export names=makeUser',
        '  export types=UserProfile',
      ].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain('__all__ = ["make_user", "UserProfile"]');
    expect(output.match(/__all__ =/gu)).toHaveLength(1);
  });

  test('documents unsupported default re-exports instead of emitting invalid Python', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      ['module name=domain', '  export from="./client.kern" default=Client'].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain("# KERN TODO: default re-export 'Client' from .client is not representable in Python");
    expect(output).not.toContain('import default as Client');
  });

  test('local export aliases create Python bindings and public __all__ aliases', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      [
        'module name=domain',
        '  fn name=makeUser returns=string',
        '    handler <<<',
        '      return "ok"',
        '    >>>',
        '  export names="makeUser as buildUser"',
      ].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain('buildUser = make_user');
    expect(output).toContain('__all__ = ["buildUser"]');
    expect(output).not.toContain('__all__ = ["make_user as buildUser"]');
  });

  test('local export aliases are emitted after local declarations', () => {
    const moduleNode = parseDocumentWithDiagnostics(
      [
        'module name=domain',
        '  export names="makeUser as buildUser"',
        '  fn name=makeUser returns=string',
        '    handler <<<',
        '      return "ok"',
        '    >>>',
      ].join('\n'),
    ).root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output.indexOf('def make_user() -> str:')).toBeLessThan(output.indexOf('buildUser = make_user'));
    expect(output).toContain('__all__ = ["buildUser"]');
  });

  test('generates Python imports from resolved public target emitted name metadata', () => {
    const result = parseDocumentWithDiagnostics(
      ['use path="./index.kern"', '  from name=parseUserPublic'].join('\n'),
      undefined,
      {
        resolveImport: (path) =>
          path === './index.kern'
            ? {
                symbols: new Map([
                  [
                    'parseUserPublic',
                    {
                      name: 'parseUserPublic',
                      sourceName: 'parseUser',
                      kind: 'fn',
                      targetNames: { python: 'parseUserPublic', ts: 'parseUserPublic' },
                    },
                  ],
                ]),
                resultFns: new Set(),
                optionFns: new Set(),
              }
            : null,
      },
    );
    const useNode = result.root.children?.[0];
    const lines = useNode ? generatePythonCoreNode(useNode) : [];

    expect(lines.join('\n')).toBe('from .index import parseUserPublic');
  });

  test('generates Python re-exports from resolved KERN symbol metadata', () => {
    const result = parseDocumentWithDiagnostics(
      ['module name=auth', '  export from="./roles.kern" names="hasRole as checkRole" types="Role as AuthRole"'].join(
        '\n',
      ),
      undefined,
      {
        resolveImport: (path) =>
          path === './roles.kern'
            ? {
                symbols: new Map([
                  ['hasRole', { name: 'hasRole', kind: 'fn' }],
                  ['Role', { name: 'Role', kind: 'type' }],
                ]),
                resultFns: new Set(),
                optionFns: new Set(),
              }
            : null,
      },
    );
    const moduleNode = result.root.children?.[0];
    const output = moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';

    expect(output).toContain('from .roles import has_role as checkRole');
    expect(output).toContain('from .roles import Role as AuthRole');
    expect(output).toContain('__all__ = ["checkRole", "AuthRole"]');
  });
});
