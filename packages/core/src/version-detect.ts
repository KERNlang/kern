/**
 * Version Detection Utility
 *
 * Auto-detects Tailwind CSS and Next.js versions from the user's project
 * by reading package.json dependencies.
 */

import type { FrameworkVersions } from './config.js';

/**
 * Parse a semver string and return the major version number.
 * Returns 0 if the string is not a valid semver.
 */
export function parseMajorVersion(version: string): number {
  const cleaned = version.replace(/^[\^~>=<]*/g, '').trim();
  const major = parseInt(cleaned.split('.')[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Detect framework versions from a parsed package.json object.
 *
 * Looks in both dependencies and devDependencies for:
 * - react -> react version
 * - tailwindcss -> tailwind version
 * - next -> nextjs version
 */
export function detectVersionsFromPackageJson(packageJson: Record<string, unknown>): FrameworkVersions {
  const versions: FrameworkVersions = {};

  const deps = (packageJson.dependencies ?? {}) as Record<string, string>;
  const devDeps = (packageJson.devDependencies ?? {}) as Record<string, string>;

  // React
  const reactVersion = deps.react ?? devDeps.react;
  if (reactVersion) {
    versions.react = reactVersion;
  }

  // Tailwind CSS
  const twVersion = devDeps.tailwindcss ?? deps.tailwindcss;
  if (twVersion) {
    versions.tailwind = twVersion;
  }

  // Next.js
  const nextVersion = deps.next ?? devDeps.next;
  if (nextVersion) {
    versions.nextjs = nextVersion;
  }

  return versions;
}

/**
 * Resolve the effective React major version.
 * Defaults to 19 when unspecified because React 19 is the current baseline.
 * Future majors collapse to 19 until they gain explicit adapters.
 */
export function resolveReactMajor(versions: FrameworkVersions): 18 | 19 {
  if (!versions.react) return 19;
  const major = parseMajorVersion(versions.react);
  return major <= 18 ? 18 : 19;
}

/**
 * Resolve the effective Tailwind major version.
 * Defaults to 3 when unspecified (backward-compatible).
 */
export function resolveTailwindMajor(versions: FrameworkVersions): 3 | 4 {
  if (!versions.tailwind) return 3;
  const major = parseMajorVersion(versions.tailwind);
  return major >= 4 ? 4 : 3;
}

/**
 * Resolve the effective Next.js major version.
 * Defaults to 14 when unspecified (most common production version).
 */
export function resolveNextjsMajor(versions: FrameworkVersions): 13 | 14 | 15 | 16 {
  if (!versions.nextjs) return 14;
  const major = parseMajorVersion(versions.nextjs);
  if (major >= 16) return 16;
  if (major >= 15) return 15;
  if (major <= 13) return 13;
  return 14;
}
