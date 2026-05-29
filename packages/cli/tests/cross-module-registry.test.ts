/** Slice 7 v2 — cross-module Result/Option recognition end-to-end.
 *
 *  Builds a project-wide registry from a temp directory containing two
 *  `.kern` files (one declaring a Result-returning fn, one importing it),
 *  verifies the resolver maps `use path="…"` correctly, and confirms the
 *  imported call gets propagation lowering. */

import { parseDocument, parseDocumentWithDiagnostics } from '@kernlang/core';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  buildCrossModuleRegistry,
  buildProjectTypeNodeIndex,
  makeImportResolverForFile,
  resolveImportedTypeNodesForFile,
} from '../src/lib/cross-module-registry.js';

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
    const moduleExports = registry.get(resolve(aPath));
    expect(moduleExports?.resultFns.has('parseUser')).toBe(true);
    expect(moduleExports?.symbols?.get('parseUser')).toMatchObject({
      name: 'parseUser',
      sourceName: 'parseUser',
      kind: 'fn',
      targetNames: { ts: 'parseUser', python: 'parse_user' },
    });

    const resolver = makeImportResolverForFile(resolve(bPath), registry);
    const result = parseDocumentWithDiagnostics(bSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parseUser(raw);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(code).toContain('const u = __k_t1.value;');
    expect(
      (result.root.children?.[0] as { props?: Record<string, unknown>; children?: unknown[] }).children?.[0],
    ).toMatchObject({
      type: 'from',
      props: { name: 'parseUser', kind: 'fn' },
    });
  });

  test('registry records exported symbol kinds beyond functions', () => {
    const modulePath = join(tmpDir, 'domain.kern');
    writeFileSync(
      modulePath,
      [
        'type name=UserId values=string',
        'interface name=UserProfile',
        '  field name=id type=UserId',
        'class name=TokenTracker',
        '  field name=count type=number',
        'fn name=makeUser params="id:UserId" returns=UserProfile export=false',
        '  handler <<<',
        '    return { id };',
        '  >>>',
      ].join('\n'),
    );

    const registry = buildCrossModuleRegistry([modulePath]);
    const symbols = registry.get(resolve(modulePath))?.symbols;

    expect(symbols?.get('UserId')).toMatchObject({ name: 'UserId', kind: 'type', targetNames: { python: 'UserId' } });
    expect(symbols?.get('UserProfile')).toMatchObject({
      name: 'UserProfile',
      kind: 'interface',
      targetNames: { python: 'UserProfile' },
    });
    expect(symbols?.get('TokenTracker')).toMatchObject({
      name: 'TokenTracker',
      kind: 'class',
      targetNames: { python: 'TokenTracker' },
    });
    expect(symbols?.has('makeUser')).toBe(false);
  });

  test('registry ignores nested class methods as module exports', () => {
    const modulePath = join(tmpDir, 'service.kern');
    writeFileSync(
      modulePath,
      [
        'fn name=validate params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
        'class name=Validator',
        '  method name=validate params="raw:string" returns=boolean',
        '    handler <<<',
        '      return true;',
        '    >>>',
        '    fn name=deepValidate returns="Result<string, AppError>"',
        '      handler <<<',
        '        return Result.ok(raw);',
        '      >>>',
        'service name=UserService',
        '  method name=loadUser returns="Result<string, AppError>"',
        '    handler <<<',
        '      return Result.ok("ok");',
        '    >>>',
        'repository name=UserRepo model=User',
        '  method name=findUser returns="Result<string, AppError>"',
        '    handler <<<',
        '      return Result.ok("ok");',
        '    >>>',
      ].join('\n'),
    );

    const registry = buildCrossModuleRegistry([modulePath]);
    const exports = registry.get(resolve(modulePath));

    expect(exports?.symbols?.get('validate')).toMatchObject({
      name: 'validate',
      kind: 'fn',
    });
    expect(exports?.symbols?.get('UserService')).toMatchObject({ name: 'UserService', kind: 'service' });
    expect(exports?.symbols?.get('UserRepo')).toMatchObject({ name: 'UserRepo', kind: 'repository' });
    expect(exports?.symbols?.has('loadUser')).toBe(false);
    expect(exports?.symbols?.has('findUser')).toBe(false);
    expect(exports?.symbols?.has('deepValidate')).toBe(false);
    expect(exports?.resultFns.has('validate')).toBe(true);
    expect(exports?.resultFns.has('loadUser')).toBe(false);
    expect(exports?.resultFns.has('findUser')).toBe(false);
    expect(exports?.resultFns.has('deepValidate')).toBe(false);
  });

  test('registry follows named KERN re-exports for barrel modules', () => {
    const parserPath = join(tmpDir, 'parser.kern');
    writeFileSync(
      parserPath,
      [
        'type name=UserProfile values="{ id: string }"',
        'fn name=parseUser params="raw:string" returns="Result<UserProfile, AppError>"',
        '  handler <<<',
        '    return Result.ok({ id: raw });',
        '  >>>',
      ].join('\n'),
    );

    const indexPath = join(tmpDir, 'index.kern');
    writeFileSync(
      indexPath,
      ['module name=domain', '  export from="./parser.kern" names="parseUser" types="UserProfile"'].join('\n'),
    );

    const appPath = join(tmpDir, 'app.kern');
    const appSource = [
      'use path="./index"',
      '  from name=parseUser',
      'fn name=run params="raw:string" returns="Result<UserProfile, AppError>"',
      '  handler <<<',
      '    const user = parseUser(raw)?;',
      '    return Result.ok(user);',
      '  >>>',
    ].join('\n');
    writeFileSync(appPath, appSource);

    const registry = buildCrossModuleRegistry([parserPath, indexPath, appPath]);
    const barrelExports = registry.get(resolve(indexPath));
    expect(barrelExports?.symbols?.get('parseUser')).toMatchObject({
      name: 'parseUser',
      kind: 'fn',
      targetNames: { python: 'parse_user' },
    });
    expect(barrelExports?.symbols?.get('UserProfile')).toMatchObject({
      name: 'UserProfile',
      kind: 'type',
      targetNames: { python: 'UserProfile' },
    });
    expect(barrelExports?.resultFns.has('parseUser')).toBe(true);

    const resolver = makeImportResolverForFile(resolve(appPath), registry);
    const result = parseDocumentWithDiagnostics(appSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parseUser(raw);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(
      (result.root.children?.[0] as { props?: Record<string, unknown>; children?: unknown[] }).children?.[0],
    ).toMatchObject({
      type: 'from',
      props: { name: 'parseUser', kind: 'fn' },
    });
  });

  test('registry target names match FastAPI acronym snake_case for functions', () => {
    const parserPath = join(tmpDir, 'parser.kern');
    writeFileSync(
      parserPath,
      [
        'fn name=parseHTTPResponse params="raw:string" returns="Result<string, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );

    const indexPath = join(tmpDir, 'index.kern');
    writeFileSync(
      indexPath,
      ['module name=domain', '  export from="./parser.kern" names="parseHTTPResponse"'].join('\n'),
    );

    const registry = buildCrossModuleRegistry([parserPath, indexPath]);
    const directExports = registry.get(resolve(parserPath));
    const barrelExports = registry.get(resolve(indexPath));

    expect(directExports?.symbols?.get('parseHTTPResponse')).toMatchObject({
      name: 'parseHTTPResponse',
      kind: 'fn',
      targetNames: { python: 'parse_http_response' },
    });
    expect(barrelExports?.symbols?.get('parseHTTPResponse')).toMatchObject({
      name: 'parseHTTPResponse',
      kind: 'fn',
      targetNames: { python: 'parse_http_response' },
    });
  });

  test('registry follows aliased KERN re-exports for barrel modules', () => {
    const parserPath = join(tmpDir, 'parser.kern');
    writeFileSync(
      parserPath,
      [
        'type name=UserProfile values="{ id: string }"',
        'fn name=parseUser params="raw:string" returns="Result<UserProfile, AppError>"',
        '  handler <<<',
        '    return Result.ok({ id: raw });',
        '  >>>',
      ].join('\n'),
    );

    const indexPath = join(tmpDir, 'index.kern');
    writeFileSync(
      indexPath,
      [
        'module name=domain',
        '  export from="./parser.kern" names="parseUser as parse" types="UserProfile as Profile"',
      ].join('\n'),
    );

    const appPath = join(tmpDir, 'app.kern');
    const appSource = [
      'use path="./index"',
      '  from name=parse',
      'fn name=run params="raw:string" returns="Result<Profile, AppError>"',
      '  handler <<<',
      '    const user = parse(raw)?;',
      '    return Result.ok(user);',
      '  >>>',
    ].join('\n');
    writeFileSync(appPath, appSource);

    const registry = buildCrossModuleRegistry([parserPath, indexPath, appPath]);
    const barrelExports = registry.get(resolve(indexPath));
    expect(barrelExports?.symbols?.get('parse')).toMatchObject({
      name: 'parse',
      sourceName: 'parseUser',
      kind: 'fn',
      targetNames: { ts: 'parse', python: 'parse' },
    });
    expect(barrelExports?.symbols?.get('Profile')).toMatchObject({
      name: 'Profile',
      sourceName: 'UserProfile',
      kind: 'type',
      targetNames: { ts: 'Profile', python: 'Profile' },
    });
    expect(barrelExports?.resultFns.has('parse')).toBe(true);

    const resolver = makeImportResolverForFile(resolve(appPath), registry);
    const result = parseDocumentWithDiagnostics(appSource, undefined, { resolveImport: resolver });
    const code = findHandlerCode(result.root)!;

    expect(code).toContain('const __k_t1 = parse(raw);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
  });

  test('registry follows star KERN re-exports without looping on cycles', () => {
    const aPath = join(tmpDir, 'a.kern');
    writeFileSync(
      aPath,
      [
        'module name=a',
        '  export from="./b.kern" star=true',
        'type name=AId values=string',
        'fn name=parseA params="raw:string" returns="Option<AId>"',
        '  handler <<<',
        '    return Option.some(raw);',
        '  >>>',
      ].join('\n'),
    );

    const bPath = join(tmpDir, 'b.kern');
    writeFileSync(
      bPath,
      [
        'module name=b',
        '  export from="./a.kern" star=true',
        'type name=BId values=string',
        'fn name=parseB params="raw:string" returns="Result<BId, AppError>"',
        '  handler <<<',
        '    return Result.ok(raw);',
        '  >>>',
      ].join('\n'),
    );

    const registry = buildCrossModuleRegistry([aPath, bPath]);
    const aExports = registry.get(resolve(aPath));
    const bExports = registry.get(resolve(bPath));

    expect(aExports?.symbols?.get('AId')).toMatchObject({ name: 'AId', kind: 'type' });
    expect(aExports?.symbols?.get('BId')).toMatchObject({ name: 'BId', kind: 'type' });
    expect(aExports?.optionFns.has('parseA')).toBe(true);
    expect(aExports?.resultFns.has('parseB')).toBe(true);
    expect(bExports?.symbols?.get('AId')).toMatchObject({ name: 'AId', kind: 'type' });
    expect(bExports?.symbols?.get('BId')).toMatchObject({ name: 'BId', kind: 'type' });
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

describe('shadow real-types — project type-node index + per-file resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-x-types-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeModels(): string {
    const modelsPath = join(tmpDir, 'models.kern');
    writeFileSync(
      modelsPath,
      [
        'type name=UserId values=string',
        'interface name=UserProfile',
        '  field name=id type=UserId',
        '  field name=email type=string',
      ].join('\n'),
    );
    return modelsPath;
  }

  test('buildProjectTypeNodeIndex collects interface/type by file and simple name', () => {
    const modelsPath = writeModels();
    const index = buildProjectTypeNodeIndex([modelsPath]);
    const byName = index.get(resolve(modelsPath));
    expect(byName?.get('UserProfile')?.type).toBe('interface');
    expect(byName?.get('UserId')?.type).toBe('type');
  });

  test('buildProjectTypeNodeIndex excludes non-exported (export=false) types', () => {
    const modelsPath = join(tmpDir, 'models.kern');
    writeFileSync(
      modelsPath,
      [
        'interface name=PublicShape',
        '  field name=id type=string',
        'interface name=PrivateShape export=false',
        '  field name=secret type=string',
      ].join('\n'),
    );
    const index = buildProjectTypeNodeIndex([modelsPath]);
    const byName = index.get(resolve(modelsPath));
    expect(byName?.get('PublicShape')?.type).toBe('interface');
    expect(byName?.has('PrivateShape')).toBe(false);
  });

  test('resolveImportedTypeNodesForFile maps a use…from import to the target type node', () => {
    const modelsPath = writeModels();
    const handlerPath = join(tmpDir, 'handler.kern');
    writeFileSync(
      handlerPath,
      [
        'use path="./models"',
        '  from name=UserProfile kind=type',
        'fn name=describe params="u:UserProfile" returns=string',
        '  handler <<<',
        '    return u.email;',
        '  >>>',
      ].join('\n'),
    );
    const index = buildProjectTypeNodeIndex([modelsPath, handlerPath]);
    const root = parseDocument(readFileSync(handlerPath, 'utf-8'));
    const imported = resolveImportedTypeNodesForFile(resolve(handlerPath), root, index);
    expect(imported.get('UserProfile')?.type).toBe('interface');
  });

  test('honors `from … as alias` — keyed by the local name', () => {
    const modelsPath = writeModels();
    const handlerPath = join(tmpDir, 'handler.kern');
    writeFileSync(handlerPath, ['use path="./models"', '  from name=UserProfile as=Profile kind=type'].join('\n'));
    const index = buildProjectTypeNodeIndex([modelsPath, handlerPath]);
    const root = parseDocument(readFileSync(handlerPath, 'utf-8'));
    const imported = resolveImportedTypeNodesForFile(resolve(handlerPath), root, index);
    expect(imported.get('Profile')?.type).toBe('interface');
    expect(imported.has('UserProfile')).toBe(false);
    // The node must carry the LOCAL name so the shadow support file emits
    // `interface Profile`, not `interface UserProfile` (else the alias would
    // resolve to "Cannot find name 'Profile'").
    expect(imported.get('Profile')?.props?.name).toBe('Profile');
  });

  test('an imported name absent from the target degrades (not included)', () => {
    const modelsPath = writeModels();
    const handlerPath = join(tmpDir, 'handler.kern');
    writeFileSync(handlerPath, ['use path="./models"', '  from name=DoesNotExist kind=type'].join('\n'));
    const index = buildProjectTypeNodeIndex([modelsPath, handlerPath]);
    const root = parseDocument(readFileSync(handlerPath, 'utf-8'));
    const imported = resolveImportedTypeNodesForFile(resolve(handlerPath), root, index);
    expect(imported.has('DoesNotExist')).toBe(false);
  });

  test('a bare / unresolvable import path yields no entries (clean degradation)', () => {
    const handlerPath = join(tmpDir, 'handler.kern');
    writeFileSync(handlerPath, ['use path="zod"', '  from name=Schema kind=type'].join('\n'));
    const index = buildProjectTypeNodeIndex([handlerPath]);
    const root = parseDocument(readFileSync(handlerPath, 'utf-8'));
    const imported = resolveImportedTypeNodesForFile(resolve(handlerPath), root, index);
    expect(imported.size).toBe(0);
  });
});
