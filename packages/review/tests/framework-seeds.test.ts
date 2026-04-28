/**
 * framework-seeds tests — verifies the per-pattern, per-symbol seed
 * registry returns correct symbol whitelists for each Next.js convention.
 *
 * Key invariant: each seed is SYMBOL-SCOPED. A stale helper sitting next
 * to a `page.tsx` must NOT inherit the page's public-API status —
 * red-team CRITICAL #2 against Plan v3 was specifically about whole-file
 * seeds. Every test here pins the exact whitelist, no broader.
 */

import { getFrameworkSeed, KNOWN_FRAMEWORK_SEEDS } from '../src/framework-seeds.js';

describe('KNOWN_FRAMEWORK_SEEDS — Next.js App Router', () => {
  it.each([
    ['/repo/src/app/page.tsx'],
    ['/repo/src/app/page.ts'],
    ['/repo/src/app/page.jsx'],
    ['/repo/src/app/page.js'],
    ['/repo/src/app/users/page.tsx'],
    ['/repo/src/app/(dashboard)/settings/page.tsx'],
  ])('matches `%s` to the page seed', (path) => {
    const seed = getFrameworkSeed(path);
    expect(seed?.why).toBe('Next.js App Router page');
    expect(seed?.symbols).toContain('default');
    expect(seed?.symbols).toContain('metadata');
    expect(seed?.symbols).toContain('generateMetadata');
    expect(seed?.symbols).toContain('generateStaticParams');
    expect(seed?.symbols).toContain('dynamic');
    expect(seed?.symbols).toContain('revalidate');
  });

  it('matches layout.tsx to the layout seed (same surface as page)', () => {
    const seed = getFrameworkSeed('/repo/src/app/layout.tsx');
    expect(seed?.why).toBe('Next.js App Router layout');
    expect(seed?.symbols).toContain('default');
    expect(seed?.symbols).toContain('metadata');
  });

  it('matches route.ts to HTTP-verb handlers', () => {
    const seed = getFrameworkSeed('/repo/src/app/api/users/route.ts');
    expect(seed?.why).toBe('Next.js App Router route handler');
    expect(seed?.symbols).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']));
    expect(seed?.symbols).toContain('runtime');
  });

  it.each([
    ['template.tsx', 'Next.js App Router template'],
    ['loading.tsx', 'Next.js App Router loading'],
    ['error.tsx', 'Next.js App Router error'],
    ['not-found.tsx', 'Next.js App Router not-found'],
    ['global-error.tsx', 'Next.js App Router global-error'],
  ])('matches `%s` to a default-only seed', (filename, why) => {
    const seed = getFrameworkSeed(`/repo/src/app/${filename}`);
    expect(seed?.why).toBe(why);
    expect(seed?.symbols).toEqual(['default']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — Next.js Pages Router', () => {
  it('matches pages/about.tsx to the data-fetching pages seed', () => {
    const seed = getFrameworkSeed('/repo/pages/about.tsx');
    expect(seed?.why).toBe('Next.js Pages Router page');
    expect(seed?.symbols).toEqual(
      expect.arrayContaining(['default', 'getServerSideProps', 'getStaticProps', 'getStaticPaths', 'config']),
    );
  });

  it('matches pages/api/route.ts to the API-route seed (default + config), NOT the page seed', () => {
    const seed = getFrameworkSeed('/repo/pages/api/users.ts');
    expect(seed?.why).toBe('Next.js Pages Router API route');
    expect(seed?.symbols).toEqual(['default', 'config']);
    // Critical: must not bleed in getServerSideProps (api routes don't have it).
    expect(seed?.symbols).not.toContain('getServerSideProps');
  });

  it('matches _app.tsx and _document.tsx to default-only seeds', () => {
    expect(getFrameworkSeed('/repo/pages/_app.tsx')?.symbols).toEqual(['default']);
    expect(getFrameworkSeed('/repo/pages/_document.tsx')?.symbols).toEqual(['default']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — Next.js middleware', () => {
  it('matches root middleware.ts', () => {
    const seed = getFrameworkSeed('/repo/middleware.ts');
    expect(seed?.why).toBe('Next.js middleware');
    expect(seed?.symbols).toEqual(['default', 'middleware', 'config']);
  });

  it('matches src/middleware.ts via the same pattern (general `**/middleware.ext`)', () => {
    const seed = getFrameworkSeed('/repo/src/middleware.ts');
    expect(seed?.why).toBe('Next.js middleware');
    expect(seed?.symbols).toContain('middleware');
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — non-matches', () => {
  it.each([
    '/repo/src/utils/helpers.ts',
    '/repo/src/lib/auth.ts',
    '/repo/src/components/Button.tsx',
    '/repo/page.tsx', // not under app/ or pages/
    '/repo/src/app-other/page.tsx', // app-other is not app
  ])('does not match unrelated path `%s`', (path) => {
    expect(getFrameworkSeed(path)).toBeUndefined();
  });
});

// Phase 4 step 7b — edge-case Next.js conventions. These were the gaps
// Codex+Gemini flagged in the plan-review pass: parallel routes, metadata
// image files, instrumentation, mdx-components, and the v16 middleware →
// proxy rename. Every seed is symbol-scoped — same invariant as 7a.
describe('KNOWN_FRAMEWORK_SEEDS — parallel routes (step 7b)', () => {
  it('matches app/@slot/default.tsx to default-only seed', () => {
    const seed = getFrameworkSeed('/repo/src/app/@modal/default.tsx');
    expect(seed?.why).toBe('Next.js App Router parallel-route default');
    expect(seed?.symbols).toEqual(['default']);
  });

  it('matches a nested default.tsx anywhere under app/', () => {
    const seed = getFrameworkSeed('/repo/src/app/(group)/users/@side/default.tsx');
    expect(seed?.why).toBe('Next.js App Router parallel-route default');
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — auth-flow special files (step 7b)', () => {
  it.each([
    ['forbidden.tsx', 'Next.js App Router forbidden'],
    ['unauthorized.tsx', 'Next.js App Router unauthorized'],
    ['global-not-found.tsx', 'Next.js App Router global-not-found'],
  ])('matches `%s` to a default-only seed', (filename, why) => {
    const seed = getFrameworkSeed(`/repo/src/app/${filename}`);
    expect(seed?.why).toBe(why);
    expect(seed?.symbols).toEqual(['default']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — metadata route handlers (step 7b)', () => {
  it('matches sitemap.ts to default + generateSitemaps', () => {
    const seed = getFrameworkSeed('/repo/src/app/sitemap.ts');
    expect(seed?.why).toBe('Next.js App Router sitemap');
    expect(seed?.symbols).toEqual(['default', 'generateSitemaps']);
  });

  it('matches robots.ts to default-only', () => {
    const seed = getFrameworkSeed('/repo/src/app/robots.ts');
    expect(seed?.why).toBe('Next.js App Router robots');
    expect(seed?.symbols).toEqual(['default']);
  });

  it('matches manifest.ts to default-only', () => {
    expect(getFrameworkSeed('/repo/src/app/manifest.ts')?.symbols).toEqual(['default']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — image metadata files (step 7b)', () => {
  it.each([
    ['icon.tsx', 'Next.js App Router icon'],
    ['apple-icon.tsx', 'Next.js App Router apple-icon'],
    ['opengraph-image.tsx', 'Next.js App Router opengraph-image'],
    ['twitter-image.tsx', 'Next.js App Router twitter-image'],
  ])('matches `%s` with default + image metadata exports', (filename, why) => {
    const seed = getFrameworkSeed(`/repo/src/app/${filename}`);
    expect(seed?.why).toBe(why);
    expect(seed?.symbols).toEqual(['default', 'generateImageMetadata', 'alt', 'size', 'contentType']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — instrumentation + mdx-components (step 7b)', () => {
  it('matches root instrumentation.ts to register + onRequestError', () => {
    const seed = getFrameworkSeed('/repo/instrumentation.ts');
    expect(seed?.why).toBe('Next.js instrumentation');
    expect(seed?.symbols).toEqual(['register', 'onRequestError']);
  });

  it('matches instrumentation-client.ts to onRouterTransitionStart', () => {
    const seed = getFrameworkSeed('/repo/src/instrumentation-client.ts');
    expect(seed?.why).toBe('Next.js instrumentation-client');
    expect(seed?.symbols).toEqual(['onRouterTransitionStart']);
  });

  it('matches mdx-components.tsx to useMDXComponents only', () => {
    const seed = getFrameworkSeed('/repo/mdx-components.tsx');
    expect(seed?.why).toBe('Next.js mdx-components');
    expect(seed?.symbols).toEqual(['useMDXComponents']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — proxy forward-compat (step 7b)', () => {
  it('matches root proxy.ts to default + proxy + config (Next 16+ middleware rename)', () => {
    const seed = getFrameworkSeed('/repo/proxy.ts');
    expect(seed?.why).toBe('Next.js proxy (v16 middleware rename)');
    expect(seed?.symbols).toEqual(['default', 'proxy', 'config']);
  });
});

// Phase 4 follow-up — Nuxt 3+ conventions. SCOPE: only Nuxt-specific
// path shapes are seeded. Generic top-level `middleware/`, `plugins/`,
// `modules/`, `composables/` dirs are NOT seeded because non-Nuxt
// projects with similarly-named dirs would over-mark stale code as
// public-API. Vue SFCs (`.vue`) are not reviewed at all so
// `pages/**/*.vue`, `layouts/**/*.vue`, `components/**/*.vue` are
// intentionally absent.
describe('KNOWN_FRAMEWORK_SEEDS — Nuxt server routes', () => {
  it.each([
    ['server/api/users.ts', 'Nuxt server/api handler'],
    ['server/api/users/[id].ts', 'Nuxt server/api handler'],
    ['server/middleware/auth.ts', 'Nuxt server/middleware handler'],
    ['server/plugins/init.ts', 'Nuxt server/plugins handler'],
    ['server/routes/sitemap.xml.ts', 'Nuxt server/routes handler'],
  ])('matches `%s` to default-only seed (%s)', (relPath, why) => {
    const seed = getFrameworkSeed(`/repo/${relPath}`);
    expect(seed?.why).toBe(why);
    expect(seed?.symbols).toEqual(['default']);
  });

  it('matches js variants of Nuxt server handlers', () => {
    const seed = getFrameworkSeed('/repo/server/api/legacy.js');
    expect(seed?.why).toBe('Nuxt server/api handler');
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — Nuxt config', () => {
  it.each([
    ['/repo/nuxt.config.ts', 'Nuxt config'],
    ['/repo/nuxt.config.js', 'Nuxt config'],
  ])('matches `%s` to default-only seed', (path, why) => {
    const seed = getFrameworkSeed(path);
    expect(seed?.why).toBe(why);
    expect(seed?.symbols).toEqual(['default']);
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — Nuxt scope-narrowing', () => {
  // Confirm we did NOT introduce broad seeds that would over-match
  // non-Nuxt projects. A top-level `middleware/` dir in an arbitrary
  // codebase must not inherit Nuxt's default-export public-API status
  // — otherwise stale middlewares get silently silenced.
  it('does NOT match a non-Nuxt top-level middleware/ file', () => {
    expect(getFrameworkSeed('/repo/middleware/auth.ts')).toBeUndefined();
  });

  it('does NOT match a non-Nuxt top-level plugins/ file', () => {
    expect(getFrameworkSeed('/repo/plugins/setup.ts')).toBeUndefined();
  });

  it('does NOT match a non-Nuxt top-level composables/ file', () => {
    expect(getFrameworkSeed('/repo/composables/useFoo.ts')).toBeUndefined();
  });
});

describe('KNOWN_FRAMEWORK_SEEDS — invariants', () => {
  it('every seed lists at least one symbol (no whole-file or empty seeds)', () => {
    for (const seed of KNOWN_FRAMEWORK_SEEDS) {
      expect(seed.symbols.length).toBeGreaterThan(0);
    }
  });

  it('every seed has a non-empty `why` string for diagnostics', () => {
    for (const seed of KNOWN_FRAMEWORK_SEEDS) {
      expect(seed.why.length).toBeGreaterThan(0);
    }
  });

  it('api-route pattern wins over the general pages pattern (ordering invariant)', () => {
    // pages/api/users.ts could match BOTH `**/pages/api/**/*.ts` and the
    // general `**/pages/**/*.ts`. The api-specific seed must come first
    // in KNOWN_FRAMEWORK_SEEDS so the api-only `[default, config]` set
    // wins — otherwise getServerSideProps would be falsely treated as
    // public on api routes.
    const apiSeed = getFrameworkSeed('/repo/pages/api/users.ts');
    expect(apiSeed?.why).toBe('Next.js Pages Router API route');
  });
});
