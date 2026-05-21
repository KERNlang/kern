// @kern-source: version-detect:1
export type FrameworkVersions = { react?: string; tailwind?: string; nextjs?: string };

// @kern-source: version-detect:2
export type ReactMajor = 18 | 19;

// @kern-source: version-detect:3
export type TailwindMajor = 3 | 4;

// @kern-source: version-detect:4
export type NextjsMajor = 13 | 14 | 15 | 16;

// @kern-source: version-detect:6
export function parseMajorVersion(version: string): number {
  const cleaned = version.replace(new RegExp('^[\\^~>=<]*', 'g'), '').trim();
  const major = parseInt(cleaned.split('.')[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

// @kern-source: version-detect:12
export function detectVersionsFromPackageJson(packageJson: Record<string, unknown>): FrameworkVersions {
  const versions = {} as FrameworkVersions;
  const deps = (packageJson.dependencies ?? {}) as Record<string, string>;
  const devDeps = (packageJson.devDependencies ?? {}) as Record<string, string>;
  const reactVersion = deps.react ?? devDeps.react;
  if (reactVersion) {
    versions.react = reactVersion;
  }
  const tailwindVersion = devDeps.tailwindcss ?? deps.tailwindcss;
  if (tailwindVersion) {
    versions.tailwind = tailwindVersion;
  }
  const nextVersion = deps.next ?? devDeps.next;
  if (nextVersion) {
    versions.nextjs = nextVersion;
  }
  return versions;
}

// @kern-source: version-detect:29
export function resolveReactMajor(versions: FrameworkVersions): ReactMajor {
  if (!versions.react) {
    return 19;
  }
  const major = parseMajorVersion(versions.react);
  return (major <= 18) ? 18 : 19;
}

// @kern-source: version-detect:36
export function resolveTailwindMajor(versions: FrameworkVersions): TailwindMajor {
  if (!versions.tailwind) {
    return 3;
  }
  const major = parseMajorVersion(versions.tailwind);
  return (major >= 4) ? 4 : 3;
}

// @kern-source: version-detect:43
export function resolveNextjsMajor(versions: FrameworkVersions): NextjsMajor {
  if (!versions.nextjs) {
    return 14;
  }
  const major = parseMajorVersion(versions.nextjs);
  if (major >= 16) {
    return 16;
  }
  if (major >= 15) {
    return 15;
  }
  if (major <= 13) {
    return 13;
  }
  return 14;
}

