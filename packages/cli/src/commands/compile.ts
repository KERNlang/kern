import type { IRNode, KernTarget } from '@kernlang/core';
import {
  expandTemplateNode,
  generateCoreNode,
  isCoreNode,
  isTemplateNode,
  resolveConfig,
  VALID_TARGETS,
} from '@kernlang/core';
import { generateReactNode, isReactNode } from '@kernlang/react';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { loadConfig, loadTemplates, parseAndSurface, parseFlag, transpileAndWrite } from '../shared.js';

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

  const targetArg = parseFlag(args, '--target') as KernTarget | undefined;

  if (targetArg) {
    if (!VALID_TARGETS.includes(targetArg)) {
      console.error(`Unknown target: '${targetArg}'.`);
      process.exit(1);
    }
    const cfg = resolveConfig({ ...compileConfig, target: targetArg });
    let compiled = 0;
    for (const file of kernFiles) {
      transpileAndWrite(file, cfg, args, outDir);
      console.log(`  ${basename(file)} → ${targetArg}`);
      compiled++;
    }
    console.log(`\nCompiled ${compiled}/${kernFiles.length} files (target: ${targetArg}) → ${outDir}`);
    process.exit(0);
  }

  // Default: core-only codegen (no --target flag)
  let compiled = 0;
  for (const file of kernFiles) {
    const source = readFileSync(file, 'utf-8');
    const ast = parseAndSurface(source, file);
    const lines: string[] = [];
    let hasReactNodes = false;

    function processNode(node: IRNode): void {
      if (isCoreNode(node.type)) {
        lines.push(...generateCoreNode(node));
        lines.push('');
        if (node.type === 'hook' || node.type === 'screen') hasReactNodes = true;
      } else if (isTemplateNode(node.type)) {
        lines.push(...expandTemplateNode(node));
        lines.push('');
      } else if (isReactNode(node.type)) {
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
    } else {
      console.log(`  ${basename(file)} → (no core nodes, skipped)`);
    }
  }

  console.log(`\nCompiled ${compiled}/${kernFiles.length} files → ${outDir}`);
  process.exit(0);
}
