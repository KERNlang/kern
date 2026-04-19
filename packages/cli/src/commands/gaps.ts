import { type GapCategory, readCoverageGaps } from '@kernlang/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { type RemoteRepoContext, withOptionalRemoteRepo } from '../remote-repo.js';
import { hasFlag, parseFlagOrNext } from '../shared.js';

interface SourceGap {
  file: string;
  line: number;
  message: string;
}

/** Display order — most actionable first. Keeps the report scanable. */
const CATEGORY_ORDER: GapCategory[] = [
  'migratable',
  'blocked-by-parser',
  'blocked-by-codegen',
  'needs-new-node',
  'detected',
];

const CATEGORY_HINTS: Record<GapCategory, string> = {
  migratable: 'run `kern migrate <name>` to auto-rewrite',
  'blocked-by-parser': 'parser cannot read this yet — file a parser issue',
  'blocked-by-codegen': 'parses but no codegen path — file a codegen issue',
  'needs-new-node': 'no IR node models this — proposal needed',
  detected: 'feature observed; no migration or schema change available yet',
};

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

    // Group by category; missing category (older .kern-gaps JSONs) counts as `detected`.
    const byCategory = new Map<GapCategory, typeof report.coverageGaps>();
    for (const gap of report.coverageGaps) {
      const category = gap.category ?? 'detected';
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(gap);
    }

    for (const category of CATEGORY_ORDER) {
      const gaps = byCategory.get(category);
      if (!gaps || gaps.length === 0) continue;

      const migrationNames = new Set<string>();
      for (const g of gaps) if (g.migration) migrationNames.add(g.migration);
      const hint = CATEGORY_HINTS[category];
      const migrationSuffix =
        category === 'migratable' && migrationNames.size > 0
          ? ` — ${[...migrationNames]
              .sort()
              .map((m) => `kern migrate ${m}`)
              .join(', ')}`
          : '';
      process.stdout.write(`  ${category} (${gaps.length}): ${hint}${migrationSuffix}\n`);
    }

    if (!verbose) {
      process.stdout.write('\n  (run with --verbose for per-file detail)\n');
    } else {
      process.stdout.write('\n  Detail:\n');
      for (const category of CATEGORY_ORDER) {
        const gaps = byCategory.get(category);
        if (!gaps || gaps.length === 0) continue;
        for (const gap of gaps) {
          const rel = relative(rootDir, gap.file) || gap.file;
          const migration = gap.migration ? ` migration=${gap.migration}` : '';
          const parent = gap.parentType ? ` parent=${gap.parentType}` : '';
          process.stdout.write(
            `    [${category}] ${rel}:${gap.line}  handler ${gap.handlerLength}ch${parent}${migration}  @ ${gap.timestamp}\n`,
          );
        }
      }
    }
  }

  process.stdout.write(`\nTotal: ${total} gaps across ${report.scannedFiles} scanned files.\n`);
}

async function runGapsLocal(args: string[], remoteContext?: RemoteRepoContext): Promise<void> {
  const rootDir = resolve(parseFlagOrNext(args, '--root') ?? remoteContext?.rootDir ?? process.cwd());
  const gapDir = resolve(parseFlagOrNext(args, '--gap-dir') ?? join(rootDir, '.kern-gaps'));
  const json = hasFlag(args, '--json');
  const verbose = hasFlag(args, '--verbose', '-v');

  const report = collectGapsReport(rootDir, gapDir);

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanReport(report, rootDir, verbose);
}

export async function runGaps(args: string[]): Promise<void> {
  await withOptionalRemoteRepo(args, { commandName: 'gaps' }, async (remoteContext) => {
    await runGapsLocal(args, remoteContext);
  });
}
