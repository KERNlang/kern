/**
 * `kern apply <files...>` — compiler-assisted refactoring via @kernlang/codemod.
 *
 * Default: dry-run with unified diff output.
 * --write: commit edits to disk (only files whose safety gates pass).
 * --min-confidence N: minimum confidence percentage (default 80).
 * --template NAME: only apply matches for one template.
 * --audit PATH: override default .kern/codemod-audit.jsonl path.
 *
 * The command is intentionally thin — it resolves file globs/paths, delegates
 * to applyFiles, and formats the result for humans. Interactive prompting is
 * explicitly deferred to a follow-up PR.
 */

import { type ApplyDecision, type ApplyResult, applyFiles } from '@kernlang/codemod';
import { existsSync, readdirSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';
import { hasFlag, parseFlagOrNext } from '../shared.js';

const APPLY_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '.turbo',
  '.vercel',
  'generated',
]);

function walk(root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const full = join(root, e);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && APPLY_EXTS.has(extname(e))) out.push(full);
  }
}

/** Flags that take a value as the next arg (unless passed --flag=value). */
const VALUE_FLAGS = new Set(['--min-confidence', '--template', '--audit']);
type DecisionCounts = Record<ApplyDecision, number>;

interface ApplyCommandOptions {
  cwd: string;
  write: boolean;
  minConfidence: number | undefined;
  templateName: string | undefined;
  auditPath: string | undefined;
  files: string[];
}

function resolveInputs(cwd: string, args: string[]): string[] {
  // Strip leading 'apply' subcommand, then walk args skipping flags + their values.
  const rest = args[0] === 'apply' ? args.slice(1) : args;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('-')) {
      // --flag=value is self-contained; --flag value consumes the next arg.
      if (!a.includes('=') && VALUE_FLAGS.has(a)) i++;
      continue;
    }
    positional.push(a);
  }
  if (positional.length === 0) return [];

  const resolved: string[] = [];
  for (const p of positional) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      console.error(`Warning: path does not exist: ${p}`);
      continue;
    }
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, resolved);
    else if (APPLY_EXTS.has(extname(abs))) resolved.push(abs);
  }
  return resolved;
}

function printResult(r: ApplyResult): void {
  const tag =
    r.decision === 'applied'
      ? '✔ applied '
      : r.decision === 'dry-run'
        ? '→ dry-run '
        : r.decision === 'rejected'
          ? '✖ rejected'
          : '· skipped ';
  const head = `${tag} ${r.filePath} [${r.templateName} @ ${r.confidencePct}%]`;
  console.log(head);
  if (r.reason) console.log(`    reason: ${r.reason}`);
  if (r.newDiagnostics && r.newDiagnostics.length > 0) {
    for (const d of r.newDiagnostics.slice(0, 5)) console.log(`    tsc: ${d}`);
    if (r.newDiagnostics.length > 5) console.log(`    …+${r.newDiagnostics.length - 5} more`);
  }
  if (r.diff && (r.decision === 'dry-run' || r.decision === 'rejected')) {
    console.log(r.diff);
  }
}

function parseMinConfidence(args: string[]): number | undefined {
  const minRaw = parseFlagOrNext(args, '--min-confidence');
  const minConfidence = minRaw ? Number(minRaw) : undefined;
  if (minRaw && (Number.isNaN(minConfidence) || minConfidence! < 0 || minConfidence! > 100)) {
    console.error(`--min-confidence must be a number in [0, 100], got: ${minRaw}`);
    process.exit(2);
  }
  return minConfidence;
}

function resolveApplyOptions(args: string[]): ApplyCommandOptions {
  const cwd = process.cwd();
  const minConfidence = parseMinConfidence(args);
  const files = resolveInputs(cwd, args);
  if (files.length === 0) {
    console.error(
      'Usage: kern apply <file-or-directory>... [--write] [--min-confidence N] [--template NAME] [--audit PATH]',
    );
    process.exit(2);
  }

  return {
    cwd,
    files,
    write: hasFlag(args, '--write'),
    minConfidence,
    templateName: parseFlagOrNext(args, '--template'),
    auditPath: parseFlagOrNext(args, '--audit'),
  };
}

function printResults(results: ApplyResult[]): DecisionCounts {
  const byDecision: DecisionCounts = { applied: 0, 'dry-run': 0, rejected: 0, skipped: 0 };
  for (const r of results) {
    byDecision[r.decision]++;
    printResult(r);
  }
  return byDecision;
}

function printSummary(byDecision: DecisionCounts, auditPath: string, write: boolean): void {
  console.log('');
  console.log(
    `Summary: ${byDecision.applied} applied, ${byDecision['dry-run']} dry-run, ${byDecision.rejected} rejected, ${byDecision.skipped} skipped`,
  );
  console.log(`Audit: ${auditPath}`);
  if (!write && byDecision['dry-run'] > 0) {
    console.log('Run with --write to apply the transforms.');
  }
}

export function runApply(args: string[]): void {
  const options = resolveApplyOptions(args);

  const { results, auditPath } = applyFiles(options.files, {
    write: options.write,
    minConfidence: options.minConfidence,
    templateName: options.templateName,
    auditPath: options.auditPath,
    cwd: options.cwd,
  });

  const byDecision = printResults(results);
  printSummary(byDecision, auditPath, options.write);
  if (byDecision.rejected > 0) {
    process.exit(1);
  }
}
