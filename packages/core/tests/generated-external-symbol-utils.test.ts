import * as facade from '../src/external-symbol-utils.js';
import * as generated from '../src/generated/utils/external-symbol-utils.js';

describe('generated external-symbol-utils behavior', () => {
  it('parses external named bindings with aliases', () => {
    expect(generated.parseExternalNamedBindingShape('sqrt')).toEqual({ name: 'sqrt', alias: 'sqrt' });
    expect(generated.parseExternalNamedBindingShape('sqrt as root')).toEqual({ name: 'sqrt', alias: 'root' });
    expect(generated.parseExternalNamedBindingShape('1bad')).toBeNull();
    expect(generated.parseExternalNamedBindingShape(' ')).toBeNull();
    expect(generated.parseExternalNamedBindingShape('a b c')).toBeNull();
  });

  it('validates safe external identifiers', () => {
    expect(generated.isExternalSafeIdentifier('foo')).toBe(true);
    expect(generated.isExternalSafeIdentifier('$foo')).toBe(true);
    expect(generated.isExternalSafeIdentifier('_bar')).toBe(true);
    expect(generated.isExternalSafeIdentifier('1bad')).toBe(false);
    expect(generated.isExternalSafeIdentifier('')).toBe(false);
    expect(generated.isExternalSafeIdentifier('foo bar')).toBe(false);
  });

  it('selects named binding signatures consistently', () => {
    expect(
      generated.externalNamedBindingSignature(
        { names: ['sqrt'], signature: '(x:number)=>number', signatures: { sqrt: '(x:any)=>any' }, types: false },
        'sqrt',
      ),
    ).toBe('(x:number)=>number');
    expect(
      generated.externalNamedBindingSignature(
        {
          names: ['sqrt', 'pow'],
          signature: '(x:number)=>number',
          signatures: { pow: '(x:number,y:number)=>number' },
          types: false,
        },
        'pow',
      ),
    ).toBe('(x:number,y:number)=>number');
    expect(
      generated.externalNamedBindingSignature({ names: [], signatures: { foo: '(x:any)=>any' }, types: false }, 'foo'),
    ).toBe('(x:any)=>any');
  });

  it('builds sidecar package signature maps from defaults and named imports', () => {
    expect(
      generated.externalSignatureMapForSidecarPackage({
        package: 'numpy',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        imports: [
          { default: 'np', names: [], signatures: { array: '(value:any)=>any' }, types: false },
          { names: ['zeros as z'], signature: '(shape:any)=>any', types: false },
          { names: ['ones'], signatures: { ones: '(shape:any)=>any' }, types: false },
        ],
      }),
    ).toMatchObject({
      array: '(value:any)=>any',
      zeros: '(shape:any)=>any',
      ones: '(shape:any)=>any',
    });
  });

  it('builds sidecar manifest symbols from modules and named imports', () => {
    expect(
      generated.externalSymbolsFromSidecarManifest({
        name: 'PyMath',
        runtime: 'python',
        effects: ['cpu'],
        requiresSidecar: true,
        packages: [
          {
            package: 'testpkg',
            registry: 'pypi',
            target: 'python',
            targetFamily: 'python',
            imports: [
              {
                default: 'np',
                names: ['array as arr'],
                signatures: { array: '(value:any)=>any' },
                types: false,
                line: 7,
              },
            ],
            line: 5,
          },
        ],
        col: 2,
      }),
    ).toEqual([
      {
        localName: 'np',
        kind: 'module',
        package: 'testpkg',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        signatures: { array: '(value:any)=>any' },
        sidecarName: 'PyMath',
        runtime: 'python',
        line: 5,
        col: 2,
      },
      {
        localName: 'arr',
        kind: 'function',
        package: 'testpkg',
        registry: 'pypi',
        target: 'python',
        targetFamily: 'python',
        sourceName: 'array',
        signature: '(value:any)=>any',
        sidecarName: 'PyMath',
        runtime: 'python',
        binding: {
          default: 'np',
          names: ['array as arr'],
          signatures: { array: '(value:any)=>any' },
          types: false,
          line: 7,
        },
        line: 7,
        col: 2,
      },
    ]);
  });

  it('src facade delegates generated utility exports', () => {
    expect(facade.parseExternalNamedBinding).toBe(generated.parseExternalNamedBindingShape);
    expect(facade.externalNamedBindingSignature).toBe(generated.externalNamedBindingSignature);
    expect(facade.externalSignatureMapForSidecarPackage).toBe(generated.externalSignatureMapForSidecarPackage);
    expect(facade.externalSymbolsFromSidecarManifest).toBe(generated.externalSymbolsFromSidecarManifest);
    expect(facade.isExternalSafeIdentifier).toBe(generated.isExternalSafeIdentifier);
  });
});
