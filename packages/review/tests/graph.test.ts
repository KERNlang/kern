import { Project } from 'ts-morph';
import { resolveImportGraph } from '../src/graph.js';

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

describe('resolveImportGraph', () => {
  it('resolves basic 2-file import', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { foo } from './b.js';\nexport const a = foo;`);
    project.createSourceFile('/src/b.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    const fileA = result.files.find(f => f.path.includes('a.ts'))!;
    const fileB = result.files.find(f => f.path.includes('b.ts'))!;
    expect(fileA.distance).toBe(0);
    expect(fileB.distance).toBe(1);
    expect(fileA.imports).toContain(fileB.path);
    expect(fileB.importedBy).toContain(fileA.path);
  });

  it('handles circular imports', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { b } from './b.js';\nexport const a = 1;`);
    project.createSourceFile('/src/b.ts', `import { a } from './a.js';\nexport const b = 2;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    const fileA = result.files.find(f => f.path.includes('a.ts'))!;
    const fileB = result.files.find(f => f.path.includes('b.ts'))!;
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
    expect(result.files.find(f => f.path.includes('d.ts'))).toBeUndefined();
  });

  it('resolves barrel file (index.ts re-exports)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { foo } from './lib/index.js';`);
    project.createSourceFile('/src/lib/index.ts', `export { foo } from './foo.js';`);
    project.createSourceFile('/src/lib/foo.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(3);
    const barrel = result.files.find(f => f.path.includes('index.ts'))!;
    expect(barrel.distance).toBe(1);
    const foo = result.files.find(f => f.path.includes('foo.ts'))!;
    expect(foo.distance).toBe(2);
  });

  it('excludes node_modules imports', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', [
      `import { foo } from './b.js';`,
      `import { bar } from 'some-package';`,
    ].join('\n'));
    project.createSourceFile('/src/b.ts', `export const foo = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    expect(result.files).toHaveLength(2);
    expect(result.files.every(f => !f.path.includes('node_modules'))).toBe(true);
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
    project.createSourceFile('/src/a.ts', [
      `import { foo } from './b.js';`,
      `import { bar } from 'external-pkg';`,  // bare specifier → skipped
    ].join('\n'));
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
    project.createSourceFile('/src/a.ts', [
      `import { b } from './b.js';`,
      `import { c } from './c.js';`,
      `import { d } from './d.js';`,
    ].join('\n'));
    project.createSourceFile('/src/b.ts', `import { d } from './d.js';\nexport const b = 1;`);
    project.createSourceFile('/src/c.ts', `import { d } from './d.js';\nexport const c = 1;`);
    project.createSourceFile('/src/d.ts', `export const d = 1;`);

    const result = resolveImportGraph(['/src/a.ts'], { project });

    const fileD = result.files.find(f => f.path.includes('d.ts'))!;
    expect(fileD.distance).toBe(1); // shortest path: a → d directly
    expect(fileD.importedBy).toContain(result.files.find(f => f.path.includes('a.ts'))!.path);
  });

  it('handles multiple entry files', () => {
    const project = createTestProject();
    project.createSourceFile('/src/a.ts', `import { shared } from './shared.js';`);
    project.createSourceFile('/src/b.ts', `import { shared } from './shared.js';`);
    project.createSourceFile('/src/shared.ts', `export const shared = 1;`);

    const result = resolveImportGraph(['/src/a.ts', '/src/b.ts'], { project });

    expect(result.entryFiles).toHaveLength(2);
    expect(result.totalFiles).toBe(3);
    const sharedFile = result.files.find(f => f.path.includes('shared.ts'))!;
    expect(sharedFile.importedBy).toHaveLength(2);
  });
});
