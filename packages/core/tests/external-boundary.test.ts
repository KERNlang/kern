import {
  collectCapabilityIslands,
  collectExternalBoundaries,
  collectSidecarManifests,
} from '../src/external-boundary.js';
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
});
