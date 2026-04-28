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
 * Symbol surface for app/ metadata image files (icon, apple-icon,
 * opengraph-image, twitter-image). The dynamic forms (`.ts(x)`/`.js(x)`)
 * export `default` (the image-generation function) plus optional
 * `generateImageMetadata`, `alt`, `size`, `contentType`. Static forms
 * (`.png`, `.svg`, etc.) have no JS exports so we skip those extensions.
 * Source: Next.js metadata-files docs.
 */
const IMAGE_METADATA_SYMBOLS = ['default', 'generateImageMetadata', 'alt', 'size', 'contentType'];

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

  // ── Step 7b — edge-case Next.js conventions ────────────────────────────

  // Parallel-route slot fallback. `app/@slot/default.tsx` (and any nested
  // `default.{ext}` under `app/`) is rendered when an unmatched parallel
  // segment has no other match. Always exports `default` only.
  ...APP_EXTS.map((ext) => ({
    pattern: `**/app/**/default.${ext}`,
    symbols: ['default'] as readonly string[],
    why: 'Next.js App Router parallel-route default',
  })),

  // Auth-flow special files (Next 15+): forbidden() and unauthorized()
  // navigations resolve to dedicated UI files. Symmetric with not-found.
  ...APP_EXTS.flatMap((ext) =>
    ['forbidden', 'unauthorized', 'global-not-found'].map((kind) => ({
      pattern: `**/app/**/${kind}.${ext}`,
      symbols: ['default'] as readonly string[],
      why: `Next.js App Router ${kind}`,
    })),
  ),

  // Metadata route handlers — sitemap, robots, manifest. Always at the
  // app/ root or under a route group; export `default` (the generator).
  // sitemap.{ext} also supports `generateSitemaps` for paginated sitemaps.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/app/**/sitemap.${ext}`,
    symbols: ['default', 'generateSitemaps'] as readonly string[],
    why: 'Next.js App Router sitemap',
  })),
  ...SCRIPT_EXTS.flatMap((ext) =>
    ['robots', 'manifest'].map((kind) => ({
      pattern: `**/app/**/${kind}.${ext}`,
      symbols: ['default'] as readonly string[],
      why: `Next.js App Router ${kind}`,
    })),
  ),

  // Image metadata files — dynamic generation forms only. Static images
  // (`.png`, `.svg`, …) have no JS exports so we don't pattern those.
  ...APP_EXTS.flatMap((ext) =>
    ['icon', 'apple-icon', 'opengraph-image', 'twitter-image'].map((kind) => ({
      pattern: `**/app/**/${kind}.${ext}`,
      symbols: IMAGE_METADATA_SYMBOLS,
      why: `Next.js App Router ${kind}`,
    })),
  ),

  // instrumentation.{ts,js} — root-level (or src/-level) hooks. `register`
  // runs at server start; `onRequestError` reports per-request errors.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/instrumentation.${ext}`,
    symbols: ['register', 'onRequestError'] as readonly string[],
    why: 'Next.js instrumentation',
  })),

  // instrumentation-client.{ts,js} — Next 15+ client-side companion.
  // `onRouterTransitionStart` fires on route changes.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/instrumentation-client.${ext}`,
    symbols: ['onRouterTransitionStart'] as readonly string[],
    why: 'Next.js instrumentation-client',
  })),

  // mdx-components.{ts,tsx,js,jsx} — required at the project root for MDX
  // pages to resolve component overrides via useMDXComponents.
  ...APP_EXTS.map((ext) => ({
    pattern: `**/mdx-components.${ext}`,
    symbols: ['useMDXComponents'] as readonly string[],
    why: 'Next.js mdx-components',
  })),

  // Forward-compat: Next 16 renames `middleware` to `proxy`. Adding the
  // pattern now means upgrading projects keep their seeds working without
  // a kern-lang release. If Next walks back the rename, removing this
  // pattern is a no-op for projects still on `middleware.{ts,js}`.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/proxy.${ext}`,
    symbols: ['default', 'proxy', 'config'] as readonly string[],
    why: 'Next.js proxy (v16 middleware rename)',
  })),

  // ── Nuxt 3+ conventions ────────────────────────────────────────────────
  //
  // SCOPE NOTE: only Nuxt-specific path shapes are seeded here. Generic
  // top-level `middleware/`, `plugins/`, `modules/`, `composables/` dirs
  // are NOT seeded because non-Nuxt projects with similarly-named dirs
  // would get over-marked: a stale plugin in `plugins/legacy.ts` of an
  // arbitrary project would inherit public-API status. The `**/server/**`
  // patterns ARE Nuxt-specific (Nitro server routes), so seeding them is
  // safe. `nuxt.config.{ts,js}` is uniquely identifying.
  //
  // SFC files (`.vue`) are not reviewed — symbols inside `<script setup>`
  // never reach the dead-export rule — so Vue's `pages/**/*.vue`,
  // `layouts/**/*.vue`, `components/**/*.vue` are intentionally absent.

  // Nuxt server routes — defineEventHandler default-export the handler
  // factory. Symbol-scoped to `default`; siblings stay subject to
  // dead-export checks.
  ...SCRIPT_EXTS.flatMap((ext) =>
    ['api', 'middleware', 'plugins', 'routes'].map((kind) => ({
      pattern: `**/server/${kind}/**/*.${ext}`,
      symbols: ['default'] as readonly string[],
      why: `Nuxt server/${kind} handler`,
    })),
  ),

  // nuxt.config — defineNuxtConfig default export. Uniquely Nuxt-named.
  ...SCRIPT_EXTS.map((ext) => ({
    pattern: `**/nuxt.config.${ext}`,
    symbols: ['default'] as readonly string[],
    why: 'Nuxt config',
  })),
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
