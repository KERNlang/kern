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

  it('expands single-star globs in overrides.files against the reviewed file list', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const pkgA = join(tmp, 'packages/a/src/index.ts');
    const pkgB = join(tmp, 'packages/b/src/index.ts');
    const internal = join(tmp, 'packages/a/src/internal.ts');
    writeFile(pkgA, `export function a() {}\n`);
    writeFile(pkgB, `export function b() {}\n`);
    writeFile(internal, `export function hidden() {}\n`);

    const map = buildPublicApiMap([pkgA, pkgB, internal], {
      files: ['packages/*/src/index.ts'],
      projectRoot: tmp,
    });

    expect(isPublicApi(map, pkgA, 'a')).toBe(true);
    expect(isPublicApi(map, pkgB, 'b')).toBe(true);
    expect(isPublicApi(map, internal, 'hidden')).toBe(false);
  });

  it('expands double-star globs across nested directories', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    // Zero-segment case: `**/` should match no separator segments, so
    // `src/**/*.ts` must also match a file directly under `src/`.
    const flat = join(tmp, 'src/flat.ts');
    const shallow = join(tmp, 'src/handlers/foo.ts');
    const deep = join(tmp, 'src/registry/v2/bar.ts');
    const outside = join(tmp, 'other/root.ts');
    writeFile(flat, `export function flat() {}\n`);
    writeFile(shallow, `export function foo() {}\n`);
    writeFile(deep, `export function bar() {}\n`);
    writeFile(outside, `export function root() {}\n`);

    const map = buildPublicApiMap([flat, shallow, deep, outside], {
      files: ['src/**/*.ts'],
      projectRoot: tmp,
    });

    expect(isPublicApi(map, flat, 'flat')).toBe(true);
    expect(isPublicApi(map, shallow, 'foo')).toBe(true);
    expect(isPublicApi(map, deep, 'bar')).toBe(true);
    expect(isPublicApi(map, outside, 'root')).toBe(false);
  });

  it('keeps literal paths as-is even when they are not in the reviewed file list', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const handler = join(tmp, 'src/handler.ts');
    writeFile(handler, `export function handle() {}\n`);

    // Literal path for a file NOT passed to buildPublicApiMap — should still
    // be added verbatim (backward compatible with pre-glob behavior).
    const map = buildPublicApiMap([handler], {
      files: ['src/handler.ts', 'src/not-in-graph.ts'],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(handler)).toBe(true);
    expect(map.entryFiles.has(join(tmp, 'src/not-in-graph.ts'))).toBe(true);
  });

  it('combines literal paths and globs in the same config', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const literal = join(tmp, 'src/literal.ts');
    const matchesGlob = join(tmp, 'src/a.entry.ts');
    const other = join(tmp, 'src/b.ts');
    writeFile(literal, `export function l() {}\n`);
    writeFile(matchesGlob, `export function a() {}\n`);
    writeFile(other, `export function b() {}\n`);

    const map = buildPublicApiMap([literal, matchesGlob, other], {
      files: ['src/literal.ts', 'src/*.entry.ts'],
      projectRoot: tmp,
    });

    expect(isPublicApi(map, literal, 'l')).toBe(true);
    expect(isPublicApi(map, matchesGlob, 'a')).toBe(true);
    expect(isPublicApi(map, other, 'b')).toBe(false);
  });

  it('accepts absolute glob patterns', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const entry = join(tmp, 'src/pages/home.ts');
    writeFile(entry, `export default function Home() {}\n`);

    const map = buildPublicApiMap([entry], {
      files: [join(tmp, 'src/pages/*.ts')],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(entry)).toBe(true);
  });

  it('a glob that matches nothing in the reviewed file list contributes nothing beyond the literal', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const file = join(tmp, 'src/other.ts');
    writeFile(file, `export function x() {}\n`);

    // The glob points at a directory layout that doesn't exist in the reviewed
    // files. The resolved literal pattern is added (harmless — it will never
    // match any real file because it still contains glob syntax), but no
    // expansion contributes real files.
    const map = buildPublicApiMap([file], {
      files: ['packages/*/src/index.ts'],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(file)).toBe(false);
  });

  it('treats Next.js-style literal brackets as a real filename, not a glob character class', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    // Next.js dynamic route segment — real filename contains `[slug]`.
    const page = join(tmp, 'src/app/[slug]/page.tsx');
    const otherPage = join(tmp, 'src/app/s/page.tsx');
    writeFile(page, `export default function Page() {}\n`);
    writeFile(otherPage, `export default function OtherPage() {}\n`);

    const map = buildPublicApiMap([page, otherPage], {
      files: ['src/app/[slug]/page.tsx'],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(page)).toBe(true);
    // The bracketed pattern is ALSO expanded as a glob, so a path like
    // `src/app/s/page.tsx` (where `s` is in the char class `[slug]`) matches.
    // That's acceptable — a user who genuinely wanted the literal Next.js
    // route gets it; a user who wanted `[slug]` as a char class gets that
    // too. Both semantics satisfied.
    expect(map.entryFiles.has(otherPage)).toBe(true);
  });

  it('translates POSIX negated character class [!abc] to regex [^abc]', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const a = join(tmp, 'src/a.ts');
    const b = join(tmp, 'src/b.ts');
    const x = join(tmp, 'src/x.ts');
    writeFile(a, `export const a = 1;\n`);
    writeFile(b, `export const b = 1;\n`);
    writeFile(x, `export const x = 1;\n`);

    const map = buildPublicApiMap([a, b, x], {
      files: ['src/[!ab].ts'],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(a)).toBe(false);
    expect(map.entryFiles.has(b)).toBe(false);
    expect(map.entryFiles.has(x)).toBe(true);
  });

  it('expands ? to a single non-separator character', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    const a = join(tmp, 'src/a.ts');
    const ab = join(tmp, 'src/ab.ts');
    writeFile(a, `export const a = 1;\n`);
    writeFile(ab, `export const ab = 1;\n`);

    const map = buildPublicApiMap([a, ab], {
      files: ['src/?.ts'],
      projectRoot: tmp,
    });

    expect(map.entryFiles.has(a)).toBe(true);
    expect(map.entryFiles.has(ab)).toBe(false);
  });

  it('collapses consecutive **s so deeply-nested globs do not cause catastrophic backtracking', () => {
    tmp = makeTmp();
    writePkg(tmp, {});
    // Build a long, deeply-nested non-matching path. Without star-squashing
    // a pattern like `**/**/**/**/z.ts` becomes a regex with multiple
    // overlapping `.*` groups that explode on long inputs.
    const deep = join(tmp, 'a/a/a/a/a/a/a/a/a/b.ts');
    writeFile(deep, `export const a = 1;\n`);

    const start = Date.now();
    const map = buildPublicApiMap([deep], {
      files: ['**/**/**/**/**/z.ts'],
      projectRoot: tmp,
    });
    const elapsed = Date.now() - start;

    // Even on a slow CI runner this should complete in well under a second.
    // The old (un-squashed) implementation could backtrack for minutes on
    // the same input.
    expect(elapsed).toBeLessThan(1000);
    expect(map.entryFiles.has(deep)).toBe(false);
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
