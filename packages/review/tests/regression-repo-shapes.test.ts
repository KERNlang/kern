/**
 * Repo-shape regression fixtures.
 *
 * These tests pin the behavior of `kern review` against the two shapes that
 * were driving the bulk of false positives before Phase 1:
 *
 *   1. **AudioFacets**: Electron app with dynamic handler registration via
 *      `registerModule(fns)`. Every handler is imported, stuffed into a map,
 *      and invoked via property access on the map. Static call-graph can't
 *      resolve those calls, but the handlers ARE imported, so the existing
 *      re-export fix keeps them alive.
 *      Regression to guard against: something in the future breaking the
 *      imported-but-not-called exports live.
 *
 *   2. **Agon**: Monorepo with `packages/core/package.json` carrying
 *      `main: './dist/index.js'` and a hand-curated `src/index.ts` barrel
 *      re-exporting ~80 symbols from neighbour modules. Those symbols are
 *      intentional public API; external packages consume them. Regression:
 *      something breaking the package.json to src public-API resolver so
 *      curated exports get flagged.
 *
 * Each fixture spins up a real directory tree, runs the actual
 * `reviewGraph` pipeline (NOT the in-memory ts-morph shortcut used by unit
 * tests), and asserts on the full end-to-end finding set. This is the layer
 * the AudioFacets + Agon users actually hit.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { clearReviewCache, resetFsProject, reviewGraph } from '../src/index.js';

function makeRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `kern-regression-${prefix}-`));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function deadExportMessages(reports: ReturnType<typeof reviewGraph>, filePath: string): string[] {
  return (
    reports
      .find((r) => r.filePath === filePath)
      ?.findings.filter((f) => f.ruleId === 'dead-export')
      .map((f) => f.message) ?? []
  );
}

describe('Regression: AudioFacets-style dynamic handler registration', () => {
  let repo: string;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    resetFsProject();
    clearReviewCache();
  });

  it('does not flag imported-but-dynamically-dispatched handlers as dead', () => {
    repo = makeRepo('audiofacets');
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['src/**/*'],
    };
    write(join(repo, 'tsconfig.json'), JSON.stringify(tsconfig));
    write(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'audiofacets-electron',
        // No `exports` field; Electron apps are consumed via the electron
        // runtime, not as a library. Public-API resolver has nothing to latch
        // onto; dead-export must still not fire thanks to the "imported =
        // live" rule.
        private: true,
      }),
    );

    // Handler modules exporting functions that get REGISTERED dynamically:
    // never directly called from a file the call-graph can see.
    write(
      join(repo, 'src/ipc/handlers/audio.ts'),
      `export async function loadAudioTrack(id: string): Promise<unknown> { return { id }; }
export async function saveAudioTrack(id: string, blob: Uint8Array): Promise<void> {
  void id; void blob;
}
`,
    );
    write(
      join(repo, 'src/ipc/handlers/project.ts'),
      `export async function openProject(path: string): Promise<unknown> { return { path }; }
export async function closeProject(): Promise<void> {}
`,
    );

    // The registration machinery imports every handler, assembles them into
    // a table, then invokes via property access. The actual call sites
    // (`handler(...)`) can't be statically resolved to any export.
    write(
      join(repo, 'src/ipc/index.ts'),
      `import { loadAudioTrack, saveAudioTrack } from './handlers/audio.js';
import { closeProject, openProject } from './handlers/project.js';

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

const HANDLERS: Record<string, HandlerFn> = {
  'audio:load': loadAudioTrack as HandlerFn,
  'audio:save': saveAudioTrack as HandlerFn,
  'project:open': openProject as HandlerFn,
  'project:close': closeProject as HandlerFn,
};

export async function dispatch(channel: string, args: unknown[]): Promise<unknown> {
  const handler = HANDLERS[channel];
  if (!handler) throw new Error('unknown channel');
  return handler(...args);
}
`,
    );

    // Main entry uses dispatch(), keeping the module graph connected.
    write(join(repo, 'src/main.ts'), `import { dispatch } from './ipc/index.js';\nexport const main = dispatch;\n`);

    const reports = reviewGraph([join(repo, 'src/main.ts')], { noCache: true });

    // The four handler exports must not be flagged: imports alone prove
    // they're in use even if dispatch lookups are opaque.
    for (const file of ['src/ipc/handlers/audio.ts', 'src/ipc/handlers/project.ts']) {
      const msgs = deadExportMessages(reports, join(repo, file));
      expect(msgs).toEqual([]);
    }
  });
});

describe('Regression: Agon-style curated barrel (main to src/index.ts)', () => {
  let repo: string;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    resetFsProject();
    clearReviewCache();
  });

  it('treats every export of a curated barrel as public API, even when nothing internal imports them', () => {
    repo = makeRepo('agon-core');
    write(
      join(repo, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }),
    );
    write(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'agon-core',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        // No internal caller for the re-exported symbols below; they exist
        // purely for other packages in the monorepo. Without the public-API
        // resolver, dead-export would flag every one.
      }),
    );

    // Worker module: its exports are re-exported by the barrel only.
    write(
      join(repo, 'src/worker.ts'),
      `export function spawnWorker(task: string): Promise<void> { return Promise.resolve(); }
export function cancelWorker(id: string): void { void id; }
export function listWorkers(): string[] { return []; }
`,
    );

    // Curated barrel: the entire public API of this package.
    write(join(repo, 'src/index.ts'), `export { cancelWorker, listWorkers, spawnWorker } from './worker.js';\n`);

    // Graph is seeded from the barrel (mirrors how `kern review --recursive`
    // would descend into a package's published entry point).
    const reports = reviewGraph([join(repo, 'src/index.ts')], { noCache: true });

    const barrelFindings = deadExportMessages(reports, join(repo, 'src/index.ts'));
    expect(barrelFindings).toEqual([]);

    // The underlying worker.ts is re-exported from the barrel, so those
    // symbols must also not be flagged.
    const workerFindings = deadExportMessages(reports, join(repo, 'src/worker.ts'));
    expect(workerFindings).toEqual([]);
  });

  it('still flags truly-internal dead exports inside the same package', () => {
    repo = makeRepo('agon-core-dead');
    write(
      join(repo, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }),
    );
    write(join(repo, 'package.json'), JSON.stringify({ name: 'agon-core', main: './dist/index.js' }));

    // Internal file never re-exported by the barrel, never imported by the
    // entry. This is a legitimate dead export and the rule MUST still fire.
    write(join(repo, 'src/internal-dead.ts'), `export function neverCalled(): number { return 42; }\n`);
    write(join(repo, 'src/worker.ts'), `export function used(): number { return 1; }\n`);
    write(join(repo, 'src/index.ts'), `export { used } from './worker.js';\n`);

    const reports = reviewGraph([join(repo, 'src/index.ts'), join(repo, 'src/internal-dead.ts')], { noCache: true });

    // If the public-API resolver over-matches (e.g. marks `internal-dead.ts`
    // as public because it lives in the same package), we'd miss this.
    const msgs = deadExportMessages(reports, join(repo, 'src/internal-dead.ts'));
    expect(msgs.some((m) => m.includes('neverCalled'))).toBe(true);
  });
});
