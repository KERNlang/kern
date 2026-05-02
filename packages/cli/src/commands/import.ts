import type { ImportResult, ParseDiagnostic, SchemaViolation, SemanticViolation } from '@kernlang/core';
import {
  generateCoreNode,
  importTypeScript,
  parseDocumentWithDiagnostics,
  validateSchema,
  validateSemantics,
} from '@kernlang/core';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { hasFlag, parseFlag } from '../shared.js';

interface ImportFileReport {
  file: string;
  output: string;
  ok: boolean;
  stats: ImportResult['stats'];
  unmapped: string[];
  diagnostics: ParseDiagnostic[];
  schemaViolations: SchemaViolation[];
  semanticViolations: SemanticViolation[];
  codegenErrors: string[];
}

interface ImportFileWorkReport extends ImportFileReport {
  kern: string;
}

interface ImportCommandReport {
  files: ImportFileReport[];
  totals: ImportResult['stats'] & {
    unmapped: number;
    diagnostics: number;
    schemaViolations: number;
    semanticViolations: number;
    codegenErrors: number;
  };
  ok: boolean;
}

interface ImportCommandWorkReport extends Omit<ImportCommandReport, 'files'> {
  files: ImportFileWorkReport[];
}

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'generated') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findTsFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      // Skip .d.ts files
      if (entry.endsWith('.d.ts')) continue;
      files.push(full);
    }
  }
  return files;
}

function codegenRoots(root: { type: string; children?: unknown[] }): unknown[] {
  return root.type === 'document' ? root.children || [] : [root];
}

function findCodegenErrors(root: ReturnType<typeof parseDocumentWithDiagnostics>['root']): string[] {
  const failures: string[] = [];
  for (const node of codegenRoots(root)) {
    try {
      generateCoreNode(node as never);
    } catch (error) {
      const typedNode = node as { type?: string; loc?: { line?: number } };
      failures.push(
        `${typedNode.type || 'node'} at line ${typedNode.loc?.line ?? '?'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

function checkImportedKern(
  result: ImportResult,
): Omit<ImportFileReport, 'file' | 'output' | 'stats' | 'unmapped' | 'ok'> {
  const parsed = parseDocumentWithDiagnostics(result.kern);
  // Slice 5a: NATIVE_KERN_ELIGIBLE is an opt-in hint, not an import-quality
  // signal — every importable TS handler that happens to be eligible would
  // otherwise flip `ok` to false. Filter at the import-check boundary so the
  // diagnostic still reaches IDE/API consumers but doesn't gate `kern import`.
  const diagnostics = parsed.diagnostics.filter((d) => d.code !== 'NATIVE_KERN_ELIGIBLE');
  return {
    diagnostics,
    schemaViolations: validateSchema(parsed.root),
    semanticViolations: validateSemantics(parsed.root),
    codegenErrors: findCodegenErrors(parsed.root),
  };
}

function emptyImportTotals(): ImportCommandReport['totals'] {
  return {
    types: 0,
    interfaces: 0,
    functions: 0,
    classes: 0,
    imports: 0,
    constants: 0,
    enums: 0,
    components: 0,
    unmapped: 0,
    diagnostics: 0,
    schemaViolations: 0,
    semanticViolations: 0,
    codegenErrors: 0,
  };
}

function emptyImportChecks(): Omit<ImportFileReport, 'file' | 'output' | 'stats' | 'unmapped' | 'ok'> {
  return {
    diagnostics: [],
    schemaViolations: [],
    semanticViolations: [],
    codegenErrors: [],
  };
}

function formatImportIssues(report: ImportFileReport): string[] {
  const lines: string[] = [];
  if (report.unmapped.length > 0) lines.push(`unmapped=${report.unmapped.length}`);
  if (report.diagnostics.length > 0) lines.push(`diagnostics=${report.diagnostics.length}`);
  if (report.schemaViolations.length > 0) lines.push(`schema=${report.schemaViolations.length}`);
  if (report.semanticViolations.length > 0) lines.push(`semantic=${report.semanticViolations.length}`);
  if (report.codegenErrors.length > 0) lines.push(`codegen=${report.codegenErrors.length}`);
  return lines;
}

function publicImportReport(report: ImportCommandWorkReport): ImportCommandReport {
  return {
    ok: report.ok,
    totals: report.totals,
    files: report.files.map((fileReport) => ({
      file: fileReport.file,
      output: fileReport.output,
      ok: fileReport.ok,
      stats: fileReport.stats,
      unmapped: fileReport.unmapped,
      diagnostics: fileReport.diagnostics,
      schemaViolations: fileReport.schemaViolations,
      semanticViolations: fileReport.semanticViolations,
      codegenErrors: fileReport.codegenErrors,
    })),
  };
}

function createImportReport(
  files: string[],
  outDir?: string,
  options: { validate: boolean } = { validate: true },
): ImportCommandWorkReport {
  const reports: ImportFileWorkReport[] = [];
  const totals = emptyImportTotals();

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const result = importTypeScript(source, basename(file));
    const kernFileName = basename(file).replace(/\.tsx?$/, '.kern');
    const kernOutDir = outDir ? resolve(outDir) : dirname(file);
    const kernPath = resolve(kernOutDir, kernFileName);
    const checked = options.validate ? checkImportedKern(result) : emptyImportChecks();

    for (const key of Object.keys(result.stats) as (keyof ImportResult['stats'])[]) {
      totals[key] += result.stats[key];
    }
    totals.unmapped += result.unmapped.length;
    totals.diagnostics += checked.diagnostics.length;
    totals.schemaViolations += checked.schemaViolations.length;
    totals.semanticViolations += checked.semanticViolations.length;
    totals.codegenErrors += checked.codegenErrors.length;

    reports.push({
      file,
      output: kernPath,
      kern: result.kern,
      ok:
        result.unmapped.length === 0 &&
        checked.diagnostics.length === 0 &&
        checked.schemaViolations.length === 0 &&
        checked.semanticViolations.length === 0 &&
        checked.codegenErrors.length === 0,
      stats: result.stats,
      unmapped: result.unmapped,
      ...checked,
    });
  }

  return { files: reports, totals, ok: reports.every((report) => report.ok) };
}

export function runImport(args: string[]): void {
  const input = args[1];
  if (!input) {
    console.error('Usage: kern import <file.ts|dir> [--outdir=<dir>] [--dry-run] [--check] [--json (report-only)]');
    process.exit(1);
  }

  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    console.error(`Not found: ${input}`);
    process.exit(1);
  }

  const outDir = parseFlag(args, '--outdir');
  const dryRun = hasFlag(args, '--dry-run');
  const check = hasFlag(args, '--check');
  const json = hasFlag(args, '--json');
  const stat = statSync(inputPath);
  const files = stat.isDirectory() ? findTsFiles(inputPath) : [inputPath];

  if (files.length === 0) {
    if (json) console.log(JSON.stringify({ files: [], totals: emptyImportTotals(), ok: true }, null, 2));
    else console.log('No .ts/.tsx files found.');
    return;
  }

  const report = createImportReport(files, outDir, { validate: check || json });
  if (json) {
    console.log(JSON.stringify(publicImportReport(report), null, 2));
    if (check && !report.ok) process.exit(1);
    return;
  }

  if (check) {
    console.log(`\n  KERN import check — validating ${files.length} TypeScript file(s)\n`);
    for (const fileReport of report.files) {
      const relFile = relative(process.cwd(), fileReport.file);
      if (fileReport.ok) {
        console.log(`  ✓ ${relFile}`);
        continue;
      }
      console.log(`  ✗ ${relFile} (${formatImportIssues(fileReport).join(', ')})`);
      for (const unmapped of fileReport.unmapped.slice(0, 3)) console.log(`      unmapped: ${unmapped}`);
      for (const diagnostic of fileReport.diagnostics.slice(0, 3)) {
        console.log(`      diagnostic: ${diagnostic.line}:${diagnostic.col} ${diagnostic.message}`);
      }
      for (const violation of fileReport.schemaViolations.slice(0, 3)) {
        console.log(`      schema: ${violation.line ?? '?'}:${violation.col ?? '?'} ${violation.message}`);
      }
      for (const violation of fileReport.semanticViolations.slice(0, 3)) {
        console.log(`      semantic: ${violation.line ?? '?'}:${violation.col ?? '?'} ${violation.message}`);
      }
      for (const error of fileReport.codegenErrors.slice(0, 3)) console.log(`      codegen: ${error}`);
    }
    console.log('');
    if (!report.ok) {
      console.error(
        `Import check failed: ${report.files.filter((fileReport) => !fileReport.ok).length} file(s) failed.`,
      );
      process.exit(1);
    }
    console.log('Import check passed.');
    return;
  }

  console.log(`\n  KERN import — converting ${files.length} TypeScript file(s)\n`);

  for (const fileReport of report.files) {
    const relFile = relative(process.cwd(), fileReport.file);
    const kernFileName = basename(fileReport.output);

    if (dryRun) {
      console.log(`  ${relFile} → ${relative(process.cwd(), fileReport.output)}`);
      console.log(
        `    types: ${fileReport.stats.types}, interfaces: ${fileReport.stats.interfaces}, functions: ${fileReport.stats.functions}, classes: ${fileReport.stats.classes}`,
      );
      if (fileReport.unmapped.length > 0) {
        console.log(`    unmapped: ${fileReport.unmapped.length}`);
        for (const u of fileReport.unmapped.slice(0, 3)) {
          console.log(`      - ${u}`);
        }
        if (fileReport.unmapped.length > 3) {
          console.log(`      ... and ${fileReport.unmapped.length - 3} more`);
        }
      }
      console.log('');
      console.log(fileReport.kern);
      console.log('---');
    } else {
      mkdirSync(dirname(fileReport.output), { recursive: true });
      writeFileSync(fileReport.output, fileReport.kern);
      const parts: string[] = [];
      if (fileReport.stats.types) parts.push(`${fileReport.stats.types} types`);
      if (fileReport.stats.interfaces) parts.push(`${fileReport.stats.interfaces} interfaces`);
      if (fileReport.stats.functions) parts.push(`${fileReport.stats.functions} functions`);
      if (fileReport.stats.classes) parts.push(`${fileReport.stats.classes} classes`);
      if (fileReport.stats.constants) parts.push(`${fileReport.stats.constants} constants`);
      if (fileReport.stats.imports) parts.push(`${fileReport.stats.imports} imports`);
      console.log(`  ${relFile} → ${kernFileName} (${parts.join(', ')})`);
      if (fileReport.unmapped.length > 0) {
        console.log(`    ⚠ ${fileReport.unmapped.length} unmapped construct(s)`);
      }
    }
  }

  console.log(
    `\n  Total: ${
      report.totals.types +
      report.totals.interfaces +
      report.totals.functions +
      report.totals.classes +
      report.totals.constants
    } declarations imported`,
  );
  if (report.totals.unmapped > 0) {
    console.log(`  ${report.totals.unmapped} unmapped construct(s) — check comments in output`);
  }
}
