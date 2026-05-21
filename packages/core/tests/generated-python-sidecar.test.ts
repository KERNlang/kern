import * as generated from '../src/generated/utils/python-sidecar.js';
import * as facade from '../src/python-sidecar.js';

const cases = [
  [undefined, 'demucs', 'Demucs'],
  [undefined, 'numpy==1.26', 'Numpy126'],
  [undefined, 'pkg-with-dash', 'PkgDashWithDashDash'],
  [undefined, 'pkg_with_underscore', 'PkgUnderscoreWithUnderscoreUnderscore'],
  [undefined, '123bad', 'Py123bad'],
  ['pd', 'pandas', 'PdPandas'],
  ['Pandas', 'pandas', 'Pandas'],
  ['NumPy', 'numpy', 'NumPy'],
  ['Client', 'my.pkg', 'ClientMyPkg'],
  ['pkg', 'my.pkg', 'Pkg'],
  ['MyPkg', 'my.pkg', 'MyPkg'],
  ['bad alias!', 'pkg-name', 'BadaliasPkgDashName'],
] satisfies Array<[string | undefined, string, string]>;

describe('generated python-sidecar naming', () => {
  it.each(cases)('generated(%p, %p) returns %p', (alias, packageName, expected) => {
    expect(generated.pythonSidecarNameFromAliasAndPackage(alias, packageName)).toBe(expected);
  });

  it.each(cases)('src facade(%p, %p) delegates to generated output', (alias, packageName) => {
    expect(facade.pythonSidecarNameFromAliasAndPackage(alias, packageName)).toBe(
      generated.pythonSidecarNameFromAliasAndPackage(alias, packageName),
    );
  });
});
