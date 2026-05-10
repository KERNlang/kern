import { collectExternalBoundaries } from '../src/external-boundary.js';
import { parse } from '../src/parser.js';

describe('external boundary collection', () => {
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
        imports: [{ names: ['useState'], types: false }],
      },
    ]);
  });
});
