export function pythonSidecarNameFromAliasAndPackage(alias: string | undefined, packageName: string): string {
  const packageTitle = titleCasePythonSidecarName(packageName);
  if (!alias) return packageTitle;
  const aliasTitle = titleCasePythonSidecarName(alias);
  const lastPackageSegment = packageName
    .split(/[./_-]+/u)
    .filter(Boolean)
    .at(-1);
  const lastPackageTitle = lastPackageSegment ? titleCasePythonSidecarName(lastPackageSegment) : packageTitle;
  return aliasTitle === lastPackageTitle || aliasTitle === packageTitle ? aliasTitle : `${aliasTitle}${packageTitle}`;
}

function titleCasePythonSidecarName(raw: string): string {
  const parts = raw
    .replace(/-/gu, '.dash.')
    .replace(/_/gu, '.underscore.')
    .split(/[./]+/u)
    .map((part) => part.replace(/[^A-Za-z0-9_$]/gu, ''))
    .filter(Boolean);
  const words = parts.length > 0 ? parts : ['Python'];
  const name = words.map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join('');
  return /^[A-Za-z_$]/u.test(name) ? name : `Py${name}`;
}
