/**
 * KNOWN_FRAMEWORK_SEEDS — per-pattern, per-symbol public-API conventions.
 *
 * MAINTENANCE CONTRACT
 *
 * Every entry must be **symbol-scoped**. A whole-file "this file is public"
 * seed is forbidden by Phase 4 design — a stale helper sitting next to a
 * Next.js page would silently inherit public-API status, which was
 * red-team CRITICAL #2 against Plan v3. Each pattern lists the EXACT
 * export names the convention treats as runtime entry points; everything
 * else stays subject to dead-export checks.
 *
 * Order matters. The first matching seed wins, so put more-specific
 * patterns before more-general ones (e.g. `pages/api/**` before
 * `pages/** /*.*`). The matcher uses POSIX-style globs from
 * `public-api.ts:globToRegex`; patterns are matched against the input
 * file path normalized to forward slashes.
 *
 * Step 7a covers the "stable" Next.js conventions documented in the
 * official routing/file-convention docs and stable across versions
 * 13–15. Edge cases — parallel-route slots, metadata image files,
 * instrumentation, mdx-components, the v16 middleware → proxy rename —
 * land in step 7b. Splitting keeps each commit a clear change set if
 * one half regresses.
 */

import { globToRegex, toPosix } from './public-api.js';

export interface FrameworkSeed {
  /** Pattern this convention applies to (POSIX-style glob, no braces). */
  pattern: string;
  /** Public symbol names — runtime entry points ONLY. */
  symbols: readonly string[];
  /** Short description for diagnostics / future maintainers. */
  why: string;
}

/**
 * Route-segment config exports valid on Next.js page/layout/route files.
 * Listing them once lets the page/layout/route patterns share the same set.
 * Source: Next.js routing/route-segment-config.
 */
const ROUTE_SEGMENT_CONFIG = [
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
] as const;

/**
 * Metadata exports valid on page/layout files. `viewport` and
 * `generateViewport` are post-13.6 additions; `generateStaticParams` is
 * how dynamic routes pre-render at build time.
 */
const PAGE_METADATA = ['metadata', 'generateMetadata', 'viewport', 'generateViewport', 'generateStaticParams'] as const;

const PAGE_LIKE_SYMBOLS = ['default', ...PAGE_METADATA, ...ROUTE_SEGMENT_CONFIG];
const ROUTE_HANDLER_VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

const APP_EXTS = ['ts', 'tsx', 'js', 'jsx'];
const SCRIPT_EXTS = ['ts', 'js'];
const PAGES_EXTS = ['tsx', 'ts', 'jsx', 'js'];

/**
 * STABLE Next.js conventions (step 7a). Edge-case shapes (parallel routes,
 * metadata files like icon/opengraph-image, instrumentation, proxy) live
 * in step 7b — each commit stays a clean change set.
 */
export const KNOWN_FRAMEWORK_SEEDS: readonly FrameworkSeed[] = [
  // App Router: route handlers — HTTP verbs + segment config.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/app/**/route.${ext}`,
    symbols: [...ROUTE_HANDLER_VERBS, ...ROUTE_SEGMENT_CONFIG],
    why: 'Next.js App Router route handler',
  })),

  // App Router: special files (template/loading/error/not-found/global-error)
  // — `default` only.
  ...APP_EXTS.flatMap((ext) =>
    ['template', 'loading', 'error', 'not-found', 'global-error'].map((kind) => ({
      pattern: `**/app/**/${kind}.${ext}`,
      symbols: ['default'] as readonly string[],
      why: `Next.js App Router ${kind}`,
    })),
  ),

  // App Router: page + layout — symmetric public surface (default render
  // + metadata + segment config).
  ...APP_EXTS.flatMap((ext) => [
    {
      pattern: `**/app/**/page.${ext}`,
      symbols: PAGE_LIKE_SYMBOLS,
      why: 'Next.js App Router page',
    },
    {
      pattern: `**/app/**/layout.${ext}`,
      symbols: PAGE_LIKE_SYMBOLS,
      why: 'Next.js App Router layout',
    },
  ]),

  // Pages Router: special files first (more specific patterns).
  ...PAGES_EXTS.flatMap((ext) => [
    {
      pattern: `**/pages/_app.${ext}`,
      symbols: ['default'] as readonly string[],
      why: 'Next.js Pages Router _app',
    },
    {
      pattern: `**/pages/_document.${ext}`,
      symbols: ['default'] as readonly string[],
      why: 'Next.js Pages Router _document',
    },
  ]),

  // Pages Router: API routes — `default` (handler) + `config` (size limits,
  // bodyParser, runtime). Must come BEFORE the general pages/**/*.* pattern
  // so api files get the api-specific seed.
  ...PAGES_EXTS.map((ext) => ({
    pattern: `**/pages/api/**/*.${ext}`,
    symbols: ['default', 'config'] as readonly string[],
    why: 'Next.js Pages Router API route',
  })),

  // Pages Router: data-fetching pages.
  ...PAGES_EXTS.map((ext) => ({
    pattern: `**/pages/**/*.${ext}`,
    symbols: ['default', 'getServerSideProps', 'getStaticProps', 'getStaticPaths', 'config'],
    why: 'Next.js Pages Router page',
  })),

  // Middleware: root or src/, with both ts and js.
  ...SCRIPT_EXTS.flatMap((ext) => [
    {
      pattern: `**/middleware.${ext}`,
      symbols: ['default', 'middleware', 'config'] as readonly string[],
      why: 'Next.js middleware',
    },
  ]),
];

/**
 * Compiled regex per seed. globToRegex is non-trivial; cache once per
 * process — KNOWN_FRAMEWORK_SEEDS is `as const` so the cache is sound.
 */
const compiled: Array<{ regex: RegExp; seed: FrameworkSeed }> = KNOWN_FRAMEWORK_SEEDS.map((seed) => ({
  regex: globToRegex(seed.pattern),
  seed,
}));

/**
 * Match a file path against KNOWN_FRAMEWORK_SEEDS. Returns the FIRST
 * matching seed (more-specific patterns must be ordered before more-
 * general ones — see the const above). Returns undefined when nothing
 * matches; the caller falls back to package.json-driven seeding.
 */
export function getFrameworkSeed(filePath: string): FrameworkSeed | undefined {
  const posix = toPosix(filePath);
  for (const { regex, seed } of compiled) {
    if (regex.test(posix)) return seed;
  }
  return undefined;
}
