import { parseDocumentWithDiagnostics } from '../../core/src/parser.js';
import { generatePythonCoreNode } from '../src/codegen-python.js';

describe('FastAPI KERN module re-export metadata', () => {
  test('generates Python re-exports from resolved KERN symbol metadata', () => {
    const result = parseDocumentWithDiagnostics(
      ['module name=auth', '  export from="./roles.kern" names="hasRole" types="Role"'].join('\n'),
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

    expect(output).toContain('from .roles import has_role');
    expect(output).toContain('from .roles import Role');
  });
});
