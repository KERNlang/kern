/** Slice 7 v2 — cross-module Result/Option recognition end-to-end.
 *
 *  Builds a project-wide registry from a temp directory containing two
 *  `.kern` files (one declaring a Result-returning fn, one importing it),
 *  verifies the resolver maps `use path="…"` correctly, and confirms the
 *  imported call gets propagation lowering. */

import { parseDocumentWithDiagnostics } from '@kernlang/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { buildCrossModuleRegistry, makeImportResolverForFile } from '../src/lib/cross-module-registry.js';

function findHandlerCode(node: { type: string; props?: Record<string, unknown>; children?: unknown[] }): string | null {
  if (node.type === 'handler' && typeof node.props?.code === 'string') {
    return node.props.code as string;
  }
  if (node.children) {
    for (const c of node.children as never[]) {
      const found = findHandlerCode(c);
      if (found) return found;
    }
  }
  return null;
}

describe('cross-module registry — end-to-end', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-x-mod-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('imported parseUser(raw)? is recognised + lowered when registry is supplied', () => {
    // Module A: declares parseUser : Result<…>
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=parseUser params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );

    // Module B: imports parseUser via `use`, calls it with `?`
    const bPath = join(tmpDir, 'b.kern');
    const bSource = [
      'use path="./a"',
      '  from name=parseUser',
      'fn name=loud params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    const u = parseUser(raw)?;',
      '    return Result.ok(u.toUpperCase());',
      '  >>>',
    ].join('\n');
    writeFileSync(bPath, bSource);

    const registry = buildCrossModuleRegistry([aPath, bPath]);
    expect(registry.get(resolve(aPath))?.resultFns.has('parseUser')).toBe(true);

    const resolver = makeImportResolverForFile(resolve(bPath), registry);
    const result = parseDocumentWithDiagnostics(bSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parseUser(raw);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(code).toContain('const u = __k_t1.value;');
  });

  test('without registry: same import passes through verbatim', () => {
    const bSource = [
      'use path="./a"',
      '  from name=parseUser',
      'fn name=loud params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    const u = parseUser(raw)?;',
      '    return Result.ok(u);',
      '  >>>',
    ].join('\n');

    const result = parseDocumentWithDiagnostics(bSource);
    const code = findHandlerCode(result.root)!;
    expect(code).toContain('parseUser(raw)?;');
  });

  test('subdirectory imports resolve via relative paths', () => {
    mkdirSync(join(tmpDir, 'lib'));
    const aPath = join(tmpDir, 'lib', 'parser.kern');
    writeFileSync(
      aPath,
      [
        'fn name=parse params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );

    const bPath = join(tmpDir, 'app.kern');
    const bSource = [
      'use path="./lib/parser"',
      '  from name=parse',
      'fn name=run params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    const u = parse(raw)?;',
      '    return Result.ok(u);',
      '  >>>',
    ].join('\n');
    writeFileSync(bPath, bSource);

    const registry = buildCrossModuleRegistry([aPath, bPath]);
    const resolver = makeImportResolverForFile(resolve(bPath), registry);
    const result = parseDocumentWithDiagnostics(bSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parse(raw);');
  });

  test('bare imports (e.g. `zod`) get null from the resolver and pass through', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=parseUser params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );
    const registry = buildCrossModuleRegistry([aPath]);
    const resolver = makeImportResolverForFile(resolve(aPath), registry);
    expect(resolver('zod')).toBeNull();
    expect(resolver('react')).toBeNull();
    expect(resolver('@scope/pkg')).toBeNull();
    // Relative path that doesn't exist on disk
    expect(resolver('./nonexistent')).toBeNull();
  });

  test('aliased import `from name=parseUser as=parse` recognises the alias', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=parseUser params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );

    const bPath = join(tmpDir, 'b.kern');
    const bSource = [
      'use path="./a"',
      '  from name=parseUser as=parse',
      'fn name=loud params="raw:string" returns="Result<string, AppError>"',
      '  handler <<<',
      '    const u = parse(raw)?;',
      '    return Result.ok(u);',
      '  >>>',
    ].join('\n');
    writeFileSync(bPath, bSource);

    const registry = buildCrossModuleRegistry([aPath, bPath]);
    const resolver = makeImportResolverForFile(resolve(bPath), registry);
    const result = parseDocumentWithDiagnostics(bSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parse(raw);');
  });

  test('async exports populate asyncResultFns / asyncOptionFns', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=fetchUser params="id:string" returns="Promise<Result<string, AppError>>"',
        '  handler <<<',
        '    return Result.ok(id);',
        '  >>>',
        'fn name=lookup params="k:string" returns="Option<string>" async=true',
        '  handler <<<',
        '    return Option.some(k);',
        '  >>>',
      ].join('\n'),
    );
    const registry = buildCrossModuleRegistry([aPath]);
    const exp = registry.get(resolve(aPath));
    expect(exp?.asyncResultFns?.has('fetchUser')).toBe(true);
    expect(exp?.asyncOptionFns?.has('lookup')).toBe(true);
    // Sync sets must NOT contain the async names.
    expect(exp?.resultFns.has('fetchUser')).toBe(false);
    expect(exp?.optionFns.has('lookup')).toBe(false);
  });

  test('cross-module `await fetchUser(id)?` lowers correctly with async registry', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=fetchUser params="id:string" returns="Promise<Result<string, AppError>>"',
        '  handler <<<',
        '    return Result.ok(id);',
        '  >>>',
      ].join('\n'),
    );

    const bPath = join(tmpDir, 'b.kern');
    const bSource = [
      'use path="./a"',
      '  from name=fetchUser',
      'fn name=loud params="id:string" returns="Promise<Result<string, AppError>>"',
      '  handler <<<',
      '    const u = await fetchUser(id)?;',
      '    return Result.ok(u);',
      '  >>>',
    ].join('\n');
    writeFileSync(bPath, bSource);

    const registry = buildCrossModuleRegistry([aPath, bPath]);
    const resolver = makeImportResolverForFile(resolve(bPath), registry);
    const result = parseDocumentWithDiagnostics(bSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = await fetchUser(id);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
  });

  test('non-exported fns (export=false) are excluded from the registry', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'fn name=parseUser params="raw:string" returns="Result<string, AppError>" export=false',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );
    const registry = buildCrossModuleRegistry([aPath]);
    expect(registry.get(resolve(aPath))?.resultFns.has('parseUser')).toBe(false);
  });
});
