import {
  COMMON_TEMPLATES,
  detectTemplates,
  formatScanSummary,
  generateConfigSource,
  scanProject,
} from '@kernlang/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { findNearestPackageJson, hasFlag } from '../shared.js';

export function runScan(args: string[]): void {
  const scanCwd = process.cwd();
  const force = hasFlag(args, '--force');
  const dryRun = hasFlag(args, '--dry-run');

  const result = scanProject(scanCwd);
  console.log(formatScanSummary(result));

  if (dryRun) {
    console.log('  --dry-run: no files written.\n');
    console.log(generateConfigSource(result));
    process.exit(0);
  }

  const configOutPath = resolve(scanCwd, 'kern.config.ts');
  if (existsSync(configOutPath) && !force) {
    console.log('  kern.config.ts already exists. Use --force to overwrite.\n');
    process.exit(0);
  }

  writeFileSync(configOutPath, generateConfigSource(result));
  console.log('  Written: kern.config.ts\n');
  process.exit(0);
}

export function runInitTemplates(args: string[]): void {
  const force = hasFlag(args, '--force');
  const dryRun = hasFlag(args, '--dry-run');
  const initCwd = process.cwd();
  const templatesDir = resolve(initCwd, 'templates');

  const pkgPath = findNearestPackageJson(initCwd);
  if (!pkgPath) {
    console.error('No package.json found. Run this in a project directory.');
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const detected = detectTemplates(pkg);

  console.log('\n  KERN init-templates — scanning dependencies\n');

  if (detected.length === 0 && !force) {
    console.log('  No recognized libraries detected.');
    console.log('  Common templates (arrow-fn, window-event) will still be created.\n');
  }

  const filesToWrite: Record<string, string> = { ...COMMON_TEMPLATES };
  for (const entry of detected) {
    console.log(`  Detected: ${entry.libraryName} (${entry.packageName})`);
    Object.assign(filesToWrite, entry.templates);
  }

  if (dryRun) {
    console.log(`\n  --dry-run: would create ${Object.keys(filesToWrite).length} template files in templates/\n`);
    for (const name of Object.keys(filesToWrite).sort()) {
      console.log(`    templates/${name}`);
    }
    process.exit(0);
  }

  mkdirSync(templatesDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  for (const [name, content] of Object.entries(filesToWrite)) {
    const outPath = resolve(templatesDir, name);
    if (existsSync(outPath) && !force) {
      console.log(`  skip: templates/${name} (exists, use --force)`);
      skipped++;
      continue;
    }
    writeFileSync(outPath, content);
    console.log(`  wrote: templates/${name}`);
    written++;
  }

  const configPath = resolve(initCwd, 'kern.config.ts');
  if (existsSync(configPath)) {
    const configContent = readFileSync(configPath, 'utf-8');
    if (!configContent.includes('templates')) {
      console.log('\n  Note: Add templates to your kern.config.ts:');
      console.log("    templates: ['./templates/'],\n");
    }
  } else {
    const configSource = ['export default {', "  target: 'web',", "  templates: ['./templates/'],", '};', ''].join(
      '\n',
    );
    writeFileSync(configPath, configSource);
    console.log('  wrote: kern.config.ts');
    written++;
  }

  console.log(`\n  Done: ${written} written, ${skipped} skipped.`);
  if (detected.length > 0) {
    console.log(`  Templates ready for: ${detected.map((d) => d.libraryName).join(', ')}`);
  }
  console.log('');
  process.exit(0);
}
