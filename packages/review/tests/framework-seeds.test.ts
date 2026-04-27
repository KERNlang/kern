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
