import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import test from 'node:test';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const SOURCE_ENTRY = resolve(PACKAGE_ROOT, 'src/kir-preview/public.ts');
const ROOT_ENTRY = resolve(PACKAGE_ROOT, 'src/index.ts');
const FORBIDDEN = /\b(?:parseWithDiagnostics|reviewKernSource|inferFromSource|ts-morph)\b/u;

function imports(source: string): string[] {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] as string,
  );
}

function localFile(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const candidate = resolve(dirname(importer), specifier);
  const paths = extname(candidate)
    ? [candidate, candidate.replace(/\.js$/u, '.ts')]
    : [`${candidate}.ts`, `${candidate}.js`];
  return paths.find((path) => existsSync(path));
}

test('@kernlang/review/kir-preview is an exported canonical-only import closure', async () => {
  const packageJson = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.exports['./kir-preview'], {
    types: './dist/kir-preview/public.d.ts',
    default: './dist/kir-preview/public.js',
  });
  assert.deepEqual(packageJson.exports['./kir-preview-dual'], {
    types: './dist/kir-preview/dual-public.d.ts',
    default: './dist/kir-preview/dual-public.js',
  });

  const pending = [SOURCE_ENTRY];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, FORBIDDEN, `${file} must not reach legacy Review ownership`);
    for (const specifier of imports(source)) {
      assert.notEqual(specifier, '..', `${file} must not import the Review root`);
      if (specifier.startsWith('@kernlang/core')) {
        assert.equal(
          specifier,
          '@kernlang/core/frontend-projection',
          'canonical Review uses only the accepted core subpath',
        );
      }
      const local = localFile(file, specifier);
      if (local) {
        assert.ok(local.includes('/src/kir-preview/'), `${file} local import must remain inside kir-preview`);
        pending.push(local);
      }
    }
  }

  const preview = await import('@kernlang/review/kir-preview');
  assert.equal(typeof preview.compareCanonicalKir, 'function');
  assert.equal(typeof preview.reviewKernModuleSets, 'function');
  const modules = [{ moduleId: 'subpath.kern', source: 'fn name=main export=true\n' }];
  const result = await preview.reviewKernModuleSets({
    base: { modules },
    head: { modules },
    mode: 'canonical-kir-preview',
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.analysisMode, 'canonical-kir-preview');
});

test('stable Review root is preview-free while the dual subpath intentionally owns both closures', async () => {
  const rootSource = readFileSync(ROOT_ENTRY, 'utf8');
  assert.doesNotMatch(rootSource, /kir-preview|frontend-projection/u);

  const stable = await import('@kernlang/review');
  assert.equal('compareCanonicalKir' in stable, false);
  assert.equal('reviewKernModuleSets' in stable, false);

  const dual = await import('@kernlang/review/kir-preview-dual');
  assert.equal(typeof dual.reviewKernModuleSets, 'function');
  const modules = [{ moduleId: 'dual-subpath.kern', source: 'fn name=main export=true\n' }];
  const result = await dual.reviewKernModuleSets({
    base: { modules },
    head: { modules },
    mode: 'dual-compare',
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.canonical.status, 'complete');
  assert.equal(result.legacy.status, 'complete');
});
