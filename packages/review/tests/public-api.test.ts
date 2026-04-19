/**
 * Public API resolver tests.
 *
 * Regressions that would break without these:
 *   - AudioFacets-style: package with `exports` pointing at a compiled dist entry
 *     that maps back to a src/index.ts — all exports in that src file are public.
 *   - Agon-style: curated `packages/core/src/index.ts` re-exports ~80 symbols —
 *     everything the barrel exports is intentional public API.
 *   - Per-symbol escape hatch from kern.config for packages using runtime
 *     registration (e.g. handler modules loaded dynamically).
 *   - Irrelevant specifiers (missing files on disk) must NOT pollute the map.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Project } from 'ts-morph';
import { buildCallGraph } from '../src/call-graph.js';
import { resolveImportGraph } from '../src/graph.js';
import { buildPublicApiMap, isPublicApi, resolvePackageEntryFiles, resolveSpecifierToSrc } from '../src/public-api.js';
import { deadExportRule } from '../src/rules/dead-code.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'kern-publicapi-'));
}

function writePkg(root: string, pkg: Record<string, unknown>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('resolveSpecifierToSrc', () => {
  it('maps ./dist/index.js to ./src/index.ts when the src file exists', () => {
    const exists = (p: string) => p.endsWith('/foo/src/index.ts');
    const resolved = resolveSpecifierToSrc('/foo', './dist/index.js', exists);
    expect(resolved).toBe('/foo/src/index.ts');
  });

  it('maps ./dist/index.js to ./src/index.tsx when only the .tsx variant exists', () => {
    const exists = (p: string) => p.endsWith('/foo/src/index.tsx');
    const resolved = resolveSpecifierToSrc('/foo', './dist/index.js', exists);
    expect(resolved).toBe('/foo/src/index.tsx');
  });

  it('returns undefined when nothing plausible exists', () => {
    const resolved = resolveSpecifierToSrc('/foo', './dist/index.js', () => false);
    expect(resolved).toBeUndefined();
  });

  it('refuses bare specifiers (package names, not relative paths)', () => {
    const exists = () => true;
    expect(resolveSpecifierToSrc('/foo', 'react', exists)).toBeUndefined();
  });

  it('resolves directory specifiers by trying index.ts(x)', () => {
    const exists = (p: string) => p.endsWith('/foo/src/index.ts');
    expect(resolveSpecifierToSrc('/foo', './src', exists)).toBe('/foo/src/index.ts');
  });

  it('accepts a direct .ts specifier', () => {
    const exists = (p: string) => p === '/foo/src/entry.ts';
    expect(resolveSpecifierToSrc('/foo', './src/entry.ts', exists)).toBe('/foo/src/entry.ts');
  });
});

describe('resolvePackageEntryFiles', () => {
  it('handles the conditional exports shape { ".": { import, require, types } }', () => {
    const pkg = {
      exports: {
        '.': {
          import: './dist/index.js',
          require: './dist/index.cjs',
          types: './dist/index.d.ts',
        },
      },
    };
    const exists = (p: string) => p === '/pkg/src/index.ts';
    const files = resolvePackageEntryFiles('/pkg', pkg, exists);
    expect(files).toEqual(['/pkg/src/index.ts']);
  });

  it('covers main/module/types when exports is absent', () => {
    const pkg = { main: './dist/index.js', module: './dist/index.mjs', types: './dist/index.d.ts' };
    const exists = (p: string) => p === '/pkg/src/index.ts';
    const files = resolvePackageEntryFiles('/pkg', pkg, exists);
    expect(files).toEqual(['/pkg/src/index.ts']);
  });

  it('covers bin as both string and object forms', () => {
    const stringBin = resolvePackageEntryFiles('/pkg', { bin: './dist/cli.js' }, (p) => p === '/pkg/src/cli.ts');
    expect(stringBin).toEqual(['/pkg/src/cli.ts']);

    const objectBin = resolvePackageEntryFiles(
      '/pkg',
      { bin: { kern: './dist/cli.js', 'kern-gaps': './dist/gaps.js' } },
      (p) => p === '/pkg/src/cli.ts' || p === '/pkg/src/gaps.ts',
    );
    expect(objectBin.sort()).toEqual(['/pkg/src/cli.ts', '/pkg/src/gaps.ts']);
  });

  it('falls back to src/index.ts even when package.json has no entry fields', () => {
    const exists = (p: string) => p === '/pkg/src/index.ts';
    const files = resolvePackageEntryFiles('/pkg', {}, exists);
    expect(files).toEqual(['/pkg/src/index.ts']);
  });

  it('drops specifiers whose source files do not exist', () => {
    const pkg = { exports: { '.': './dist/index.js', './sub': './dist/sub.js' } };
    const exists = (p: string) => p === '/pkg/src/index.ts';
    const files = resolvePackageEntryFiles('/pkg', pkg, exists);
    expect(files).toEqual(['/pkg/src/index.ts']);
  });

  it('handles arrays of specifiers (conditional export fallbacks)', () => {
    const pkg = { exports: { '.': { default: ['./dist/a.js', './dist/b.js'] } } };
    const exists = (p: string) => p === '/pkg/src/a.ts' || p === '/pkg/src/b.ts';
    const files = resolvePackageEntryFiles('/pkg', pkg, exists);
    expect(files.sort()).toEqual(['/pkg/src/a.ts', '/pkg/src/b.ts']);
  });
});

describe('buildPublicApiMap (filesystem)', () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('treats every export of a package.json exports target as public', () => {
    tmp = makeTmp();
    writePkg(tmp, { name: 'agon-core', exports: './dist/index.js' });
    writeFile(join(tmp, 'src/index.ts'), `export function publicA() {}\nexport function publicB() {}\n`);
    writeFile(join(tmp, 'src/internal.ts'), `export function helper() {}\n`);

    const map = buildPublicApiMap([join(tmp, 'src/index.ts'), join(tmp, 'src/internal.ts')]);

    expect(isPublicApi(map, join(tmp, 'src/index.ts'), 'publicA')).toBe(true);
    expect(isPublicApi(map, join(tmp, 'src/index.ts'), 'publicB')).toBe(true);
    expect(isPublicApi(map, join(tmp, 'src/internal.ts'), 'helper')).toBe(false);
  });

  it('falls back to src/index.ts when package.json has no entry fields', () => {
    tmp = makeTmp();
    writePkg(tmp, { name: 'bare' });
    writeFile(join(tmp, 'src/index.ts'), `export function entry() {}\n`);

    const map = buildPublicApiMap([join(tmp, 'src/index.ts')]);
    expect(isPublicApi(map, join(tmp, 'src/index.ts'), 'entry')).toBe(true);
  });

  it('applies config overrides for file globs (absolute path) and per-symbol entries', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const handlers = join(tmp, 'src/handlers/foo.ts');
    writeFile(handlers, `export function handleFoo() {}\n`);

    const map = buildPublicApiMap([handlers], {
      files: [handlers],
      symbols: [`${handlers}#handleFoo`],
      projectRoot: tmp,
    });
    expect(isPublicApi(map, handlers, 'handleFoo')).toBe(true);
  });

  it('resolves overrides paths relative to projectRoot', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const handlers = join(tmp, 'src/handlers/foo.ts');
    writeFile(handlers, `export function handleFoo() {}\n`);

    const map = buildPublicApiMap([handlers], {
      files: ['src/handlers/foo.ts'],
      projectRoot: tmp,
    });
    expect(isPublicApi(map, handlers, 'handleFoo')).toBe(true);
  });

  it('handles a package with no package.json above the file without throwing', () => {
    tmp = makeTmp();
    const orphan = join(tmp, 'orphan/file.ts');
    writeFile(orphan, `export function solo() {}\n`);
    // No package.json written at tmp or above — buildPublicApiMap should return an empty map.
    const map = buildPublicApiMap([orphan]);
    expect(isPublicApi(map, orphan, 'solo')).toBe(false);
  });
});

describe('dead-export + public-api integration', () => {
  function createProject(): Project {
    return new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
  }

  it('still flags a truly dead export when publicApi is empty', () => {
    const project = createProject();
    project.createSourceFile('/src/main.ts', `import { used } from './lib.js';\nexport function main() { used(); }\n`);
    project.createSourceFile(
      '/src/lib.ts',
      `export function used() { return 1; }\nexport function dead() { return 2; }\n`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);
    const findings = deadExportRule(callGraph, '/src/lib.ts');

    expect(findings.some((f) => f.message.includes('dead'))).toBe(true);
  });

  it('suppresses dead-export for a file declared as a public entry', () => {
    const project = createProject();
    project.createSourceFile('/src/main.ts', `import { used } from './lib.js';\nexport function main() { used(); }\n`);
    project.createSourceFile(
      '/src/lib.ts',
      `export function used() { return 1; }\nexport function dead() { return 2; }\n`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const publicApi = {
      entryFiles: new Set(['/src/lib.ts']),
      explicitSymbols: new Set<string>(),
    };
    const findings = deadExportRule(callGraph, '/src/lib.ts', publicApi);

    expect(findings.length).toBe(0);
  });

  it('suppresses dead-export for a single symbol via explicitSymbols', () => {
    const project = createProject();
    project.createSourceFile('/src/main.ts', `import { used } from './lib.js';\nexport function main() { used(); }\n`);
    project.createSourceFile(
      '/src/lib.ts',
      `export function used() { return 1; }\nexport function registerHandler() { return 2; }\nexport function trulyDead() { return 3; }\n`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const publicApi = {
      entryFiles: new Set<string>(),
      explicitSymbols: new Set(['/src/lib.ts#registerHandler']),
    };
    const findings = deadExportRule(callGraph, '/src/lib.ts', publicApi);

    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes('registerHandler'))).toBe(false);
    expect(messages.some((m) => m.includes('trulyDead'))).toBe(true);
  });
});
