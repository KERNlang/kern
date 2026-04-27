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
