import type { CallCheckDiagnostic, CheckDiagnostic, ReturnCheckDiagnostic } from '@kernlang/check';
import { checkCalls, checkProgram, checkReturns } from '@kernlang/check';
import { parseDocumentWithDiagnostics, validateSemantics } from '@kernlang/core';
import { nativeEligibilityClassifier, typescriptClosureClassifier } from '@kernlang/core/node';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { findKernFiles, hasFlag } from '../shared.js';

// Slice 0.9 — Node-side: inject the TypeScript-backed classifiers so block-bodied
// arrows in expression props keep parsing (instead of fail-closing).
const NODE_PARSE_CAPS = {
  closureClassifier: typescriptClosureClassifier,
  nativeEligibilityClassifier,
} as const;

// Mirror the discovery filter used by `commands/self-coverage.ts`.
const SKIP_DIRS = new Set(['build', '.kern-gaps', 'coverage', '.next', '.turbo', '.vercel', 'generated']);

export type CheckSeverity = 'error' | 'warning';
export type CheckCategory = 'declaration' | 'call' | 'return' | 'parse' | 'semantic';

/** A single CLI-level diagnostic, normalized across every library checker. */
export interface CheckDiagnosticOut {
  /** Path relative to the resolved scan root. */
  file: string;
  /** 1-based line, or null when the library diagnostic carries no location. */
  line: number | null;
  /** 1-based column, or null when unavailable. */
  column: number | null;
  severity: CheckSeverity;
  category: CheckCategory;
  /** Library rule id, verbatim. */
  rule: string;
  /** Human-readable reason, verbatim from the library diagnostic. */
  message: string;
}

export interface CheckSummary {
  filesScanned: number;
  filesWithParseErrors: number;
  diagnosticCount: number;
  errorCount: number;
  warningCount: number;
  returnChecksRun: number;
  durationMs: number;
}

export interface CheckReport {
  schemaVersion: '1.0';
  tool: 'kern-check';
  checkerVersion: string;
  root: string;
  diagnostics: CheckDiagnosticOut[];
  summary: CheckSummary;
}

export interface RunCheckOptions {
  withSemantics: boolean;
}

/**
 * Pure exit-code decision. Unit-testable without IO.
 *
 * - ≥1 error-severity diagnostic → 1
 * - ≥1 warning-severity diagnostic AND `strict` → 1
 * - otherwise → 0
 */
export function exitCodeFor(summary: CheckSummary, strict: boolean): 0 | 1 {
  if (summary.errorCount > 0) return 1;
  if (strict && summary.warningCount > 0) return 1;
  return 0;
}

/**
 * Read the version of `@kernlang/check` from its installed package.json by
 * ascending from this module's directory to the nearest
 * `node_modules/@kernlang/check/package.json`. The package's `exports` map does
 * not expose `./package.json`, so we read the file directly rather than via
 * module resolution. Falls back to `'unknown'` if it cannot be located.
 */
export function readCheckerVersion(): string {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }
  while (true) {
    const candidate = join(dir, 'node_modules', '@kernlang', 'check', 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string };
        if (typeof pkg.version === 'string') return pkg.version;
      } catch {
        // fall through to keep ascending
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
}

function listKernFiles(root: string): string[] {
  return (
    findKernFiles(root)
      .filter(
        (file) =>
          !relative(root, file)
            .split(/[\\/]/)
            .some((part) => SKIP_DIRS.has(part)),
      )
      // `findKernFiles` matches any entry whose name ends in `.kern`, including
      // DIRECTORIES named `*.kern` (the repo has a `.kern/` config dir). Those are
      // not source files — drop them so the per-file read never hits EISDIR.
      .filter((file) => statSync(file).isFile())
      .sort((a, b) => a.localeCompare(b))
  );
}

function mapDeclaration(rel: string, diagnostic: CheckDiagnostic): CheckDiagnosticOut {
  return {
    file: rel,
    line: null,
    column: null,
    severity: 'error',
    category: 'declaration',
    rule: diagnostic.rule,
    message: diagnostic.reason,
  };
}

function mapCall(rel: string, diagnostic: CallCheckDiagnostic): CheckDiagnosticOut {
  return {
    file: rel,
    line: null,
    column: null,
    severity: 'error',
    category: 'call',
    rule: diagnostic.rule,
    message: diagnostic.reason,
  };
}

function mapReturn(rel: string, diagnostic: ReturnCheckDiagnostic): CheckDiagnosticOut {
  return {
    file: rel,
    line: null,
    column: null,
    severity: 'error',
    category: 'return',
    rule: diagnostic.rule,
    message: diagnostic.reason,
  };
}

/** Stable ordering: file, then category, then rule, then message. */
function sortDiagnostics(diagnostics: CheckDiagnosticOut[]): CheckDiagnosticOut[] {
  return [...diagnostics].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.category.localeCompare(b.category) ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message),
  );
}

/**
 * Run the type-checker (and, optionally, semantic validation) over a file or
 * directory and produce the stable {@link CheckReport}. Pure with respect to
 * process state apart from reading the filesystem.
 */
export function collectCheck(target: string, opts: RunCheckOptions): CheckReport {
  const start = Date.now();
  const resolved = resolve(target);
  const isDirectory = statSync(resolved).isDirectory();
  const scanRoot = isDirectory ? resolved : dirname(resolved);
  const files = isDirectory ? listKernFiles(resolved) : [resolved];

  const diagnostics: CheckDiagnosticOut[] = [];
  const filesWithParseErrors = new Set<string>();
  let returnChecksRun = 0;

  for (const file of files) {
    const rel = relative(scanRoot, file) || file;
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch (err) {
      // Unreadable file is an operational failure — surface it to the caller.
      throw new Error(`kern check: cannot read file '${file}': ${(err as Error).message}`);
    }

    const { root, diagnostics: parseDiagnostics } = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);

    let fileHasParseError = false;
    for (const diagnostic of parseDiagnostics) {
      if (diagnostic.severity !== 'error') continue;
      fileHasParseError = true;
      diagnostics.push({
        file: rel,
        line: diagnostic.line,
        column: diagnostic.col,
        severity: 'error',
        category: 'parse',
        rule: 'parse-error',
        message: diagnostic.message,
      });
    }

    // Report-and-continue: a file with parse errors is excluded from
    // type-checking but every other file still runs.
    if (fileHasParseError) {
      filesWithParseErrors.add(rel);
      continue;
    }

    for (const diagnostic of checkProgram(root)) diagnostics.push(mapDeclaration(rel, diagnostic));
    for (const diagnostic of checkCalls(root)) diagnostics.push(mapCall(rel, diagnostic));
    const returnResult = checkReturns(root);
    returnChecksRun += returnResult.returnChecksRun;
    for (const diagnostic of returnResult.diagnostics) diagnostics.push(mapReturn(rel, diagnostic));

    if (opts.withSemantics) {
      for (const violation of validateSemantics(root)) {
        diagnostics.push({
          file: rel,
          line: violation.line ?? null,
          column: violation.col ?? null,
          // The semantic validator emits no severity field; every violation it
          // reports is a hard rule violation, so it maps to `error`.
          severity: 'error',
          category: 'semantic',
          rule: violation.rule,
          message: violation.message,
        });
      }
    }
  }

  const sorted = sortDiagnostics(diagnostics);
  const errorCount = sorted.filter((d) => d.severity === 'error').length;
  const warningCount = sorted.filter((d) => d.severity === 'warning').length;

  return {
    schemaVersion: '1.0',
    tool: 'kern-check',
    checkerVersion: readCheckerVersion(),
    root: scanRoot,
    diagnostics: sorted,
    summary: {
      filesScanned: files.length,
      filesWithParseErrors: filesWithParseErrors.size,
      diagnosticCount: sorted.length,
      errorCount,
      warningCount,
      returnChecksRun,
      durationMs: Date.now() - start,
    },
  };
}

function printHumanReport(report: CheckReport, quiet: boolean): void {
  const { diagnostics, summary } = report;

  if (!quiet && diagnostics.length > 0) {
    const byFile = new Map<string, CheckDiagnosticOut[]>();
    for (const diagnostic of diagnostics) {
      const bucket = byFile.get(diagnostic.file);
      if (bucket) bucket.push(diagnostic);
      else byFile.set(diagnostic.file, [diagnostic]);
    }

    const ruleWidth = Math.max(...diagnostics.map((d) => d.rule.length));
    for (const [file, fileDiagnostics] of byFile) {
      process.stdout.write(`${file}\n`);
      for (const diagnostic of fileDiagnostics) {
        const locator =
          diagnostic.line !== null ? `${diagnostic.category}, line ${diagnostic.line}` : diagnostic.category;
        process.stdout.write(
          `  ${diagnostic.severity.padEnd(7)}${diagnostic.rule.padEnd(ruleWidth + 2)}${diagnostic.message}  (${locator})\n`,
        );
      }
      process.stdout.write('\n');
    }
  }

  if (diagnostics.length === 0) {
    process.stdout.write(
      `✓ ${summary.filesScanned} files checked, no issues (returnChecksRun: ${summary.returnChecksRun})\n`,
    );
    return;
  }

  const errorWord = summary.errorCount === 1 ? 'error' : 'errors';
  const fileCount = new Set(diagnostics.map((d) => d.file)).size;
  const fileWord = fileCount === 1 ? 'file' : 'files';
  process.stdout.write(
    `✗ ${summary.errorCount} ${errorWord} in ${fileCount} ${fileWord} ` +
      `(${summary.filesScanned} files scanned, ${summary.warningCount} warnings)\n`,
  );
}

function printCheckHelp(): void {
  process.stdout.write(
    [
      'Usage: kern check [path] [--json] [--quiet] [--strict] [--with-semantics]',
      '',
      'Run the KERN nominal type-checker over a file or directory (defaults to cwd).',
      '',
      '  --json             machine-readable output on stdout (schemaVersion 1.0)',
      '  --quiet            human mode: print only the summary line (ignored under --json)',
      '  --strict           warnings also cause a non-zero exit',
      '  --with-semantics   also run semantic validation (category: "semantic")',
      '',
    ].join('\n'),
  );
}

/**
 * Operational failure: exit 2 directly (distinct from diagnostic-driven exit 1
 * routed through the cli.ts catch handler).
 */
function operationalFailure(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export async function runCheck(args: string[]): Promise<void> {
  if (hasFlag(args, '--help', '-h')) {
    printCheckHelp();
    return;
  }

  const rest = args[0] === 'check' ? args.slice(1) : args;

  const known = new Set(['--json', '--quiet', '--strict', '--with-semantics']);
  const positionals: string[] = [];
  for (const arg of rest) {
    if (arg.startsWith('-')) {
      if (!known.has(arg)) operationalFailure(`kern check: unknown flag '${arg}'`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    operationalFailure(`kern check: expected at most one path, got ${positionals.length}`);
  }

  const json = hasFlag(rest, '--json');
  const quiet = hasFlag(rest, '--quiet');
  const strict = hasFlag(rest, '--strict');
  const withSemantics = hasFlag(rest, '--with-semantics');

  const targetArg = positionals[0] ?? process.cwd();
  const resolved = resolve(targetArg);
  if (!existsSync(resolved)) {
    operationalFailure(`kern check: path does not exist: ${targetArg}`);
  }

  let report: CheckReport;
  try {
    report = collectCheck(resolved, { withSemantics });
  } catch (err) {
    operationalFailure((err as Error).message);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanReport(report, quiet);
  }

  const code = exitCodeFor(report.summary, strict);
  if (code !== 0) process.exit(code);
}
