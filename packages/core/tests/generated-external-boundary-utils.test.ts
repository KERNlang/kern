import * as facade from '../src/external-boundary-utils.js';
import * as generated from '../src/generated/utils/external-boundary-utils.js';

describe('generated external-boundary-utils behavior', () => {
  it('delegates name splitting through import metadata semantics', () => {
    expect(generated.splitExternalNames('fs, exec')).toEqual(['fs', 'exec']);
    expect(generated.splitExternalNames('[fs, exec]')).toEqual(['fs', 'exec']);
    expect(generated.splitExternalNames(undefined)).toEqual([]);
  });

  it('reads non-empty string props and boolean props', () => {
    const props = { runtime: 'python', empty: '', requiresSidecar: 'true', disabled: false };

    expect(generated.externalStringProp(props, 'runtime')).toBe('python');
    expect(generated.externalStringProp(props, 'empty')).toBeUndefined();
    expect(generated.externalBoolProp(props, 'requiresSidecar')).toBe(true);
    expect(generated.externalBoolProp(props, 'disabled')).toBe(false);
  });

  it('merges explicit effects after inherited island effects', () => {
    expect(
      generated.mergeExternalEffects(
        { effects: '[cpu, stream]' },
        { effects: ['fs', 'cpu'] },
      ),
    ).toEqual(['fs', 'cpu', 'stream']);
    expect(generated.mergeExternalEffects({ effects: 'cpu' }, undefined)).toEqual(['cpu']);
  });

  it('inherits strings and args from explicit props first, then island defaults', () => {
    const island = { runtime: 'python', serialization: 'json', args: ['session'] };

    expect(generated.inheritExternalString({ runtime: 'node' }, 'runtime', island)).toBe('node');
    expect(generated.inheritExternalString({}, 'serialization', island)).toBe('json');
    expect(generated.inheritExternalString({ serialization: '' }, 'serialization', island)).toBe('json');
    expect(generated.inheritExternalString({}, 'runtime', { runtime: '' })).toBe('');
    expect(generated.inheritExternalArgs({ args: '[local]' }, island)).toEqual(['local']);
    expect(generated.inheritExternalArgs({}, island)).toEqual(['session']);
    expect(generated.inheritExternalArgs({ args: 'local' }, undefined)).toEqual(['local']);
    expect(generated.inheritExternalArgs({}, undefined)).toBeUndefined();
  });

  it('detects runtime imports directly', () => {
    expect(generated.hasExternalRuntimeImports({ imports: [] })).toBe(false);
    expect(generated.hasExternalRuntimeImports({ imports: [{ names: [], types: true }] })).toBe(false);
    expect(generated.hasExternalRuntimeImports({ imports: [{ names: [], types: false }] })).toBe(true);
    expect(generated.hasExternalRuntimeImports({ imports: [{ names: [], types: true }, { names: [], types: false }] })).toBe(
      true,
    );
    expect(generated.externalRuntimeImports([])).toEqual([]);
    expect(generated.externalRuntimeImports([{ names: [], types: true }])).toEqual([]);
    expect(generated.externalRuntimeImports([{ names: ['sqrt'], types: false }])).toEqual([
      { names: ['sqrt'], types: false },
    ]);
  });

  it('classifies sidecar boundary runtime shapes', () => {
    expect(
      generated.isPythonSidecarBoundaryShape({
        requiresSidecar: true,
        imports: [{ names: [], types: false }],
        targetFamily: 'python',
      }),
    ).toBe(true);
    expect(
      generated.isPythonSidecarBoundaryShape({
        requiresSidecar: true,
        imports: [{ names: [], types: true }],
        targetFamily: 'python',
      }),
    ).toBe(false);
    expect(
      generated.isLoosePythonBoundaryShape({
        explicitPackage: true,
        imports: [{ names: [], types: false }],
        registry: 'pypi',
      }),
    ).toBe(true);
    expect(
      generated.isLoosePythonBoundaryShape({
        explicitPackage: true,
        island: {},
        imports: [{ names: [], types: false }],
        registry: 'pypi',
      }),
    ).toBe(false);
  });

  it('builds sidecar package shapes from runtime imports only', () => {
    expect(
      generated.externalSidecarPackageFromBoundary({
        package: 'math',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [{ names: ['NDArray'], types: true }, { names: ['sqrt'], types: false }],
        version: '3',
        line: 10,
        col: 3,
      }),
    ).toEqual({
      package: 'math',
      registry: 'pypi',
      target: 'python',
      targetFamily: 'python',
      imports: [{ names: ['sqrt'], types: false }],
      version: '3',
      line: 10,
      col: 3,
    });
  });

  it('omits sidecar package optional fields when not present', () => {
    const sidecarPackage = generated.externalSidecarPackageFromBoundary({
      package: 'math',
      registry: 'pypi',
      target: 'python',
      targetFamily: 'python',
      imports: [{ names: ['sqrt'], types: false }],
    });

    expect(sidecarPackage).toEqual({
      package: 'math',
      registry: 'pypi',
      target: 'python',
      targetFamily: 'python',
      imports: [{ names: ['sqrt'], types: false }],
    });
    expect('version' in sidecarPackage).toBe(false);
    expect('line' in sidecarPackage).toBe(false);
    expect('col' in sidecarPackage).toBe(false);
  });

  it('keys sidecar packages by package registry and target', () => {
    expect(
      generated.externalSidecarPackageKey({
        package: 'math',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [],
      }),
    ).toBe('math\0pypi\0python');
  });

  it('src facade delegates generated utility exports', () => {
    expect(facade.splitExternalNames).toBe(generated.splitExternalNames);
    expect(facade.externalStringProp).toBe(generated.externalStringProp);
    expect(facade.externalBoolProp).toBe(generated.externalBoolProp);
    expect(facade.externalRuntimeImports).toBe(generated.externalRuntimeImports);
    expect(facade.externalSidecarPackageFromBoundary).toBe(generated.externalSidecarPackageFromBoundary);
    expect(facade.externalSidecarPackageKey).toBe(generated.externalSidecarPackageKey);
    expect(facade.mergeExternalEffects).toBe(generated.mergeExternalEffects);
    expect(facade.inheritExternalString).toBe(generated.inheritExternalString);
    expect(facade.inheritExternalArgs).toBe(generated.inheritExternalArgs);
    expect(facade.hasExternalRuntimeImports).toBe(generated.hasExternalRuntimeImports);
    expect(facade.isPythonSidecarBoundaryShape).toBe(generated.isPythonSidecarBoundaryShape);
    expect(facade.isLoosePythonBoundaryShape).toBe(generated.isLoosePythonBoundaryShape);
  });
});
