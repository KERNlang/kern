import {
  evaluateRagEvalDocument,
  evaluateRagEvalDocumentFromDeclaredSources,
  type RagChunkInput,
  type RagEvalDocumentReport,
} from '@kernlang/core';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parseFlagOrNext } from '../shared.js';

const USAGE = 'Usage: kern rag eval <file.kern> [--corpus <chunks.json>]';

/** `kern rag …` — run a RAG spec's contracts in the toolchain (dbt-test shape). */
export function runRag(args: string[]): void {
  const sub = args[1];
  if (sub === 'eval') {
    runRagEval(args.slice(2));
    return;
  }
  console.error(USAGE);
  process.exit(1);
}

function runRagEval(args: string[]): void {
  const corpusPath = parseFlagOrNext(args, '--corpus');
  const filePath = args.find((arg) => !arg.startsWith('-') && arg !== corpusPath);

  const resolvedFilePath = filePath ? resolve(filePath) : '';
  if (!filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (!existsSync(resolvedFilePath)) fail(`file not found: ${filePath}`);
  if (corpusPath && !existsSync(corpusPath)) fail(`corpus not found: ${corpusPath}`);

  const source = readFileSync(resolvedFilePath, 'utf-8');
  const chunks = corpusPath ? readCorpus(corpusPath) : undefined;
  let report: RagEvalDocumentReport;
  try {
    report = chunks
      ? evaluateRagEvalDocument(source, chunks)
      : evaluateRagEvalDocumentFromDeclaredSources(source, { sourcePath: resolvedFilePath });
  } catch (err) {
    fail(`evaluation failed: ${(err as Error).message}`);
  }

  printReport(report, filePath, chunks?.length ?? report.corpusSource.chunkCount);
  if (report.diagnostics.length > 0) process.exit(1); // invalid spec — failed closed
  if (report.evals.length === 0) process.exit(0); // no ragEval to run is not a failure
  process.exit(report.passed ? 0 : 1);
}

function readCorpus(corpusPath: string): RagChunkInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(corpusPath), 'utf-8'));
  } catch (err) {
    fail(`invalid corpus JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) fail('corpus JSON must be an array of chunks.');
  parsed.forEach((chunk, index) => {
    if (
      typeof chunk !== 'object' ||
      chunk === null ||
      typeof (chunk as RagChunkInput).id !== 'string' ||
      typeof (chunk as RagChunkInput).text !== 'string' ||
      typeof (chunk as RagChunkInput).source !== 'string'
    ) {
      fail(`corpus chunk at index ${index} must have string id, text, and source.`);
    }
  });
  return parsed as RagChunkInput[];
}

function printReport(report: RagEvalDocumentReport, file: string, chunkCount: number): void {
  console.log(
    `kern rag eval ${file}  (embedder=${report.embedderId}, mode=${report.corpusSource.mode}, ${chunkCount} chunks)`,
  );
  if (report.corpusSource.mode === 'declared-local-sources') {
    const fileCount = report.corpusSource.fileCount ?? report.corpusSource.files?.length ?? 0;
    console.log(`  corpus source: ${fileCount} file(s), sha256=${report.corpusSource.corpusSha256}`);
  }
  if (report.diagnostics.length > 0) {
    console.log(`  invalid RAG spec — ${report.diagnostics.length} violation(s):`);
    for (const diagnostic of report.diagnostics) {
      const where = diagnostic.line ? ` (line ${diagnostic.line})` : '';
      console.log(`    ✗ ${diagnostic.rule}${where}: ${diagnostic.message}`);
    }
    console.log('\nINVALID');
    return;
  }
  if (report.evals.length === 0) {
    console.log('  no ragEval declared — nothing to run.');
    return;
  }
  for (const entry of report.evals) {
    const label = entry.evalName ? `${entry.ragName}/${entry.evalName}` : entry.ragName;
    const { passed, passedCaseCount, caseCount } = entry.result;
    console.log(`  ${passed ? '✓' : '✗'} ${label}  (${passedCaseCount}/${caseCount} cases)`);
    for (const evalCase of entry.result.cases) {
      console.log(
        `      ${evalCase.passed ? '✓' : '✗'} ${evalCase.name}  "${evalCase.query}"  [${evalCase.chunks.length} chunks]`,
      );
      for (const assertion of evalCase.assertions) {
        if (!assertion.passed) console.log(`          ✗ ${assertion.kind}: ${assertion.message}`);
      }
    }
  }
  console.log(report.passed ? '\nPASS' : '\nFAIL');
}

function fail(message: string): never {
  // Throw (unambiguously `never` in every toolchain) rather than leaning on
  // process.exit's `never` typing; cli.ts main() catches and exits 1.
  throw new Error(`kern rag eval: ${message}`);
}
