/**
 * Version Adapters for Tailwind CSS and Next.js
 *
 * Two-layer architecture:
 * (a) Token rules: class name transforms (e.g., bg-opacity-50 -> removed in TW v4)
 * (b) Output-mode rules: structural differences (import patterns, metadata API)
 *
 * Stored as TypeScript modules so they can hold predicates and transforms.
 * Shared across all targets that use Tailwind (React, Vue, Svelte).
 */

import type { FrameworkVersions } from './config.js';
import { resolveNextjsMajor, resolveTailwindMajor } from './version-detect.js';

// ── Tailwind Version Adapter ────────────────────────────────────────────

/**
 * A token rule transforms individual Tailwind class names.
 * If the predicate matches, the transform function is applied.
 */
export interface TailwindTokenRule {
  /** Human-readable name for debugging */
  name: string;
  /** Returns true if this rule applies to the given class */
  predicate: (cls: string) => boolean;
  /** Transform the class name. Return empty string to remove. */
  transform: (cls: string) => string;
}

/**
 * Output-mode rules for Tailwind structural differences.
 */
export interface TailwindOutputRules {
  /** Whether to use @import instead of @tailwind directives */
  useAtImport: boolean;
  /** Whether opacity utilities use slash syntax (bg-black/50 vs bg-opacity-50) */
  useSlashOpacity: boolean;
  /** Whether to use the new color-mix() approach for arbitrary opacity */
  useColorMix: boolean;
}

/**
 * Combined Tailwind compatibility profile.
 */
export interface TailwindVersionProfile {
  major: 3 | 4;
  tokenRules: TailwindTokenRule[];
  outputRules: TailwindOutputRules;
}

// ── Token rules for Tailwind v3 -> v4 migration ────────────────────────

const TW_V4_TOKEN_RULES: TailwindTokenRule[] = [
  {
    name: 'blur-filter-rename',
    predicate: (cls) => cls === 'filter' || cls === 'backdrop-filter',
    transform: () => '',
  },
  {
    name: 'decoration-slice-rename',
    predicate: (cls) => cls === 'decoration-slice' || cls === 'decoration-clone',
    transform: (cls) => cls.replace('decoration-', 'box-decoration-'),
  },
  {
    name: 'flex-shrink-grow-rename',
    predicate: (cls) => /^(flex-shrink|flex-grow)(-\d+)?$/.test(cls),
    transform: (cls) => cls.replace('flex-shrink', 'shrink').replace('flex-grow', 'grow'),
  },
  {
    name: 'overflow-ellipsis-rename',
    predicate: (cls) => cls === 'overflow-ellipsis',
    transform: () => 'text-ellipsis',
  },
];

// ── Build Tailwind profile ──────────────────────────────────────────────

export function buildTailwindProfile(versions: FrameworkVersions): TailwindVersionProfile {
  const major = resolveTailwindMajor(versions);

  if (major >= 4) {
    return {
      major: 4,
      tokenRules: TW_V4_TOKEN_RULES,
      outputRules: {
        useAtImport: true,
        useSlashOpacity: true,
        useColorMix: true,
      },
    };
  }

  return {
    major: 3,
    tokenRules: [],
    outputRules: {
      useAtImport: false,
      useSlashOpacity: false,
      useColorMix: false,
    },
  };
}

/**
 * Apply token rules to a list of Tailwind classes.
 * Returns the transformed class string.
 */
export function applyTailwindTokenRules(classes: string, profile: TailwindVersionProfile): string {
  if (profile.tokenRules.length === 0 && !profile.outputRules.useSlashOpacity) return classes;

  const parts = classes.split(/\s+/).filter(Boolean);
  const result: string[] = [];

  for (const cls of parts) {
    let transformed = cls;
    for (const rule of profile.tokenRules) {
      if (rule.predicate(cls)) {
        transformed = rule.transform(cls);
        break;
      }
    }
    if (transformed) {
      result.push(transformed);
    }
  }

  // Post-processing: merge opacity utilities into slash syntax
  // e.g., bg-red-500 bg-opacity-50 → bg-red-500/50
  if (profile.outputRules.useSlashOpacity) {
    return mergeOpacityUtilities(result).join(' ');
  }

  return result.join(' ');
}

/**
 * Merge `{prefix}-opacity-{N}` classes into the preceding color class
 * using slash syntax: `bg-red-500 bg-opacity-50` → `bg-red-500/50`.
 * Supports bg, text, border, ring prefixes.
 */
function mergeOpacityUtilities(classes: string[]): string[] {
  const opacityPattern = /^(bg|text|border|ring)-opacity-(\d+)$/;
  // First pass: collect opacity values by prefix
  const opacityMap = new Map<string, string>();
  const nonOpacity: string[] = [];

  for (const cls of classes) {
    const match = cls.match(opacityPattern);
    if (match) {
      opacityMap.set(match[1], match[2]);
    } else {
      nonOpacity.push(cls);
    }
  }

  if (opacityMap.size === 0) return classes;

  // Second pass: merge opacity into color classes
  const merged: string[] = [];
  for (const cls of nonOpacity) {
    let didMerge = false;
    for (const [prefix, opacity] of opacityMap) {
      // Match color classes like bg-red-500, text-zinc-300, border-gray-200, ring-blue-500
      if (cls.startsWith(`${prefix}-`) && !cls.includes('/')) {
        merged.push(`${cls}/${opacity}`);
        opacityMap.delete(prefix);
        didMerge = true;
        break;
      }
    }
    if (!didMerge) {
      merged.push(cls);
    }
  }

  return merged;
}

// ── Next.js Version Adapter ────────────────────────────────────────────

/**
 * Output-mode rules for Next.js structural differences.
 */
export interface NextjsOutputRules {
  /** Metadata export style: 'typed' = Metadata type, 'satisfies' = satisfies Metadata */
  metadataStyle: 'typed' | 'satisfies';
  /** Whether to use the next/navigation module (v13+) vs next/router */
  useAppRouter: boolean;
  /** Image component import path */
  imageImport: 'next/image' | 'next/legacy/image';
  /** Whether async server components are supported */
  asyncServerComponents: boolean;
  /** Whether to use the new Link behavior (no nested <a>) */
  linkNoAnchor: boolean;
}

/**
 * Combined Next.js compatibility profile.
 */
export interface NextjsVersionProfile {
  major: 13 | 14 | 15 | 16;
  outputRules: NextjsOutputRules;
}

export function buildNextjsProfile(versions: FrameworkVersions): NextjsVersionProfile {
  const major = resolveNextjsMajor(versions);

  switch (major) {
    case 16:
      return {
        major: 16,
        outputRules: {
          metadataStyle: 'satisfies',
          useAppRouter: true,
          imageImport: 'next/image',
          asyncServerComponents: true,
          linkNoAnchor: true,
        },
      };
    case 15:
      return {
        major: 15,
        outputRules: {
          metadataStyle: 'satisfies',
          useAppRouter: true,
          imageImport: 'next/image',
          asyncServerComponents: true,
          linkNoAnchor: true,
        },
      };
    case 14:
      return {
        major: 14,
        outputRules: {
          metadataStyle: 'typed',
          useAppRouter: true,
          imageImport: 'next/image',
          asyncServerComponents: true,
          linkNoAnchor: true,
        },
      };
    default:
      return {
        major: 13,
        outputRules: {
          metadataStyle: 'typed',
          useAppRouter: true,
          imageImport: 'next/image',
          asyncServerComponents: false,
          linkNoAnchor: true,
        },
      };
  }
}

// ── Combined Version Profile ────────────────────────────────────────────

export interface VersionProfile {
  tailwind: TailwindVersionProfile;
  nextjs: NextjsVersionProfile;
}

export function buildVersionProfile(versions: FrameworkVersions): VersionProfile {
  return {
    tailwind: buildTailwindProfile(versions),
    nextjs: buildNextjsProfile(versions),
  };
}
