#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { decodeKirEvidence, encodeKirEvidence } from '../packages/core/dist/kir-evidence/canonical.js';
import { encodeModuleKir } from '../packages/core/dist/kir-structural/module-canonical.js';
import { moduleSpecifiers } from './check-canonical-value.mjs';

const limits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const sourceRoot = 'packages/core/src';
const ownRoot = path.join(sourceRoot, 'kir-evidence');
const source = '# π\nfn name=main export=true\n  handler lang=ts\n    let name=result value=null\n';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function literalModuleSpecifiers(sourceText, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) throw new Error(`cannot parse workspace production source ${sourcePath}`);
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = node.moduleReference.expression;
      if (specifier && ts.isStringLiteral(specifier)) specifiers.push(specifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const [argument] = node.arguments;
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function range(content) {
  const offset = source.indexOf(content);
  if (offset < 0) throw new Error(`missing fixture content ${content}`);
  const start = Buffer.byteLength(source.slice(0, offset), 'utf8');
  return [start, start + Buffer.byteLength(content, 'utf8')];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function runKirEvidenceCheck() {
  for (const sourcePath of sourceFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${ownRoot}${path.sep}`)) continue;
    if (
      moduleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath).some((specifier) =>
        specifier.split('/').includes('kir-evidence'),
      )
    ) {
      throw new Error(`KIR evidence must remain unconsumed internal release evidence: ${sourcePath}`);
    }
  }
  for (const entry of readdirSync('packages', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join('packages', entry.name);
    const packageSource = path.join(packageRoot, 'src');
    if (existsSync(packageSource) && packageSource !== sourceRoot) {
      for (const sourcePath of sourceFiles(packageSource)) {
        if (
          literalModuleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath).some((specifier) =>
            specifier.split('/').includes('kir-evidence'),
          )
        ) {
          throw new Error(`KIR evidence must not enter workspace production source: ${sourcePath}`);
        }
      }
    }
    const packagePath = path.join(packageRoot, 'package.json');
    if (
      existsSync(packagePath) &&
      JSON.stringify(JSON.parse(readFileSync(packagePath, 'utf8')).exports ?? {}).includes('kir-evidence')
    ) {
      throw new Error(`KIR evidence codec must not be publicly exported by ${packagePath}`);
    }
  }
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const forbidden of ['test:kern-ir', 'test:runtime-abi']) {
    if (Object.hasOwn(rootPackage.scripts, forbidden)) throw new Error(`KIR evidence cannot promote ${forbidden}`);
  }

  const semanticBytes = encodeModuleKir(
    [
      {
        id: 'main.kern',
        roots: [
          {
            type: 'fn',
            props: { export: true, name: 'main' },
            children: [
              {
                type: 'handler',
                props: { lang: 'ts' },
                children: [{ type: 'let', props: { name: 'result', value: { __expr: true, code: 'null' } } }],
              },
            ],
          },
        ],
      },
    ],
    limits,
  );
  const [nodeStart, nodeEnd] = range('fn name=main export=true');
  const [expressionStart, expressionEnd] = range('null');
  const input = {
    semanticBytes,
    sources: [{ moduleId: 'main.kern', source }],
    spans: [
      {
        content: 'fn name=main export=true',
        endByte: nodeEnd,
        id: 'main-function',
        moduleId: 'main.kern',
        nodePath: [0],
        propertyKey: null,
        startByte: nodeStart,
      },
      {
        content: 'null',
        endByte: expressionEnd,
        id: 'null-expression',
        moduleId: 'main.kern',
        nodePath: [0, 0, 0],
        propertyKey: 'value',
        startByte: expressionStart,
      },
    ],
    diagnostics: [
      {
        category: 'validator',
        code: 'null-result',
        id: 'null-result-warning',
        message: 'The result is statically null.',
        moduleId: 'main.kern',
        severity: 'warning',
        spanId: 'null-expression',
      },
    ],
  };
  const evidenceBytes = encodeKirEvidence(input, { limits });
  const artifact = decodeKirEvidence(evidenceBytes, semanticBytes, input.sources, { limits });
  if (
    artifact.proofLabel !== 'ALPHA-NO-GO' ||
    artifact.diagnostics.length === 0 ||
    !artifact.spans.some((span) => span.propertyKey !== null) ||
    artifact.semantic.sha256 !== sha256(semanticBytes)
  ) {
    throw new Error('KIR evidence acceptance witness is incomplete');
  }
  process.stdout.write(
    `KIR evidence: PASS (INTERNAL; ${artifact.spans.length} UTF-8 spans; ${artifact.diagnostics.length} diagnostic; ALPHA-NO-GO).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runKirEvidenceCheck();
