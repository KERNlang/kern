import { collectExternalBoundaries } from '../src/external-boundary.js';
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
        imports: [{ names: ['useState'], types: false }],
      },
    ]);
  });
});
