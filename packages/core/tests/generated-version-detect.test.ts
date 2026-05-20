import * as facade from '../src/version-detect.js';
import * as generated from '../src/generated/utils/version-detect.js';

describe('generated version-detect behavior', () => {
  it.each([
    ['3.4.1', 3],
    ['4.0.0', 4],
    ['15.2.3', 15],
    ['^3.4.1', 3],
    ['~4.0.0', 4],
    ['>=14.0.0', 14],
    ['latest', 0],
    ['', 0],
    ['0.0.0', 0],
  ])('parseMajorVersion(%p) returns %p', (input, expected) => {
    expect(generated.parseMajorVersion(input)).toBe(expected);
  });

  it.each([
    [{ dependencies: { react: '^19.2.0' } }, { react: '^19.2.0' }],
    [{ devDependencies: { tailwindcss: '^3.4.1' } }, { tailwind: '^3.4.1' }],
    [{ dependencies: { next: '^14.2.0' } }, { nextjs: '^14.2.0' }],
    [
      {
        dependencies: { react: '^19.0.0', next: '15.0.0' },
        devDependencies: { tailwindcss: '4.0.0' },
      },
      { react: '^19.0.0', tailwind: '4.0.0', nextjs: '15.0.0' },
    ],
    [
      {
        dependencies: { react: '19-deps', tailwindcss: '3-deps', next: '15-deps' },
        devDependencies: { react: '18-dev', tailwindcss: '4-dev', next: '14-dev' },
      },
      { react: '19-deps', tailwind: '4-dev', nextjs: '15-deps' },
    ],
    [{ dependencies: { vue: '^3.5.0' } }, {}],
  ])('detectVersionsFromPackageJson(%p) returns %p', (packageJson, expected) => {
    expect(generated.detectVersionsFromPackageJson(packageJson)).toEqual(expected);
  });

  it.each([
    [{}, 19],
    [{ react: '^18.3.1' }, 18],
    [{ react: '19.2.0' }, 19],
    [{ react: '^20.0.0' }, 19],
    [{ react: 'latest' }, 18],
  ])('resolveReactMajor(%p) returns %p', (versions, expected) => {
    expect(generated.resolveReactMajor(versions)).toBe(expected);
  });

  it.each([
    [{}, 3],
    [{ tailwind: '^3.4.1' }, 3],
    [{ tailwind: '4.0.0' }, 4],
    [{ tailwind: 'latest' }, 3],
  ])('resolveTailwindMajor(%p) returns %p', (versions, expected) => {
    expect(generated.resolveTailwindMajor(versions)).toBe(expected);
  });

  it.each([
    [{}, 14],
    [{ nextjs: '^13.5.0' }, 13],
    [{ nextjs: '14.2.0' }, 14],
    [{ nextjs: '~15.0.0' }, 15],
    [{ nextjs: '16.1.6' }, 16],
    [{ nextjs: '^16.2.2' }, 16],
    [{ nextjs: 'latest' }, 13],
  ])('resolveNextjsMajor(%p) returns %p', (versions, expected) => {
    expect(generated.resolveNextjsMajor(versions)).toBe(expected);
  });

  it.each([
    '3.4.1',
    '^18.3.1',
    'latest',
    '',
  ])('version-detect facade delegates parseMajorVersion(%p)', (input) => {
    expect(facade.parseMajorVersion(input)).toBe(generated.parseMajorVersion(input));
  });

  it('version-detect facade delegates all generated exports', () => {
    const pkg = { dependencies: { react: '^19.2.0', next: '15.0.0' }, devDependencies: { tailwindcss: '4.0.0' } };
    const versions = generated.detectVersionsFromPackageJson(pkg);
    expect(facade.detectVersionsFromPackageJson(pkg)).toEqual(versions);
    expect(facade.resolveReactMajor(versions)).toBe(generated.resolveReactMajor(versions));
    expect(facade.resolveTailwindMajor(versions)).toBe(generated.resolveTailwindMajor(versions));
    expect(facade.resolveNextjsMajor(versions)).toBe(generated.resolveNextjsMajor(versions));
  });
});
