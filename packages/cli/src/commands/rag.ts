import {
  evaluateRagEvalDocumentAsync,
  evaluateRagEvalDocumentFromDeclaredSourcesAsync,
  ragRetrieveCorpusSourceSummary,
  type RagChunkInput,
  type RagEvalDocumentReport,
  type RagRetrieveDocumentReport,
  retrieveRagDocument,
} from '@kernlang/core';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const USAGE =
  'Usage: kern rag eval <file.kern> [--corpus <chunks.json>] [--openai-api-key <key>]\n' +
  '       kern rag retrieve <file.kern> --query <text> [--param name=value]  (local embed models only)';

/** `kern rag …` — run a RAG spec's contracts in the toolchain (dbt-test shape). */
export async function runRag(args: string[]): Promise<void> {
  const sub = args[1];
  if (sub === 'eval') {
    await runRagEval(args.slice(2));
    return;
  }
  if (sub === 'retrieve') {
    runRagRetrieve(args.slice(2));
    return;
  }
  console.error(USAGE);
  process.exit(1);
}

function runRagRetrieve(args: string[]): void {
  const { filePath, paramError, paramFlagPresent, query, queryFlagPresent, queryParams, unknownFlags } =
    parseRagRetrieveArgs(args);
  const resolvedFilePath = filePath ? resolve(filePath) : '';
  if (unknownFlags.length > 0) fail(`unknown flag for retrieve: ${unknownFlags[0]}.\n${USAGE}`);
  if (!filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (queryFlagPresent && (!query?.trim() || query.trim().startsWith('-'))) fail(`missing value for --query.\n${USAGE}`);
  if (paramError) fail(`${paramError}.\n${USAGE}`);
  if (paramFlagPresent && Object.keys(queryParams).length === 0) fail(`missing value for --param.\n${USAGE}`);
  if (!existsSync(resolvedFilePath)) fail(`file not found: ${filePath}`);

  const source = readFileSync(resolvedFilePath, 'utf-8');
  let report: RagRetrieveDocumentReport;
  try {
    report = retrieveRagDocument(source, {
      sourcePath: resolvedFilePath,
      ...(query !== undefined ? { query } : {}),
      queryParams,
    });
  } catch (err) {
    fail(`retrieval failed: ${(err as Error).message}`);
  }

  if (report.diagnostics.length > 0) {
    console.log(`kern rag retrieve ${filePath}`);
    console.log(`  invalid RAG spec — ${report.diagnostics.length} violation(s):`);
    for (const diagnostic of report.diagnostics) {
      const where = diagnostic.line ? ` (line ${diagnostic.line})` : '';
      console.log(`    ✗ ${diagnostic.rule}${where}: ${diagnostic.message}`);
    }
    process.exit(1);
  }
  console.log(`kern rag retrieve ${filePath}  (${ragRetrieveCorpusSourceSummary(report)})`);
  if (report.retrievals.length === 0) {
    console.log('  no ragRetrieve declared — nothing to run.');
    process.exit(0);
  }
  for (const retrieval of report.retrievals) {
    const label = retrieval.ragName ? `${retrieval.ragName}/${retrieval.name}` : retrieval.name;
    console.log(`  ${label} index=${retrieval.indexName} query="${retrieval.query}"`);
    for (const chunk of retrieval.result.chunks) {
      console.log(`    ${chunk.id} score=${chunk.score} source=${chunk.source} text="${truncateText(chunk.text)}"`);
    }
  }
  process.exit(0);
}

async function runRagEval(args: string[]): Promise<void> {
  const { corpusFlagPresent, corpusPath, filePath, openAiApiKeyFlag, openAiKeyFlagPresent } = parseRagEvalArgs(args);

  const resolvedFilePath = filePath ? resolve(filePath) : '';
  if (!filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (corpusFlagPresent && (!corpusPath?.trim() || corpusPath.startsWith('-'))) {
    fail(`missing value for --corpus.\n${USAGE}`);
  }
  if (openAiKeyFlagPresent && (!openAiApiKeyFlag?.trim() || openAiApiKeyFlag.startsWith('-'))) {
    fail(`missing value for --openai-api-key.\n${USAGE}`);
  }
  if (!existsSync(resolvedFilePath)) fail(`file not found: ${filePath}`);
  if (corpusPath && !existsSync(corpusPath)) fail(`corpus not found: ${corpusPath}`);

  const source = readFileSync(resolvedFilePath, 'utf-8');
  const chunks = corpusPath ? readCorpus(corpusPath) : undefined;
  const providerOptions = ragProviderOptions(openAiApiKeyFlag);
  let report: RagEvalDocumentReport;
  try {
    report = chunks
      ? await evaluateRagEvalDocumentAsync(source, chunks, providerOptions)
      : await evaluateRagEvalDocumentFromDeclaredSourcesAsync(source, {
          sourcePath: resolvedFilePath,
          ...providerOptions,
        });
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

function ragProviderOptions(
  openAiApiKeyFlag: string | undefined,
): { readonly providers: { readonly openai: { readonly apiKey: string } } } | undefined {
  const openAiApiKey = (openAiApiKeyFlag ?? process.env.KERN_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim();
  return openAiApiKey ? { providers: { openai: { apiKey: openAiApiKey } } } : undefined;
}

interface ParsedRagEvalArgs {
  readonly filePath?: string;
  readonly corpusPath?: string;
  readonly corpusFlagPresent: boolean;
  readonly openAiApiKeyFlag?: string;
  readonly openAiKeyFlagPresent: boolean;
}

function parseRagEvalArgs(args: readonly string[]): ParsedRagEvalArgs {
  let filePath: string | undefined;
  let corpusPath: string | undefined;
  let corpusFlagPresent = false;
  let openAiApiKeyFlag: string | undefined;
  let openAiKeyFlagPresent = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--corpus') {
      corpusFlagPresent = true;
      corpusPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--corpus=')) {
      corpusFlagPresent = true;
      corpusPath = arg.slice('--corpus='.length);
      continue;
    }
    if (arg === '--openai-api-key') {
      openAiKeyFlagPresent = true;
      openAiApiKeyFlag = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--openai-api-key=')) {
      openAiKeyFlagPresent = true;
      openAiApiKeyFlag = arg.slice('--openai-api-key='.length);
      continue;
    }
    if (!arg.startsWith('-') && filePath === undefined) filePath = arg;
  }

  return { filePath, corpusPath, corpusFlagPresent, openAiApiKeyFlag, openAiKeyFlagPresent };
}

interface ParsedRagRetrieveArgs {
  readonly filePath?: string;
  readonly query?: string;
  readonly queryFlagPresent: boolean;
  readonly queryParams: Record<string, string>;
  readonly paramFlagPresent: boolean;
  readonly paramError?: string;
  readonly unknownFlags: readonly string[];
}

function parseRagRetrieveArgs(args: readonly string[]): ParsedRagRetrieveArgs {
  let filePath: string | undefined;
  let query: string | undefined;
  let queryFlagPresent = false;
  let paramFlagPresent = false;
  let paramError: string | undefined;
  const unknownFlags: string[] = [];
  const queryParams: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--query') {
      queryFlagPresent = true;
      query = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--query=')) {
      queryFlagPresent = true;
      query = arg.slice('--query='.length);
      continue;
    }
    if (arg === '--param') {
      paramFlagPresent = true;
      paramError ??= assignQueryParam(queryParams, args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--param=')) {
      paramFlagPresent = true;
      paramError ??= assignQueryParam(queryParams, arg.slice('--param='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      unknownFlags.push(arg);
      continue;
    }
    if (filePath === undefined) filePath = arg;
  }

  return { filePath, query, queryFlagPresent, queryParams, paramFlagPresent, ...(paramError ? { paramError } : {}), unknownFlags };
}

function assignQueryParam(out: Record<string, string>, raw: string | undefined): string | undefined {
  if (!raw?.includes('=')) return 'missing value for --param (expected name=value)';
  const index = raw.indexOf('=');
  const name = raw.slice(0, index).trim();
  const value = raw.slice(index + 1).trim();
  if (!name) return 'missing value for --param (expected name=value)';
  if (!value) return 'missing value for --param';
  out[name] = value;
  return undefined;
}

function truncateText(text: string, maxLength = 96): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
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
  throw new Error(`kern rag: ${message}`);
}
