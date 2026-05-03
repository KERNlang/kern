/**
 * `kern migrate <migration> [dir]` - in-place migrations of .kern sources.
 *
 * `literal-const`
 *   Detects `const name=X ... handler <<< <single-line const expression> >>>`
 *   and rewrites to `const name=X ... value=...`. Primitive literals use the
 *   compact `value=42` form; strings and expressions use `value={{ ... }}` so
 *   generated TypeScript stays byte-equivalent to the original handler body.
 *
 * `fn-expr`
 *   Detects `fn name=X ... handler <<< <single-line function body> >>>` and
 *   rewrites to `fn name=X ... expr={{ ... }}`. The compiler emits the expr
 *   body verbatim inside the function, matching the original handler output.
 *
 * Dry-run by default; `--write` commits edits.
 */

import { type GapCategory, isInlineSafeExpression, isInlineSafeLiteral } from '@kernlang/core';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join, relative, resolve } from 'path';
import { hasFlag, loadConfig, loadTemplates, parseFlagOrNext, transpileAndWrite } from '../shared.js';

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

function walkKern(root: string, out: string[]): void {
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
      walkKern(full, out);
    } else if (stat.isFile() && extname(entry) === '.kern') {
      out.push(full);
    }
  }
}

// -- literal-const ----------------------------------------------------------
// Classifiers live in @kernlang/core so `kern gaps` can tag migratable handlers
// using the exact same rules the rewriter applies here.

interface LiteralConstHit {
  headerLine: number; // 1-based line of the `const name=...` line
  literal: string;
  valueAttr: string;
}

interface LiteralConstResult {
  hits: LiteralConstHit[];
  output: string;
}

/**
 * Line-based migration: matches the exact shape emitted by historical
 * importers and by hand-written audiofacets files:
 *
 *   const name=X type=T [more props]      <- header, no trailing handler attr
 *     handler <<<
 *       <single literal line>
 *     >>>
 *
 * Indentation is tolerated (any whitespace), but the handler MUST be
 * single-line content sandwiched by `<<<` and `>>>` with no other children.
 * If the const header already contains `value=`, the handler is left alone.
 */
function rewriteLiteralConsts(source: string): LiteralConstResult {
  const lines = source.split('\n');
  const hits: LiteralConstHit[] = [];
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Header: must start with 'const ' (possibly preceded by whitespace),
    // contain name=, and NOT already carry a value= attribute.
    const headerMatch = line.match(/^(\s*)const\s+(.*)$/);
    if (!headerMatch) {
      out.push(line);
      i++;
      continue;
    }
    const headerIndent = headerMatch[1];
    const headerRest = headerMatch[2];
    // Skip if already has value= to avoid double-migration.
    if (/\bvalue=/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }
    // Require name= somewhere in the header so we don't misfire on other
    // `const` occurrences (there shouldn't be any at column 0 in .kern, but
    // being strict avoids future surprises).
    if (!/\bname=/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }
    // Skip headers with inline `#` or `//` comments. The KERN parser strips
    // them (see parser-core.ts stripLineComment), so appending `value=...`
    // after a comment would put the value *inside* the comment and the
    // migration would silently delete the handler without preserving it.
    if (/(?:^|\s)(?:#|\/\/)/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }

    // Look ahead for the handler block:
    //   line i+1:  <deeper-indent>  handler <<<
    //   line i+2:  <deeper-indent>    <literal>
    //   line i+3:  <deeper-indent>  >>>
    const openLine = lines[i + 1];
    const bodyLine = lines[i + 2];
    const closeLine = lines[i + 3];
    if (openLine === undefined || bodyLine === undefined || closeLine === undefined) {
      out.push(line);
      i++;
      continue;
    }
    const openMatch = openLine.match(/^(\s+)handler\s*<<<\s*$/);
    const closeMatch = closeLine.match(/^\s+>>>\s*$/);
    if (!openMatch || !closeMatch) {
      out.push(line);
      i++;
      continue;
    }
    // Require the handler to be a CHILD of the const — its indent must be
    // strictly deeper than the const header's. Otherwise a sibling handler
    // block would be swallowed when the const itself is indented.
    if (openMatch[1].length <= headerIndent.length) {
      out.push(line);
      i++;
      continue;
    }
    // Body must be a single line of pure literal content, deeper indent than
    // the `handler` line, single token. Reject multi-line handlers.
    const openIndent = openMatch[1];
    const bodyMatch = bodyLine.match(/^(\s+)(.*)$/);
    if (!bodyMatch || bodyMatch[1].length <= openIndent.length) {
      out.push(line);
      i++;
      continue;
    }
    const bodyText = bodyMatch[2];
    // Two-tier: prefer the bare `value=<literal>` form for pure primitives
    // (cleaner output); fall back to `value={{ <expr> }}` for anything else
    // that's a single-line, non-empty, non-closing-delimiter body. The
    // compiled TS is byte-identical to the original handler form either way
    // because both paths route through the same codegen branch in
    // codegen/type-system.ts:generateConst.
    let valueAttr: string;
    let rendered: string;
    if (isInlineSafeLiteral(bodyText)) {
      const lit = bodyText.trim();
      valueAttr = `value=${lit}`;
      rendered = lit;
    } else if (isInlineSafeExpression(bodyText)) {
      const expr = bodyText.trim();
      valueAttr = `value={{ ${expr} }}`;
      rendered = expr;
    } else {
      out.push(line);
      i++;
      continue;
    }

    // Preserve trailing attributes after name=... so export=false etc. stay.
    const rewrittenHeader = `${headerIndent}const ${headerRest.trimEnd()} ${valueAttr}`;
    hits.push({ headerLine: i + 1, literal: rendered, valueAttr });
    out.push(rewrittenHeader);
    i += 4; // skip handler <<<, body, >>>
  }

  return { hits, output: out.join('\n') };
}

// -- fn-expr ----------------------------------------------------------------

/**
 * Line-based migration for single-line `fn` handler bodies. Matches:
 *
 *   [indent]fn name=X [props...]    <- header, no handler= attr, no expr= attr
 *   [deeper]  handler <<<
 *   [deeper]    <single body line>  <- preserved verbatim (incl. `return`, `;`)
 *   [deeper]  >>>
 *
 * Rewrites to `fn name=X ... expr={{ <body> }}`. The codegen in
 * generateFunction emits the expr verbatim inside the function body, so the
 * compiled TypeScript is byte-identical to the handler form.
 *
 * Shares the same safety guards as rewriteLiteralConsts:
 *   - handler must be a child of the fn (strictly deeper indent),
 *   - no `}}` in the body (would close the expr block early),
 *   - header must not already carry expr= or handler=,
 *   - header must not contain an inline `#` or `//` comment,
 *   - body must not be empty after trim,
 *   - handler must have exactly ONE body line (no multi-line blocks).
 */
function rewriteFnExpr(source: string): LiteralConstResult {
  const lines = source.split('\n');
  const hits: LiteralConstHit[] = [];
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const headerMatch = line.match(/^(\s*)fn\s+(.*)$/);
    if (!headerMatch) {
      out.push(line);
      i++;
      continue;
    }
    const headerIndent = headerMatch[1];
    const headerRest = headerMatch[2];
    if (/\bexpr=/.test(headerRest) || /\bhandler=/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }
    if (!/\bname=/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }
    if (/(?:^|\s)(?:#|\/\/)/.test(headerRest)) {
      out.push(line);
      i++;
      continue;
    }

    const openLine = lines[i + 1];
    const bodyLine = lines[i + 2];
    const closeLine = lines[i + 3];
    if (openLine === undefined || bodyLine === undefined || closeLine === undefined) {
      out.push(line);
      i++;
      continue;
    }
    const openMatch = openLine.match(/^(\s+)handler\s*<<<\s*$/);
    const closeMatch = closeLine.match(/^\s+>>>\s*$/);
    if (!openMatch || !closeMatch) {
      out.push(line);
      i++;
      continue;
    }
    if (openMatch[1].length <= headerIndent.length) {
      out.push(line);
      i++;
      continue;
    }
    const openIndent = openMatch[1];
    const bodyMatch = bodyLine.match(/^(\s+)(.*)$/);
    if (!bodyMatch || bodyMatch[1].length <= openIndent.length) {
      out.push(line);
      i++;
      continue;
    }
    const bodyText = bodyMatch[2];
    if (!isInlineSafeExpression(bodyText)) {
      out.push(line);
      i++;
      continue;
    }

    const body = bodyText.trim();
    const valueAttr = `expr={{ ${body} }}`;
    const rewritten = `${headerIndent}fn ${headerRest.trimEnd()} ${valueAttr}`;
    hits.push({ headerLine: i + 1, literal: body, valueAttr });
    out.push(rewritten);
    i += 4;
  }

  return { hits, output: out.join('\n') };
}

// -- Migration registry ----------------------------------------------------
//
// Each entry is a self-describing migration. `kern migrate list` enumerates
// the registry; `kern migrate <name>` dispatches to one entry. The `category`
// field matches the `GapCategory` surfaced by `kern gaps` so tooling (MCP,
// VS Code, CI) can cross-reference migratable gaps with the migration that
// would resolve them.

export interface MigrationDef {
  /** Canonical name — also the CLI subcommand. */
  name: string;
  /** Category this migration services. Today always `migratable`. */
  category: GapCategory;
  /** One-line description shown in help + `list` output. */
  summary: string;
  /** Pure rewriter — takes source, returns new source + per-hit breakdown. */
  rewrite: (source: string) => LiteralConstResult;
}

import { rewriteClassBodies } from './migrate-class-body.js';
import { rewriteNativeHandlers } from './migrate-native-handlers.js';

export const MIGRATIONS: Record<string, MigrationDef> = {
  'literal-const': {
    name: 'literal-const',
    category: 'migratable',
    summary: 'Inline single-line const handler bodies as `value=` attributes',
    rewrite: rewriteLiteralConsts,
  },
  'fn-expr': {
    name: 'fn-expr',
    category: 'migratable',
    summary: 'Inline single-line fn handler bodies as `expr={{ ... }}` attributes',
    rewrite: rewriteFnExpr,
  },
  'class-body': {
    name: 'class-body',
    category: 'migratable',
    summary: 'Convert `const X type=any handler<<<class X{...}>>>` to a `class` node',
    rewrite: rewriteClassBodies,
  },
  'native-handlers': {
    name: 'native-handlers',
    category: 'migratable',
    summary: 'Convert raw `<<<…>>>` handler bodies to `lang="kern"` body-statement form',
    rewrite: rewriteNativeHandlers,
  },
};

/** Stable iteration order for help + list output. */
function migrationList(): MigrationDef[] {
  return Object.values(MIGRATIONS).sort((a, b) => a.name.localeCompare(b.name));
}

// -- Command entry ----------------------------------------------------------

interface FileReport {
  file: string;
  hits: number;
  rewrites: string[];
  // Legacy JSON field: original single-line handler bodies.
  literals: string[];
}

interface MigrateReport {
  migration: string;
  /** Category from the registry — mirrors `kern gaps` taxonomy. */
  category: GapCategory;
  scannedFiles: number;
  changedFiles: number;
  totalHits: number;
  files: FileReport[];
  mode: 'dry-run' | 'write';
}

function formatHuman(report: MigrateReport, rootDir: string): string {
  const lines: string[] = [];
  lines.push(
    `kern migrate ${report.migration} - scanned ${report.scannedFiles} .kern files in ${
      relative(process.cwd(), rootDir) || '.'
    }`,
  );
  if (report.totalHits === 0) {
    lines.push('No migration candidates found.');
    return `${lines.join('\n')}\n`;
  }
  for (const file of report.files) {
    if (file.hits === 0) continue;
    const rel = relative(rootDir, file.file) || file.file;
    lines.push(`  ${rel}  (${file.hits} hit${file.hits === 1 ? '' : 's'})`);
    for (const rewrite of file.rewrites.slice(0, 5)) {
      lines.push(`    -> ${rewrite}`);
    }
    if (file.rewrites.length > 5) {
      lines.push(`    ... ${file.rewrites.length - 5} more`);
    }
  }
  const action = report.mode === 'write' ? 'applied' : 'would apply';
  lines.push('');
  lines.push(`${action}: ${report.totalHits} hits across ${report.changedFiles} files`);
  if (report.mode === 'dry-run') {
    lines.push('(dry-run - re-run with --write to commit)');
  }
  return `${lines.join('\n')}\n`;
}

// ── --verify helpers ──────────────────────────────────────────────────────
// Bake the whole "compile pre, apply migration, compile post, diff, revert
// on drift" operator dance into a single flag. Without this, users ship
// class-body / literal-const changes and have to stage a git worktree,
// recompile twice, and pray the byte-clean check is empty. Now they
// just run `kern migrate <name> --write --verify`.

/** Compile every `.kern` file under rootDir into outDir, matching how the
 * standard `kern compile` command invokes transpile. `--no-gaps` suppresses
 * writes to `.kern-gaps/` so a verify run doesn't pollute the user's state.
 */
function compileAllKernInto(rootDir: string, files: string[], outDir: string): { failures: string[] } {
  // Force target='auto' so each file picks its own target from AST content.
  // Verification needs to be stable and deterministic — `nextjs` default
  // from plain `loadConfig()` emits a `page.tsx` wrapper even for pure
  // const-only files, which doesn't match what `kern compile <file>`
  // produces in normal CLI use.
  const cfg = { ...loadConfig(), target: 'auto' as const };
  // Load any configured templates the user's `kern compile` would register —
  // without this, verify compile fails with "No template registered..." on
  // projects that use template nodes even though their normal build works.
  try {
    loadTemplates(cfg);
  } catch {
    // Template loading failures are surfaced during normal compile as well;
    // don't hard-stop verify here — per-file transpile will report them.
  }
  const failures: string[] = [];
  for (const file of files) {
    try {
      transpileAndWrite(file, cfg, ['--no-gaps'], outDir, rootDir);
    } catch (err) {
      failures.push(`${file}: ${(err as Error).message}`);
    }
  }
  return { failures };
}

interface DriftEntry {
  file: string;
  reason: 'missing-in-after' | 'missing-in-before' | 'content';
}

/** Recursively walk `dir`, returning paths relative to `dir`. */
function listRel(dir: string, base = dir, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) listRel(full, base, out);
    else if (s.isFile()) out.push(relative(base, full));
  }
  return out;
}

function collectDriftBetween(beforeDir: string, afterDir: string): DriftEntry[] {
  const beforeFiles = new Set(listRel(beforeDir));
  const afterFiles = new Set(listRel(afterDir));
  const drift: DriftEntry[] = [];

  for (const rel of beforeFiles) {
    if (!afterFiles.has(rel)) {
      drift.push({ file: rel, reason: 'missing-in-after' });
      continue;
    }
    try {
      const a = readFileSync(join(beforeDir, rel), 'utf-8');
      const b = readFileSync(join(afterDir, rel), 'utf-8');
      if (a !== b) drift.push({ file: rel, reason: 'content' });
    } catch {
      drift.push({ file: rel, reason: 'content' });
    }
  }
  for (const rel of afterFiles) {
    if (!beforeFiles.has(rel)) drift.push({ file: rel, reason: 'missing-in-before' });
  }
  return drift;
}

function cleanupTmp(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — ignore
  }
}

function printUsage(): void {
  process.stderr.write('Usage: kern migrate <migration|list> [dir] [--write] [--verify] [--json]\n');
  process.stderr.write('Migrations:\n');
  const padTo = migrationList().reduce((m, d) => Math.max(m, d.name.length), 0);
  for (const def of migrationList()) {
    process.stderr.write(`  ${def.name.padEnd(padTo)}  [${def.category}] ${def.summary}\n`);
  }
  process.stderr.write('\nList programmatically:\n');
  process.stderr.write('  kern migrate list [--json]   # print the registry\n');
}

function runMigrateList(json: boolean): void {
  const entries = migrationList().map((d) => ({
    name: d.name,
    category: d.category,
    summary: d.summary,
  }));
  if (json) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    return;
  }
  const padTo = entries.reduce((m, d) => Math.max(m, d.name.length), 0);
  for (const entry of entries) {
    process.stdout.write(`${entry.name.padEnd(padTo)}  [${entry.category}]  ${entry.summary}\n`);
  }
}

export function runMigrate(args: string[]): void {
  const sub = args[1];
  const json = hasFlag(args, '--json');

  if (!sub || sub.startsWith('--')) {
    printUsage();
    process.exit(1);
  }

  if (sub === 'list') {
    runMigrateList(json);
    return;
  }

  const def = MIGRATIONS[sub];
  if (!def) {
    process.stderr.write(`Unknown migration: ${sub}\n`);
    printUsage();
    process.exit(1);
  }

  const rootArg = args.slice(2).find((a) => !a.startsWith('--'));
  const rootDir = resolve(parseFlagOrNext(args, '--root') ?? rootArg ?? process.cwd());
  const write = hasFlag(args, '--write');
  const verify = hasFlag(args, '--verify');

  // --verify implies --write (no point verifying a dry-run).
  const effectiveWrite = write || verify;

  const files: string[] = [];
  walkKern(rootDir, files);

  // Verify pre-compile: snapshot originals + emit BEFORE build against the
  // current (pre-migration) .kern sources. Runs before we touch anything on
  // disk so rollback is guaranteed.
  const snapshot = new Map<string, string>();
  let beforeDir: string | undefined;
  let compileFailed = false;
  if (verify) {
    for (const file of files) {
      try {
        snapshot.set(file, readFileSync(file, 'utf-8'));
      } catch {
        // Best-effort — files we can't read we won't migrate either.
      }
    }
    beforeDir = mkdtempSync(join(tmpdir(), 'kern-verify-before-'));
    const { failures } = compileAllKernInto(rootDir, files, beforeDir);
    if (failures.length > 0) {
      process.stderr.write(`✗ ${sub}: pre-migration compile failed on ${failures.length} file(s):\n`);
      for (const f of failures.slice(0, 3)) process.stderr.write(`  ${f}\n`);
      cleanupTmp(beforeDir);
      compileFailed = true;
      process.exit(1);
    }
  }

  const fileReports: FileReport[] = [];
  let totalHits = 0;
  let changedFiles = 0;
  const touchedFiles: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const result = def.rewrite(source);
    fileReports.push({
      file,
      hits: result.hits.length,
      rewrites: result.hits.map((h) => h.valueAttr),
      literals: result.hits.map((h) => h.literal),
    });
    if (result.hits.length > 0) {
      totalHits += result.hits.length;
      changedFiles++;
      if (effectiveWrite && result.output !== source) {
        writeFileSync(file, result.output);
        touchedFiles.push(file);
      }
    }
  }

  // Verify post-compile: emit AFTER build against migrated sources, diff
  // tree-wise, roll back on drift.
  if (verify && !compileFailed) {
    const afterDir = mkdtempSync(join(tmpdir(), 'kern-verify-after-'));
    const { failures } = compileAllKernInto(rootDir, files, afterDir);
    if (failures.length > 0) {
      process.stderr.write(`✗ ${sub}: post-migration compile failed — rolling back\n`);
      for (const [file, original] of snapshot) writeFileSync(file, original);
      cleanupTmp(beforeDir);
      cleanupTmp(afterDir);
      process.exit(1);
    }

    const drift = collectDriftBetween(beforeDir!, afterDir);
    cleanupTmp(beforeDir);
    cleanupTmp(afterDir);

    if (drift.length === 0) {
      // stderr so `kern migrate ... --verify --json` still emits parseable
      // JSON on stdout (the banner is status output, not report output).
      process.stderr.write(
        `✓ ${sub}: verified byte-clean (${files.length} .kern files compiled pre/post, ${touchedFiles.length} rewritten, 0 TS drift)\n`,
      );
    } else {
      process.stderr.write(`✗ ${sub}: ${drift.length} file(s) drifted in compiled TS — rolling back migration.\n`);
      const preview = drift
        .slice(0, 5)
        .map((d) => `  ${d.file} (${d.reason})`)
        .join('\n');
      process.stderr.write(`${preview}\n`);
      if (drift.length > 5) process.stderr.write(`  ...and ${drift.length - 5} more\n`);
      for (const [file, original] of snapshot) writeFileSync(file, original);
      process.stderr.write(`Restored ${snapshot.size} .kern file(s) to pre-migration state.\n`);
      process.exit(1);
    }
  }

  const report: MigrateReport = {
    migration: def.name,
    category: def.category,
    scannedFiles: files.length,
    changedFiles,
    totalHits,
    files: fileReports,
    mode: effectiveWrite ? 'write' : 'dry-run',
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatHuman(report, rootDir));
}

// Exported for unit tests.
export const __test__ = {
  isInlineSafeLiteral,
  isInlineSafeExpression,
  rewriteLiteralConsts,
  rewriteFnExpr,
};
