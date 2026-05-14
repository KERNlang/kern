import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';

function rulesFor(source: string): string[] {
  return validateSemantics(parseDocumentWithDiagnostics(source).root).map((v) => v.rule);
}

describe('semantic-validator — module export cross references', () => {
  test('accepts local exports that reference declarations in the same module', () => {
    const source = [
      'module name=domain',
      '  fn name=makeUser returns=string',
      '    handler <<<',
      '      return "ok"',
      '    >>>',
      '  type name=UserProfile values="{ id: string }"',
      '  export names=makeUser types=UserProfile',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('export-local-unknown-symbol');
  });

  test('accepts local exports that reference imported use aliases', () => {
    const source = [
      'module name=domain',
      '  use path="./parser"',
      '    from name=parseUser as=parse',
      '  export names=parse',
    ].join('\n');

    expect(rulesFor(source)).toEqual([]);
  });

  test('accepts local exports that reference external import bindings', () => {
    const source = [
      'module name=domain',
      '  import from=zod names=z',
      '  import from=react default=React',
      '  export names="z,React"',
    ].join('\n');

    expect(rulesFor(source)).toEqual([]);
  });

  test('treats canonical import aliases as visible local bindings', () => {
    const source = ['module name=domain', '  import from=zod names="z as schema"', '  export names=schema'].join('\n');

    expect(rulesFor(source)).not.toContain('export-local-unknown-symbol');
  });

  test('first-class external import aliases count as local export names', () => {
    const source = [
      'module name=domain',
      '  import { Component as ReactComponent } from "react"',
      '  export names=ReactComponent',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('export-local-unknown-symbol');
  });

  test('first-class Python import symbols count as local export names', () => {
    const source = ['module name=mathApi', '  import py "math" names=sqrt', '  export names=sqrt'].join('\n');

    expect(rulesFor(source)).not.toContain('export-local-unknown-symbol');
  });

  test('sidecar island Python symbols count as local export names', () => {
    const source = [
      'module name=metrics',
      '  island sidecar PyMetrics runtime=python requiresSidecar=true',
      '    import py "statistics" names="mean as pyMean"',
      '  export names=pyMean',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('export-local-unknown-symbol');
  });

  test('reports duplicate first-class external import local names', () => {
    const source = [
      'module name=dupes',
      '  import npm "lodash" as helper',
      '  import py "helpers" as helper',
      '  export names=helper',
    ].join('\n');
    const violations = validateSemantics(parseDocumentWithDiagnostics(source).root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'external-import-local-conflict',
          message: expect.stringContaining("External import local name 'helper'"),
        }),
      ]),
    );
    expect(violations.map((violation) => violation.rule)).not.toContain('export-local-unknown-symbol');
  });

  test('accepts same-name external value and type imports as separate namespaces', () => {
    const source = [
      'module name=typing',
      '  import py "numpy" names=NDArray',
      '  import py "numpy.typing" names=NDArray types=true',
      '  export names=NDArray',
      '  export types=NDArray',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('external-import-local-conflict');
  });

  test('reports duplicate type-only external import local names', () => {
    const source = [
      'module name=typing',
      '  import py "numpy.typing" names=NDArray types=true',
      '  import py "custom.typing" names=NDArray types=true',
      '  export types=NDArray',
    ].join('\n');

    expect(rulesFor(source)).toContain('external-import-local-conflict');
  });

  test('reports only the conflicting external namespace in mixed value and type diagnostics', () => {
    const source = [
      'module name=typing',
      '  import py "numpy" names=NDArray',
      '  import py "numpy.typing" names=NDArray types=true',
      '  import py "custom.typing" names=NDArray types=true',
      '  export types=NDArray',
    ].join('\n');
    const violations = validateSemantics(parseDocumentWithDiagnostics(source).root);
    const conflict = violations.find((violation) => violation.rule === 'external-import-local-conflict');

    expect(conflict?.message).toContain('pypi:numpy.typing#NDArray');
    expect(conflict?.message).toContain('pypi:custom.typing#NDArray');
    expect(conflict?.message).not.toContain('pypi:numpy#NDArray');
  });

  test('reports local exports that reference unknown symbols', () => {
    const source = ['module name=domain', '  export names=missing'].join('\n');
    const violations = validateSemantics(parseDocumentWithDiagnostics(source).root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'export-local-unknown-symbol',
          nodeType: 'export',
          message: expect.stringContaining("unknown symbol 'missing'"),
        }),
      ]),
    );
  });

  test('reports invalid export binding syntax before codegen', () => {
    const source = [
      'module name=domain',
      '  fn name=makeUser returns=string',
      '    handler <<<',
      '      return "ok"',
      '    >>>',
      '  export names="makeUser as"',
    ].join('\n');
    const violations = validateSemantics(parseDocumentWithDiagnostics(source).root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'export-binding-invalid',
          message: expect.stringContaining('makeUser as'),
        }),
      ]),
    );
    expect(violations.filter((v) => v.rule === 'export-binding-invalid')).toHaveLength(1);
  });

  test('reports resolver-enriched re-exports that name missing source symbols', () => {
    const source = ['module name=domain', '  export from="./parser.kern" names="missing as parse"'].join('\n');
    const result = parseDocumentWithDiagnostics(source, undefined, {
      resolveImport: (path) =>
        path === './parser.kern'
          ? {
              symbols: new Map([['parseUser', { name: 'parseUser', kind: 'fn' }]]),
              resultFns: new Set(['parseUser']),
              optionFns: new Set(),
            }
          : null,
    });
    const violations = validateSemantics(result.root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'export-from-unknown-symbol',
          message: expect.stringContaining('does not include that symbol'),
        }),
      ]),
    );
  });

  test('parser records resolved export names for semantic re-export validation', () => {
    const source = ['module name=domain', '  export from="./parser.kern" names=parseUser'].join('\n');
    const result = parseDocumentWithDiagnostics(source, undefined, {
      resolveImport: (path) =>
        path === './parser.kern'
          ? {
              symbols: new Map([['parseUser', { name: 'parseUser', kind: 'fn' }]]),
              resultFns: new Set(['parseUser']),
              optionFns: new Set(),
            }
          : null,
    });

    expect(result.root.children?.[0]?.children?.[0]).toMatchObject({
      type: 'export',
      props: { resolvedExportNames: 'parseUser' },
    });
  });

  test('does not reject unresolved external re-exports without resolver metadata', () => {
    const source = ['module name=domain', '  export from="@vendor/pkg" names=missing'].join('\n');

    expect(rulesFor(source)).toEqual([]);
  });

  test('reports re-exports from resolved empty modules', () => {
    const source = ['module name=domain', '  export from="./empty.kern" names=missing'].join('\n');
    const result = parseDocumentWithDiagnostics(source, undefined, {
      resolveImport: (path) =>
        path === './empty.kern'
          ? {
              symbols: new Map(),
              resultFns: new Set(),
              optionFns: new Set(),
            }
          : null,
    });
    const violations = validateSemantics(result.root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'export-from-unknown-symbol',
          message: expect.stringContaining("Re-export references 'missing'"),
        }),
      ]),
    );
  });

  test('does not reject default re-exports before default metadata exists', () => {
    const source = ['module name=domain', '  export from="./client.kern" default=Client'].join('\n');
    const result = parseDocumentWithDiagnostics(source, undefined, {
      resolveImport: (path) =>
        path === './client.kern'
          ? {
              symbols: new Map([['Client', { name: 'Client', kind: 'class' }]]),
              resultFns: new Set(),
              optionFns: new Set(),
            }
          : null,
    });

    expect(validateSemantics(result.root).map((v) => v.rule)).not.toContain('export-from-unknown-symbol');
  });

  test('accepts local default exports that reference visible names', () => {
    const source = [
      'module name=domain',
      '  fn name=makeUser returns=string',
      '    handler <<<',
      '      return "ok"',
      '    >>>',
      '  export default=makeUser',
    ].join('\n');

    expect(rulesFor(source)).toEqual([]);
  });

  test('reports local default exports that reference unknown symbols', () => {
    const source = ['module name=domain', '  export default=missing'].join('\n');
    const violations = validateSemantics(parseDocumentWithDiagnostics(source).root);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'export-local-unknown-symbol',
          nodeType: 'export',
          message: expect.stringContaining("unknown symbol 'missing'"),
        }),
      ]),
    );
    expect(violations.filter((v) => v.rule === 'export-local-unknown-symbol')).toHaveLength(1);
  });
});
