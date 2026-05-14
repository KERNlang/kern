import {
  collectCapabilityIslands,
  collectExternalBoundaries,
  collectSidecarManifests,
} from '../src/external-boundary.js';
import { collectExternalImportSymbols, externalSignatureDiagnostics } from '../src/external-symbols.js';
import { parse } from '../src/parser.js';

describe('external boundary collection', () => {
  it('collects direct foreign import metadata', () => {
    const root = parse(
      [
        'import npm "zod" as z version=3 review=known reason="schema validation" runtime=node effects=validation serialization=json',
        'import py "pandas" as pd runtime=python effects="fs,cpu" serialization=stream',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toEqual([
      {
        package: 'zod',
        registry: 'npm',
        target: 'ts',
        targetFamily: 'ts',
        runtime: 'node',
        effects: ['validation'],
        serialization: 'json',
        requiresSidecar: false,
        version: '3',
        review: 'known',
        reason: 'schema validation',
        imports: [
          {
            default: 'z',
            from: 'zod',
            names: [],
            types: false,
            line: 1,
            col: 1,
          },
        ],
        line: 1,
        col: 1,
      },
      {
        package: 'pandas',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        runtime: 'python',
        effects: ['fs', 'cpu'],
        serialization: 'stream',
        requiresSidecar: false,
        imports: [
          {
            default: 'pd',
            from: 'pandas',
            names: [],
            types: false,
            line: 2,
            col: 1,
          },
        ],
        line: 2,
        col: 1,
      },
    ]);
  });

  it('collects inline extern package metadata', () => {
    const root = parse(
      [
        'module name=app',
        '  extern package=react registry=npm target=react version=18 review=known reason=ui names="useState,useEffect"',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toEqual([
      {
        package: 'react',
        registry: 'npm',
        target: 'react',
        targetFamily: 'ts',
        version: '18',
        review: 'known',
        reason: 'ui',
        effects: [],
        requiresSidecar: false,
        imports: [
          {
            names: ['useState', 'useEffect'],
            types: false,
            line: 2,
            col: 3,
          },
        ],
        line: 2,
        col: 3,
      },
    ]);
  });

  it('collects child import bindings under the parent boundary', () => {
    const root = parse(
      [
        'module name=api',
        '  extern package=numpy registry=pypi target=fastapi',
        '    import default=np names=array',
        '    import from=numpy.typing names=NDArray types=true',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toEqual([
      {
        package: 'numpy',
        registry: 'pypi',
        target: 'fastapi',
        targetFamily: 'python',
        effects: [],
        requiresSidecar: false,
        imports: [
          {
            default: 'np',
            names: ['array'],
            types: false,
            line: 3,
            col: 5,
          },
          {
            from: 'numpy.typing',
            names: ['NDArray'],
            types: true,
            line: 4,
            col: 5,
          },
        ],
        line: 2,
        col: 3,
      },
    ]);
  });

  it('walks nested modules and preserves invalid target family for review', () => {
    const root = parse(
      [
        'module name=outer',
        '  module name=inner',
        '    extern package=broken registry=npm target=reacts names=useState',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toMatchObject([
      {
        package: 'broken',
        registry: 'npm',
        target: 'all',
        targetFamily: 'none',
        effects: [],
        requiresSidecar: false,
        imports: [{ names: ['useState'], types: false }],
      },
    ]);
  });

  it('collects capability islands with bracket-list effects and child imports', () => {
    const root = parse(
      [
        'island engine Claude runtime=node effects=[network,stream,secret] serialization=stream requiresSidecar=false review=known reason="provider boundary"',
        '  import npm "@anthropic-ai/sdk" as Anthropic',
      ].join('\n'),
    );

    expect(collectCapabilityIslands(root)).toEqual([
      {
        name: 'Claude',
        kind: 'engine',
        runtime: 'node',
        effects: ['network', 'stream', 'secret'],
        serialization: 'stream',
        requiresSidecar: false,
        review: 'known',
        reason: 'provider boundary',
        imports: [
          {
            package: '@anthropic-ai/sdk',
            registry: 'npm',
            target: 'ts',
            targetFamily: 'ts',
            island: {
              name: 'Claude',
              kind: 'engine',
              runtime: 'node',
              effects: ['network', 'stream', 'secret'],
              serialization: 'stream',
              requiresSidecar: false,
              review: 'known',
              reason: 'provider boundary',
              line: 1,
              col: 1,
            },
            runtime: 'node',
            effects: ['network', 'stream', 'secret'],
            serialization: 'stream',
            review: 'known',
            reason: 'provider boundary',
            requiresSidecar: false,
            imports: [
              {
                default: 'Anthropic',
                from: '@anthropic-ai/sdk',
                names: [],
                types: false,
                line: 2,
                col: 3,
              },
            ],
            line: 2,
            col: 3,
          },
        ],
        line: 1,
        col: 1,
      },
    ]);
  });

  it('preserves island context on external boundary collection', () => {
    const root = parse(
      [
        'island engine OpenCode runtime=node effects=[exec,stream,fs] serialization=stream requiresSidecar=true',
        '  import npm "opencode" as opencode',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toMatchObject([
      {
        package: 'opencode',
        registry: 'npm',
        targetFamily: 'ts',
        island: {
          name: 'OpenCode',
          kind: 'engine',
          effects: ['exec', 'stream', 'fs'],
          requiresSidecar: true,
        },
        runtime: 'node',
        effects: ['exec', 'stream', 'fs'],
        serialization: 'stream',
        requiresSidecar: true,
      },
    ]);
  });

  it('merges island and child import effects additively', () => {
    const root = parse(
      [
        'island engine Data runtime=node effects=[network,secret]',
        '  import npm "cache-lib" as cache effects=[fs]',
      ].join('\n'),
    );

    expect(collectExternalBoundaries(root)).toMatchObject([
      {
        package: 'cache-lib',
        effects: ['network', 'secret', 'fs'],
        island: {
          name: 'Data',
          effects: ['network', 'secret'],
        },
      },
    ]);
  });

  it('dogfoods AGON engines as capability islands', () => {
    const root = parse(
      [
        'module name=agonEngines',
        '  island engine Claude runtime=node effects=[network,stream,secret] serialization=stream',
        '    import npm "@anthropic-ai/sdk" as Anthropic',
        '  island engine Gemini runtime=node effects=[network,stream,secret] serialization=stream',
        '    import npm "@google/genai" as GoogleGenAI',
        '  island engine OpenCode runtime=node effects=[exec,stream,fs] serialization=stream requiresSidecar=true',
        '    import npm "opencode" as opencode',
        '  island engine MiniMax runtime=node effects=[network,stream,secret] serialization=stream',
        '    import npm "@minimax-ai/sdk" as MiniMax',
        '  island engine Zai runtime=node effects=[network,stream,secret] serialization=stream',
        '    import npm "zai-sdk" as zai',
        '  island engine Kimi runtime=node effects=[network,stream,secret] serialization=stream',
        '    import npm "@moonshotai/sdk" as Moonshot',
      ].join('\n'),
    );

    const islands = collectCapabilityIslands(root);
    expect(islands.map((island) => island.name)).toEqual(['Claude', 'Gemini', 'OpenCode', 'MiniMax', 'Zai', 'Kimi']);
    expect(islands.find((island) => island.name === 'OpenCode')).toMatchObject({
      kind: 'engine',
      runtime: 'node',
      effects: ['exec', 'stream', 'fs'],
      requiresSidecar: true,
    });
    expect(islands.every((island) => island.imports.length === 1)).toBe(true);
  });

  it('collects Python sidecar manifests for sidecar-backed capability islands', () => {
    const root = parse(
      [
        'island sidecar Demucs runtime=python effects=[fs,exec,stream] serialization=handle requiresSidecar=true',
        '  import py "demucs" as demucs',
        '  import py "fastapi" as FastAPI',
        '  import npm "zod" as z',
      ].join('\n'),
    );

    expect(collectSidecarManifests(root)).toEqual([
      {
        name: 'Demucs',
        kind: 'sidecar',
        runtime: 'python',
        effects: ['fs', 'exec', 'stream'],
        serialization: 'handle',
        requiresSidecar: true,
        packages: [
          {
            package: 'demucs',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            imports: [{ default: 'demucs', from: 'demucs', names: [], types: false, line: 2, col: 3 }],
            line: 2,
            col: 3,
          },
          {
            package: 'fastapi',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            imports: [{ default: 'FastAPI', from: 'fastapi', names: [], types: false, line: 3, col: 3 }],
            line: 3,
            col: 3,
          },
        ],
        line: 1,
        col: 1,
      },
    ]);
  });

  it('does not collect sidecar manifests for non-Python islands', () => {
    const root = parse(
      ['island sidecar NodeBridge runtime=node effects=[exec] requiresSidecar=true', '  import py "pandas" as pd'].join(
        '\n',
      ),
    );

    expect(collectSidecarManifests(root)).toEqual([]);
  });

  it('collects top-level Python imports as implicit sidecar manifests', () => {
    const root = parse('import py "pandas" as pd version=2 effects=[fs,cpu]');

    expect(collectSidecarManifests(root)).toMatchObject([
      {
        name: 'PdPandas',
        kind: 'sidecar',
        runtime: 'python',
        effects: ['fs', 'cpu'],
        serialization: 'json',
        requiresSidecar: true,
        packages: [
          {
            package: 'pandas',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            version: '2',
          },
        ],
      },
    ]);
  });

  it('does not treat legacy PyPI metadata imports as callable implicit sidecars', () => {
    const root = parse('import from=numpy registry=pypi names=array');

    expect(collectSidecarManifests(root)).toEqual([]);
  });

  it('does not collect type-only Python imports as sidecar manifests', () => {
    const root = parse('import py "numpy.typing" names=NDArray types=true');

    expect(collectSidecarManifests(root)).toEqual([]);
  });

  it('merges repeated loose Python imports in sidecar manifests', () => {
    const root = parse(['module name=calc', '  import py "math" as math', '  import py "math" names=sqrt'].join('\n'));

    expect(collectSidecarManifests(root)).toMatchObject([
      {
        name: 'Math',
        packages: [
          {
            package: 'math',
            imports: [{ default: 'math' }, { names: ['sqrt'] }],
          },
        ],
      },
    ]);
  });

  it('records explicit Python signature maps in sidecar manifests', () => {
    const root = parse('import py "math" names=sqrt signatures="sqrt:(x: number) => Promise<number>"');

    expect(collectSidecarManifests(root)).toMatchObject([
      {
        packages: [
          {
            package: 'math',
            imports: [{ names: ['sqrt'], signatures: { sqrt: '(x: number) => Promise<number>' } }],
          },
        ],
      },
    ]);
  });

  it('parses compact signature maps with semicolons inside TypeScript object types', () => {
    const root = parse(
      'import py "json" names=dumps signatures="dumps:(value: unknown, opts: { indent?: number; sort_keys?: boolean }) => Promise<string>"',
    );

    expect(collectSidecarManifests(root)).toMatchObject([
      {
        packages: [
          {
            package: 'json',
            imports: [
              {
                names: ['dumps'],
                signatures: {
                  dumps: '(value: unknown, opts: { indent?: number; sort_keys?: boolean }) => Promise<string>',
                },
              },
            ],
          },
        ],
      },
    ]);
  });

  it('builds a typed symbol table for npm and Python imports', () => {
    const root = parse(
      [
        'module name=app',
        '  import npm "zod" as z',
        '  import from=react registry=npm names="useMemo,useState as useReactState"',
        '  import py "math" as math signatures="sqrt:(x: bigint) => Promise<bigint>"',
        '  import py "math" names=sqrt',
      ].join('\n'),
    );

    const table = collectExternalImportSymbols(root);
    expect(table.byLocalName.get('z')).toMatchObject({
      kind: 'module',
      package: 'zod',
      registry: 'npm',
      targetFamily: 'ts',
    });
    expect(table.byLocalName.get('useReactState')).toMatchObject({
      kind: 'function',
      package: 'react',
      registry: 'npm',
      sourceName: 'useState',
    });
    expect(table.byLocalName.get('math')).toMatchObject({
      kind: 'module',
      package: 'math',
      registry: 'pypi',
      targetFamily: 'python',
      signatures: { sqrt: '(x: bigint) => Promise<bigint>' },
      sidecarName: 'Math',
    });
    expect(table.byLocalName.get('sqrt')).toMatchObject({
      kind: 'function',
      package: 'math',
      registry: 'pypi',
      sourceName: 'sqrt',
      signature: '(x: bigint) => Promise<bigint>',
      sidecarName: 'Math',
    });
    expect(table.byPackage.get('math')).toHaveLength(2);
  });

  it('diagnoses signature maps that do not match named-only imports', () => {
    const root = parse(
      'import py "custom_package" names=first signatures="first:(x: number) => Promise<number>;second:(x: string) => Promise<string>"',
    );

    expect(externalSignatureDiagnostics(root)).toEqual([
      {
        package: 'custom_package',
        registry: 'pypi',
        name: 'second',
        reason: 'not-imported',
        line: 1,
        col: 1,
      },
    ]);
  });

  it('keeps non-sidecar PyPI metadata imports in the typed symbol table', () => {
    const root = parse(
      [
        'module name=api',
        '  extern package=numpy registry=pypi target=fastapi',
        '    import default=np names=array',
      ].join('\n'),
    );

    const table = collectExternalImportSymbols(root);
    expect(table.byLocalName.get('np')).toMatchObject({
      kind: 'module',
      package: 'numpy',
      registry: 'pypi',
      target: 'fastapi',
      targetFamily: 'python',
    });
    expect(table.byLocalName.get('array')).toMatchObject({
      kind: 'function',
      package: 'numpy',
      registry: 'pypi',
      sourceName: 'array',
    });
  });

  it('keeps type-only PyPI imports in the typed symbol table', () => {
    const root = parse('import py "numpy.typing" names=NDArray types=true');

    const table = collectExternalImportSymbols(root);
    expect(table.byLocalName.get('NDArray')).toMatchObject({
      kind: 'type',
      package: 'numpy.typing',
      registry: 'pypi',
      target: 'python',
      targetFamily: 'python',
      sourceName: 'NDArray',
    });
  });

  it('treats module signature maps as API declarations instead of diagnostics', () => {
    const root = parse(
      'import py "custom_package" as custom signatures="first:(x: number) => Promise<number>;second:(x: string) => Promise<string>"',
    );

    expect(externalSignatureDiagnostics(root)).toEqual([]);
  });
});
