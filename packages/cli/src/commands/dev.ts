import type { KernTarget } from '@kernlang/core';
import { detectVersionsFromPackageJson, VALID_TARGETS } from '@kernlang/core';
import { loadEvolvedNodes } from '@kernlang/evolve';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import {
  findKernFiles,
  findNearestPackageJson,
  getOutputExtension,
  hasFlag,
  loadConfig,
  loadTemplates,
  parseFlag,
  transpileAndWrite,
} from '../shared.js';

export async function runDev(args: string[]): Promise<void> {
  const devInput = args[1];
  if (!devInput) {
    console.error('Usage: kern dev <file.kern|dir> [--target=nextjs] [--outdir=<dir>]');
    process.exit(1);
  }

  const inputPath = resolve(devInput);
  const stat = existsSync(inputPath) ? statSync(inputPath) : null;
  if (!stat) {
    console.error(`Not found: ${devInput}`);
    process.exit(1);
  }

  const watchDir = stat.isDirectory() ? inputPath : dirname(inputPath);
  const watchPattern = stat.isDirectory() ? undefined : basename(inputPath);

  const devConfig = loadConfig();

  const devCliTarget = parseFlag(args, '--target') as KernTarget | undefined;
  if (devCliTarget) {
    if (!VALID_TARGETS.includes(devCliTarget)) {
      console.error(`Unknown target: '${devCliTarget}'.`);
      process.exit(1);
    }
    (devConfig as { target: KernTarget }).target = devCliTarget;
  }

  const devOutDir = parseFlag(args, '--outdir');

  const pkgPath = findNearestPackageJson(watchDir);
  if (pkgPath && Object.keys(devConfig.frameworkVersions).length === 0) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const detected = detectVersionsFromPackageJson(pkg);
      if (detected.tailwind || detected.nextjs) {
        devConfig.frameworkVersions = { ...devConfig.frameworkVersions, ...detected };
        const parts: string[] = [];
        if (detected.tailwind) parts.push(`Tailwind ${detected.tailwind}`);
        if (detected.nextjs) parts.push(`Next.js ${detected.nextjs}`);
        console.log(`  Auto-detected: ${parts.join(', ')}`);
      }
    } catch {
      // Intentional: package.json detection is optional
    }
  }

  loadTemplates(devConfig);

  const evolvedResult = loadEvolvedNodes(process.cwd(), hasFlag(args, '--verify'));
  if (evolvedResult.loaded > 0) {
    console.log(`  Evolved nodes: ${evolvedResult.loaded} loaded`);
  }

  console.log(`\n  KERN dev — watching for changes`);
  console.log(`  Target: ${devConfig.target}`);
  console.log(`  Watch:  ${relative(process.cwd(), watchDir) || '.'}`);
  console.log('');

  const initialFiles = findKernFiles(watchDir, watchPattern);
  for (const file of initialFiles) {
    transpileAndWrite(file, devConfig, args, devOutDir, watchDir);
  }
  if (initialFiles.length > 0) {
    console.log(`  ${initialFiles.length} file(s) compiled.\n`);
  }

  const { watch } = await import('chokidar').catch(() => {
    console.error(`kern dev requires chokidar: npm install chokidar`);
    process.exit(1);
  });

  const globPattern = watchPattern ? resolve(watchDir, watchPattern) : resolve(watchDir, '**/*.kern');

  const watcher = watch(globPattern, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  const handleFile = (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const start = performance.now();
    try {
      transpileAndWrite(filePath, devConfig, args, devOutDir, watchDir);
      const ms = Math.round(performance.now() - start);
      console.log(`  ${rel} → compiled (${ms}ms)`);
    } catch (err) {
      console.error(`  ${rel} → ERROR: ${(err as Error).message}`);
    }
  };

  watcher.on('change', handleFile);
  watcher.on('add', handleFile);

  watcher.on('unlink', (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const ext = filePath.endsWith('.kern') ? '.kern' : '.ir';
    const fileBaseName = basename(filePath, ext);
    const unlinkRelDir = relative(resolve(watchDir), dirname(filePath));
    const unlinkBaseDir = devOutDir ? resolve(resolve(devOutDir), unlinkRelDir) : dirname(filePath);
    const outDir = resolve(unlinkBaseDir, devConfig.output.outDir);
    const outExt = getOutputExtension(devConfig.target);
    const outFile = resolve(outDir, `${fileBaseName}${outExt}`);
    try {
      if (existsSync(outFile)) {
        unlinkSync(outFile);
        console.log(`  ${rel} → deleted generated file`);
      }
    } catch (err) {
      console.error(`  ${rel} → ERROR deleting: ${(err as Error).message}`);
    }
  });

  console.log('  Watching for changes... (Ctrl+C to stop)\n');

  process.on('SIGINT', () => {
    console.log('\n  KERN dev stopped.');
    process.exit(0);
  });

  await new Promise(() => {});
}
