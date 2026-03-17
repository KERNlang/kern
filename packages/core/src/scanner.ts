/**
 * Project Scanner — detects project conventions and generates kern.config.ts
 *
 * Scans config files (package.json, tsconfig.json, .prettierrc, etc.)
 * to auto-generate a KernConfig that matches the project's setup.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { detectVersionsFromPackageJson } from './version-detect.js';
import { DEFAULT_CONFIG } from './config.js';
import type { KernConfig, KernTarget } from './config.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface ScanResult {
  config: Partial<KernConfig>;
  info: ScanInfo;
  detections: Detection[];
}

export interface ScanInfo {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  typescript: { strict: boolean; pathAliases: Record<string, string[]>; module: string | null } | null;
  formatting: { semicolons: boolean; singleQuote: boolean; tabWidth: number; trailingComma: string } | null;
  editorConfig: { indentStyle: string; indentSize: number } | null;
  typeLibraries: string[];
}

export interface Detection {
  source: string;
  field: string;
  value: string;
  confidence: 'high' | 'medium';
}

// ── Main Entry ───────────────────────────────────────────────────────────

export function scanProject(cwd: string): ScanResult {
  const config: Partial<KernConfig> = {};
  const info: ScanInfo = {
    packageManager: null,
    typescript: null,
    formatting: null,
    editorConfig: null,
    typeLibraries: [],
  };
  const detections: Detection[] = [];

  detectFromPackageJson(cwd, config, info, detections);
  detectFromTsconfig(cwd, config, info, detections);
  detectFromPrettierrc(cwd, info, detections);
  detectFromEditorConfig(cwd, info, detections);
  detectPackageManager(cwd, info, detections);

  return { config, info, detections };
}

// ── Detector: package.json ───────────────────────────────────────────────

function detectFromPackageJson(
  cwd: string,
  config: Partial<KernConfig>,
  info: ScanInfo,
  detections: Detection[],
): void {
  const pkgPath = resolve(cwd, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return;
  }

  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const allDeps = { ...devDeps, ...deps };

  // ── Target detection (priority order) ──
  const target = detectTarget(allDeps);
  if (target) {
    config.target = target;
    detections.push({ source: 'package.json', field: 'target', value: target, confidence: 'high' });
  }

  // ── Framework versions (reuse core utility) ──
  const versions = detectVersionsFromPackageJson(pkg);
  if (versions.nextjs || versions.tailwind) {
    config.frameworkVersions = versions;
    if (versions.nextjs) {
      detections.push({ source: 'package.json', field: 'frameworkVersions.nextjs', value: versions.nextjs, confidence: 'high' });
    }
    if (versions.tailwind) {
      detections.push({ source: 'package.json', field: 'frameworkVersions.tailwind', value: versions.tailwind, confidence: 'high' });
    }
  }

  // ── i18n detection ──
  if (allDeps['next-intl']) {
    config.i18n = { enabled: true, hookName: 'useTranslations', importPath: 'next-intl' };
    detections.push({ source: 'package.json', field: 'i18n', value: 'next-intl (useTranslations)', confidence: 'high' });
  } else if (allDeps['react-i18next']) {
    config.i18n = { enabled: true, hookName: 'useTranslation', importPath: 'react-i18next' };
    detections.push({ source: 'package.json', field: 'i18n', value: 'react-i18next (useTranslation)', confidence: 'high' });
  } else {
    config.i18n = { enabled: false };
    detections.push({ source: 'package.json', field: 'i18n', value: 'disabled (no i18n library found)', confidence: 'medium' });
  }

  // ── UI library detection ──
  if (allDeps['@shadcn/ui'] || pkg.name === 'shadcn' || existsSync(resolve(cwd, 'components.json'))) {
    config.components = { ...config.components, uiLibrary: '@/components/ui' };
    detections.push({ source: 'package.json', field: 'components.uiLibrary', value: '@/components/ui (shadcn)', confidence: 'high' });
  } else if (allDeps['@mui/material']) {
    config.components = { ...config.components, uiLibrary: '@mui/material' };
    detections.push({ source: 'package.json', field: 'components.uiLibrary', value: '@mui/material', confidence: 'high' });
  } else if (allDeps['@chakra-ui/react']) {
    config.components = { ...config.components, uiLibrary: '@chakra-ui/react' };
    detections.push({ source: 'package.json', field: 'components.uiLibrary', value: '@chakra-ui/react', confidence: 'high' });
  }

  // ── Express extras ──
  if (target === 'express') {
    const express: KernConfig['express'] = {};
    if (allDeps['helmet']) {
      express.helmet = true;
      detections.push({ source: 'package.json', field: 'express.helmet', value: 'true', confidence: 'high' });
    }
    if (allDeps['compression']) {
      express.compression = true;
      detections.push({ source: 'package.json', field: 'express.compression', value: 'true', confidence: 'high' });
    }
    if (Object.keys(express).length > 0) {
      config.express = express;
    }
  }

  // ── Type libraries (report only) ──
  const typeLibs = ['zod', 'valibot', 'prisma', '@prisma/client', 'drizzle-orm', 'yup', 'io-ts'];
  for (const lib of typeLibs) {
    if (allDeps[lib]) {
      info.typeLibraries.push(lib);
      detections.push({ source: 'package.json', field: 'info.typeLibraries', value: lib, confidence: 'medium' });
    }
  }
}

function detectTarget(allDeps: Record<string, string>): KernTarget | null {
  // Priority: most specific framework first
  if (allDeps['next']) return 'nextjs';
  if (allDeps['react-native']) return 'native';
  if (allDeps['express']) return 'express';
  if (allDeps['tailwindcss'] && !allDeps['next']) return 'tailwind';
  if (allDeps['react']) return 'web';
  return null;
}

// ── Detector: tsconfig.json ──────────────────────────────────────────────

function detectFromTsconfig(
  cwd: string,
  config: Partial<KernConfig>,
  info: ScanInfo,
  detections: Detection[],
): void {
  const tsconfigPath = resolve(cwd, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return;

  let tsconfig: Record<string, unknown>;
  try {
    tsconfig = parseJsonWithComments(readFileSync(tsconfigPath, 'utf-8'));
  } catch {
    return;
  }

  // Follow extends one level
  let baseConfig: Record<string, unknown> = {};
  const extendsPath = tsconfig.extends as string | undefined;
  if (extendsPath) {
    try {
      const resolvedExtends = resolve(cwd, extendsPath);
      if (existsSync(resolvedExtends)) {
        baseConfig = parseJsonWithComments(readFileSync(resolvedExtends, 'utf-8'));
      }
    } catch {
      // ignore
    }
  }

  // Merge compiler options (tsconfig overrides base)
  const baseOpts = (baseConfig.compilerOptions ?? {}) as Record<string, unknown>;
  const opts = { ...baseOpts, ...(tsconfig.compilerOptions ?? {}) as Record<string, unknown> };

  const strict = opts.strict === true;
  const module = (opts.module as string) ?? null;
  const paths = (opts.paths ?? {}) as Record<string, string[]>;

  info.typescript = { strict, pathAliases: paths, module };

  detections.push({ source: 'tsconfig.json', field: 'info.typescript.strict', value: String(strict), confidence: 'high' });

  if (module) {
    detections.push({ source: 'tsconfig.json', field: 'info.typescript.module', value: module, confidence: 'medium' });
  }

  // Extract path aliases → componentRoot
  const aliasKeys = Object.keys(paths);
  const atAlias = aliasKeys.find(k => k.startsWith('@/'));
  if (atAlias) {
    config.components = { ...config.components, componentRoot: '@/components' };
    detections.push({ source: 'tsconfig.json', field: 'components.componentRoot', value: '@/components (from @/* alias)', confidence: 'medium' });
  }
}

// ── Detector: .prettierrc ────────────────────────────────────────────────

function detectFromPrettierrc(
  cwd: string,
  info: ScanInfo,
  detections: Detection[],
): void {
  const candidates = ['.prettierrc', '.prettierrc.json'];
  let raw: string | null = null;
  let source = '';

  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) {
      try {
        raw = readFileSync(p, 'utf-8');
        source = name;
        break;
      } catch {
        // continue
      }
    }
  }

  if (!raw) return;

  let prettier: Record<string, unknown>;
  try {
    prettier = JSON.parse(raw);
  } catch {
    return;
  }

  const semicolons = prettier.semi !== false;
  const singleQuote = prettier.singleQuote === true;
  const tabWidth = typeof prettier.tabWidth === 'number' ? prettier.tabWidth : 2;
  const trailingComma = typeof prettier.trailingComma === 'string' ? prettier.trailingComma : 'es5';

  info.formatting = { semicolons, singleQuote, tabWidth, trailingComma };

  detections.push({ source, field: 'info.formatting', value: `semi=${semicolons} quote=${singleQuote ? 'single' : 'double'} tab=${tabWidth}`, confidence: 'medium' });
}

// ── Detector: .editorconfig ──────────────────────────────────────────────

function detectFromEditorConfig(
  cwd: string,
  info: ScanInfo,
  detections: Detection[],
): void {
  const ecPath = resolve(cwd, '.editorconfig');
  if (!existsSync(ecPath)) return;

  let raw: string;
  try {
    raw = readFileSync(ecPath, 'utf-8');
  } catch {
    return;
  }

  // Simple line-by-line parse — find [*] section
  const lines = raw.split('\n');
  let inGlobal = false;
  let indentStyle = 'space';
  let indentSize = 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inGlobal = trimmed === '[*]';
      continue;
    }
    if (!inGlobal) continue;

    const [key, rawVal] = trimmed.split('=').map(s => s.trim());
    const val = rawVal?.replace(/[#;].*$/, '').trim();
    if (key === 'indent_style' && val) indentStyle = val;
    if (key === 'indent_size' && val) indentSize = parseInt(val, 10) || 2;
  }

  info.editorConfig = { indentStyle, indentSize };
  detections.push({ source: '.editorconfig', field: 'info.editorConfig', value: `${indentStyle} (${indentSize})`, confidence: 'medium' });
}

// ── Detector: package manager (lockfile) ─────────────────────────────────

function detectPackageManager(
  cwd: string,
  info: ScanInfo,
  detections: Detection[],
): void {
  const lockfiles: Array<[string, ScanInfo['packageManager']]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ];

  for (const [file, manager] of lockfiles) {
    if (existsSync(resolve(cwd, file))) {
      info.packageManager = manager;
      detections.push({ source: file, field: 'info.packageManager', value: manager!, confidence: 'high' });
      return;
    }
  }
}

// ── Config Source Generator ──────────────────────────────────────────────

export function generateConfigSource(result: ScanResult): string {
  const { config } = result;
  const lines: string[] = [];

  lines.push("import type { KernConfig } from '@kernlang/core';");
  lines.push('');
  lines.push('const config: KernConfig = {');

  // target — always emit when detected (explicit is better than implicit default)
  if (config.target) {
    lines.push(`  target: '${config.target}',`);
  }

  // frameworkVersions
  if (config.frameworkVersions) {
    const fv = config.frameworkVersions;
    const entries: string[] = [];
    if (fv.nextjs) entries.push(`nextjs: '${fv.nextjs}'`);
    if (fv.tailwind) entries.push(`tailwind: '${fv.tailwind}'`);
    if (entries.length > 0) {
      lines.push(`  frameworkVersions: { ${entries.join(', ')} },`);
    }
  }

  // i18n
  if (config.i18n) {
    if (config.i18n.enabled === false) {
      lines.push('  i18n: { enabled: false },');
    } else if (config.i18n.hookName && config.i18n.importPath) {
      if (
        config.i18n.hookName !== DEFAULT_CONFIG.i18n.hookName ||
        config.i18n.importPath !== DEFAULT_CONFIG.i18n.importPath
      ) {
        lines.push('  i18n: {');
        lines.push('    enabled: true,');
        lines.push(`    hookName: '${config.i18n.hookName}',`);
        lines.push(`    importPath: '${config.i18n.importPath}',`);
        lines.push('  },');
      }
    }
  }

  // components
  if (config.components) {
    const comp = config.components;
    const compEntries: string[] = [];
    if (comp.uiLibrary && comp.uiLibrary !== DEFAULT_CONFIG.components.uiLibrary) {
      compEntries.push(`uiLibrary: '${comp.uiLibrary}'`);
    }
    if (comp.componentRoot && comp.componentRoot !== DEFAULT_CONFIG.components.componentRoot) {
      compEntries.push(`componentRoot: '${comp.componentRoot}'`);
    }
    if (compEntries.length > 0) {
      lines.push(`  components: { ${compEntries.join(', ')} },`);
    }
  }

  // express
  if (config.express) {
    const ex = config.express;
    const exEntries: string[] = [];
    if (ex.helmet) exEntries.push('helmet: true');
    if (ex.compression) exEntries.push('compression: true');
    if (exEntries.length > 0) {
      lines.push(`  express: { ${exEntries.join(', ')} },`);
    }
  }

  lines.push('};');
  lines.push('');
  lines.push('export default config;');
  lines.push('');

  return lines.join('\n');
}

// ── Summary Formatter ────────────────────────────────────────────────────

const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

const INFO_FIELDS = new Set([
  'info.typescript.strict',
  'info.typescript.module',
  'info.formatting',
  'info.editorConfig',
  'info.typeLibraries',
  'info.packageManager',
]);

export function formatScanSummary(result: ScanResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${ANSI_BOLD}KERN scan${ANSI_RESET} — project analysis`);
  lines.push('');

  // Group detections by source
  const bySource = new Map<string, Detection[]>();
  for (const d of result.detections) {
    const existing = bySource.get(d.source) ?? [];
    existing.push(d);
    bySource.set(d.source, existing);
  }

  for (const [source, dets] of bySource) {
    lines.push(`  ${ANSI_DIM}${source}${ANSI_RESET}`);
    for (const d of dets) {
      const isInfo = INFO_FIELDS.has(d.field);
      const marker = isInfo ? `${ANSI_YELLOW}-${ANSI_RESET}` : `${ANSI_GREEN}✓${ANSI_RESET}`;
      lines.push(`    ${marker} ${d.field}: ${d.value}`);
    }
    lines.push('');
  }

  if (result.detections.length === 0) {
    lines.push('  No project configuration detected.');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseJsonWithComments(raw: string): Record<string, unknown> {
  // Strip comments while preserving string contents.
  // Matches strings first (to skip them), then comments to remove.
  const stripped = raw
    .replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => {
      // Keep strings as-is, remove comments
      return match.startsWith('"') ? match : '';
    })
    // Remove trailing commas before } or ]
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}
