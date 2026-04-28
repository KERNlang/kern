/**
 * Phase 4 end-to-end fixture (step 10/12).
 *
 * Exercises the full Phase 4 pipeline against a realistic project shape
 * combining every layer the previous steps built:
 *
 *   - canonical-path module (step 1)        — symlink-stable lookups (deferred)
 *   - dynamic-import edges (step 3)         — lazy route reachable end-to-end
 *   - test caller exclusion (step 5)        — *.test.ts not a production caller
 *   - JSON seeds (step 6)                   — package.json `main` carried
 *   - Next.js stable conventions (step 7a)  — page/route default + verbs public
 *   - Next.js edge-case conventions (step 7b)— sitemap default + symbol scope
 *   - default-export alias (step 9a + 9b)   — `default` seed → Page internal
 *   - blocker cap (step 9b)                 — wired through (empty producer)
 *
 * What this test PINS: the load-bearing FP-reduction path Phase 4 was
 * commissioned to deliver. A real Next.js project shape (page, route,
 * sitemap, helper, lazy-loaded module, dead helper, production+test
 * importers) goes through reviewGraph and the report's dead-export
 * findings are exactly what users would see.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewGraph } from '../src/index.js';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'kern-phase4-e2e-'));
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function deadExportMessages(reports: ReturnType<typeof reviewGraph>, filePath: string): string[] {
  const r = reports.find((rep) => rep.filePath === filePath);
  if (!r) return [];
  return r.findings.filter((f) => f.ruleId === 'dead-export').map((f) => f.message);
}

describe('Phase 4 end-to-end (step 10/12)', () => {
  let repo: string;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('keeps Next.js page+route+sitemap symbols out of dead-export, flags the unused helper', () => {
    repo = makeRepo();

    write(
      join(repo, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          allowJs: true,
        },
        include: ['src/**/*'],
      }),
    );
    write(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'my-app',
        main: './dist/index.js',
        types: './dist/index.d.ts',
      }),
    );

    // Curated entry point — exports a util that nothing internally uses
    // but external consumers do. Must NOT be flagged dead (package.json
    // main → src/index.ts seeds whole-file public via step 6).
    write(
      join(repo, 'src/index.ts'),
      `export function publicHelper() { return 42; }\nexport function unusedInPackage() { return 1; }\n`,
    );

    // Next.js App Router page — `export default function Page()`. Step 7a
    // seeds (path, 'default'); step 9a+9b alias default → 'Page' so the
    // call graph's stored name resolves as public.
    write(
      join(repo, 'src/app/page.tsx'),
      `export default function Page() { return null; }\n` +
        `export const metadata = { title: 'Home' };\n` +
        // A stale helper sitting next to the page — must NOT inherit
        // the page's public-API status. Symbol-scope invariant.
        `export function staleHelper() { return 'never used'; }\n`,
    );

    // Route handler — step 7a seeds GET/POST/etc.
    write(
      join(repo, 'src/app/api/users/route.ts'),
      `export async function GET() { return new Response('ok'); }\n` +
        `export async function POST() { return new Response('ok'); }\n`,
    );

    // Sitemap — step 7b seeds default + generateSitemaps.
    write(
      join(repo, 'src/app/sitemap.ts'),
      `export default function sitemap() { return [{ url: '/', lastModified: new Date() }]; }\n`,
    );

    // Lazy-loaded module — reachable via literal dynamic-import (step 3).
    write(join(repo, 'src/lib/lazy.ts'), `export function lazyHandler() { return 'lazy'; }\n`);
    write(
      join(repo, 'src/lib/loader.ts'),
      `export async function load() {\n  const mod = await import('./lazy.js');\n  return mod.lazyHandler();\n}\n`,
    );
    // The page imports the loader so loader is reachable, lazy is reachable
    // via the dynamic-import edge.
    write(
      join(repo, 'src/lib/index.ts'),
      `import { load } from './loader.js';\nexport function bootstrap() { return load(); }\n`,
    );

    // Test caller exclusion (step 5) — only .test.ts imports `testOnly`.
    write(
      join(repo, 'src/lib/dead.ts'),
      `export function testOnly() { return 'only-tests-call-me'; }\nexport function trulyDead() { return 'no-callers'; }\n`,
    );
    write(
      join(repo, 'src/lib/dead.test.ts'),
      `import { testOnly } from './dead.js';\nexport function spec() { return testOnly(); }\n`,
    );

    // Build the graph from a small set of entry files; reviewGraph also
    // walks the package.json + framework conventions to seed the public API.
    const entries = [
      join(repo, 'src/index.ts'),
      join(repo, 'src/app/page.tsx'),
      join(repo, 'src/app/api/users/route.ts'),
      join(repo, 'src/app/sitemap.ts'),
      join(repo, 'src/lib/index.ts'),
      join(repo, 'src/lib/dead.test.ts'),
    ];
    const reports = reviewGraph(entries, { noCache: true });

    // 1. The page's `default` (Page) is NOT flagged — default-alias works.
    const pageMessages = deadExportMessages(reports, join(repo, 'src/app/page.tsx'));
    expect(pageMessages.find((m) => m.includes('Page'))).toBeUndefined();
    expect(pageMessages.find((m) => m.includes('metadata'))).toBeUndefined();
    // But staleHelper IS flagged — symbol-scope invariant holds, no
    // bleed from the page convention.
    expect(pageMessages.some((m) => m.includes('staleHelper'))).toBe(true);

    // 2. Route HTTP-verb exports stay public via step 7a seeds.
    const routeMessages = deadExportMessages(reports, join(repo, 'src/app/api/users/route.ts'));
    expect(routeMessages.find((m) => m.includes('GET'))).toBeUndefined();
    expect(routeMessages.find((m) => m.includes('POST'))).toBeUndefined();

    // 3. Sitemap default stays public via step 7b seeds.
    const sitemapMessages = deadExportMessages(reports, join(repo, 'src/app/sitemap.ts'));
    expect(sitemapMessages).toEqual([]);

    // 4. lazy.ts#lazyHandler reachable via literal dynamic-import (step 3).
    const lazyMessages = deadExportMessages(reports, join(repo, 'src/lib/lazy.ts'));
    expect(lazyMessages.find((m) => m.includes('lazyHandler'))).toBeUndefined();

    // 5. *.test.ts caller does NOT pin dead.ts#testOnly alive (step 5).
    const deadMessages = deadExportMessages(reports, join(repo, 'src/lib/dead.ts'));
    expect(deadMessages.some((m) => m.includes('testOnly'))).toBe(true);
    expect(deadMessages.some((m) => m.includes('trulyDead'))).toBe(true);

    // 6. package.json#main carries publicHelper as public (step 6).
    const indexMessages = deadExportMessages(reports, join(repo, 'src/index.ts'));
    expect(indexMessages.find((m) => m.includes('publicHelper'))).toBeUndefined();
    // unusedInPackage is also at the same entry, so it's also public via
    // whole-file entryFiles seeding — that's the main/exports contract.
    expect(indexMessages.find((m) => m.includes('unusedInPackage'))).toBeUndefined();
  });
});
