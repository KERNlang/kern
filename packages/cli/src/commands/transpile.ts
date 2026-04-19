import type { IRNode, KernConfig, KernStructure, KernTarget, ResolvedKernConfig } from '@kernlang/core';
import { ALL_TARGETS, decompile, resolveConfig, VALID_STRUCTURES } from '@kernlang/core';
import { loadEvolvedNodes } from '@kernlang/evolve';
import { collectLanguageMetrics } from '@kernlang/metrics';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createJiti } from 'jiti';
import { basename, dirname, resolve } from 'path';
import {
  getOutputExtension,
  hasFlag,
  loadTemplates,
  parseAndSurface,
  parseFlag,
  transpileForTarget,
} from '../shared.js';

// ── Minify/Pretty implementations ───────────────────────────────────────

/** Serialize node props. pseudoFormat controls pseudo style output:
 *  'minify' → ` {:state:key:value}` (space + braces)
 *  'pretty' → `,:state:key:value`   (comma prefix, no braces) */
function serializeProps(node: IRNode, pseudoFormat: 'minify' | 'pretty' = 'minify'): string {
  const type = node.type;
  const props = node.props || {};
  let head = type;

  for (const [k, v] of Object.entries(props)) {
    if (['styles', 'pseudoStyles', 'themeRefs'].includes(k)) continue;
    if (type === 'theme' && k === 'name') {
      head += ` ${v}`;
      continue;
    }
    if (typeof v === 'object' && v !== null && '__expr' in v) {
      head += ` ${k}={{ ${(v as unknown as { code: string }).code} }}`;
      continue;
    }
    const val = typeof v === 'string' && v.includes(' ') ? `"${v}"` : String(v);
    head += ` ${k}=${val}`;
  }

  if (props.styles) {
    const pairs = Object.entries(props.styles as Record<string, string>).map(([k, v]) =>
      v.includes(' ') || v.includes(',') ? `"${k}":"${v}"` : `${k}:${v}`,
    );
    head += ` {${pairs.join(',')}}`;
  }

  if (props.pseudoStyles) {
    const pseudo = props.pseudoStyles as Record<string, Record<string, string>>;
    for (const [state, styles] of Object.entries(pseudo)) {
      for (const [k, v] of Object.entries(styles)) {
        head += pseudoFormat === 'minify' ? ` {:${state}:${k}:${v}}` : `,${`:${state}:${k}:${v}`}`;
      }
    }
  }

  if (props.themeRefs) {
    for (const ref of props.themeRefs as string[]) {
      head += ` $${ref}`;
    }
  }

  return head;
}

function minifyKern(node: IRNode): string {
  const head = serializeProps(node, 'minify');
  if (node.children && node.children.length > 0) {
    const kids = node.children.map((c) => minifyKern(c)).join(',');
    return `${head}(${kids})`;
  }
  return head;
}

function prettyKern(node: IRNode, indent = ''): string {
  const line = `${indent}${serializeProps(node, 'pretty')}`;

  let result = `${line}\n`;
  if (node.children) {
    for (const child of node.children) {
      result += prettyKern(child, `${indent}  `);
    }
  }
  return result;
}

// ── Main transpile command ──────────────────────────────────────────────

export function runTranspile(args: string[]): void {
  const inputFile = args.find((a) => !a.startsWith('--'));

  if (!inputFile) {
    printHelp();
    process.exit(1);
  }

  // Load config
  let config: ResolvedKernConfig;
  const configPath = resolve(process.cwd(), 'kern.config.ts');
  if (existsSync(configPath)) {
    try {
      const jiti = createJiti(import.meta.url);
      const mod = jiti(configPath) as { default?: unknown };
      const userConfig = mod.default ?? mod;
      config = resolveConfig(userConfig as Partial<KernConfig>);
    } catch (err) {
      console.error(`Warning: Failed to load kern.config.ts: ${(err as Error).message}`);
      config = resolveConfig({});
    }
  } else {
    config = resolveConfig({});
  }

  loadTemplates(config);
  loadEvolvedNodes(process.cwd(), hasFlag(args, '--verify'));

  // CLI overrides
  const cliTarget = parseFlag(args, '--target');
  if (cliTarget) {
    if (!ALL_TARGETS.includes(cliTarget as KernTarget)) {
      console.error(`Unknown target: '${cliTarget}'. Valid targets: ${ALL_TARGETS.join(', ')}`);
      process.exit(1);
    }
    config = { ...config, target: cliTarget as KernTarget };
  }
  const target = config.target;

  const cliStructure = parseFlag(args, '--structure');
  if (cliStructure) {
    if (!VALID_STRUCTURES.includes(cliStructure as KernStructure)) {
      console.error(`Unknown structure: '${cliStructure}'. Valid structures: ${VALID_STRUCTURES.join(', ')}`);
      process.exit(1);
    }
    config = { ...config, structure: cliStructure as KernStructure };
  }

  const irSource = readFileSync(resolve(inputFile), 'utf-8');
  const ast = parseAndSurface(irSource, inputFile);
  const ext = inputFile.endsWith('.kern') ? '.kern' : '.ir';
  const name = basename(inputFile, ext);

  // Minify
  if (hasFlag(args, '--minify')) {
    const minified = minifyKern(ast);
    const outFile = resolve(dirname(inputFile), `${name}.min.kern`);
    writeFileSync(outFile, minified);
    const savings = Math.round((1 - minified.length / irSource.length) * 100);
    console.log(`Minified: ${inputFile} → ${outFile}`);
    console.log(`Chars:    ${irSource.length} → ${minified.length} (${savings}% smaller)`);
    process.exit(0);
  }

  // Pretty
  if (hasFlag(args, '--pretty')) {
    const pretty = prettyKern(ast);
    const outFile = resolve(dirname(inputFile), `${name}.kern`);
    writeFileSync(outFile, pretty);
    console.log(`Formatted: ${inputFile} → ${outFile}`);
    process.exit(0);
  }

  // Decompile
  if (hasFlag(args, '--decompile')) {
    const result = decompile(ast);
    console.log(result.code);
    process.exit(0);
  }

  // Metrics
  if (hasFlag(args, '--metrics')) {
    const metrics = collectLanguageMetrics(ast);
    console.log(`Metrics: ${inputFile}`);
    console.log(`  Nodes:        ${metrics.nodeCount} (${metrics.nodeTypes.length} types)`);
    console.log(`  Styles:       ${metrics.styleMetrics.totalStyleDecls} declarations`);
    console.log(
      `  Mapped:       ${metrics.styleMetrics.mappedStyleDecls} (${Math.round((1 - metrics.styleMetrics.escapeRatio) * 100)}%)`,
    );
    console.log(
      `  Escaped:      ${metrics.styleMetrics.escapedStyleDecls} (${Math.round(metrics.styleMetrics.escapeRatio * 100)}%)`,
    );
    if (metrics.styleMetrics.escapedKeys.length > 0) {
      console.log(`  Escape keys:  ${metrics.styleMetrics.escapedKeys.join(', ')}`);
    }
    console.log(`  Shorthand:    ${Math.round(metrics.shorthandCoverage * 100)}% coverage`);
    console.log(`  Theme refs:   ${metrics.themeRefCount}`);
    console.log(`  Pseudo:       ${metrics.pseudoStyleCount}`);
    if (metrics.unknownNodeCount > 0) {
      console.log(`  Unknown nodes: ${metrics.unknownNodeCount}`);
    }
    console.log('');
    console.log('  Node types:');
    for (const nt of metrics.nodeTypes.slice(0, 10)) {
      console.log(`    ${nt.type}: ${nt.count} (${nt.styleDecls} styles)`);
    }
    process.exit(0);
  }

  // Transpile
  const result = transpileForTarget(ast, config);

  const outDir = resolve(dirname(inputFile), config.output.outDir);
  const isStructured = config.structure !== 'flat' && result.artifacts && result.artifacts.length > 0;

  if (isStructured) {
    for (const artifact of result.artifacts!) {
      const artifactPath = resolve(outDir, artifact.path);
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, artifact.content);
    }
    const entryArtifact = result.artifacts!.find((a) => a.type === 'entry' || a.type === 'page');
    const displayPath = entryArtifact ? resolve(outDir, entryArtifact.path) : resolve(outDir, `${name}.tsx`);
    console.log(`Transpiled: ${inputFile} → ${displayPath}`);
  } else {
    const outExt = getOutputExtension(target);
    const outFile = resolve(outDir, `${name}${outExt}`);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, result.code);
    if (result.artifacts) {
      for (const artifact of result.artifacts) {
        const artifactPath = resolve(outDir, artifact.path);
        mkdirSync(dirname(artifactPath), { recursive: true });
        writeFileSync(artifactPath, artifact.content);
      }
    }
    console.log(`Transpiled: ${inputFile} → ${outFile}`);
  }

  const targetNames: Record<string, string> = {
    native: 'React Native',
    web: 'React (inline)',
    tailwind: 'React + Tailwind',
    nextjs: 'Next.js App Router',
    express: 'Express TypeScript',
    fastapi: 'FastAPI Python',
    cli: 'Commander.js CLI',
    terminal: 'ANSI Terminal',
    ink: 'Ink (React for Terminals)',
    vue: 'Vue 3 SFC',
    nuxt: 'Nuxt 3',
  };
  console.log(`Target:     ${targetNames[target] || target}`);
  if (config.structure !== 'flat') {
    const structureNames: Record<string, string> = {
      bulletproof: 'Bulletproof React',
      atomic: 'Atomic Design',
      kern: 'KERN Native',
    };
    console.log(`Structure:  ${structureNames[config.structure] || config.structure}`);
  }
  console.log(`IR tokens:  ${result.irTokenCount}`);
  console.log(`TS tokens:  ${result.tsTokenCount}`);
  console.log(`Reduction:  ${result.tokenReduction}%`);
  console.log(`Source map: ${result.sourceMap.length} entries`);
  if (result.artifacts) {
    console.log(`Artifacts:  ${result.artifacts.length}`);
  }
  if (result.diagnostics && result.diagnostics.length > 0) {
    const counts: Record<string, number> = {};
    for (const d of result.diagnostics) counts[d.outcome] = (counts[d.outcome] || 0) + 1;
    const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
    console.log(`Diagnostics: ${parts.join(', ')}`);
    const unsupported = result.diagnostics.filter((d) => d.outcome === 'unsupported');
    if (unsupported.length > 0) {
      for (const d of unsupported) {
        const loc = d.loc ? `:${d.loc.line}` : '';
        const lost = d.childrenLost ? ` (+${d.childrenLost} children)` : '';
        console.log(`  ⚠ ${d.nodeType}${loc} — unsupported in ${d.target}${lost}`);
      }
    }
    // Surface severity-based diagnostics from transpiler
    const sevDiags = result.diagnostics.filter((d) => d.severity);
    for (const d of sevDiags) {
      const loc = d.loc ? `:${d.loc.line}` : '';
      const icon = d.severity === 'error' ? '✖' : d.severity === 'warning' ? '⚠' : 'ℹ';
      console.log(`  ${icon} ${d.severity}: ${d.message || d.reason || d.nodeType}${loc}`);
    }
    if (sevDiags.some((d) => d.severity === 'error')) {
      process.exitCode = 1;
    }
  }
}

export function printHelp(): void {
  console.log(
    'Usage: kern <file.kern> [--target=lib|nextjs|tailwind|web|native|express|cli|terminal|ink|vue|nuxt|fastapi|mcp] [options]',
  );
  console.log('');
  console.log('Commands:');
  console.log('  dev <dir|file> [--target=...] [--outdir=...]  Watch & hot-transpile .kern files');
  console.log('  compile <dir|file> --outdir=<dir>             Compile .kern → .ts (core nodes)');
  console.log('  scan [--force] [--dry-run]                    Detect project → generate kern.config.ts');
  console.log('  init-templates [--force] [--dry-run]          Scan deps → scaffold template .kern files');
  console.log(
    '  gaps [--root=<dir>|--git=<repo|github-url>] [options]  Report explicit KERN-GAP comments + coverage gaps',
  );
  console.log('  import <file.ts|dir> [options]                Convert TypeScript source into starter .kern files');
  console.log('  migrate <name> [dir] [--write]                In-place .kern migrations (e.g. literal-const)');
  console.log(
    '  review <file.ts|dir> [--git=<repo|github-url>] [options]  Static analysis, Cognitive Complexity & CI Gate',
  );
  console.log('  schema                                        Print the current KERN schema JSON');
  console.log('  evolve <dir|file> [options]                   Detect gaps → propose templates');
  console.log('  evolve:review [options]                       Review staged template proposals');
  console.log('  evolve:review-v4 [options]                    Review & graduate v4 node proposals');
  console.log('  evolve:promote <keyword>                      Show steps to move evolved → core');
  console.log('  evolve:backfill <kw> --target=<t>             LLM generates target-specific codegen');
  console.log('  evolve:prune [--dry-run] [--days=N]           Remove unused nodes (default 90d)');
  console.log('  evolve:migrate                                Detect & resolve keyword collisions');
  console.log('  evolve:rebuild                                Rebuild manifest.json from disk definitions');
  console.log('  confidence <file.kern>                        Display confidence graph for a .kern file');
  console.log('');
  console.log('Targets:');
  console.log('  nextjs    Next.js App Router (default)');
  console.log('  tailwind  React + Tailwind CSS');
  console.log('  web       React with inline styles');
  console.log('  vue       Vue 3 Single File Component');
  console.log('  nuxt      Nuxt 3 (pages, layouts, server routes)');
  console.log('  native    React Native component');
  console.log('  express   Express TypeScript backend');
  console.log('  cli       Commander.js CLI app');
  console.log('  terminal  ANSI terminal rendering');
  console.log('  ink       React Ink terminal UI');
  console.log('  fastapi   FastAPI Python backend');
  console.log('  mcp       Model Context Protocol server');
  console.log('');
  console.log('Options:');
  console.log('  --structure=flat|bulletproof|atomic|kern  Output structure pattern (React targets)');
  console.log('  --decompile  Output human-readable pseudocode');
  console.log('  --minify     Output minified single-line Kern (LLM wire format)');
  console.log('  --pretty     Expand minified Kern back to indented format');
  console.log('  --metrics    Show language metrics (escape ratio, coverage, etc.)');
  console.log('');
  console.log('Structures (React targets only):');
  console.log('  flat         Single .tsx file (default)');
  console.log('  bulletproof  Feature-based folder structure');
  console.log('  atomic       Atomic Design hierarchy (pages/templates/organisms/molecules/atoms)');
  console.log('  kern         KERN-native (surfaces/blocks/signals/tokens/models)');
}
