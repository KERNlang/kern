import { importTypeScript } from '@kernlang/core';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { hasFlag, parseFlag } from '../shared.js';

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'generated') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findTsFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      // Skip .d.ts files
      if (entry.endsWith('.d.ts')) continue;
      files.push(full);
    }
  }
  return files;
}

export function runImport(args: string[]): void {
  const input = args[1];
  if (!input) {
    console.error('Usage: kern import <file.ts|dir> [--outdir=<dir>] [--dry-run]');
    process.exit(1);
  }

  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    console.error(`Not found: ${input}`);
    process.exit(1);
  }

  const outDir = parseFlag(args, '--outdir');
  const dryRun = hasFlag(args, '--dry-run');
  const stat = statSync(inputPath);
  const files = stat.isDirectory() ? findTsFiles(inputPath) : [inputPath];

  if (files.length === 0) {
    console.log('No .ts/.tsx files found.');
    return;
  }

  console.log(`\n  KERN import — converting ${files.length} TypeScript file(s)\n`);

  let totalStats = { types: 0, interfaces: 0, functions: 0, classes: 0, imports: 0, constants: 0, enums: 0 };
  let totalUnmapped = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const relFile = relative(process.cwd(), file);
    const result = importTypeScript(source, basename(file));

    // Accumulate stats
    for (const key of Object.keys(totalStats) as (keyof typeof totalStats)[]) {
      totalStats[key] += result.stats[key];
    }
    totalUnmapped += result.unmapped.length;

    const kernFileName = basename(file).replace(/\.tsx?$/, '.kern');
    const kernOutDir = outDir ? resolve(outDir) : dirname(file);
    const kernPath = resolve(kernOutDir, kernFileName);

    if (dryRun) {
      console.log(`  ${relFile} → ${relative(process.cwd(), kernPath)}`);
      console.log(`    types: ${result.stats.types}, interfaces: ${result.stats.interfaces}, functions: ${result.stats.functions}, classes: ${result.stats.classes}`);
      if (result.unmapped.length > 0) {
        console.log(`    unmapped: ${result.unmapped.length}`);
        for (const u of result.unmapped.slice(0, 3)) {
          console.log(`      - ${u}`);
        }
        if (result.unmapped.length > 3) {
          console.log(`      ... and ${result.unmapped.length - 3} more`);
        }
      }
      console.log('');
      console.log(result.kern);
      console.log('---');
    } else {
      mkdirSync(kernOutDir, { recursive: true });
      writeFileSync(kernPath, result.kern);
      const parts: string[] = [];
      if (result.stats.types) parts.push(`${result.stats.types} types`);
      if (result.stats.interfaces) parts.push(`${result.stats.interfaces} interfaces`);
      if (result.stats.functions) parts.push(`${result.stats.functions} functions`);
      if (result.stats.classes) parts.push(`${result.stats.classes} classes`);
      if (result.stats.constants) parts.push(`${result.stats.constants} constants`);
      if (result.stats.imports) parts.push(`${result.stats.imports} imports`);
      console.log(`  ${relFile} → ${kernFileName} (${parts.join(', ')})`);
      if (result.unmapped.length > 0) {
        console.log(`    ⚠ ${result.unmapped.length} unmapped construct(s)`);
      }
    }
  }

  console.log(`\n  Total: ${totalStats.types + totalStats.interfaces + totalStats.functions + totalStats.classes + totalStats.constants} declarations imported`);
  if (totalUnmapped > 0) {
    console.log(`  ${totalUnmapped} unmapped construct(s) — check comments in output`);
  }
}
