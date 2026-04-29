#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  checkNativeKernTestBaseline,
  createNativeKernTestBaseline,
  explainNativeKernTestRule,
  formatNativeKernTestCoverage,
  formatNativeKernTestRunSummary,
  formatNativeKernTestSummary,
  listNativeKernTestRules,
  type NativeKernTestBaseline,
  type NativeKernTestRunSummary,
  type NativeKernTestSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from './index.js';

interface NativeKernTestCliIO {
  stdout: Pick<typeof process.stdout, 'write'>;
  stderr: Pick<typeof process.stderr, 'write'>;
}

interface NativeKernTestCliOptions {
  json: boolean;
  compact: boolean;
  coverage: boolean;
  baselinePath?: string;
  writeBaselinePath?: string;
  minCoverage?: number;
  failOnWarn: boolean;
  maxWarnings?: number;
  grep?: string;
  bail: boolean;
  passWithNoTests: boolean;
}

const VALUE_FLAGS = new Set([
  '--baseline',
  '--explain-rule',
  '--format',
  '--grep',
  '--max-warnings',
  '--min-coverage',
  '--write-baseline',
]);

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((arg) => flags.includes(arg));
}

function hasValueFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

function parseValueFlag(args: string[], flag: string): string | undefined {
  const eqArg = args.find((arg) => arg.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith('--')) return '';
  return next;
}

function firstPositionalArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

function requireValueFlag(
  args: string[],
  flag: string,
  description: string,
  io: NativeKernTestCliIO,
): string | undefined {
  if (!hasValueFlag(args, flag)) return undefined;
  const value = parseValueFlag(args, flag);
  if (!value) {
    io.stderr.write(`${flag} requires ${description}.\n`);
    throw new Error('usage');
  }
  return value;
}

function loadNativeBaseline(path: string): NativeKernTestBaseline {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as NativeKernTestBaseline;
  if (parsed.version !== 1 || !Array.isArray(parsed.warnings)) {
    throw new Error('expected { "version": 1, "warnings": [...] }');
  }
  return parsed;
}

function isNativeRunSummary(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
): summary is NativeKernTestRunSummary {
  return 'files' in summary;
}

function usage(): string {
  return [
    'Usage: kern-test <file-or-dir> [--json] [--grep <pattern>] [--bail] [--fail-on-warn]',
    '                 [--max-warnings <n>] [--coverage] [--min-coverage <pct>]',
    '                 [--baseline <file>] [--write-baseline <file>] [--pass-with-no-tests]',
    '                 [--format compact] [--compact] [--list-rules] [--explain-rule <rule>]',
  ].join('\n');
}

function handleNativeBaseline(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
  opts: { baselinePath?: string; writeBaselinePath?: string },
  io: NativeKernTestCliIO,
): boolean {
  let failed = false;
  if (opts.writeBaselinePath) {
    writeFileSync(opts.writeBaselinePath, `${JSON.stringify(createNativeKernTestBaseline(summary), null, 2)}\n`);
  }
  if (opts.baselinePath) {
    const check = checkNativeKernTestBaseline(summary, loadNativeBaseline(opts.baselinePath));
    if (!check.ok) {
      failed = true;
      for (const warning of check.newWarnings) {
        io.stderr.write(
          `New native warning: ${warning.suite} > ${warning.caseName}: ${warning.assertion} [${warning.ruleId}]${warning.message ? ` - ${warning.message}` : ''}\n`,
        );
      }
      for (const warning of check.staleWarnings) {
        io.stderr.write(
          `Stale native warning baseline: ${warning.suite} > ${warning.caseName}: ${warning.assertion} [${warning.ruleId}]${warning.message ? ` - ${warning.message}` : ''}\n`,
        );
      }
    }
  }
  return failed;
}

function reportNativeSummary(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
  options: NativeKernTestCliOptions,
  io: NativeKernTestCliIO,
): number {
  io.stdout.write(
    options.json
      ? `${JSON.stringify(summary, null, 2)}\n`
      : isNativeRunSummary(summary)
        ? formatNativeKernTestRunSummary(summary, options.compact ? { format: 'compact' } : undefined)
        : formatNativeKernTestSummary(summary, options.compact ? { format: 'compact' } : undefined),
  );
  if (options.coverage && !options.json) io.stdout.write(formatNativeKernTestCoverage(summary.coverage));

  const baselineFailed = handleNativeBaseline(
    summary,
    { baselinePath: options.baselinePath, writeBaselinePath: options.writeBaselinePath },
    io,
  );
  const coverageFailed = options.minCoverage !== undefined && summary.coverage.percent < options.minCoverage;
  if (coverageFailed) {
    io.stderr.write(`Native coverage ${summary.coverage.percent}% is below --min-coverage ${options.minCoverage}%.\n`);
  }

  const grepMatchedNothing =
    Boolean(options.grep) &&
    summary.total === 0 &&
    !options.passWithNoTests &&
    (!isNativeRunSummary(summary) || summary.files.length > 0);
  const failed =
    summary.failed > 0 ||
    baselineFailed ||
    coverageFailed ||
    (options.failOnWarn && summary.warnings > 0) ||
    (options.maxWarnings !== undefined && summary.warnings > options.maxWarnings) ||
    grepMatchedNothing;
  return failed ? 1 : 0;
}

export function runNativeKernTestCli(
  args: string[] = process.argv.slice(2),
  io: NativeKernTestCliIO = { stdout: process.stdout, stderr: process.stderr },
): number {
  try {
    const json = hasFlag(args, '--json');
    const listRules = hasFlag(args, '--list-rules');
    const help = hasFlag(args, '--help', '-h');

    if (help) {
      io.stdout.write(`${usage()}\n`);
      return 0;
    }

    if (listRules) {
      const rules = listNativeKernTestRules();
      io.stdout.write(
        json
          ? `${JSON.stringify(rules, null, 2)}\n`
          : `${rules.map((rule) => `${rule.ruleId} - ${rule.description}`).join('\n')}\n`,
      );
      return 0;
    }

    const explainRule = requireValueFlag(args, '--explain-rule', 'a rule ID', io);
    if (explainRule) {
      const rule = explainNativeKernTestRule(explainRule);
      if (!rule) {
        io.stderr.write(`Unknown native test rule: ${explainRule}\n`);
        return 2;
      }
      io.stdout.write(
        json
          ? `${JSON.stringify(rule, null, 2)}\n`
          : `${rule.ruleId}\n${rule.description}${rule.presets?.length ? `\nPresets: ${rule.presets.join(', ')}` : ''}\n`,
      );
      return 0;
    }

    const input = firstPositionalArg(args);
    if (!input) {
      io.stderr.write(`${usage()}\n`);
      return 1;
    }

    const grepFlagPresent = hasValueFlag(args, '--grep');
    const grep = requireValueFlag(args, '--grep', 'a pattern', io);
    const formatFlagPresent = hasValueFlag(args, '--format');
    const requestedFormat = requireValueFlag(args, '--format', '"default" or "compact"', io);
    const compact = hasFlag(args, '--compact') || requestedFormat === 'compact';
    const maxWarningsRaw = requireValueFlag(args, '--max-warnings', 'a non-negative integer', io);
    const minCoverageRaw = requireValueFlag(args, '--min-coverage', 'a percentage from 0 to 100', io);
    const baselinePath = requireValueFlag(args, '--baseline', 'a file path', io);
    const writeBaselinePath = requireValueFlag(args, '--write-baseline', 'a file path', io);
    const maxWarnings = maxWarningsRaw === undefined ? undefined : Number(maxWarningsRaw);
    const minCoverage = minCoverageRaw === undefined ? undefined : Number(minCoverageRaw);

    if (grepFlagPresent && !grep) {
      io.stderr.write('--grep requires a pattern.\n');
      return 2;
    }
    if (formatFlagPresent && requestedFormat !== 'default' && requestedFormat !== 'compact') {
      io.stderr.write('--format must be "default" or "compact".\n');
      return 2;
    }
    if (maxWarnings !== undefined && (!Number.isInteger(maxWarnings) || maxWarnings < 0)) {
      io.stderr.write('--max-warnings requires a non-negative integer.\n');
      return 2;
    }
    if (minCoverage !== undefined && (Number.isNaN(minCoverage) || minCoverage < 0 || minCoverage > 100)) {
      io.stderr.write('--min-coverage requires a percentage from 0 to 100.\n');
      return 2;
    }
    if (baselinePath && writeBaselinePath) {
      io.stderr.write('--baseline and --write-baseline cannot be used together.\n');
      return 2;
    }

    const inputPath = resolve(input);
    if (!existsSync(inputPath)) {
      io.stderr.write(`Not found: ${input}\n`);
      return 1;
    }

    const options: NativeKernTestCliOptions = {
      json,
      compact,
      coverage: hasFlag(args, '--coverage') || minCoverageRaw !== undefined,
      baselinePath,
      writeBaselinePath,
      minCoverage,
      failOnWarn: hasFlag(args, '--fail-on-warn'),
      maxWarnings,
      grep,
      bail: hasFlag(args, '--bail'),
      passWithNoTests: hasFlag(args, '--pass-with-no-tests'),
    };
    const stat = statSync(inputPath);
    const summary = stat.isDirectory()
      ? runNativeKernTestRun(inputPath, options)
      : runNativeKernTests(inputPath, options);
    return reportNativeSummary(summary, options, io);
  } catch (error) {
    if (error instanceof Error && error.message === 'usage') return 2;
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  process.exitCode = runNativeKernTestCli();
}
