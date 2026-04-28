import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Project } from 'ts-morph';
import { resolveImportGraph } from '../src/graph.js';
import type { GraphEdge, ReachabilityBlocker } from '../src/types.js';

function createTestProject(): Project {
  return new Project({
    compilerOptions: {
      strict: true,
      target: 99,
      module: 99,
      moduleResolution: 100, // Bundler
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

const TMP = join(tmpdir(), 'kern-review-graph-tests');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('resolveImportGraph', () => {
  it('resolves basic 2-file import', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { foo } from './b.js';\nexport const a = foo;`);
    project.createSourceFile('/src/b.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    const fileA = result.files.find((f) => f.path.includes('a.ts'))!;
    const fileB = result.files.find((f) => f.path.includes('b.ts'))!;
    expect(fileA.distance).toBe(0);
    expect(fileB.distance).toBe(1);
    expect(fileA.imports).toContain(fileB.path);
    expect(fileB.importedBy).toContain(fileA.path);
    expect(fileA.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named-import',
          importedName: 'foo',
          localName: 'foo',
          to: fileB.path,
        }),
      ]),
    );
  });

  it('handles circular imports', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { b } from './b.js';\nexport const a = 1;`);
    project.createSourceFile('/src/b.ts', `import { a } from './a.js';\nexport const b = 2;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    const fileA = result.files.find((f) => f.path.includes('a.ts'))!;
    const fileB = result.files.find((f) => f.path.includes('b.ts'))!;
    expect(fileA.imports).toContain(fileB.path);
    expect(fileB.imports).toContain(fileA.path);
  });

  it('caps at maxDepth', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { b } from './b.js';`);
    project.createSourceFile('/src/b.ts', `import { c } from './c.js';`);
    project.createSourceFile('/src/c.ts', `import { d } from './d.js';`);
    project.createSourceFile('/src/d.ts', `export const d = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project, maxDepth: 2 });

    // a(0) → b(1) → c(2, discovered but not walked) → d not reached
    expect(result.files).toHaveLength(3);
    expect(result.files.find((f) => f.path.includes('d.ts'))).toBeUndefined();
  });

  it('resolves barrel file (index.ts re-exports)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { foo } from './lib/index.js';`);
    project.createSourceFile('/src/lib/index.ts', `export { foo } from './foo.js';`);
    project.createSourceFile('/src/lib/foo.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(3);
    const barrel = result.files.find((f) => f.path.includes('index.ts'))!;
    expect(barrel.distance).toBe(1);
    const foo = result.files.find((f) => f.path.includes('foo.ts'))!;
    expect(foo.distance).toBe(2);
    expect(barrel.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named-reexport',
          importedName: 'foo',
          localName: 'foo',
          to: foo.path,
        }),
      ]),
    );
  });

  it('records alias metadata for named imports and re-exports', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { baz } from './barrel.js';\nexport const a = baz;`);
    project.createSourceFile('/src/barrel.ts', `export { foo as baz } from './foo.js';`);
    project.createSourceFile('/src/foo.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    const fileA = result.files.find((f) => f.path.includes('a.ts'))!;
    const barrel = result.files.find((f) => f.path.includes('barrel.ts'))!;
    const foo = result.files.find((f) => f.path.includes('foo.ts'))!;

    expect(fileA.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named-import',
          importedName: 'baz',
          localName: 'baz',
          to: barrel.path,
        }),
      ]),
    );
    expect(barrel.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named-reexport',
          importedName: 'foo',
          localName: 'baz',
          to: foo.path,
        }),
      ]),
    );
    expect(foo.incomingEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: barrel.path,
          kind: 'named-reexport',
        }),
      ]),
    );
  });

  it('excludes node_modules imports', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/a.ts',
      [`import { foo } from './b.js';`, `import { bar } from 'some-package';`].join('\n'),
    );
    project.createSourceFile('/src/b.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => !f.path.includes('node_modules'))).toBe(true);
  });

  it('returns empty result for empty input', () => {
    const project = createTestProject();
    const result = resolveImportGraph([], { project });

    expect(result.files).toHaveLength(0);
    expect(result.entryFiles).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('tracks totalFiles and skipped counters', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/a.ts',
      [
        `import { foo } from './b.js';`,
        `import { bar } from 'external-pkg';`, // bare specifier → skipped
      ].join('\n'),
    );
    project.createSourceFile('/src/b.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.totalFiles).toBe(2);
    expect(result.skipped).toBeGreaterThanOrEqual(1); // at least the bare specifier
  });

  it('keeps shortest distance when file reachable via multiple paths', () => {
    const project = createTestProject();
    // a → b → d (distance 2)
    // a → c → d (distance 2)
    // but also a → d directly (distance 1)
    project.createSourceFile(
      '/src/a.ts',
      [`import { b } from './b.js';`, `import { c } from './c.js';`, `import { d } from './d.js';`].join('\n'),
    );
    project.createSourceFile('/src/b.ts', `import { d } from './d.js';\nexport const b = 1;`);
    project.createSourceFile('/src/c.ts', `import { d } from './d.js';\nexport const c = 1;`);
    project.createSourceFile('/src/d.ts', `export const d = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    const fileD = result.files.find((f) => f.path.includes('d.ts'))!;
    expect(fileD.distance).toBe(1); // shortest path: a → d directly
    expect(fileD.importedBy).toContain(result.files.find((f) => f.path.includes('a.ts'))!.path);
  });

  it('handles multiple entry files', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { shared } from './shared.js';`);
    project.createSourceFile('/src/b.ts', `import { shared } from './shared.js';`);
    project.createSourceFile('/src/shared.ts', `export const shared = 1;`);

    const result = resolveImportGraph(['/src/a.ts', '/src/b.ts'], { project });

    expect(result.entryFiles).toHaveLength(2);
    expect(result.totalFiles).toBe(3);
    const sharedFile = result.files.find((f) => f.path.includes('shared.ts'))!;
    expect(sharedFile.importedBy).toHaveLength(2);
  });

  it('resolves extension fallback from filesystem-backed graph review', () => {
    const dir = join(TMP, 'fs-extension-fallback');
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, 'entry.ts');
    const child = join(dir, 'child.ts');
    writeFileSync(entry, `import { child } from './child.js';\nexport const entrypoint = child;\n`);
    writeFileSync(child, `export const child = 1;\n`);

    const result = resolveImportGraph([entry]);
    const entryFile = result.files.find((f) => f.path === entry)!;
    expect(entryFile.imports).toContain(child);
    expect(entryFile.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named-import',
          importedName: 'child',
          localName: 'child',
          to: child,
        }),
      ]),
    );
  });
});

// Phase 4 step 4 — type-only imports/exports are erased at compile time and
// must not contribute caller edges. Without this, `import type { AuthService }`
// or `export type { Foo } from './m'` would mark runtime symbols alive even
// though no runtime reference survives compilation.
describe('Phase 4 type-only import/export skip', () => {
  it("does not emit any edge for `import type { X } from './m'`", () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/consumer.ts',
      `import type { AuthService } from './auth.js';\nexport const x = 1;\n`,
    );
    project.createSourceFile('/src/auth.ts', `export interface AuthService { login(): void }\n`);

    const result = resolveImportGraph(['/src/consumer.ts'], { project });
    const consumer = result.files.find((f) => f.path === '/src/consumer.ts');
    const edgesToAuth = (consumer?.importEdges ?? []).filter((e) => e.to === '/src/auth.ts');
    expect(edgesToAuth).toEqual([]);
  });

  it("skips type-only specifiers in mixed `import { foo, type Bar } from './m'`", () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/mixed.ts',
      `import { runtime, type CompileType } from './m.js';\nexport const out = runtime();\n`,
    );
    project.createSourceFile('/src/m.ts', `export function runtime() {}\nexport interface CompileType {}\n`);

    const result = resolveImportGraph(['/src/mixed.ts'], { project });
    const mixed = result.files.find((f) => f.path === '/src/mixed.ts');
    const namedImports = (mixed?.importEdges ?? []).filter((e) => e.kind === 'named-import');
    expect(namedImports.map((e) => e.importedName)).toEqual(['runtime']);
  });

  it("does not emit a re-export edge for `export type { X } from './m'`", () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel.ts', `export type { Shape } from './shape.js';\n`);
    project.createSourceFile('/src/shape.ts', `export interface Shape { x: number }\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });
    const barrel = result.files.find((f) => f.path === '/src/barrel.ts');
    const reexports = (barrel?.importEdges ?? []).filter((e) => e.kind === 'named-reexport' || e.kind === 'export-all');
    expect(reexports).toEqual([]);
  });

  it("skips type-only specifiers in mixed `export { foo, type Bar } from './m'`", () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel2.ts', `export { runtime, type Shape } from './m.js';\n`);
    project.createSourceFile('/src/m.ts', `export function runtime() {}\nexport interface Shape {}\n`);

    const result = resolveImportGraph(['/src/barrel2.ts'], { project });
    const barrel = result.files.find((f) => f.path === '/src/barrel2.ts');
    const reexportNames = (barrel?.importEdges ?? [])
      .filter((e) => e.kind === 'named-reexport')
      .map((e) => e.importedName);
    expect(reexportNames).toEqual(['runtime']);
  });
});

// Phase 4 step 3 — literal dynamic-import tracing. Without this, lazy routes
// like `await import('./routes/users')` are invisible to the graph and the
// target's exports get flagged dead. Red-team #5: ts-morph models the call
// expression as SyntaxKind.ImportKeyword, NOT as an Identifier with text
// "import" — getting this wrong silently skips every dynamic import.
describe('Phase 4 dynamic-import edge emission', () => {
  it("emits a 'dynamic-import' edge when import('./mod') has a string-literal specifier", () => {
    const project = createTestProject();
    project.createSourceFile('/src/router.ts', `async function go() { await import('./users.js'); }\n`);
    project.createSourceFile('/src/users.ts', `export function getUser() { return null; }\n`);

    const result = resolveImportGraph(['/src/router.ts'], { project });
    const router = result.files.find((f) => f.path === '/src/router.ts');
    expect(router?.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dynamic-import',
          specifier: './users.js',
          to: '/src/users.ts',
        }),
      ]),
    );
  });

  it('also recognizes NoSubstitutionTemplateLiteral specifiers (`import(`./mod`)`)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/loader.ts', 'async function load() { await import(`./feature`); }\n');
    project.createSourceFile('/src/feature.ts', 'export const FEATURE_ID = "x";\n');

    const result = resolveImportGraph(['/src/loader.ts'], { project });
    const loader = result.files.find((f) => f.path === '/src/loader.ts');
    expect(loader?.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dynamic-import',
          to: '/src/feature.ts',
        }),
      ]),
    );
  });

  it('does NOT emit an edge when the specifier is non-literal (deferred to step 9b blocker)', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/router2.ts',
      `const ROUTES: Record<string, string> = { a: './a' };\nasync function go(role: string) { await import(ROUTES[role]); }\n`,
    );
    project.createSourceFile('/src/a.ts', `export function aHandler() {}\n`);

    const result = resolveImportGraph(['/src/router2.ts'], { project });
    const router = result.files.find((f) => f.path === '/src/router2.ts');
    const dynEdges = router?.importEdges.filter((e) => e.kind === 'dynamic-import') ?? [];
    expect(dynEdges).toEqual([]);
  });

  it('static-import and dynamic-import to the same target coexist as separate edges', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/dual.ts',
      `import { eager } from './target.js';\nasync function lazy() { await import('./target.js'); }\nexport const e = eager;\n`,
    );
    project.createSourceFile('/src/target.ts', `export function eager() {}\n`);

    const result = resolveImportGraph(['/src/dual.ts'], { project });
    const dual = result.files.find((f) => f.path === '/src/dual.ts');
    const kindsToTarget = (dual?.importEdges ?? []).filter((e) => e.to === '/src/target.ts').map((e) => e.kind);
    expect(kindsToTarget).toContain('named-import');
    expect(kindsToTarget).toContain('dynamic-import');
  });
});

// Phase 4 step 2 — type-shape contract tests. These are compile-time-asserted
// by tsc, but a runtime check guards against accidental breaking changes
// landing in types.ts that wouldn't surface until step 3 (graph.ts emit) or
// step 9b (rules/dead-code.ts consumer) starts using them.
describe('Phase 4 reachability types', () => {
  it('GraphEdgeKind accepts the dynamic-import variant', () => {
    const edge: GraphEdge = {
      from: '/a.ts',
      to: '/b.ts',
      specifier: './b.js',
      kind: 'dynamic-import',
      via: 'ts-morph',
    };
    expect(edge.kind).toBe('dynamic-import');
  });

  it('ReachabilityBlocker carries symbol scope (filePath, exportName) and the reason', () => {
    const blocker: ReachabilityBlocker = {
      reason: 'non-literal-dynamic-import',
      filePath: '/routes.ts',
      exportName: 'getUser',
      site: { file: '/router.ts', line: 42 },
    };

    // Symbol scope: the (filePath, exportName) tuple is the key red-team v3
    // showed that a file-only blocker silenced 50 unrelated symbols.
    expect(blocker.filePath).toBe('/routes.ts');
    expect(blocker.exportName).toBe('getUser');
    expect(blocker.site.line).toBe(42);
  });

  it('ReachabilityBlockerReason covers the three documented failure modes', () => {
    const reasons: ReachabilityBlocker['reason'][] = [
      'non-literal-dynamic-import',
      'unresolved-re-export',
      'unmapped-public-surface',
    ];
    expect(reasons).toHaveLength(3);
  });
});

// Phase 4 follow-up — concrete blocker producers wired in graph.ts.
//   Producer 1: named re-export with relative specifier whose target ts-morph
//               cannot resolve (and extension fallback fails too) emits a
//               symbol-scoped ReachabilityBlocker on the importing file's
//               localName. Bare specifiers and resolved re-exports must NOT
//               produce blockers — bare = missing dep / external dep, both
//               handled elsewhere; resolved = no failure to record.
//   Producer 2: non-literal `import(expr)` increments
//               GraphResult.unmappedDynamicImports. NEVER produces a blocker
//               (red-team CRITICAL #1 invariant). Edge stays absent (already
//               covered by the "does NOT emit an edge" test above).
describe('Producer 1 — unresolved named re-export → blocker', () => {
  it('emits a blocker on the importing file localName when relative target does not resolve', () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel.ts', `export { foo } from './missing.js';\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });

    expect(result.blockers).toBeDefined();
    expect(result.blockers).toHaveLength(1);
    const b = result.blockers![0]!;
    expect(b.reason).toBe('unresolved-re-export');
    expect(b.filePath).toBe('/src/barrel.ts');
    expect(b.exportName).toBe('foo');
    expect(b.site.file).toBe('/src/barrel.ts');
    expect(b.site.line).toBeGreaterThan(0);
  });

  it('uses the local alias when the re-export renames', () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel.ts', `export { foo as bar } from './missing.js';\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers![0]!.exportName).toBe('bar');
  });

  it('does NOT emit a blocker when the re-export target resolves cleanly', () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel.ts', `export { foo } from './worker.js';\n`);
    project.createSourceFile('/src/worker.ts', `export function foo() {}\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });
    expect(result.blockers ?? []).toHaveLength(0);
  });

  it('does NOT emit a blocker for unresolved bare specifiers (missing dep, not unknowable target)', () => {
    const project = createTestProject();
    // Bare specifier — the dead-export rule's package-public-API logic
    // already handles symbols re-exported to external consumers. Producing
    // a blocker here would double-cap and obscure missing-dep diagnostics.
    project.createSourceFile('/src/barrel.ts', `export { foo } from 'some-missing-pkg';\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });
    expect(result.blockers ?? []).toHaveLength(0);
  });

  it('does NOT emit a blocker for `export * from` (cannot pin to a single export name)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/barrel.ts', `export * from './missing.js';\n`);

    const result = resolveImportGraph(['/src/barrel.ts'], { project });
    // export-all has no localName to attach a symbol-scoped blocker to.
    // Falling back to file scope would re-introduce red-team CRITICAL #1.
    expect(result.blockers ?? []).toHaveLength(0);
  });

  it('emits one blocker per unresolved named re-export, symbol-scoped', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/barrel.ts',
      `export { foo, bar } from './missing.js';\nexport { baz } from './also-missing.js';\n`,
    );

    const result = resolveImportGraph(['/src/barrel.ts'], { project });
    expect(result.blockers).toHaveLength(3);
    const names = (result.blockers ?? []).map((b) => b.exportName).sort();
    expect(names).toEqual(['bar', 'baz', 'foo']);
  });
});

describe('Producer 2 — non-literal dynamic import → telemetry counter', () => {
  it('increments unmappedDynamicImports for `import(expr)` and emits NO blocker', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/router.ts',
      `const ROUTES: Record<string, string> = { a: './a' };\nasync function go(role: string) { await import(ROUTES[role]); }\n`,
    );
    project.createSourceFile('/src/a.ts', `export function aHandler() {}\n`);

    const result = resolveImportGraph(['/src/router.ts'], { project });

    expect(result.unmappedDynamicImports).toBe(1);
    // Symbol scope is unknowable — must NEVER produce a blocker.
    expect(result.blockers ?? []).toHaveLength(0);
  });

  it('counts every non-literal call site, not just the first', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/router.ts',
      `declare const a: string;\ndeclare const b: string;\nasync function go() { await import(a); await import(b); }\n`,
    );

    const result = resolveImportGraph(['/src/router.ts'], { project });
    expect(result.unmappedDynamicImports).toBe(2);
  });

  it('literal dynamic imports do NOT count toward the telemetry counter', () => {
    const project = createTestProject();
    project.createSourceFile('/src/loader.ts', `async function go() { await import('./feature.js'); }\n`);
    project.createSourceFile('/src/feature.ts', `export function featureHandler() {}\n`);

    const result = resolveImportGraph(['/src/loader.ts'], { project });
    expect(result.unmappedDynamicImports ?? 0).toBe(0);
  });
});

// The previous static-import catch silently swallowed every ts-morph
// error during decl processing — operators had no signal that analysis
// degraded. Now we count + surface via review-health (and log under
// KERN_DEBUG). The counter must be ZERO on healthy input so the health
// surface only fires when something actually went wrong.
describe('Malformed-import telemetry counter', () => {
  it('counts zero for well-formed source', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { foo } from './b.js';\nexport const a = foo;\n`);
    project.createSourceFile('/src/b.ts', `export const foo = 1;\n`);

    const result = resolveImportGraph(['/src/a.ts'], { project });
    expect(result.malformedImports ?? 0).toBe(0);
  });

  it('exposes a malformedImports field on GraphResult (shape contract)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/empty.ts', '');

    const result = resolveImportGraph(['/src/empty.ts'], { project });
    // Field shape contract: the GraphResult API must expose the counter
    // even when no failures occurred. Triggering an actual ts-morph throw
    // from a synthetic in-memory fixture is unreliable (ts-morph's parser
    // recovers from most malformations); the contract test guards against
    // accidentally dropping the field from the public shape.
    expect(typeof result.malformedImports).toBe('number');
  });
});
