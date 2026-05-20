import * as generated from '../src/generated/utils/version-detect.js';
import * as source from '../src/version-detect.js';

describe('generated version-detect parity', () => {
  it.each([
    '3.4.1',
    '4.0.0',
    '15.2.3',
    '^3.4.1',
    '~4.0.0',
    '>=14.0.0',
    'latest',
    '',
    '0.0.0',
  ])('parseMajorVersion(%s) matches source', (input) => {
    expect(generated.parseMajorVersion(input)).toBe(source.parseMajorVersion(input));
  });

  it.each([
    { dependencies: { react: '^19.2.0' } },
    { devDependencies: { tailwindcss: '^3.4.1' } },
    { dependencies: { next: '^14.2.0' } },
    {
      dependencies: { react: '^19.0.0', next: '15.0.0' },
      devDependencies: { tailwindcss: '4.0.0' },
    },
    {
      dependencies: { react: '19-deps', tailwindcss: '3-deps', next: '15-deps' },
      devDependencies: { react: '18-dev', tailwindcss: '4-dev', next: '14-dev' },
    },
    { dependencies: { vue: '^3.5.0' } },
  ])('detectVersionsFromPackageJson(%p) matches source', (packageJson) => {
    expect(generated.detectVersionsFromPackageJson(packageJson)).toEqual(
      source.detectVersionsFromPackageJson(packageJson),
    );
  });

  it.each([
    {},
    { react: '^18.3.1' },
    { react: '19.2.0' },
    { react: '^20.0.0' },
    { react: 'latest' },
  ])('resolveReactMajor(%p) matches source', (versions) => {
    expect(generated.resolveReactMajor(versions)).toBe(source.resolveReactMajor(versions));
  });

  it.each([
    {},
    { tailwind: '^3.4.1' },
    { tailwind: '4.0.0' },
    { tailwind: 'latest' },
  ])('resolveTailwindMajor(%p) matches source', (versions) => {
    expect(generated.resolveTailwindMajor(versions)).toBe(source.resolveTailwindMajor(versions));
  });

  it.each([
    {},
    { nextjs: '^13.5.0' },
    { nextjs: '14.2.0' },
    { nextjs: '~15.0.0' },
    { nextjs: '16.1.6' },
    { nextjs: '^16.2.2' },
    { nextjs: 'latest' },
  ])('resolveNextjsMajor(%p) matches source', (versions) => {
    expect(generated.resolveNextjsMajor(versions)).toBe(source.resolveNextjsMajor(versions));
  });
});
