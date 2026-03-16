import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, relative, join } from 'path';
import { parse, resolveConfig } from '@kern/core';
import type { ResolvedKernConfig, KernTarget } from '@kern/core';
import { collectLanguageMetrics, mergeMetrics, type LanguageMetrics } from './metrics.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  cwd: string;
  target: KernTarget;
  kernFiles: string[];
  colorPalette: Record<string, string>;
  metrics: LanguageMetrics | null;
}

// ── File discovery ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'out']);

function findKernFiles(cwd: string, maxDepth = 5): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.endsWith('.kern')) {
        results.push(relative(cwd, full));
      }
    }
  }

  walk(cwd, 0);
  return results.sort();
}

// ── Project scanning ─────────────────────────────────────────────────────

export function scanKernProject(cwd: string, config?: ResolvedKernConfig): ProjectSummary {
  const resolved = config ?? resolveConfig();
  const kernFiles = findKernFiles(cwd);

  if (kernFiles.length === 0) {
    return {
      cwd,
      target: resolved.target,
      kernFiles: [],
      colorPalette: resolved.colors,
      metrics: null,
    };
  }

  const fileMetrics: LanguageMetrics[] = [];
  for (const file of kernFiles) {
    try {
      const source = readFileSync(resolve(cwd, file), 'utf-8');
      const ast = parse(source);
      fileMetrics.push(collectLanguageMetrics(ast));
    } catch {
      // Skip unparseable files
    }
  }

  return {
    cwd,
    target: resolved.target,
    kernFiles,
    colorPalette: resolved.colors,
    metrics: fileMetrics.length > 0 ? mergeMetrics(fileMetrics) : null,
  };
}

// ── Kern-format context export (for Agon integration) ────────────────────

export function projectToKern(summary: ProjectSummary): string {
  const lines: string[] = [];
  const name = summary.cwd.split('/').pop() || 'project';

  lines.push(`kern-project ${name} {`);
  lines.push(`  target: "${summary.target}"`);
  lines.push(`  files: ${summary.kernFiles.length}`);

  for (const file of summary.kernFiles) {
    lines.push(`  - ${file}`);
  }

  if (summary.metrics) {
    const m = summary.metrics;
    lines.push('');
    lines.push('  metrics {');
    lines.push(`    nodes: ${m.nodeCount}`);
    lines.push(`    escapeRatio: ${m.styleMetrics.escapeRatio.toFixed(2)}`);
    if (m.styleMetrics.escapedKeys.length > 0) {
      lines.push(`    escapedKeys: ${m.styleMetrics.escapedKeys.join(', ')}`);
    }
    lines.push(`    themeRefs: ${m.themeRefCount}`);
    lines.push(`    pseudoStyles: ${m.pseudoStyleCount}`);
    lines.push(`    shorthandCoverage: ${Math.round(m.shorthandCoverage * 100)}%`);
    if (m.tokenEfficiency) {
      lines.push(`    tokenReduction: ${m.tokenEfficiency.tokenReduction}%`);
    }
    lines.push('  }');

    if (m.nodeTypes.length > 0) {
      lines.push('');
      lines.push('  nodeTypes {');
      for (const nt of m.nodeTypes.slice(0, 15)) {
        lines.push(`    ${nt.type}: ${nt.count}`);
      }
      lines.push('  }');
    }
  }

  const colorEntries = Object.entries(summary.colorPalette);
  if (colorEntries.length > 0) {
    lines.push('');
    lines.push('  colors {');
    for (const [hex, name] of colorEntries.slice(0, 20)) {
      lines.push(`    ${hex}: ${name}`);
    }
    lines.push('  }');
  }

  lines.push('}');
  return lines.join('\n');
}
