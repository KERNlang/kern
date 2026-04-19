/**
 * `kern migrate <migration> [dir]` - in-place migrations of .kern sources.
 *
 * First migration: `literal-const`
 *   Detects `const name=X ... handler <<< <primitive-literal> >>>` and rewrites
 *   to `const name=X ... value=<primitive-literal>`. This closes the single
 *   largest class of coverage-gap handlers: primitive constant literals that
 *   were wrapped in handler blocks by older importers (or hand-authored) even
 *   though the schema supports inline `value=` attributes.
 *
 * Dry-run by default; `--write` commits edits.
 */

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

/**
 * Return true if the given single-line string is a safe-to-inline literal:
 * - numeric (int, float, hex, scientific, underscore-separated)
 * - boolean / null / undefined
 *
 * Strings are deliberately excluded. The KERN parser strips quotes from
 * `quoted` tokens before they reach const codegen, so `value="foo"` would
 * round-trip as unquoted TS (`const X = foo;`). That's a latent pre-existing
 * bug that also affects `kern import`; migrating strings here would corrupt
 * compiled output until the codegen path is fixed in a separate change.
 */
function isInlineSafeLiteral(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') return true;

  // Numeric: int, float, hex, binary, octal, scientific, underscore
  // separators. Optional leading minus; no operators, no identifiers.
  if (
    /^-?(?:0x[0-9a-fA-F][0-9a-fA-F_]*|0b[01][01_]*|0o[0-7][0-7_]*|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)$/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

interface LiteralConstHit {
  headerLine: number; // 1-based line of the `const name=...` line
  literal: string;
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

    // Look ahead for the handler block:
    //   line i+1:  <indent>  handler <<<
    //   line i+2:  <indent>    <literal>
    //   line i+3:  <indent>  >>>
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
    // Body must be a single line of pure literal content, deeper indent than
    // the `handler` line, single token. Reject multi-line handlers.
    const openIndent = openMatch[1];
    const bodyMatch = bodyLine.match(/^(\s+)(.*)$/);
    if (!bodyMatch || bodyMatch[1].length <= openIndent.length) {
      out.push(line);
      i++;
      continue;
    }
    const literalText = bodyMatch[2];
    if (!isInlineSafeLiteral(literalText)) {
      out.push(line);
      i++;
      continue;
    }

    // Preserve trailing attributes after name=... so export=false etc. stay.
    // Build the rewritten header: insert ` value=<literal>` before the end.
    // Strategy: append at end. Same codegen (see codegen/type-system.ts:216)
    // so order doesn't matter.
    const rewrittenHeader = `${headerIndent}const ${headerRest.trimEnd()} value=${literalText.trim()}`;
    hits.push({ headerLine: i + 1, literal: literalText.trim() });
    out.push(rewrittenHeader);
    i += 4; // skip handler <<<, body, >>>
  }

  return { hits, output: out.join('\n') };
}

// -- Command entry ----------------------------------------------------------

interface FileReport {
  file: string;
  hits: number;
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
    for (const lit of file.literals.slice(0, 5)) {
      lines.push(`    -> value=${lit}`);
    }
    if (file.literals.length > 5) {
      lines.push(`    ... ${file.literals.length - 5} more`);
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

export function runMigrate(args: string[]): void {
  const sub = args[1];
  if (!sub || sub.startsWith('--')) {
    process.stderr.write('Usage: kern migrate <migration> [dir] [--write] [--json]\n');
    process.stderr.write('Migrations:\n');
    process.stderr.write('  literal-const   Inline primitive-literal handler bodies as `value=` attributes\n');
    process.exit(1);
  }
  if (sub !== 'literal-const') {
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
    const result = rewriteLiteralConsts(source);
    fileReports.push({
      file,
      hits: result.hits.length,
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
    migration: 'literal-const',
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
export const __test__ = { isInlineSafeLiteral, rewriteLiteralConsts };
