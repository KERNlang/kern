import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FORBIDDEN_PUBLIC_EXPORTS = Object.freeze([
  'CoreCompletion',
  'CoreRuntimeContractAdapterError',
  'CoreRuntimeEnv',
  'CoreRuntimeResult',
  'CreateCoreRuntimeEnvOptions',
  'KernBuiltinValue',
  'KernFunctionValue',
  'KernValue',
  'RuntimeParam',
  'assertCoreShape',
  'callCoreFunction',
  'coreFixtureValueToKernValue',
  'createCoreRuntimeEnv',
  'evalCoreExpression',
  'fromHostValue',
  'kBoolean',
  'kNull',
  'kNumber',
  'kString',
  'kUndefined',
  'kernTruthy',
  'kernValueToCoreFixtureValue',
  'roundTripKernContractDataValue',
  'runCoreRuntime',
  'toHostValue',
  'validateCoreShape',
]);

function stringLeaves(value, result = []) {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) stringLeaves(child, result);
  }
  return result;
}

function objectKeys(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    result.push(key);
    objectKeys(child, result);
  }
  return result;
}

function publicEntrypoints(packageJson) {
  return [...new Set([packageJson.main, packageJson.types, ...stringLeaves(packageJson.exports)].filter(Boolean))];
}

function packageFile(packageDirectory, target, packageName, kind) {
  const resolvedPackage = resolve(packageDirectory);
  const resolvedTarget = resolve(packageDirectory, target);
  if (resolvedTarget !== resolvedPackage && !resolvedTarget.startsWith(`${resolvedPackage}${sep}`)) {
    throw new Error(`${packageName}: ${kind} escapes the packed package: ${target}`);
  }
  if (/core-runtime/iu.test(relative(resolvedPackage, resolvedTarget))) {
    throw new Error(`${packageName}: ${kind} exposes a core-runtime module path: ${target}`);
  }
  if (!existsSync(resolvedTarget)) {
    throw new Error(`${packageName}: packed ${kind} is missing: ${target}`);
  }
  if (!statSync(resolvedTarget).isFile()) {
    throw new Error(`${packageName}: packed ${kind} is not a regular file: ${target}`);
  }
  return resolvedTarget;
}

function localModuleCandidates(sourceFile, specifier) {
  const target = resolve(dirname(sourceFile), specifier);
  const extension = extname(target);
  if (sourceFile.endsWith('.d.ts') && extension === '.js') {
    return [`${target.slice(0, -3)}.d.ts`, target];
  }
  if (extension) return [target];
  return [target, `${target}.js`, `${target}.d.ts`, join(target, 'index.js'), join(target, 'index.d.ts')];
}

function resolveLocalModule(packageDirectory, sourceFile, specifier, packageName) {
  const candidates = localModuleCandidates(sourceFile, specifier);
  const target = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!target) {
    throw new Error(
      `${packageName}: public graph has a missing local module from ${relative(packageDirectory, sourceFile)}: ${specifier}`,
    );
  }
  return packageFile(packageDirectory, relative(packageDirectory, target), packageName, 'public graph module');
}

function sourceFile(file, content) {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
}

function moduleSpecifiers(file, content, packageName) {
  const result = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      result.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      result.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
        throw new Error(`${packageName}: public graph contains a computed module edge in ${file}`);
      }
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file, content));
  return result;
}

function bindingNames(name, result) {
  if (ts.isIdentifier(name)) {
    result.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, result);
  }
}

function hasExportModifier(node) {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function exportedNames(file, content) {
  const source = sourceFile(file, content);
  const result = new Set();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      const collectIdentifiers = (node) => {
        if (ts.isIdentifier(node)) result.add(node.text);
        ts.forEachChild(node, collectIdentifiers);
      };
      collectIdentifiers(statement.expression);
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          result.add(element.name.text);
          if (element.propertyName) result.add(element.propertyName.text);
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        result.add(statement.exportClause.name.text);
      }
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, result);
      continue;
    }
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) result.add(statement.name.text);
  }
  return result;
}

function packageAliasTargets(packageJson, specifier) {
  const imports = packageJson.imports ?? {};
  if (Object.hasOwn(imports, specifier)) return stringLeaves(imports[specifier]);
  for (const [pattern, target] of Object.entries(imports)) {
    const marker = pattern.indexOf('*');
    if (marker < 0 || !specifier.startsWith(pattern.slice(0, marker)) || !specifier.endsWith(pattern.slice(marker + 1))) {
      continue;
    }
    const replacement = specifier.slice(marker, specifier.length - (pattern.length - marker - 1));
    return stringLeaves(target).map((candidate) => candidate.replaceAll('*', replacement));
  }
  return [];
}

function inspectPublicGraph(packageDirectory, entryFiles, packageName, packageJson) {
  const pending = [...entryFiles];
  const visited = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const content = readFileSync(file, 'utf8');
    const names = exportedNames(file, content);
    for (const symbol of FORBIDDEN_PUBLIC_EXPORTS) {
      if (names.has(symbol)) {
        throw new Error(
          `${packageName}: public graph module ${relative(packageDirectory, file)} exposes quarantined symbol: ${symbol}`,
        );
      }
    }
    for (const specifier of moduleSpecifiers(file, content, packageName)) {
      if (/core-runtime/iu.test(specifier)) {
        throw new Error(
          `${packageName}: public graph module ${relative(packageDirectory, file)} references the quarantined module family`,
        );
      }
      if (specifier.startsWith('.')) {
        pending.push(resolveLocalModule(packageDirectory, file, specifier, packageName));
        continue;
      }
      if (specifier.startsWith('#')) {
        const targets = packageAliasTargets(packageJson, specifier);
        if (targets.length === 0) {
          throw new Error(`${packageName}: public graph uses an unresolved package import alias: ${specifier}`);
        }
        for (const target of targets) {
          pending.push(packageFile(packageDirectory, target, packageName, 'public graph import alias'));
        }
      }
    }
  }
}

export function inspectPackageDirectory(packageDirectory, packageName) {
  const packageJsonPath = join(packageDirectory, 'package.json');
  if (!existsSync(packageJsonPath)) throw new Error(`${packageName}: packed package.json is missing`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const exportKeys = objectKeys(packageJson.exports);
  const exportTargets = stringLeaves(packageJson.exports);
  if (exportKeys.some((key) => /core-runtime/iu.test(key))) {
    throw new Error(`${packageName}: exports map key exposes the core-runtime module family`);
  }
  if ([...exportKeys, ...exportTargets].some((entry) => entry.includes('*'))) {
    throw new Error(`${packageName}: wildcard exports are forbidden by the public-graph quarantine`);
  }
  const entries = publicEntrypoints(packageJson);
  if (entries.length === 0) throw new Error(`${packageName}: packed package has no inspectable public entry`);
  const entryFiles = entries.map((entry) => packageFile(packageDirectory, entry, packageName, 'public entry'));
  inspectPublicGraph(packageDirectory, entryFiles, packageName, packageJson);
}

function packPackage(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageDirectory, stdio: 'pipe' });
  const archives = readdirSync(destination).filter((file) => file.endsWith('.tgz') && !before.has(file));
  if (archives.length !== 1) {
    throw new Error(`packing ${relative(REPO_ROOT, packageDirectory)} produced ${archives.length} archives`);
  }
  return join(destination, archives[0]);
}

function extractPackage(archive, destination) {
  execFileSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'pipe' });
  return join(destination, 'package');
}

export function runCheck() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kern-core-runtime-quarantine-'));
  try {
    for (const candidate of [
      { directory: join(REPO_ROOT, 'packages/core'), name: '@kernlang/core' },
      { directory: join(REPO_ROOT, 'packages/compat'), name: 'kern-lang' },
    ]) {
      const extractionRoot = join(temporaryRoot, candidate.name.replaceAll('/', '-').replaceAll('@', ''));
      mkdirSync(extractionRoot);
      const archive = packPackage(candidate.directory, temporaryRoot);
      inspectPackageDirectory(extractPackage(archive, extractionRoot), candidate.name);
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
  process.stdout.write('core runtime public-ABI quarantine: PASS (packed core + compat public graphs)\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCheck();
  } catch (error) {
    process.stderr.write(
      `core runtime public-ABI quarantine: FAIL (${error instanceof Error ? error.message : String(error)})\n`,
    );
    process.exitCode = 1;
  }
}
