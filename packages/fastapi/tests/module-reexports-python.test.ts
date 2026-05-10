import { parseDocumentWithDiagnostics } from '../../core/src/parser.js';
import { generatePythonCoreNode } from '../src/codegen-python.js';

describe('FastAPI KERN module re-export metadata', () => {
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
  });
});
