import type { IRNode, KernTarget } from '@kernlang/core';
import {
  expandTemplateNode,
  generateCoreNode,
  isCoreNode,
  isTemplateNode,
  KernParseError,
  parseStrict,
  parseWithDiagnostics,
  resolveConfig,
  sourceComment,
  VALID_TARGETS,
} from '@kernlang/core';
import { generateReactNode, isReactNode } from '@kernlang/react';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import {
  hasFlag,
  loadConfig,
  loadTemplates,
  parseAndSurface,
  parseFlag,
  surfaceParseDiagnostics,
  transpileAndWrite,
} from '../shared.js';

/** Extract exported symbol names from generated TypeScript lines, distinguishing type-only exports. */
function extractExports(lines: string[]): { name: string; typeOnly: boolean }[] {
  const exports: { name: string; typeOnly: boolean }[] = [];
  const re = /^export\s+(?:async\s+)?(?:function\*?|class|const|enum|abstract\s+class)\s+(\w+)/;
  const typeRe = /^export\s+(?:interface|type)\s+(\w+)/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) { exports.push({ name: m[1], typeOnly: false }); continue; }
    const tm = line.match(typeRe);
    if (tm) exports.push({ name: tm[1], typeOnly: true });
  }
  return exports;
}

export function runCompile(args: string[]): void {
  const compileInput = args[1];
  const outDirArg = parseFlag(args, '--outdir');

  if (!compileInput) {
    console.error('Usage: kern compile <file.kern|dir> --outdir=<dir>');
    process.exit(1);
  }

  const outDir = resolve(outDirArg || 'generated');
  mkdirSync(outDir, { recursive: true });

  const inputPath = resolve(compileInput);
  const stat = existsSync(inputPath) ? statSync(inputPath) : null;
  const kernFiles: string[] = [];

  if (stat?.isDirectory()) {
    for (const f of readdirSync(inputPath)) {
      if (f.endsWith('.kern')) kernFiles.push(resolve(inputPath, f));
    }
  } else if (stat?.isFile()) {
    kernFiles.push(inputPath);
  } else {
    console.error(`Not found: ${compileInput}`);
    process.exit(1);
  }

  if (kernFiles.length === 0) {
    console.error(`No .kern files found in: ${compileInput}`);
    process.exit(1);
  }

  const compileConfig = loadConfig();
  loadTemplates(compileConfig);

  const strictParse = hasFlag(args, '--strict-parse');
  const barrel = hasFlag(args, '--barrel');
  const targetArg = parseFlag(args, '--target') as KernTarget | undefined;

  /** Parse a .kern file, respecting --strict-parse. */
  function parseFile(file: string): IRNode {
    const source = readFileSync(file, 'utf-8');
    if (strictParse) {
      try {
        return parseStrict(source);
      } catch (err) {
        if (err instanceof KernParseError) {
          console.error(`\n${file}:`);
          console.error(`  [ERROR] ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    }
    return parseAndSurface(source, file);
  }

  /** Parse and collect error counts for the summary. */
  function parseFileWithCount(file: string): { ast: IRNode; errors: number; warnings: number } {
    if (strictParse) {
      return { ast: parseFile(file), errors: 0, warnings: 0 };
    }
    const source = readFileSync(file, 'utf-8');
    const result = parseWithDiagnostics(source);
    const { errors, warnings } = surfaceParseDiagnostics(result.diagnostics, file);
    return { ast: result.root, errors, warnings };
  }

  if (targetArg) {
    if (!VALID_TARGETS.includes(targetArg)) {
      console.error(`Unknown target: '${targetArg}'.`);
      process.exit(1);
    }
    const cfg = resolveConfig({ ...compileConfig, target: targetArg });
    let compiled = 0;
    for (const file of kernFiles) {
      if (strictParse) {
        // Validate first — transpileAndWrite uses parseAndSurface internally,
        // so we pre-validate with parseStrict to fail fast.
        parseFile(file);
      }
      transpileAndWrite(file, cfg, args, outDir);
      console.log(`  ${basename(file)} → ${targetArg}`);
      compiled++;
    }
    console.log(`\nCompiled ${compiled}/${kernFiles.length} files (target: ${targetArg}) → ${outDir}`);
    process.exit(0);
  }

  // Default: core-only codegen (no --target flag)
  let compiled = 0;
  let totalErrors = 0;
  const barrelEntries: { moduleName: string; exports: { name: string; typeOnly: boolean }[] }[] = [];

  for (const file of kernFiles) {
    const { ast, errors } = parseFileWithCount(file);
    totalErrors += errors;
    const lines: string[] = [];
    let hasReactNodes = false;

    function processNode(node: IRNode): void {
      if (isCoreNode(node.type)) {
        const sc = sourceComment(node, basename(file, '.kern'));
        if (sc) lines.push(sc);
        lines.push(...generateCoreNode(node));
        lines.push('');
        if (node.type === 'hook' || node.type === 'screen') hasReactNodes = true;
      } else if (isTemplateNode(node.type)) {
        const sc = sourceComment(node, basename(file, '.kern'));
        if (sc) lines.push(sc);
        lines.push(...expandTemplateNode(node));
        lines.push('');
      } else if (isReactNode(node.type)) {
        const sc = sourceComment(node, basename(file, '.kern'));
        if (sc) lines.push(sc);
        lines.push(...generateReactNode(node));
        lines.push('');
        hasReactNodes = true;
      }
    }

    processNode(ast);
    if (ast.children) {
      for (const child of ast.children) {
        processNode(child);
      }
    }

    if (lines.length > 0) {
      const ext = hasReactNodes ? '.tsx' : '.ts';
      const outName = basename(file, '.kern') + ext;
      const outFile = resolve(outDir, outName);
      writeFileSync(outFile, `${lines.join('\n')}\n`);
      console.log(`  ${basename(file)} → ${outName}`);
      compiled++;

      if (barrel) {
        const exports = extractExports(lines);
        if (exports.length > 0) {
          const moduleName = basename(file, '.kern');
          barrelEntries.push({ moduleName, exports });
        }
      }

    } else {
      console.log(`  ${basename(file)} → (no core nodes, skipped)`);
    }
  }

  // Generate barrel index if --barrel is set
  if (barrel && barrelEntries.length > 0) {
    // Avoid overwriting output from index.kern — use _barrel.ts if conflict exists
    const hasIndexKern = barrelEntries.some((e) => e.moduleName === 'index');
    const barrelName = hasIndexKern ? '_barrel.ts' : 'index.ts';
    const barrelLines = ['// Generated by KERN — do not edit.', ''];
    for (const entry of barrelEntries) {
      const valueExports = entry.exports.filter((e) => !e.typeOnly).map((e) => e.name);
      const typeExports = entry.exports.filter((e) => e.typeOnly).map((e) => e.name);
      if (valueExports.length > 0) {
        barrelLines.push(`export { ${valueExports.join(', ')} } from './${entry.moduleName}.js';`);
      }
      if (typeExports.length > 0) {
        barrelLines.push(`export type { ${typeExports.join(', ')} } from './${entry.moduleName}.js';`);
      }
    }
    barrelLines.push('');
    const barrelFile = resolve(outDir, barrelName);
    writeFileSync(barrelFile, barrelLines.join('\n'));
    const totalExports = barrelEntries.reduce((n, e) => n + e.exports.length, 0);
    console.log(`  barrel → ${barrelName} (${totalExports} exports)`);
  }

  console.log(`\nCompiled ${compiled}/${kernFiles.length} files → ${outDir}`);
  if (totalErrors > 0 && !strictParse) {
    console.error(`\n${totalErrors} parse error(s) found. Use --strict-parse to fail on errors.`);
  }
  process.exit(0);
}
