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

  it('builds external boundary shapes from normalized metadata and inherited props', () => {
    expect(
      generated.externalBoundaryFromParts(
        'local_engine',
        'pypi',
        'python',
        'python',
        {
          args: '[codex]',
          effects: '[fs,cpu]',
          serialization: 'ndjson',
          requiresSidecar: 'true',
          version: '2',
          review: 'known',
          reason: 'runtime bridge',
        },
        {
          name: 'Multi',
          kind: 'sidecar',
          runtime: 'python',
          protocol: 'pty-session',
          module: 'kern_engines.cli.daemon',
          args: ['claude'],
          session: 'Session',
          options: 'Options',
          error: 'ErrorShape',
          timeout: 'TimeoutShape',
          effects: ['exec', 'fs'],
          serialization: 'json',
          requiresSidecar: false,
          line: 1,
          col: 1,
        },
        [{ names: ['run'], types: false, line: 2, col: 3 }],
        2,
        3,
      ),
    ).toEqual({
      package: 'local_engine',
      registry: 'pypi',
      target: 'python',
      targetFamily: 'python',
      island: {
        name: 'Multi',
        kind: 'sidecar',
        runtime: 'python',
        protocol: 'pty-session',
        module: 'kern_engines.cli.daemon',
        args: ['claude'],
        session: 'Session',
        options: 'Options',
        error: 'ErrorShape',
        timeout: 'TimeoutShape',
        effects: ['exec', 'fs'],
        serialization: 'json',
        requiresSidecar: false,
        line: 1,
        col: 1,
      },
      runtime: 'python',
      protocol: 'pty-session',
      module: 'kern_engines.cli.daemon',
      args: ['codex'],
      session: 'Session',
      options: 'Options',
      error: 'ErrorShape',
      timeout: 'TimeoutShape',
      effects: ['exec', 'fs', 'cpu'],
      serialization: 'ndjson',
      requiresSidecar: true,
      version: '2',
      review: 'known',
      reason: 'runtime bridge',
      imports: [{ names: ['run'], types: false, line: 2, col: 3 }],
      line: 2,
      col: 3,
    });
  });

  it('builds external boundary shapes without island inheritance', () => {
    expect(
      generated.externalBoundaryFromParts(
        'react',
        'npm',
        'react',
        'ts',
        { names: 'useState' },
        undefined,
        [{ names: ['useState'], types: false }],
        undefined,
        undefined,
      ),
    ).toMatchObject({
      package: 'react',
      registry: 'npm',
      target: 'react',
      targetFamily: 'ts',
      effects: [],
      requiresSidecar: false,
      imports: [{ names: ['useState'], types: false }],
    });
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
        effects: [],
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
      effects: [],
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

  it('builds sidecar manifests from eligible python islands', () => {
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'ignored',
        runtime: 'python',
        effects: [],
        requiresSidecar: false,
        imports: [],
      }),
    ).toBeNull();
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'ignored',
        runtime: 'node',
        effects: [],
        requiresSidecar: true,
        imports: [],
      }),
    ).toBeNull();
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'ignored',
        runtime: 'python',
        effects: [],
        requiresSidecar: true,
        imports: [],
      }),
    ).toBeNull();
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'typeOnly',
        runtime: 'python',
        effects: [],
        requiresSidecar: true,
        imports: [
          {
            package: 'numpy',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            effects: [],
            requiresSidecar: true,
            imports: [{ names: ['NDArray'], types: true }],
          },
        ],
      }),
    ).toBeNull();
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'mixed',
        runtime: 'python',
        effects: ['fs'],
        requiresSidecar: true,
        imports: [
          {
            package: 'numpy',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            effects: ['fs'],
            requiresSidecar: true,
            imports: [{ names: ['array'], types: false }],
          },
          {
            package: 'react',
            registry: 'npm',
            target: 'react',
            targetFamily: 'ts',
            requiresSidecar: true,
            imports: [{ names: ['useState'], types: false }],
          },
        ],
      })?.packages,
    ).toEqual([
      {
        package: 'numpy',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [{ names: ['array'], types: false }],
      },
    ]);

    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'tracks',
        kind: 'sidecar',
        runtime: 'python',
        protocol: 'stdio',
        module: 'svc.tracks',
        args: ['--debug'],
        session: 'session',
        options: 'options',
        error: 'error',
        timeout: '10s',
        effects: ['fs'],
        serialization: 'json',
        requiresSidecar: true,
        imports: [
          {
            package: 'numpy',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            effects: ['fs'],
            requiresSidecar: true,
            imports: [{ names: ['NDArray'], types: true }, { names: ['array'], types: false }],
            version: '2',
            line: 7,
            col: 2,
          },
        ],
        line: 5,
        col: 1,
      }),
    ).toEqual({
      name: 'tracks',
      kind: 'sidecar',
      runtime: 'python',
      protocol: 'stdio',
      module: 'svc.tracks',
      args: ['--debug'],
      session: 'session',
      options: 'options',
      error: 'error',
      timeout: '10s',
      effects: ['fs'],
      serialization: 'json',
      requiresSidecar: true,
      packages: [
        {
          package: 'numpy',
          registry: 'pypi',
          target: 'python',
          targetFamily: 'python',
          imports: [{ names: ['array'], types: false }],
          version: '2',
          line: 7,
          col: 2,
        },
      ],
      line: 5,
      col: 1,
    });
  });

  it('keeps protocol-only python sidecar manifests', () => {
    expect(
      generated.externalSidecarManifestFromIsland({
        name: 'protocolOnly',
        runtime: 'python',
        protocol: 'stdio',
        effects: ['net'],
        requiresSidecar: true,
        imports: [],
      }),
    ).toEqual({
      name: 'protocolOnly',
      runtime: 'python',
      protocol: 'stdio',
      effects: ['net'],
      requiresSidecar: true,
      packages: [],
    });
  });

  it('builds loose sidecar manifests from explicit python package boundaries', () => {
    const sidecarPackage = {
      package: 'requests',
      registry: 'pypi' as const,
      target: 'python' as const,
      targetFamily: 'python' as const,
      imports: [{ names: ['get'], types: false }],
    };

    expect(
      generated.externalLooseSidecarManifestFromBoundary(
        'requestsSidecar',
        {
          package: 'requests',
          registry: 'pypi',
          target: 'python',
          targetFamily: 'python',
          imports: [{ names: ['get'], types: false }],
          effects: ['net'],
          line: 12,
          col: 4,
        },
        sidecarPackage,
      ),
    ).toEqual({
      name: 'requestsSidecar',
      kind: 'sidecar',
      runtime: 'python',
      effects: ['net'],
      serialization: 'json',
      requiresSidecar: true,
      packages: [sidecarPackage],
      line: 12,
      col: 4,
    });
    expect(
      generated.externalLooseSidecarManifestFromBoundary(
        'requestsSidecar',
        {
          package: 'requests',
          registry: 'pypi',
          target: 'python',
          targetFamily: 'python',
          imports: [{ names: ['get'], types: false }],
        },
        sidecarPackage,
      ).effects,
    ).toEqual([]);
  });

  it('merges loose sidecar manifest packages by key', () => {
    const manifest = {
      name: 'requestsSidecar',
      runtime: 'python',
      effects: ['net'],
      requiresSidecar: true as const,
      packages: [
        {
          package: 'requests',
          registry: 'pypi' as const,
          target: 'python' as const,
          targetFamily: 'python' as const,
          imports: [{ names: ['get'], types: false }],
        },
      ],
    };

    generated.mergeExternalSidecarManifestPackage(
      manifest,
      {
        package: 'requests',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [{ names: ['post'], types: false }],
        version: '2',
      },
      ['fs', 'net'],
    );
    generated.mergeExternalSidecarManifestPackage(
      manifest,
      {
        package: 'numpy',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [{ names: ['array'], types: false }],
      },
      ['cpu'],
    );
    generated.mergeExternalSidecarManifestPackage(
      manifest,
      {
        package: 'requests',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [],
      },
      undefined,
    );

    expect(manifest).toEqual({
      name: 'requestsSidecar',
      runtime: 'python',
      effects: ['net', 'fs', 'cpu'],
      requiresSidecar: true,
      packages: [
        {
          package: 'requests',
          registry: 'pypi',
          target: 'python',
          targetFamily: 'python',
          imports: [{ names: ['get'], types: false }, { names: ['post'], types: false }],
          version: '2',
        },
        {
          package: 'numpy',
          registry: 'pypi',
          target: 'python',
          targetFamily: 'python',
          imports: [{ names: ['array'], types: false }],
        },
      ],
    });
  });

  it('src facade delegates generated utility exports', () => {
    expect(facade.splitExternalNames).toBe(generated.splitExternalNames);
    expect(facade.externalBoundaryFromParts).toBe(generated.externalBoundaryFromParts);
    expect(facade.externalStringProp).toBe(generated.externalStringProp);
    expect(facade.externalBoolProp).toBe(generated.externalBoolProp);
    expect(facade.externalRuntimeImports).toBe(generated.externalRuntimeImports);
    expect(facade.externalLooseSidecarManifestFromBoundary).toBe(generated.externalLooseSidecarManifestFromBoundary);
    expect(facade.externalSidecarManifestFromIsland).toBe(generated.externalSidecarManifestFromIsland);
    expect(facade.externalSidecarPackageFromBoundary).toBe(generated.externalSidecarPackageFromBoundary);
    expect(facade.externalSidecarPackageKey).toBe(generated.externalSidecarPackageKey);
    expect(facade.mergeExternalSidecarManifestPackage).toBe(generated.mergeExternalSidecarManifestPackage);
    expect(facade.mergeExternalEffects).toBe(generated.mergeExternalEffects);
    expect(facade.inheritExternalString).toBe(generated.inheritExternalString);
    expect(facade.inheritExternalArgs).toBe(generated.inheritExternalArgs);
    expect(facade.hasExternalRuntimeImports).toBe(generated.hasExternalRuntimeImports);
    expect(facade.isPythonSidecarBoundaryShape).toBe(generated.isPythonSidecarBoundaryShape);
    expect(facade.isLoosePythonBoundaryShape).toBe(generated.isLoosePythonBoundaryShape);
  });
});
