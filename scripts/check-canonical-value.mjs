#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourceRoot = 'packages/core/src';
const ownRoot = path.join(sourceRoot, 'canonical-value');
const allowedConsumerRoots = [
  path.join(sourceRoot, 'kir-structural'),
  path.join(sourceRoot, 'kir-evidence'),
];
const graphEntry = path.join(ownRoot, 'canonical.ts');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

export function moduleSpecifiers(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0)
    throw new Error(`cannot parse canonical value browser graph source ${sourcePath}`);
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`non-literal module specifier in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = node.moduleReference.expression;
      if (!specifier || !ts.isStringLiteral(specifier)) throw new Error(`non-literal import-equals in ${sourcePath}`);
      specifiers.push(specifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) throw new Error(`non-literal dynamic import in ${sourcePath}`);
      specifiers.push(argument.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) throw new Error(`non-literal require in ${sourcePath}`);
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

export function canonicalValueReferences(source, sourcePath) {
  return moduleSpecifiers(source, sourcePath).filter((specifier) => {
    if (!specifier.startsWith('.')) return false;
    const resolved = path.normalize(path.join(path.dirname(sourcePath), specifier.replace(/\.js$/u, '.ts')));
    return resolved.startsWith(`${ownRoot}${path.sep}`);
  });
}

export function runCanonicalValueCheck() {
  for (const sourcePath of sourceFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${ownRoot}${path.sep}`)) continue;
    if (canonicalValueReferences(readFileSync(sourcePath, 'utf8'), sourcePath).length > 0) {
      if (allowedConsumerRoots.some((root) => sourcePath.startsWith(`${root}${path.sep}`))) continue;
      throw new Error(`canonical value reader must remain internal and unconsumed; found reference in ${sourcePath}`);
    }
  }

  const ownFiles = new Set(sourceFiles(ownRoot));
  const visited = new Set();
  function inspectBrowserGraph(sourcePath) {
    if (visited.has(sourcePath)) return;
    visited.add(sourcePath);
    const source = readFileSync(sourcePath, 'utf8');
    for (const specifier of moduleSpecifiers(source, sourcePath)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`canonical value browser graph cannot import bare or Node dependency ${specifier} from ${sourcePath}`);
      }
      const resolved = path.normalize(path.join(path.dirname(sourcePath), specifier.replace(/\.js$/u, '.ts')));
      if (!ownFiles.has(resolved)) {
        throw new Error(`canonical value browser graph escapes its internal module: ${sourcePath} -> ${resolved}`);
      }
      inspectBrowserGraph(resolved);
    }
  }
  inspectBrowserGraph(graphEntry);
  if (visited.size !== ownFiles.size) {
    const unreachable = [...ownFiles].filter((sourcePath) => !visited.has(sourcePath));
    throw new Error(`canonical value module contains source outside the checked browser graph: ${unreachable.join(', ')}`);
  }

  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  if (JSON.stringify(packageJson.exports ?? {}).includes('canonical-value')) {
    throw new Error('canonical value reader must not be publicly exported');
  }
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  if (Object.hasOwn(rootPackage.scripts, 'test:kern-ir')) {
    throw new Error('canonical value reader cannot promote the KIR v1 gate');
  }

  process.stdout.write(
    'Canonical value reader: PASS (INTERNAL; browser graph closed; only structural and evidence codecs consume it; ALPHA-NO-GO; no KIR v1, public export, runtime adoption, or probe replacement).\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCanonicalValueCheck();
