import type { IRNode, KernTarget, ResolvedKernConfig } from '@kernlang/core';
import {
  ALL_TARGETS,
  detectVersionsFromPackageJson,
  expandTemplateNode,
  generateCoreNode,
  isCoreNode,
  isTemplateNode,
  KernParseError,
  parseStrict,
  parseWithDiagnostics,
  resolveConfig,
  sourceComment,
} from '@kernlang/core';
import { loadEvolvedNodes } from '@kernlang/evolve';
import { generateReactNode, isReactNode } from '@kernlang/react';
import type { ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import {
  type BarrelEntry,
  extractExportsFromLines,
  type FileDiagnosticsJSON,
  findKernFiles,
  findNearestPackageJson,
  generateBarrelFile,
  generateFacadeFiles,
  getOutputExtension,
  hasFlag,
  loadConfig,
  loadTemplates,
  parseFlag,
  parseWithJSONDiagnostics,
  runShadowAnalysis,
  scanOutputForBarrelEntries,
  surfaceParseDiagnostics,
  surfaceShadowDiagnostics,
  transpileAndWrite,
} from '../shared.js';

// ── Single-file compilation (no --target) ───────────────────────────────

interface DefaultCompileResult {
  compiled: boolean;
  errors: number;
  warnings: number;
  barrelEntry?: BarrelEntry;
}

/** Compile a single .kern file using core/template/react codegen (no target transpiler). */
async function compileDefaultSingle(
  file: string,
  outDir: string,
  strictParse: boolean,
  jsonOutput: boolean,
  jsonDiagnostics: FileDiagnosticsJSON[],
  shadow: boolean,
  inputBase?: string,
): Promise<DefaultCompileResult> {
  const source = readFileSync(file, 'utf-8');

  let ast: IRNode;
  let errors = 0;
  let warnings = 0;

  if (strictParse) {
    try {
      ast = parseStrict(source);
    } catch (err) {
      if (err instanceof KernParseError) {
        console.error(`\n${file}:`);
        console.error(`  [ERROR] ${err.message}`);
        if (!jsonOutput) process.exit(1);
        return { compiled: false, errors: 1, warnings: 0 };
      }
      throw err;
    }
  } else if (jsonOutput) {
    const { root, json } = parseWithJSONDiagnostics(source, file);
    ast = root;
    jsonDiagnostics.push(json);
    errors = json.diagnostics.filter((d) => d.severity === 'error').length + json.schemaViolations.length;
    warnings = json.diagnostics.filter((d) => d.severity === 'warning').length;
  } else {
    const result = parseWithDiagnostics(source);
    const diag = surfaceParseDiagnostics(result.diagnostics, file);
    ast = result.root;
    errors = diag.errors;
    warnings = diag.warnings;
  }

  // ── Shadow semantic analysis (opt-in) ────────────────────────────────
  if (shadow) {
    const shadowDiagnostics = await runShadowAnalysis(ast);
    if (jsonOutput) {
      // The JSON path pushes one entry per file; attach shadow results to the last one.
      const current = jsonDiagnostics[jsonDiagnostics.length - 1];
      if (current && current.file === file) {
        current.shadowDiagnostics = shadowDiagnostics;
        const shadowErrors = shadowDiagnostics.filter((d) => d.rule === 'shadow-ts').length;
        errors += shadowErrors;
        if (shadowErrors > 0) current.success = false;
      }
    } else {
      const counts = surfaceShadowDiagnostics(shadowDiagnostics, file);
      errors += counts.errors;
      warnings += counts.warnings;
    }
  }

  const lines: string[] = [];
  let hasReactNodes = false;

  function processNode(node: IRNode): void {
    if (isReactNode(node.type)) {
      const sc = sourceComment(node, basename(file, '.kern'));
      if (sc) lines.push(sc);
      lines.push(...generateReactNode(node));
      lines.push('');
      hasReactNodes = true;
    } else if (isCoreNode(node.type)) {
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
    }
  }

  processNode(ast);
  if (ast.children) {
    for (const child of ast.children) {
      processNode(child);
    }
  }

  if (lines.length === 0) {
    if (!jsonOutput) console.log(`  ${basename(file)} → (no core nodes, skipped)`);
    return { compiled: false, errors, warnings };
  }

  const ext = hasReactNodes ? '.tsx' : '.ts';
  const outName = basename(file, '.kern') + ext;
  // Preserve subdirectory structure when compiling a directory recursively
  const relSubdir = inputBase ? relative(inputBase, dirname(file)) : '';
  const targetDir = relSubdir ? resolve(outDir, relSubdir) : outDir;
  mkdirSync(targetDir, { recursive: true });
  const outFile = resolve(targetDir, outName);
  writeFileSync(outFile, `${lines.join('\n')}\n`);
  if (!jsonOutput) console.log(`  ${basename(file)} → ${relSubdir ? `${relSubdir}/` : ''}${outName}`);

  const exports = extractExportsFromLines(lines);
  const barrelEntry = exports.length > 0 ? { moduleName: basename(file, '.kern'), exports } : undefined;

  return { compiled: true, errors, warnings, barrelEntry };
}

// ── Main compile command ────────────────────────────────────────────────

export async function runCompile(args: string[]): Promise<void> {
  const compileInput = args[1];
  const outDirArg = parseFlag(args, '--outdir');

  if (!compileInput) {
    console.error(
      'Usage: kern compile <file.kern|dir> [--target=<target>] [--outdir=<dir>] [--watch] [--facades] [--index] [--shadow]',
    );
    process.exit(1);
  }

  const outDir = resolve(outDirArg || 'generated');
  mkdirSync(outDir, { recursive: true });

  const inputPath = resolve(compileInput);
  const stat = existsSync(inputPath) ? statSync(inputPath) : null;

  if (!stat) {
    console.error(`Not found: ${compileInput}`);
    process.exit(1);
  }

  const isDir = stat.isDirectory();
  const kernFiles = isDir ? findKernFiles(inputPath) : stat.isFile() ? [inputPath] : [];

  if (kernFiles.length === 0) {
    console.error(`No .kern files found in: ${compileInput}`);
    process.exit(1);
  }

  // ── Flags ──────────────────────────────────────────────────────────
  const compileConfig = loadConfig();
  const strictParse = hasFlag(args, '--strict-parse');
  const tolerant = hasFlag(args, '--tolerant');
  const barrel = hasFlag(args, '--barrel', '--index');
  const facades = hasFlag(args, '--facades');
  const facadesDir = parseFlag(args, '--facades-dir');
  const jsonOutput = hasFlag(args, '--json');
  const watchMode = hasFlag(args, '--watch');
  const serveMode = hasFlag(args, '--serve');
  const shadow = hasFlag(args, '--shadow');
  const targetArg = parseFlag(args, '--target') as KernTarget | undefined;

  if (targetArg && !ALL_TARGETS.includes(targetArg)) {
    console.error(`Unknown target: '${targetArg}'.`);
    process.exit(1);
  }

  // ── Framework detection + evolved nodes (from dev command) ─────────
  const watchDir = isDir ? inputPath : dirname(inputPath);

  if (targetArg) {
    const pkgPath = findNearestPackageJson(watchDir);
    if (pkgPath && Object.keys(compileConfig.frameworkVersions).length === 0) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const detected = detectVersionsFromPackageJson(pkg);
        if (detected.tailwind || detected.nextjs) {
          compileConfig.frameworkVersions = { ...compileConfig.frameworkVersions, ...detected };
          if (!jsonOutput) {
            const parts: string[] = [];
            if (detected.tailwind) parts.push(`Tailwind ${detected.tailwind}`);
            if (detected.nextjs) parts.push(`Next.js ${detected.nextjs}`);
            console.log(`  Auto-detected: ${parts.join(', ')}`);
          }
        }
      } catch {
        // Intentional: package.json detection is optional
      }
    }
  }

  loadTemplates(compileConfig);

  const evolvedResult = loadEvolvedNodes(process.cwd(), hasFlag(args, '--verify'));
  if (evolvedResult.loaded > 0 && !jsonOutput) {
    console.log(`  Evolved nodes: ${evolvedResult.loaded} loaded`);
  }

  // ── Resolve config with target ─────────────────────────────────────
  const cfg = targetArg ? resolveConfig({ ...compileConfig, target: targetArg }) : compileConfig;

  // ── Initial compilation ────────────────────────────────────────────
  const jsonDiagnostics: FileDiagnosticsJSON[] = [];

  async function compileAll(
    files: string[],
  ): Promise<{ compiled: number; totalErrors: number; barrelEntries: BarrelEntry[] }> {
    let compiled = 0;
    let totalErrors = 0;
    const barrelEntries: BarrelEntry[] = [];

    if (targetArg) {
      for (const file of files) {
        if (strictParse) {
          const source = readFileSync(file, 'utf-8');
          try {
            parseStrict(source);
          } catch (err) {
            if (err instanceof KernParseError) {
              console.error(`\n${file}:`);
              console.error(`  [ERROR] ${err.message}`);
              process.exit(1);
            }
            throw err;
          }
        }
        try {
          transpileAndWrite(file, cfg as ResolvedKernConfig, args, outDir, isDir ? inputPath : undefined);
          if (!jsonOutput) console.log(`  ${basename(file)} → ${targetArg}`);
          compiled++;
        } catch (err) {
          totalErrors++;
          console.error(`  ${basename(file)} → ERROR: ${(err as Error).message}`);
        }

        // Shadow analysis runs independently of the transpiler path so
        // `--target=<x> --shadow` isn't a silent no-op. Re-parse is accepted
        // until a shared pre-parse hook exists.
        if (shadow) {
          try {
            const source = readFileSync(file, 'utf-8');
            const { root: shadowRoot } = parseWithDiagnostics(source);
            const shadowDiagnostics = await runShadowAnalysis(shadowRoot);
            if (jsonOutput) {
              jsonDiagnostics.push({
                file,
                success: shadowDiagnostics.every((d) => d.rule !== 'shadow-ts'),
                diagnostics: [],
                schemaViolations: [],
                shadowDiagnostics,
              });
            } else {
              const counts = surfaceShadowDiagnostics(shadowDiagnostics, file);
              totalErrors += counts.errors;
            }
          } catch (err) {
            if (!jsonOutput) console.error(`  [SHADOW] ${basename(file)}: ${(err as Error).message}`);
          }
        }
      }
      // Barrel entries from output scan for --target path
      if (barrel || facades) {
        barrelEntries.push(...scanOutputForBarrelEntries(outDir));
      }
    } else {
      for (const file of files) {
        const result = await compileDefaultSingle(
          file,
          outDir,
          strictParse,
          jsonOutput,
          jsonDiagnostics,
          shadow,
          isDir ? inputPath : undefined,
        );
        if (result.compiled) compiled++;
        totalErrors += result.errors;
        if (result.barrelEntry) barrelEntries.push(result.barrelEntry);
      }
    }

    return { compiled, totalErrors, barrelEntries };
  }

  const { compiled, totalErrors, barrelEntries } = await compileAll(kernFiles);

  // ── Barrel & facades ───────────────────────────────────────────────
  if (barrel && barrelEntries.length > 0) {
    generateBarrelFile(outDir, barrelEntries);
  }
  if (facades && barrelEntries.length > 0) {
    generateFacadeFiles(outDir, facadesDir, barrelEntries);
  }

  // ── Summary ────────────────────────────────────────────────────────
  if (jsonOutput) {
    const output = targetArg
      ? { compiled, total: kernFiles.length, outDir, target: targetArg, errors: 0, files: [] }
      : { compiled, total: kernFiles.length, outDir, errors: totalErrors, files: jsonDiagnostics };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const targetLabel = targetArg ? ` (target: ${targetArg})` : '';
    console.log(`\nCompiled ${compiled}/${kernFiles.length} files${targetLabel} → ${outDir}`);
    if (totalErrors > 0 && !strictParse) {
      if (tolerant) {
        console.log(`  ${totalErrors} parse error(s) recovered — output contains TODO comments at error positions.`);
      } else {
        console.error(
          `\n${totalErrors} parse error(s) found. Use --strict-parse to fail on errors, or --tolerant for partial compilation.`,
        );
      }
    }
  }

  // ── Exit or watch ──────────────────────────────────────────────────
  if (!watchMode) {
    process.exit(0);
  }

  // ── Watch mode ─────────────────────────────────────────────────────
  const { watch } = await import('chokidar').catch(() => {
    console.error('kern compile --watch requires chokidar: npm install chokidar');
    process.exit(1);
  });

  // ── MCP serve mode — auto-restart compiled server ───────────────────
  let mcpProcess: ChildProcess | null = null;

  function findCompiledEntry(): string | null {
    if (!existsSync(outDir)) return null;
    // Search recursively for .ts files containing McpServer (the actual server entry)
    const candidates: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (entry.endsWith('.ts') && entry !== 'index.ts' && entry !== '_barrel.ts') {
          candidates.push(full);
        }
      }
    }
    walk(outDir);
    // Prefer files containing McpServer instantiation
    const mcpEntry = candidates.find((f) => readFileSync(f, 'utf-8').includes('McpServer'));
    return mcpEntry || candidates[0] || null;
  }

  async function restartMcpServer(): Promise<void> {
    if (!serveMode || targetArg !== 'mcp') return;
    const entry = findCompiledEntry();
    if (!entry) return;

    if (mcpProcess) {
      mcpProcess.kill('SIGTERM');
      mcpProcess = null;
    }

    const { spawn: spawnProcess } = await import('child_process');
    mcpProcess = spawnProcess('npx', ['tsx', entry], {
      stdio: 'inherit',
      env: { ...process.env },
    });
    mcpProcess.on('error', (err) => {
      console.error(`  MCP server error: ${err.message}`);
    });
    mcpProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`  MCP server exited with code ${code}`);
      }
      mcpProcess = null;
    });
    console.log(`  MCP server started: ${relative(process.cwd(), entry)}`);
  }

  // Start MCP server after initial compile
  await restartMcpServer();

  console.log('\n  Watching for changes... (Ctrl+C to stop)\n');

  const globPattern = isDir ? resolve(inputPath, '**/*.kern') : inputPath;

  const watcher = watch(globPattern, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  const handleChange = async (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const start = performance.now();
    try {
      if (targetArg) {
        transpileAndWrite(filePath, cfg as ResolvedKernConfig, args, outDir, isDir ? inputPath : undefined);
      } else {
        await compileDefaultSingle(filePath, outDir, strictParse, false, [], shadow, isDir ? inputPath : undefined);
      }

      // Regenerate barrel/facades from current output state
      if (barrel || facades) {
        const entries = scanOutputForBarrelEntries(outDir);
        if (barrel) generateBarrelFile(outDir, entries);
        if (facades) generateFacadeFiles(outDir, facadesDir, entries);
      }

      const ms = Math.round(performance.now() - start);
      console.log(`  ${rel} → compiled (${ms}ms)`);

      // Restart MCP server if --serve (fire-and-forget, log errors)
      void restartMcpServer().catch((err) => {
        console.error(`  MCP restart failed: ${(err as Error).message}`);
      });
    } catch (err) {
      console.error(`  ${rel} → ERROR: ${(err as Error).message}`);
    }
  };

  watcher.on('change', handleChange);
  watcher.on('add', handleChange);

  watcher.on('unlink', (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const name = basename(filePath, '.kern');

    // Remove generated output file(s)
    const outExt = targetArg ? getOutputExtension(targetArg) : '.ts';
    for (const ext of [outExt, outExt === '.ts' ? '.tsx' : '.ts']) {
      const outFile = resolve(outDir, `${name}${ext}`);
      if (existsSync(outFile)) {
        unlinkSync(outFile);
        console.log(`  ${rel} → deleted ${basename(outFile)}`);
      }
    }

    // Regenerate barrel/facades
    if (barrel || facades) {
      const entries = scanOutputForBarrelEntries(outDir);
      if (barrel) generateBarrelFile(outDir, entries);
      if (facades) generateFacadeFiles(outDir, facadesDir, entries);
    }
  });

  process.on('SIGINT', () => {
    if (mcpProcess) mcpProcess.kill('SIGTERM');
    console.log('\n  KERN compile stopped.');
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}
