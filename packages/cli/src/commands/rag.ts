import { evaluateRagEvalDocument, type RagChunkInput, type RagEvalDocumentReport } from '@kernlang/core';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parseFlag, parseFlagOrNext } from '../shared.js';

const USAGE = 'Usage: kern rag eval <file.kern> --corpus <chunks.json>';

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
  const corpusPath = parseFlagOrNext(args, '--corpus') ?? parseFlag(args, '--corpus');
  const filePath = args.find((arg) => !arg.startsWith('-') && arg !== corpusPath);

  if (!filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (!existsSync(filePath)) fail(`file not found: ${filePath}`);
  if (!corpusPath) fail(`--corpus <chunks.json> is required (on-disk ingestion lands in P1.5).\n${USAGE}`);
  if (!existsSync(corpusPath)) fail(`corpus not found: ${corpusPath}`);

  const chunks = readCorpus(corpusPath);
  const report = evaluateRagEvalDocument(readFileSync(resolve(filePath), 'utf-8'), chunks);
  printReport(report, filePath, chunks.length);
  process.exit(report.passed ? 0 : 1);
}

function readCorpus(corpusPath: string): RagChunkInput[] {
  try {
    const parsed = JSON.parse(readFileSync(resolve(corpusPath), 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('corpus JSON must be an array of chunks.');
    return parsed as RagChunkInput[];
  } catch (err) {
    fail(`invalid corpus JSON: ${(err as Error).message}`);
    return []; // unreachable — fail() exits
  }
}

function printReport(report: RagEvalDocumentReport, file: string, chunkCount: number): void {
  console.log(`kern rag eval ${file}  (embedder=${report.embedderId}, ${chunkCount} chunks)`);
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
  console.error(`kern rag eval: ${message}`);
  process.exit(1);
}
