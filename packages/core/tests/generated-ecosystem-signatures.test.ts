import * as facade from '../src/ecosystem-signatures.js';
import type { ExternalImportRegistry as GeneratedExternalImportRegistry } from '../src/generated/utils/ecosystem-signatures.js';
import * as generated from '../src/generated/utils/ecosystem-signatures.js';
import type { ExternalImportRegistry as CanonicalExternalImportRegistry } from '../src/import-metadata.js';

type TypeEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;
type _ExternalImportRegistryReExportMatchesCanonical = Assert<
  TypeEqual<GeneratedExternalImportRegistry, CanonicalExternalImportRegistry>
>;
type _ExternalImportRegistryKeepsExpectedLiterals = Assert<
  TypeEqual<GeneratedExternalImportRegistry, 'host' | 'npm' | 'pypi' | 'kern'>
>;

describe('generated ecosystem-signatures behavior', () => {
  it('parses object signature maps and trims signatures', () => {
    expect(generated.parseExternalSignatureMap({ load: '  () => Promise<void>  ', bad: '', 'bad-name': 'x' })).toEqual({
      load: '() => Promise<void>',
    });
  });

  it('parses JSON signature maps', () => {
    expect(generated.parseExternalSignatureMap('{"dumps":"(value: unknown) => Promise<string>"}')).toEqual({
      dumps: '(value: unknown) => Promise<string>',
    });
  });

  it('parses compact signature maps with nested semicolons protected', () => {
    expect(
      generated.parseExternalSignatureMap(
        'load:(value: { text: "a;b" }) => Promise<string>; dump:(items: Array<{x: number}>) => Promise<void>',
      ),
    ).toEqual({
      load: '(value: { text: "a;b" }) => Promise<string>',
      dump: '(items: Array<{x: number}>) => Promise<void>',
    });
  });

  it.each([
    undefined,
    null,
    '',
    '   ',
    '{bad json}',
    'missingSeparator',
    'bad-name:() => void',
    'ok:',
  ])('returns undefined for invalid signature map %p', (value) => {
    expect(generated.parseExternalSignatureMap(value)).toBeUndefined();
  });

  it('keeps compact parser separators inside escaped quoted strings', () => {
    expect(
      generated.parseExternalSignatureMap(
        String.raw`quote:(value: "a\";b") => Promise<string>; next:() => Promise<void>`,
      ),
    ).toEqual({
      quote: String.raw`(value: "a\";b") => Promise<string>`,
      next: '() => Promise<void>',
    });
  });

  it('keeps compact parser separators inside generic angle brackets', () => {
    expect(generated.parseExternalSignatureMap('make:() => Promise<Result<A;B>>; next:() => Promise<void>')).toEqual({
      make: '() => Promise<Result<A;B>>',
      next: '() => Promise<void>',
    });
  });

  it('infers Python stdlib signatures only for PyPI packages', () => {
    const registry: GeneratedExternalImportRegistry = 'pypi';
    expect(generated.inferExternalSignature(registry, 'math', 'sqrt')).toBe('(x: number) => Promise<number>');
    expect(generated.inferExternalSignature('npm', 'math', 'sqrt')).toBeUndefined();
    expect(generated.inferExternalSignature('pypi', 'math', 'missing')).toBeUndefined();
  });

  it('returns a copy of inferred signature maps', () => {
    const first = generated.inferExternalSignatureMap('pypi', 'json');
    const second = generated.inferExternalSignatureMap('pypi', 'json');
    expect(first).toEqual({
      dumps: '(value: unknown, ...args: unknown[]) => Promise<string>',
      loads: '(value: string, ...args: unknown[]) => Promise<unknown>',
    });
    expect(first).not.toBe(second);
  });

  it('merges inferred and explicit signatures with explicit taking precedence', () => {
    expect(
      generated.mergeExternalSignatureMaps(
        { dumps: 'old', loads: '(value: string) => Promise<unknown>' },
        { dumps: 'new' },
      ),
    ).toEqual({
      dumps: 'new',
      loads: '(value: string) => Promise<unknown>',
    });
    expect(generated.mergeExternalSignatureMaps(undefined, undefined)).toBeUndefined();
  });

  it('src facade delegates generated exports', () => {
    expect(facade.parseExternalSignatureMap).toBe(generated.parseExternalSignatureMap);
    expect(facade.inferExternalSignature('pypi', 'math', 'sqrt')).toBe(
      generated.inferExternalSignature('pypi', 'math', 'sqrt'),
    );
    expect(facade.inferExternalSignatureMap('pypi', 'json')).toEqual(
      generated.inferExternalSignatureMap('pypi', 'json'),
    );
    expect(facade.mergeExternalSignatureMaps).toBe(generated.mergeExternalSignatureMaps);
  });
});
