import { type IRNode, isExplicitForeignRawBody, parseDocumentWithDiagnostics } from '@kernlang/core';
import { classifyHandlerBody, nativeEligibilityClassifier, typescriptClosureClassifier } from '@kernlang/core/node';
import { existsSync, readFileSync, statSync } from 'fs';
import { relative, resolve } from 'path';
import { findKernFiles, hasFlag } from '../shared.js';

// Slice 0.9 — Node-side: inject the TypeScript-backed classifiers so block-bodied
// arrows in expression props keep parsing (instead of fail-closing).
const NODE_PARSE_CAPS = {
  closureClassifier: typescriptClosureClassifier,
  nativeEligibilityClassifier,
} as const;

const SKIP_DIRS = new Set(['build', '.kern-gaps', 'coverage', '.next', '.turbo', '.vercel', 'generated']);
const EXCLUDED_REASONS = new Set(['foreign-by-design']);

interface HandlerCoverage {
  file: string;
  line: number;
  status:
    | 'native'
    | 'migratable'
    | 'explicit-foreign'
    | 'heuristic-foreign'
    | 'template-placeholder'
    | 'blocked'
    | 'empty';
  reason: string;
}

interface SelfCoverageReport {
  root: string;
  scannedFiles: number;
  filesWithParseErrors: number;
  parseErrors: Array<{ file: string; line: number; message: string }>;
  totalHandlers: number;
  nativeHandlers: number;
  rawHandlers: number;
  emptyRawHandlers: number;
  migratableRawHandlers: number;
  explicitForeignHandlers: number;
  heuristicForeignHandlers: number;
  templatePlaceholderHandlers: number;
  blockedHandlers: number;
  nativeAuthoredPct: number | null;
  classifiedOrMigratablePct: number | null;
  blockers: Array<{ reason: string; count: number; pctOfBlocked: number }>;
  handlers: HandlerCoverage[];
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function listKernFiles(root: string): string[] {
  return findKernFiles(root)
    .filter(
      (file) =>
        !relative(root, file)
          .split(/[\\/]/)
          .some((part) => SKIP_DIRS.has(part)),
    )
    .sort((a, b) => a.localeCompare(b));
}

function collectNodes(node: IRNode, type: string, out: IRNode[] = []): IRNode[] {
  if (node.type === type) out.push(node);
  for (const child of node.children ?? []) collectNodes(child, type, out);
  return out;
}

function countByReason(handlers: HandlerCoverage[]): Array<{ reason: string; count: number; pctOfBlocked: number }> {
  const counts = new Map<string, number>();
  const total = handlers.filter((h) => h.status === 'blocked').length;
  for (const handler of handlers) {
    if (handler.status !== 'blocked') continue;
    counts.set(handler.reason, (counts.get(handler.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count, pctOfBlocked: pct(count, total) ?? 0 }));
}

function printSelfCoverageHelp(): void {
  process.stdout.write(
    [
      'Usage: kern self-coverage [dir] [--root=<dir>] [--canonicalize-braces] [--json] [--verbose]',
      '',
      'Measures how much handler logic is already native KERN, migratable to native KERN,',
      'or intentionally foreign/template code.',
      '',
      '  --canonicalize-braces  also count non-block control-flow bodies (`if (c) stmt;`)',
      '                         as migratable — mirrors the opt-in `kern migrate',
      '                         native-handlers --canonicalize-braces` lift.',
      '',
    ].join('\n'),
  );
}

function parseRootArg(rest: string[]): string | undefined {
  const eq = rest.find((arg) => arg.startsWith('--root='));
  if (eq) {
    const value = eq.slice('--root='.length);
    if (!value) throw new Error('self-coverage --root requires a directory path');
    return value;
  }

  const idx = rest.indexOf('--root');
  if (idx === -1) return undefined;
  const value = rest[idx + 1];
  if (!value || value.startsWith('-')) throw new Error('self-coverage --root requires a directory path');
  return value;
}

export function collectSelfCoverage(rootDir: string, opts?: { canonicalizeBraces?: boolean }): SelfCoverageReport {
  const files = listKernFiles(rootDir);
  const handlers: HandlerCoverage[] = [];
  const parseErrors: SelfCoverageReport['parseErrors'] = [];
  const filesWithParseErrors = new Set<string>();

  for (const file of files) {
    const rel = relative(rootDir, file) || file;
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== 'error') continue;
      filesWithParseErrors.add(rel);
      parseErrors.push({ file: rel, line: diagnostic.line, message: diagnostic.message });
    }

    for (const handler of collectNodes(root, 'handler')) {
      const props = handler.props ?? {};
      const line = handler.loc?.line ?? 1;
      const rawLang = typeof props.lang === 'string' ? props.lang.trim() : undefined;
      const declaredLang = rawLang ? rawLang.toLowerCase() : undefined;
      const declaredReason = typeof props.reason === 'string' ? props.reason : undefined;
      if (declaredLang === 'kern') {
        if ((handler.children?.length ?? 0) > 0) {
          handlers.push({ file: rel, line, status: 'native', reason: 'lang-kern' });
        } else if (typeof props.code === 'string' && props.code.trim().length > 0) {
          handlers.push({ file: rel, line, status: 'blocked', reason: 'lang-kern-raw-body' });
        } else {
          handlers.push({ file: rel, line, status: 'empty', reason: 'no-code' });
        }
        continue;
      }

      const code = props.code;
      if (typeof code !== 'string') {
        handlers.push({ file: rel, line, status: 'empty', reason: 'no-code' });
        continue;
      }
      if (code.trim().length === 0) {
        handlers.push({ file: rel, line, status: 'empty', reason: 'empty' });
        continue;
      }

      if (
        isExplicitForeignRawBody({
          opener: 'handler',
          declaredLang,
          declaredReason,
        })
      ) {
        handlers.push({ file: rel, line, status: 'explicit-foreign', reason: 'explicit-foreign' });
        continue;
      }
      if (declaredLang) {
        handlers.push({
          file: rel,
          line,
          status: 'blocked',
          reason: declaredReason ? 'foreign-unsupported-lang' : 'foreign-missing-reason',
        });
        continue;
      }

      const result = classifyHandlerBody(code, { allowNonBlock: opts?.canonicalizeBraces });
      if (result.eligible) {
        handlers.push({ file: rel, line, status: 'migratable', reason: result.reason });
      } else if (result.reason === 'template-placeholder') {
        handlers.push({ file: rel, line, status: 'template-placeholder', reason: result.reason });
      } else if (EXCLUDED_REASONS.has(result.reason)) {
        handlers.push({ file: rel, line, status: 'heuristic-foreign', reason: result.reason });
      } else {
        handlers.push({ file: rel, line, status: 'blocked', reason: result.reason });
      }
    }
  }

  const totalHandlers = handlers.filter((h) => h.status !== 'empty').length;
  const nativeHandlers = handlers.filter((h) => h.status === 'native').length;
  const rawHandlers = handlers.filter(
    (h) =>
      h.status === 'migratable' ||
      h.status === 'explicit-foreign' ||
      h.status === 'heuristic-foreign' ||
      h.status === 'template-placeholder' ||
      h.status === 'blocked',
  ).length;
  const migratableRawHandlers = handlers.filter((h) => h.status === 'migratable').length;
  const explicitForeignHandlers = handlers.filter((h) => h.status === 'explicit-foreign').length;
  const heuristicForeignHandlers = handlers.filter((h) => h.status === 'heuristic-foreign').length;
  const templatePlaceholderHandlers = handlers.filter((h) => h.status === 'template-placeholder').length;
  const blockedHandlers = handlers.filter((h) => h.status === 'blocked').length;
  const emptyRawHandlers = handlers.filter((h) => h.status === 'empty').length;
  const classifiedOrMigratable =
    nativeHandlers +
    migratableRawHandlers +
    explicitForeignHandlers +
    heuristicForeignHandlers +
    templatePlaceholderHandlers;

  return {
    root: rootDir,
    scannedFiles: files.length,
    filesWithParseErrors: filesWithParseErrors.size,
    parseErrors,
    totalHandlers,
    nativeHandlers,
    rawHandlers,
    emptyRawHandlers,
    migratableRawHandlers,
    explicitForeignHandlers,
    heuristicForeignHandlers,
    templatePlaceholderHandlers,
    blockedHandlers,
    nativeAuthoredPct: pct(nativeHandlers, totalHandlers),
    classifiedOrMigratablePct: pct(classifiedOrMigratable, totalHandlers),
    blockers: countByReason(handlers),
    handlers,
  };
}

function printHumanReport(report: SelfCoverageReport, rootDir: string, verbose: boolean): void {
  process.stdout.write(
    `kern self-coverage — scanned ${report.scannedFiles} .kern files in ${relative(process.cwd(), rootDir) || '.'}\n`,
  );
  process.stdout.write(`Handlers: ${report.totalHandlers} non-empty (${report.emptyRawHandlers} empty raw skipped)\n`);
  process.stdout.write(`Native KERN authored: ${report.nativeHandlers} (${report.nativeAuthoredPct ?? 'N/A'}%)\n`);
  process.stdout.write(`Migratable raw handlers: ${report.migratableRawHandlers}\n`);
  process.stdout.write(`Explicit foreign handlers: ${report.explicitForeignHandlers}\n`);
  process.stdout.write(`Heuristic foreign handlers: ${report.heuristicForeignHandlers}\n`);
  process.stdout.write(`Template placeholders: ${report.templatePlaceholderHandlers}\n`);
  process.stdout.write(`Blocked handlers: ${report.blockedHandlers}\n`);
  process.stdout.write(`Classified or migratable: ${report.classifiedOrMigratablePct ?? 'N/A'}%\n`);

  if (report.filesWithParseErrors > 0) {
    process.stdout.write(`\nParse errors: ${report.parseErrors.length} in ${report.filesWithParseErrors} file(s)\n`);
  }

  if (report.blockers.length > 0) {
    process.stdout.write('\nTop blockers:\n');
    for (const blocker of report.blockers.slice(0, 10)) {
      process.stdout.write(`  ${blocker.reason}: ${blocker.count} (${blocker.pctOfBlocked.toFixed(1)}% of blocked)\n`);
    }
  }

  if (verbose) {
    process.stdout.write('\nHandler detail:\n');
    for (const handler of report.handlers) {
      process.stdout.write(`  ${handler.status.padEnd(20)} ${handler.file}:${handler.line} ${handler.reason}\n`);
    }
  }
}

export async function runSelfCoverage(args: string[]): Promise<void> {
  if (hasFlag(args, '--help', '-h')) {
    printSelfCoverageHelp();
    return;
  }
  const rest = args[0] === 'self-coverage' ? args.slice(1) : args;
  const positional = rest.filter((arg) => !arg.startsWith('-'));
  const rootArg = parseRootArg(rest) ?? positional[0] ?? process.cwd();
  const rootDir = resolve(rootArg);
  if (!existsSync(rootDir)) {
    throw new Error(`self-coverage root does not exist: ${rootArg}`);
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`self-coverage root must be a directory: ${rootArg}`);
  }

  const report = collectSelfCoverage(rootDir, { canonicalizeBraces: hasFlag(args, '--canonicalize-braces') });
  if (hasFlag(args, '--json')) {
    process.stdout.write(
      `${JSON.stringify({ ...report, root: relative(process.cwd(), report.root) || '.' }, null, 2)}\n`,
    );
    return;
  }
  printHumanReport(report, rootDir, hasFlag(args, '--verbose', '-v'));
}
