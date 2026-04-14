import { readCoverageGaps } from '@kernlang/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { hasFlag, parseFlag } from '../shared.js';

interface SourceGap {
  file: string;
  line: number;
  message: string;
}

interface GapsReport {
  scannedFiles: number;
  sourceGaps: SourceGap[];
  coverageGaps: ReturnType<typeof readCoverageGaps>;
}

const SCAN_EXTENSIONS = new Set(['.kern', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.kern-gaps',
  'coverage',
  '.next',
  '.turbo',
  '.vercel',
  'generated',
]);
const KERN_GAP_PATTERN = /\/\/\s*KERN-GAP:\s*(.+?)\s*$/;

function walkSources(root: string, files: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkSources(full, files);
    } else if (stat.isFile() && SCAN_EXTENSIONS.has(extname(entry))) {
      files.push(full);
    }
  }
}

function scanFileForGaps(file: string): SourceGap[] {
  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out: SourceGap[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(KERN_GAP_PATTERN);
    if (match) {
      out.push({ file, line: i + 1, message: match[1] });
    }
  }
  return out;
}

function collectGapsReport(rootDir: string, gapDir: string): GapsReport {
  const files: string[] = [];
  walkSources(rootDir, files);
  const sourceGaps: SourceGap[] = [];
  for (const file of files) {
    sourceGaps.push(...scanFileForGaps(file));
  }
  const coverageGaps = existsSync(gapDir) ? readCoverageGaps(gapDir) : [];
  return { scannedFiles: files.length, sourceGaps, coverageGaps };
}

function printHumanReport(report: GapsReport, rootDir: string, verbose: boolean): void {
  const total = report.sourceGaps.length + report.coverageGaps.length;
  process.stdout.write(
    `kern gaps — scanned ${report.scannedFiles} files in ${relative(process.cwd(), rootDir) || '.'}\n`,
  );

  if (total === 0) {
    process.stdout.write('No gaps found.\n');
    return;
  }

  if (report.sourceGaps.length > 0) {
    process.stdout.write(`\nKERN-GAP comments (${report.sourceGaps.length}):\n`);
    const grouped = new Map<string, SourceGap[]>();
    for (const gap of report.sourceGaps) {
      const rel = relative(rootDir, gap.file) || gap.file;
      if (!grouped.has(rel)) grouped.set(rel, []);
      grouped.get(rel)?.push(gap);
    }
    const sorted = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [file, gaps] of sorted) {
      process.stdout.write(`  ${file}\n`);
      for (const gap of gaps) {
        process.stdout.write(`    ${gap.line}: ${gap.message}\n`);
      }
    }
  }

  if (report.coverageGaps.length > 0) {
    process.stdout.write(`\nCompiler coverage gaps (${report.coverageGaps.length}):\n`);
    const byNodeType = new Map<string, number>();
    for (const gap of report.coverageGaps) {
      byNodeType.set(gap.nodeType, (byNodeType.get(gap.nodeType) ?? 0) + 1);
    }
    for (const [nodeType, count] of [...byNodeType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      process.stdout.write(`  ${nodeType}: ${count}\n`);
    }
    if (!verbose) {
      process.stdout.write('\n  (run with --verbose for per-file detail)\n');
    } else {
      process.stdout.write('\n  Detail:\n');
      for (const gap of report.coverageGaps) {
        const rel = relative(rootDir, gap.file) || gap.file;
        process.stdout.write(
          `    ${rel}:${gap.line}  [${gap.nodeType}] handler ${gap.handlerLength}ch  @ ${gap.timestamp}\n`,
        );
      }
    }
  }

  process.stdout.write(`\nTotal: ${total} gaps across ${report.scannedFiles} scanned files.\n`);
}

export function runGaps(args: string[]): void {
  const rootDir = resolve(parseFlag(args, '--root') ?? process.cwd());
  const gapDir = resolve(parseFlag(args, '--gap-dir') ?? join(rootDir, '.kern-gaps'));
  const json = hasFlag(args, '--json');
  const verbose = hasFlag(args, '--verbose', '-v');

  const report = collectGapsReport(rootDir, gapDir);

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanReport(report, rootDir, verbose);
}
