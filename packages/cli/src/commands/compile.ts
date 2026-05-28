import type { IRNode, KernTarget, ModuleExports, ResolvedKernConfig } from '@kernlang/core';
import {
  ALL_TARGETS,
  collectCapabilityIslands,
  collectExternalBoundaries,
  collectSidecarManifests,
  detectReactHookDeps,
  detectVersionsFromPackageJson,
  expandTemplateNode,
  generateCoreNode,
  injectReactHookImports,
  isCoreNode,
  isTemplateNode,
  KernParseError,
  parseStrict,
  parseWithDiagnostics,
  resolveConfig,
  sourceComment,
  validateSchema,
} from '@kernlang/core';
import { loadEvolvedNodes } from '@kernlang/evolve';
import { generateReactNode, isReactNode } from '@kernlang/react';
import type { ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path';
import { buildCrossModuleRegistry, makeImportResolverForFile } from '../lib/cross-module-registry.js';
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
  outputBaseNameForTarget,
  parseFlag,
  parseWithJSONDiagnostics,
  runShadowAnalysis,
  scanOutputForBarrelEntries,
  surfaceParseDiagnostics,
  surfaceShadowDiagnostics,
  surfaceValidationDiagnostics,
  transpileAndWrite,
  writeFastApiPythonInstallFilesForAsts,
  writeSidecarInstallFilesForAsts,
} from '../shared.js';

// ── Single-file compilation (no --target) ───────────────────────────────

interface DefaultCompileResult {
  compiled: boolean;
  errors: number;
  warnings: number;
  barrelEntry?: BarrelEntry;
  sidecarEntry?: SidecarInstallEntry;
}

interface SidecarInstallEntry {
  file: string;
  ast: IRNode;
  outDir: string;
}

interface FastApiModulePlan {
  entryModulesByOutDir: Map<string, string[]>;
  entryByFile: Map<string, FastApiModulePlanEntry>;
  moduleByFile: Map<string, string>;
  moduleNameByFile: Record<string, string>;
  modulePathByFile: Record<string, string>;
  packageInitFiles: string[];
}

interface FastApiModulePlanEntry {
  sourceFile: string;
  outDir: string;
  outputRelDir: string;
  moduleName: string;
  modulePath: string;
  outputFile: string;
}

const GENERATED_FASTAPI_PACKAGE_INIT = '# Generated Python package marker.\n';

function parseStrictWithOptions(source: string, parseOptions?: import('@kernlang/core').ParseOptions): IRNode {
  if (!parseOptions) return parseStrict(source);
  const { root, diagnostics } = parseWithDiagnostics(source, undefined, parseOptions);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    const err = new KernParseError(first.message, first.line, first.col, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  const schemaViolations = validateSchema(root);
  if (schemaViolations.length > 0) {
    const first = schemaViolations[0];
    const err = new KernParseError(first.message, first.line ?? 1, first.col ?? 1, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  return root;
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
  parseOptions?: import('@kernlang/core').ParseOptions,
): Promise<DefaultCompileResult> {
  const source = readFileSync(file, 'utf-8');

  let ast: IRNode;
  let errors = 0;
  let warnings = 0;

  if (strictParse) {
    try {
      ast = parseStrictWithOptions(source, parseOptions);
      const validation = surfaceValidationDiagnostics(ast, file);
      if (validation.errors > 0) {
        if (jsonOutput) {
          const { json } = parseWithJSONDiagnostics(source, file, parseOptions);
          jsonDiagnostics.push(json);
        }
        if (!jsonOutput) process.exit(1);
        return { compiled: false, errors: validation.errors, warnings: validation.warnings };
      }
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
    const { root, json } = parseWithJSONDiagnostics(source, file, parseOptions);
    ast = root;
    jsonDiagnostics.push(json);
    errors = json.diagnostics.filter((d) => d.severity === 'error').length + json.schemaViolations.length;
    warnings = json.diagnostics.filter((d) => d.severity === 'warning').length;
  } else {
    const result = parseWithDiagnostics(source, undefined, parseOptions);
    const diag = surfaceParseDiagnostics(result.diagnostics, file);
    const validation = surfaceValidationDiagnostics(result.root, file);
    ast = result.root;
    errors = diag.errors + validation.errors;
    warnings = diag.warnings + validation.warnings;
  }

  // ── Shadow semantic analysis (opt-in) ────────────────────────────────
  if (shadow) {
    const shadowDiagnostics = await runShadowAnalysis(ast);
    if (jsonOutput) {
      const current = jsonDiagnostics.find((entry) => entry.file === file);
      if (current) {
        current.shadowDiagnostics = shadowDiagnostics;
        const shadowErrors = shadowDiagnostics.filter((d) => d.rule === 'shadow-ts').length;
        errors += shadowErrors;
        if (shadowErrors > 0) current.success = false;
      } else {
        const shadowErrors = shadowDiagnostics.filter((d) => d.rule === 'shadow-ts').length;
        errors += shadowErrors;
        jsonDiagnostics.push({
          file,
          success: shadowErrors === 0,
          diagnostics: [],
          schemaViolations: [],
          capabilityIslands: collectCapabilityIslands(ast),
          sidecarManifests: collectSidecarManifests(ast),
          externalBoundaries: collectExternalBoundaries(ast),
          shadowDiagnostics,
        });
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
  if (ast.type !== 'module' && ast.children) {
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
  const targetDir = defaultSidecarOutDirForFile(file, outDir, inputBase);
  mkdirSync(targetDir, { recursive: true });
  const outFile = resolve(targetDir, outName);
  // Slice C-cell-v4 — auto-emit `import { useState } from 'react'` when
  // body-stmt `cell` nodes appear in the IR. The default compile path
  // (no --target) doesn't go through `transpileForTarget`, so it needs its
  // own integration. Targeted compiles get this in `shared.ts`.
  const reactDeps = detectReactHookDeps(ast);
  const code = injectReactHookImports(lines.join('\n'), reactDeps);
  writeFileSync(outFile, `${code}\n`);
  if (!jsonOutput) console.log(`  ${basename(file)} → ${relSubdir ? `${relSubdir}/` : ''}${outName}`);

  const exports = extractExportsFromLines(lines);
  const barrelEntry = exports.length > 0 ? { moduleName: basename(file, '.kern'), exports } : undefined;

  return { compiled: true, errors, warnings, barrelEntry, sidecarEntry: { file, ast, outDir: targetDir } };
}

function defaultSidecarOutDirForFile(file: string, outDir: string, inputBase?: string): string {
  const relSubdir = inputBase ? relative(inputBase, dirname(file)) : '';
  return relSubdir ? resolve(outDir, relSubdir) : outDir;
}

function targetSidecarOutDirForFile(file: string, outDir: string, cfg: ResolvedKernConfig, inputBase?: string): string {
  const relDir = inputBase ? relative(resolve(inputBase), dirname(file)) : '';
  const baseDir = resolve(outDir, relDir);
  return resolve(baseDir, cfg.output.outDir);
}

function fastApiOutputRoot(outDir: string, cfg: ResolvedKernConfig): string {
  return resolve(outDir, cfg.output.outDir);
}

function fastApiOutputRelDir(file: string, inputBase?: string): string {
  if (!inputBase) return '';
  const relDir = relative(resolve(inputBase), dirname(file));
  if (!relDir || relDir === '.') return '';
  const segments = relDir.split(sep).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.some((segment) => segment === '..')) return '';
  return segments.map((segment) => outputBaseNameForTarget(segment, 'fastapi')).join('/');
}

function fastApiTargetOutDirForFile(file: string, outDir: string, cfg: ResolvedKernConfig, inputBase?: string): string {
  const relDir = fastApiOutputRelDir(file, inputBase);
  const root = fastApiOutputRoot(outDir, cfg);
  return relDir ? resolve(root, relDir) : root;
}

function fastApiModulePath(outputRelDir: string, moduleName: string): string {
  const packagePath = outputRelDir ? outputRelDir.split('/').filter(Boolean) : [];
  return [...packagePath, moduleName].join('.');
}

function reserveFastApiPackageSegments(
  entries: readonly { outputRelDir: string }[],
  outDir: string,
  cfg: ResolvedKernConfig,
): Map<string, Set<string>> {
  const reservedByOutDir = new Map<string, Set<string>>();
  const root = fastApiOutputRoot(outDir, cfg);
  for (const entry of entries) {
    const parts = entry.outputRelDir.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const parentRelDir = parts.slice(0, i);
      const packageName = parts[i];
      const parentOutDir = parentRelDir.length > 0 ? resolve(root, ...parentRelDir) : root;
      const reserved = reservedByOutDir.get(parentOutDir);
      if (reserved) reserved.add(packageName);
      else reservedByOutDir.set(parentOutDir, new Set([packageName]));
    }
  }
  return reservedByOutDir;
}

function fastApiPackageInitFiles(
  outDir: string,
  cfg: ResolvedKernConfig,
  entries: readonly FastApiModulePlanEntry[],
): string[] {
  const root = fastApiOutputRoot(outDir, cfg);
  const initFiles = new Set<string>([resolve(root, '__init__.py')]);
  for (const entry of entries) {
    const parts = entry.outputRelDir.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      initFiles.add(resolve(root, ...parts.slice(0, i), '__init__.py'));
    }
  }
  return [...initFiles].sort();
}

function buildFastApiModulePlan(
  files: readonly string[],
  outDir: string,
  cfg: ResolvedKernConfig,
  inputBase?: string,
): FastApiModulePlan | null {
  if (cfg.target !== 'fastapi') return null;

  const entries = files
    .map((file) => {
      const ext = file.endsWith('.kern') ? '.kern' : '.ir';
      const outputRelDir = fastApiOutputRelDir(file, inputBase);
      const outDirKey = fastApiTargetOutDirForFile(file, outDir, cfg, inputBase);
      return {
        file: resolve(file),
        outDirKey,
        outputRelDir,
        baseName: outputBaseNameForTarget(basename(file, ext), 'fastapi'),
        sortKey: `${outDirKey}\0${relative(inputBase ? resolve(inputBase) : process.cwd(), resolve(file))}`,
      };
    })
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  const usedByOutDir = new Map<string, Set<string>>();
  const packageReservedByOutDir = reserveFastApiPackageSegments(entries, outDir, cfg);
  const reservedByOutDir = new Map<string, Set<string>>();
  const entryModulesByOutDir = new Map<string, string[]>();
  const entryByFile = new Map<string, FastApiModulePlanEntry>();
  const moduleByFile = new Map<string, string>();
  const moduleNameByFile: Record<string, string> = {};
  const modulePathByFile: Record<string, string> = {};
  const planEntries: FastApiModulePlanEntry[] = [];

  for (const entry of entries) {
    const reserved = reservedByOutDir.get(entry.outDirKey);
    if (reserved) reserved.add(entry.baseName);
    else reservedByOutDir.set(entry.outDirKey, new Set([entry.baseName]));
  }

  for (const entry of entries) {
    let used = usedByOutDir.get(entry.outDirKey);
    if (!used) {
      used = new Set<string>();
      usedByOutDir.set(entry.outDirKey, used);
    }
    const reserved = reservedByOutDir.get(entry.outDirKey) ?? new Set<string>();
    const packageReserved = packageReservedByOutDir.get(entry.outDirKey) ?? new Set<string>();

    let moduleName = entry.baseName;
    for (
      let suffix = 2;
      used.has(moduleName) ||
      packageReserved.has(moduleName) ||
      (moduleName !== entry.baseName && reserved.has(moduleName));
      suffix++
    ) {
      moduleName = `${entry.baseName}_${suffix}`;
    }

    used.add(moduleName);
    const modulePath = fastApiModulePath(entry.outputRelDir, moduleName);
    const planEntry: FastApiModulePlanEntry = {
      sourceFile: entry.file,
      outDir: entry.outDirKey,
      outputRelDir: entry.outputRelDir,
      moduleName,
      modulePath,
      outputFile: resolve(entry.outDirKey, `${moduleName}.py`),
    };
    entryByFile.set(entry.file, planEntry);
    moduleByFile.set(entry.file, moduleName);
    moduleNameByFile[entry.file] = moduleName;
    modulePathByFile[entry.file] = modulePath;
    planEntries.push(planEntry);

    const entryModules = entryModulesByOutDir.get(entry.outDirKey);
    if (entryModules) entryModules.push(moduleName);
    else entryModulesByOutDir.set(entry.outDirKey, [moduleName]);
  }

  return {
    entryModulesByOutDir,
    entryByFile,
    moduleByFile,
    moduleNameByFile,
    modulePathByFile,
    packageInitFiles: fastApiPackageInitFiles(outDir, cfg, planEntries),
  };
}

function groupInstallEntriesByOutDir(entries: SidecarInstallEntry[]): Map<string, IRNode[]> {
  const byOutDir = new Map<string, IRNode[]>();
  for (const entry of entries) {
    const asts = byOutDir.get(entry.outDir);
    if (asts) asts.push(entry.ast);
    else byOutDir.set(entry.outDir, [entry.ast]);
  }
  return byOutDir;
}

function writeAggregatedSidecarInstallFiles(
  entries: SidecarInstallEntry[],
  options?: { sidecarIslandsOnly?: boolean },
): void {
  const byOutDir = groupInstallEntriesByOutDir(entries);
  for (const [sidecarOutDir, asts] of byOutDir) {
    mkdirSync(sidecarOutDir, { recursive: true });
    writeSidecarInstallFilesForAsts(asts, sidecarOutDir, options);
  }
}

function writeAggregatedFastApiPythonInstallFiles(entries: SidecarInstallEntry[], rootOutDir: string): void {
  writeFastApiPythonInstallFilesForAsts(
    entries.map((entry) => entry.ast),
    rootOutDir,
  );
}

function clearSidecarInstallFiles(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeSidecarInstallFilesForAsts([], outDir);
}

function writeGeneratedFastApiInitFile(initFile: string): void {
  mkdirSync(dirname(initFile), { recursive: true });
  if (existsSync(initFile) && readFileSync(initFile, 'utf-8') !== GENERATED_FASTAPI_PACKAGE_INIT) return;
  writeFileSync(initFile, GENERATED_FASTAPI_PACKAGE_INIT);
}

function removeGeneratedFastApiInitFile(initFile: string): boolean {
  if (!existsSync(initFile)) return false;
  if (readFileSync(initFile, 'utf-8') !== GENERATED_FASTAPI_PACKAGE_INIT) return false;
  unlinkSync(initFile);
  return true;
}

function removeEmptyDirsUpTo(startDir: string, stopDir: string): void {
  let current = resolve(startDir);
  const stop = resolve(stopDir);
  for (let steps = 0; steps < 100; steps++) {
    if (current === stop) return;
    const rel = relative(stop, current);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return;
    try {
      rmdirSync(current);
    } catch {
      return;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function toManifestPath(path: string): string {
  return path.split(sep).join('/');
}

function writeFastApiModuleManifest(plan: FastApiModulePlan | null, outDir: string, cfg: ResolvedKernConfig): void {
  if (!plan) return;
  const root = fastApiOutputRoot(outDir, cfg);
  mkdirSync(root, { recursive: true });
  for (const initFile of plan.packageInitFiles) {
    writeGeneratedFastApiInitFile(initFile);
  }
  const entries = [...plan.entryByFile.values()]
    .sort((a, b) => (a.sourceFile < b.sourceFile ? -1 : a.sourceFile > b.sourceFile ? 1 : 0))
    .map((entry) => ({
      sourceFile: toManifestPath(relative(process.cwd(), entry.sourceFile)),
      outputFile: toManifestPath(relative(root, entry.outputFile)),
      package: entry.outputRelDir,
      moduleName: entry.moduleName,
      modulePath: entry.modulePath,
    }));
  writeFileSync(
    resolve(root, 'kern-python-modules.json'),
    `${JSON.stringify({ target: 'fastapi', entries }, null, 2)}\n`,
  );
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
  const emitArg = parseFlag(args, '--emit');
  const pythonModelBackend = parseFlag(args, '--python-model-backend');
  const cfg = resolveConfig({
    ...compileConfig,
    ...(targetArg ? { target: targetArg } : {}),
    ...(emitArg ? { emit: emitArg } : {}),
    ...(pythonModelBackend ? { pythonModelBackend: pythonModelBackend as any } : {}),
  });

  // ── Slice 7 v2 — cross-module Result/Option registry ───────────────
  // Index every `.kern` file's exported fn signatures once, before the
  // per-file compile loop. Each compile then receives a per-file
  // `ImportResolver` that translates `use path="…"` strings into the
  // imported module's ModuleExports, enabling `?`/`!` propagation across
  // KERN-to-KERN imports.
  let crossModuleRegistry = buildCrossModuleRegistry(kernFiles);
  let fastApiModulePlan = targetArg
    ? buildFastApiModulePlan(kernFiles, outDir, cfg as ResolvedKernConfig, isDir ? inputPath : undefined)
    : null;

  // ── Initial compilation ────────────────────────────────────────────
  const jsonDiagnostics: FileDiagnosticsJSON[] = [];

  async function compileAll(files: string[]): Promise<{
    compiled: number;
    totalErrors: number;
    barrelEntries: BarrelEntry[];
    sidecarEntries: SidecarInstallEntry[];
  }> {
    let compiled = 0;
    let totalErrors = 0;
    const barrelEntries: BarrelEntry[] = [];
    const sidecarEntries: SidecarInstallEntry[] = [];

    if (targetArg) {
      for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        const parseOptions = { resolveImport: makeImportResolverForFile(resolve(file), crossModuleRegistry) };
        let skipTranspile = false;

        if (strictParse) {
          try {
            const ast = parseStrictWithOptions(source, parseOptions);
            const validation = surfaceValidationDiagnostics(ast, file);
            if (validation.errors > 0) {
              totalErrors += validation.errors;
              if (jsonOutput) {
                const { json } = parseWithJSONDiagnostics(source, file, parseOptions);
                jsonDiagnostics.push(json);
                skipTranspile = true;
              }
              if (!jsonOutput) process.exit(1);
            }
          } catch (err) {
            if (err instanceof KernParseError) {
              console.error(`\n${file}:`);
              console.error(`  [ERROR] ${err.message}`);
              process.exit(1);
            }
            throw err;
          }
        }
        if (jsonOutput) {
          if (!strictParse) {
            const { json } = parseWithJSONDiagnostics(source, file, parseOptions);
            jsonDiagnostics.push(json);
            totalErrors += json.diagnostics.filter((d) => d.severity === 'error').length + json.schemaViolations.length;
          }
        } else if (!strictParse) {
          const result = parseWithDiagnostics(source, undefined, parseOptions);
          totalErrors += result.diagnostics.filter((d) => d.severity === 'error').length;
          const validation = surfaceValidationDiagnostics(result.root, file);
          totalErrors += validation.errors;
        }

        if (skipTranspile) continue;

        try {
          const plannedEntry = fastApiModulePlan?.entryByFile.get(resolve(file));
          transpileAndWrite(file, cfg as ResolvedKernConfig, args, outDir, isDir ? inputPath : undefined, {
            fastApiEntryModules: plannedEntry
              ? fastApiModulePlan?.entryModulesByOutDir.get(plannedEntry.outDir)
              : undefined,
            fastApiModuleNameByFile: fastApiModulePlan?.moduleNameByFile,
            fastApiModulePathByFile: fastApiModulePlan?.modulePathByFile,
            outputBaseName: plannedEntry?.moduleName,
            outputRelDir: plannedEntry?.outputRelDir,
            resolveImport: makeImportResolverForFile(resolve(file), crossModuleRegistry),
            writeSidecarInstallFiles: false,
          });
          const { root } = parseWithDiagnostics(source, undefined, parseOptions);
          sidecarEntries.push(sidecarEntryForFile(file, root));
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
              const shadowErrors = shadowDiagnostics.filter((d) => d.rule === 'shadow-ts').length;
              totalErrors += shadowErrors;
              const current = jsonDiagnostics.find((entry) => entry.file === file);
              if (current) {
                current.shadowDiagnostics = shadowDiagnostics;
                if (shadowErrors > 0) current.success = false;
              } else {
                jsonDiagnostics.push({
                  file,
                  success: shadowErrors === 0,
                  diagnostics: [],
                  schemaViolations: [],
                  capabilityIslands: collectCapabilityIslands(shadowRoot),
                  sidecarManifests: collectSidecarManifests(shadowRoot),
                  externalBoundaries: collectExternalBoundaries(shadowRoot),
                  shadowDiagnostics,
                });
              }
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
          { resolveImport: makeImportResolverForFile(resolve(file), crossModuleRegistry) },
        );
        if (result.compiled) compiled++;
        totalErrors += result.errors;
        if (result.barrelEntry) barrelEntries.push(result.barrelEntry);
        if (result.sidecarEntry) sidecarEntries.push(result.sidecarEntry);
      }
    }

    return { compiled, totalErrors, barrelEntries, sidecarEntries };
  }

  const { compiled, totalErrors, barrelEntries, sidecarEntries } = await compileAll(kernFiles);
  const watchedSidecarEntries = new Map<string, SidecarInstallEntry>(
    sidecarEntries.map((entry) => [resolve(entry.file), entry]),
  );
  writeFastApiModuleManifest(fastApiModulePlan, outDir, cfg as ResolvedKernConfig);
  if (targetArg === 'fastapi') {
    writeAggregatedFastApiPythonInstallFiles(sidecarEntries, fastApiOutputRoot(outDir, cfg as ResolvedKernConfig));
    writeAggregatedSidecarInstallFiles(sidecarEntries, { sidecarIslandsOnly: true });
  } else {
    writeAggregatedSidecarInstallFiles(sidecarEntries);
  }

  function sidecarEntryForFile(file: string, ast: IRNode, plan = fastApiModulePlan): SidecarInstallEntry {
    return {
      file,
      ast,
      outDir:
        targetArg === 'fastapi'
          ? (plan?.entryByFile.get(resolve(file))?.outDir ??
            fastApiTargetOutDirForFile(file, outDir, cfg as ResolvedKernConfig, isDir ? inputPath : undefined))
          : targetArg
            ? targetSidecarOutDirForFile(file, outDir, cfg as ResolvedKernConfig, isDir ? inputPath : undefined)
            : defaultSidecarOutDirForFile(file, outDir, isDir ? inputPath : undefined),
    };
  }

  function refreshSidecarEntry(file: string): void {
    const source = readFileSync(file, 'utf-8');
    const parseOptions = { resolveImport: makeImportResolverForFile(resolve(file), crossModuleRegistry) };
    const { root } = parseWithDiagnostics(source, undefined, parseOptions);
    watchedSidecarEntries.set(resolve(file), sidecarEntryForFile(file, root));
  }

  function writeWatchedSidecarInstallFiles(): void {
    const entries = [...watchedSidecarEntries.values()];
    if (targetArg === 'fastapi') {
      writeAggregatedFastApiPythonInstallFiles(entries, fastApiOutputRoot(outDir, cfg as ResolvedKernConfig));
      writeAggregatedSidecarInstallFiles(entries, { sidecarIslandsOnly: true });
      return;
    }
    writeAggregatedSidecarInstallFiles(entries);
  }

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
      ? { compiled, total: kernFiles.length, outDir, target: targetArg, errors: totalErrors, files: jsonDiagnostics }
      : { compiled, total: kernFiles.length, outDir, errors: totalErrors, files: jsonDiagnostics };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const targetLabel = targetArg ? ` (target: ${targetArg})` : '';
    console.log(`\nCompiled ${compiled}/${kernFiles.length} files${targetLabel} → ${outDir}`);
    if (totalErrors > 0 && !strictParse) {
      if (tolerant) {
        console.log(`  ${totalErrors} diagnostic error(s) recovered — output may contain TODO comments.`);
      } else {
        console.error(
          `\n${totalErrors} diagnostic error(s) found. Use --strict-parse to fail on parse/schema errors, or --tolerant for partial compilation.`,
        );
      }
    }
  }

  // ── Exit or watch ──────────────────────────────────────────────────
  if (!watchMode) {
    process.exit(strictParse && totalErrors > 0 ? 1 : 0);
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

  function removePlannedFastApiOutput(entry: FastApiModulePlanEntry): void {
    if (existsSync(entry.outputFile)) unlinkSync(entry.outputFile);
  }

  function removeStaleFastApiInitFiles(previous: FastApiModulePlan, next: FastApiModulePlan | null): void {
    const nextInitFiles = new Set(next?.packageInitFiles ?? []);
    const root = fastApiOutputRoot(outDir, cfg as ResolvedKernConfig);
    for (const initFile of previous.packageInitFiles) {
      if (nextInitFiles.has(initFile)) continue;
      if (removeGeneratedFastApiInitFile(initFile)) {
        removeEmptyDirsUpTo(dirname(initFile), root);
      }
    }
  }

  function removeStaleFastApiOutputs(previous: FastApiModulePlan | null, next: FastApiModulePlan | null): void {
    if (!previous) return;
    const nextEntries = next ? [...next.entryByFile.values()] : [];
    const nextOutputFiles = new Set(nextEntries.map((entry) => entry.outputFile));
    for (const previousEntry of previous.entryByFile.values()) {
      if (nextOutputFiles.has(previousEntry.outputFile)) continue;
      removePlannedFastApiOutput(previousEntry);
    }
    removeStaleFastApiInitFiles(previous, next);
  }

  function transpileTargetWithPlan(
    filePath: string,
    plan: FastApiModulePlan | null,
    registry = crossModuleRegistry,
  ): void {
    const plannedEntry = plan?.entryByFile.get(resolve(filePath));
    transpileAndWrite(filePath, cfg as ResolvedKernConfig, args, outDir, isDir ? inputPath : undefined, {
      fastApiEntryModules: plannedEntry ? plan?.entryModulesByOutDir.get(plannedEntry.outDir) : undefined,
      fastApiModuleNameByFile: plan?.moduleNameByFile,
      fastApiModulePathByFile: plan?.modulePathByFile,
      outputBaseName: plannedEntry?.moduleName,
      outputRelDir: plannedEntry?.outputRelDir,
      resolveImport: makeImportResolverForFile(resolve(filePath), registry),
      writeSidecarInstallFiles: false,
    });
  }

  function sidecarEntryWithRegistry(
    filePath: string,
    registry: Map<string, ModuleExports>,
    plan = fastApiModulePlan,
  ): SidecarInstallEntry {
    const source = readFileSync(filePath, 'utf-8');
    const parseOptions = { resolveImport: makeImportResolverForFile(resolve(filePath), registry) };
    const { root } = parseWithDiagnostics(source, undefined, parseOptions);
    return sidecarEntryForFile(filePath, root, plan);
  }

  function rebuildFastApiDirectoryOutputs(currentFiles: string[]): void {
    const nextRegistry = buildCrossModuleRegistry(currentFiles);
    const nextPlan = buildFastApiModulePlan(currentFiles, outDir, cfg as ResolvedKernConfig, inputPath);
    const nextSidecarEntries = new Map<string, SidecarInstallEntry>();
    for (const currentFile of currentFiles) {
      transpileTargetWithPlan(currentFile, nextPlan, nextRegistry);
      nextSidecarEntries.set(resolve(currentFile), sidecarEntryWithRegistry(currentFile, nextRegistry, nextPlan));
    }
    removeStaleFastApiOutputs(fastApiModulePlan, nextPlan);
    writeFastApiModuleManifest(nextPlan, outDir, cfg as ResolvedKernConfig);
    crossModuleRegistry = nextRegistry;
    fastApiModulePlan = nextPlan;
    watchedSidecarEntries.clear();
    for (const [fileKey, entry] of nextSidecarEntries) {
      watchedSidecarEntries.set(fileKey, entry);
    }
    writeWatchedSidecarInstallFiles();
  }

  const handleChange = async (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const start = performance.now();
    try {
      let sidecarsRefreshed = false;
      if (targetArg) {
        if (targetArg === 'fastapi' && isDir) {
          rebuildFastApiDirectoryOutputs(findKernFiles(inputPath));
          sidecarsRefreshed = true;
        } else {
          transpileTargetWithPlan(filePath, fastApiModulePlan);
        }
      } else {
        await compileDefaultSingle(filePath, outDir, strictParse, false, [], shadow, isDir ? inputPath : undefined, {
          resolveImport: makeImportResolverForFile(resolve(filePath), crossModuleRegistry),
        });
      }
      if (!sidecarsRefreshed) {
        refreshSidecarEntry(filePath);
        writeWatchedSidecarInstallFiles();
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

  watcher.on('unlink', async (filePath: string) => {
    const rel = relative(process.cwd(), filePath);
    const name = basename(filePath, '.kern');
    try {
      if (targetArg === 'fastapi' && isDir) {
        rebuildFastApiDirectoryOutputs(findKernFiles(inputPath));
      } else {
        // Remove generated output file(s)
        const outExt = targetArg ? getOutputExtension(targetArg) : '.ts';
        const deletedName =
          targetArg === 'fastapi'
            ? (fastApiModulePlan?.moduleByFile.get(resolve(filePath)) ?? outputBaseNameForTarget(name, 'fastapi'))
            : name;
        const deletedOutDir =
          targetArg === 'fastapi'
            ? (fastApiModulePlan?.entryByFile.get(resolve(filePath))?.outDir ??
              fastApiTargetOutDirForFile(filePath, outDir, cfg as ResolvedKernConfig, isDir ? inputPath : undefined))
            : targetArg
              ? targetSidecarOutDirForFile(filePath, outDir, cfg as ResolvedKernConfig, isDir ? inputPath : undefined)
              : defaultSidecarOutDirForFile(filePath, outDir, isDir ? inputPath : undefined);
        for (const ext of [outExt, outExt === '.ts' ? '.tsx' : '.ts']) {
          const outFile = resolve(deletedOutDir, `${deletedName}${ext}`);
          if (existsSync(outFile)) {
            unlinkSync(outFile);
            console.log(`  ${rel} → deleted ${basename(outFile)}`);
          }
        }
        watchedSidecarEntries.delete(resolve(filePath));
        clearSidecarInstallFiles(deletedOutDir);
        writeWatchedSidecarInstallFiles();
      }

      // Regenerate barrel/facades
      if (barrel || facades) {
        const entries = scanOutputForBarrelEntries(outDir);
        if (barrel) generateBarrelFile(outDir, entries);
        if (facades) generateFacadeFiles(outDir, facadesDir, entries);
      }
    } catch (err) {
      console.error(`  ${rel} → ERROR: ${(err as Error).message}`);
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
