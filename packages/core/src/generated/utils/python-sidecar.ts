// @kern-source: python-sidecar:1
export function pythonSidecarNameFromAliasAndPackage(alias: string | undefined, packageName: string): string {
  const packageTitle = titleCasePythonSidecarName(packageName);
  if (!alias) {
    return packageTitle;
  }
  const aliasTitle = titleCasePythonSidecarName(alias);
  const lastPackageSegment = packageName.split(new RegExp('[./_-]+', 'u')).filter(Boolean).at(-1);
  const lastPackageTitle = lastPackageSegment ? titleCasePythonSidecarName(lastPackageSegment) : packageTitle;
  const aliasKey = aliasTitle.toLowerCase();
  return (aliasKey === lastPackageTitle.toLowerCase() || aliasKey === packageTitle.toLowerCase()) ? aliasTitle : (aliasTitle + packageTitle);
}

// @kern-source: python-sidecar:14
export function titleCasePythonSidecarName(raw: string): string {
  const parts = raw.replace(new RegExp('-', 'gu'), '.dash.').replace(new RegExp('_', 'gu'), '.underscore.').split(new RegExp('[./]+', 'u')).map((part) => part.replace(new RegExp('[^A-Za-z0-9_$]', 'gu'), '')).filter(Boolean);
  const words = (parts.length > 0) ? parts : ['Python'];
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return (new RegExp('^[A-Za-z_$]', 'u').test(name)) ? name : ('Py' + name);
}

