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

import { isInlineSafeExpression, isInlineSafeLiteral } from '@kernlang/core';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { hasFlag, parseFlagOrNext } from '../shared.js';

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

const MIGRATIONS: Record<string, (source: string) => LiteralConstResult> = {
  'literal-const': rewriteLiteralConsts,
  'fn-expr': rewriteFnExpr,
};

export function runMigrate(args: string[]): void {
  const sub = args[1];
  if (!sub || sub.startsWith('--')) {
    process.stderr.write('Usage: kern migrate <migration> [dir] [--write] [--json]\n');
    process.stderr.write('Migrations:\n');
    process.stderr.write('  literal-const   Inline single-line const handler bodies as `value=` attributes\n');
    process.stderr.write('  fn-expr         Inline single-line fn handler bodies as `expr={{ ... }}` attributes\n');
    process.exit(1);
  }
  const rewrite = MIGRATIONS[sub];
  if (!rewrite) {
    process.stderr.write(`Unknown migration: ${sub}\n`);
    process.exit(1);
  }

  const rootArg = args.slice(2).find((a) => !a.startsWith('--'));
  const rootDir = resolve(parseFlagOrNext(args, '--root') ?? rootArg ?? process.cwd());
  const write = hasFlag(args, '--write');
  const json = hasFlag(args, '--json');

  const files: string[] = [];
  walkKern(rootDir, files);

  const fileReports: FileReport[] = [];
  let totalHits = 0;
  let changedFiles = 0;

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const result = rewrite(source);
    fileReports.push({
      file,
      hits: result.hits.length,
      rewrites: result.hits.map((h) => h.valueAttr),
      literals: result.hits.map((h) => h.literal),
    });
    if (result.hits.length > 0) {
      totalHits += result.hits.length;
      changedFiles++;
      if (write && result.output !== source) {
        writeFileSync(file, result.output);
      }
    }
  }

  const report: MigrateReport = {
    migration: sub,
    scannedFiles: files.length,
    changedFiles,
    totalHits,
    files: fileReports,
    mode: write ? 'write' : 'dry-run',
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
