import {
  BUILTIN_RAG_VECTOR_STORE_MANIFESTS,
  builtinRagVectorStoreManifest,
  createInMemoryRagVectorStoreForConformance,
  evaluateRagEvalDocumentAsync,
  evaluateRagEvalDocumentFromDeclaredSourcesAsync,
  indexRagDocumentAsync,
  RAG_VECTOR_STORE_CONFORMANCE_PROFILE,
  type RagChunkInput,
  type RagEvalDocumentReport,
  type RagIndexDocumentReport,
  type RagRetrieveDocumentReport,
  type RagVectorStoreConformanceContext,
  type RagVectorStoreConformanceReport,
  type RagVectorStoreKind,
  ragRetrieveCorpusSourceSummary,
  retrieveRagDocumentAsync,
  runRagVectorStoreConformance,
} from '@kernlang/core';
import { LocalPersistentRagVectorStoreAdapter } from '@kernlang/core/node';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const USAGE =
  'Usage: kern rag eval <file.kern> [--corpus <chunks.json>] [--json] [--openai-api-key <key>]\n' +
  '       kern rag retrieve <file.kern> --query <text> [--param name=value] [--openai-api-key <key>]\n' +
  '       kern rag index <file.kern> [--status] [--json] [--force-rebuild] [--openai-api-key <key>]\n' +
  '       kern rag conformance [--adapter memory|local-persistent] [--json]\n' +
  '       kern rag conformance --list [--json]';

/** `kern rag …` — run a RAG spec's contracts in the toolchain (dbt-test shape). */
export async function runRag(args: string[]): Promise<void> {
  const sub = args[1];
  if (sub === 'eval') {
    await runRagEval(args.slice(2));
    return;
  }
  if (sub === 'retrieve') {
    await runRagRetrieve(args.slice(2));
    return;
  }
  if (sub === 'index') {
    await runRagIndex(args.slice(2));
    return;
  }
  if (sub === 'conformance') {
    runRagConformance(args.slice(2));
    return;
  }
  console.error(USAGE);
  process.exit(1);
}

async function runRagIndex(args: string[]): Promise<void> {
  const parsed = parseRagIndexArgs(args);
  const resolvedFilePath = parsed.filePath ? resolve(parsed.filePath) : '';
  if (parsed.unknownFlags.length > 0) fail(`unknown flag for index: ${parsed.unknownFlags[0]}.\n${USAGE}`);
  if (parsed.unexpectedArgs.length > 0) fail(`unexpected argument for index: ${parsed.unexpectedArgs[0]}.\n${USAGE}`);
  if (!parsed.filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (parsed.status && parsed.forceRebuild) fail(`--status cannot be combined with --force-rebuild.\n${USAGE}`);
  if (parsed.openAiKeyFlagPresent && (!parsed.openAiApiKeyFlag?.trim() || parsed.openAiApiKeyFlag.startsWith('-'))) {
    fail(`missing value for --openai-api-key.\n${USAGE}`);
  }
  if (!existsSync(resolvedFilePath)) fail(`file not found: ${parsed.filePath}`);

  const source = readFileSync(resolvedFilePath, 'utf-8');
  let report: RagIndexDocumentReport;
  try {
    report = await indexRagDocumentAsync(source, {
      sourcePath: resolvedFilePath,
      statusOnly: parsed.status,
      forceRebuild: parsed.forceRebuild,
      ...ragProviderOptions(parsed.openAiApiKeyFlag),
    });
  } catch (err) {
    fail(`index failed: ${errorMessageWithClose(err)}`);
  }

  if (parsed.json) console.log(JSON.stringify(report, null, 2));
  else printRagIndexReport(report, parsed.filePath, parsed.status);
  process.exit(report.diagnostics.length > 0 ? 1 : 0);
}

function runRagConformance(args: string[]): void {
  const { adapterFlagPresent, adapterName, json, list, unexpectedArgs, unknownFlags } = parseRagConformanceArgs(args);
  if (unknownFlags.length > 0) fail(`unknown flag for conformance: ${unknownFlags[0]}.\n${USAGE}`);
  if (unexpectedArgs.length > 0) fail(`unexpected argument for conformance: ${unexpectedArgs[0]}.\n${USAGE}`);
  if (list && adapterFlagPresent) fail(`--list cannot be combined with --adapter.\n${USAGE}`);
  if (adapterFlagPresent && (!adapterName?.trim() || adapterName.trim().startsWith('-'))) {
    fail(`missing value for --adapter.\n${USAGE}`);
  }
  if (list) {
    printRagConformanceList(json);
    process.exit(0);
  }
  const manifests = adapterName
    ? [builtinRagVectorStoreManifest(adapterName) ?? fail(`unknown RAG adapter '${adapterName}'.\n${USAGE}`)]
    : BUILTIN_RAG_VECTOR_STORE_MANIFESTS;

  const reports: RagVectorStoreConformanceReport[] = [];
  for (const manifest of manifests) {
    const tmp = mkdtempSync(join(tmpdir(), `kern-rag-${manifest.name}-conformance-`));
    try {
      reports.push(
        runRagVectorStoreConformance({
          manifest,
          createStore: (context) => createConformanceStore(manifest.adapterKind, context, tmp),
        }),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const passed = reports.every((report) => report.passed);
  if (json) {
    console.log(JSON.stringify({ passed, reports }, null, 2));
  } else {
    console.log('kern rag conformance');
    for (const report of reports) {
      const mark = report.passed ? '✓' : '✗';
      console.log(
        `  ${mark} ${report.manifest.name} (${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped)`,
      );
      for (const entry of report.cases) {
        if (entry.status === 'failed') console.log(`      ✗ ${entry.name}: ${entry.message ?? 'failed'}`);
        if (entry.status === 'skipped') console.log(`      - ${entry.name}: ${entry.message ?? 'skipped'}`);
      }
    }
  }
  process.exit(passed ? 0 : 1);
}

function printRagIndexReport(report: RagIndexDocumentReport, filePath: string, statusOnly: boolean): void {
  console.log(`kern rag index ${filePath}${statusOnly ? ' --status' : ''}`);
  if (report.diagnostics.length > 0) {
    console.log(`  invalid RAG spec — ${report.diagnostics.length} violation(s):`);
    for (const diagnostic of report.diagnostics) {
      const where = diagnostic.line ? ` (line ${diagnostic.line})` : '';
      console.log(`    ✗ ${diagnostic.rule}${where}: ${diagnostic.message}`);
    }
    return;
  }
  if (report.indexes.length === 0) {
    console.log('  no ragIndex declared — nothing to run.');
    return;
  }
  console.log('  indexes:');
  for (const index of report.indexes) {
    const snapshot = index.snapshotPath ? ` snapshot=${index.snapshotPath}` : '';
    const manifest = index.manifestPath ? ` manifest=${index.manifestPath}` : '';
    console.log(
      `    ${index.indexName} store=${index.storeName} kind=${index.storeKind} status=${index.status} action=${index.action} chunks=${index.chunkCount}${snapshot}${manifest}`,
    );
    console.log(`      ${index.reason}`);
  }
}

function printRagConformanceList(json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          profile: RAG_VECTOR_STORE_CONFORMANCE_PROFILE,
          adapters: BUILTIN_RAG_VECTOR_STORE_MANIFESTS,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`kern rag conformance ${RAG_VECTOR_STORE_CONFORMANCE_PROFILE.version}`);
  console.log(`  required capabilities: ${RAG_VECTOR_STORE_CONFORMANCE_PROFILE.requiredCapabilities.join(', ')}`);
  console.log(`  cases: ${RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases.length}`);
  for (const manifest of BUILTIN_RAG_VECTOR_STORE_MANIFESTS) {
    console.log(
      `  ${manifest.name} kind=${manifest.adapterKind} persistence=${manifest.persistence} metrics=${manifest.metrics.join(',')} maxDims=${manifest.maxDimensions}`,
    );
  }
}

function createConformanceStore(
  adapterKind: RagVectorStoreKind,
  context: RagVectorStoreConformanceContext,
  directory: string,
) {
  if (adapterKind === 'memory') return createInMemoryRagVectorStoreForConformance(context);
  if (adapterKind === 'local-persistent') {
    return new LocalPersistentRagVectorStoreAdapter({
      directory,
      fileName: `${context.namespace}.json`,
      fingerprint: context.fingerprint,
      dims: context.dims,
    });
  }
  fail(`unknown RAG adapter kind '${adapterKind}'.`);
}

async function runRagRetrieve(args: string[]): Promise<void> {
  const {
    filePath,
    openAiApiKeyFlag,
    openAiKeyFlagPresent,
    paramError,
    paramFlagPresent,
    query,
    queryFlagPresent,
    queryParams,
    unexpectedArgs,
    unknownFlags,
  } = parseRagRetrieveArgs(args);
  const resolvedFilePath = filePath ? resolve(filePath) : '';
  if (unknownFlags.length > 0) fail(`unknown flag for retrieve: ${unknownFlags[0]}.\n${USAGE}`);
  if (unexpectedArgs.length > 0) fail(`unexpected argument for retrieve: ${unexpectedArgs[0]}.\n${USAGE}`);
  if (!filePath) fail(`missing <file.kern>.\n${USAGE}`);
  if (queryFlagPresent && (!query?.trim() || query.trim().startsWith('-')))
    fail(`missing value for --query.\n${USAGE}`);
  if (openAiKeyFlagPresent && (!openAiApiKeyFlag?.trim() || openAiApiKeyFlag.startsWith('-'))) {
    fail(`missing value for --openai-api-key.\n${USAGE}`);
  }
  if (paramError) fail(`${paramError}.\n${USAGE}`);
  if (paramFlagPresent && Object.keys(queryParams).length === 0) fail(`missing value for --param.\n${USAGE}`);
  if (!existsSync(resolvedFilePath)) fail(`file not found: ${filePath}`);

  const source = readFileSync(resolvedFilePath, 'utf-8');
  let report: RagRetrieveDocumentReport;
  try {
    report = await retrieveRagDocumentAsync(source, {
      sourcePath: resolvedFilePath,
      ...(query !== undefined ? { query } : {}),
      queryParams,
      ...ragProviderOptions(openAiApiKeyFlag),
    });
  } catch (err) {
    fail(`retrieval failed: ${errorMessageWithClose(err)}`);
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
  if (report.indexes.length > 0) {
    console.log('  indexes:');
    for (const index of report.indexes) {
      const chunking = index.chunkingName ? ` chunking=${index.chunkingName}` : '';
      const snapshot = index.snapshotPath ? ` snapshot=${index.snapshotPath}` : '';
      console.log(
        `    ${index.indexName} store=${index.storeName} kind=${index.storeKind}${chunking} status=${index.status} chunks=${index.chunkCount}${snapshot}`,
      );
    }
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
  const {
    corpusFlagPresent,
    corpusPath,
    filePath,
    json,
    openAiApiKeyFlag,
    openAiKeyFlagPresent,
    unexpectedArgs,
    unknownFlags,
  } = parseRagEvalArgs(args);

  const resolvedFilePath = filePath ? resolve(filePath) : '';
  if (unknownFlags.length > 0) fail(`unknown flag for eval: ${unknownFlags[0]}.\n${USAGE}`);
  if (unexpectedArgs.length > 0) fail(`unexpected argument for eval: ${unexpectedArgs[0]}.\n${USAGE}`);
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
    fail(`evaluation failed: ${errorMessageWithClose(err)}`);
  }

  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report, filePath, chunks?.length ?? report.corpusSource.chunkCount);
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
  if (!openAiApiKey) return undefined;
  const openai = {};
  Object.defineProperty(openai, 'apiKey', {
    value: openAiApiKey,
    enumerable: false,
  });
  return { providers: { openai: openai as { readonly apiKey: string } } };
}

interface ParsedRagEvalArgs {
  readonly filePath?: string;
  readonly corpusPath?: string;
  readonly corpusFlagPresent: boolean;
  readonly json: boolean;
  readonly openAiApiKeyFlag?: string;
  readonly openAiKeyFlagPresent: boolean;
  readonly unexpectedArgs: readonly string[];
  readonly unknownFlags: readonly string[];
}

function parseRagEvalArgs(args: readonly string[]): ParsedRagEvalArgs {
  let filePath: string | undefined;
  let corpusPath: string | undefined;
  let corpusFlagPresent = false;
  let json = false;
  let openAiApiKeyFlag: string | undefined;
  let openAiKeyFlagPresent = false;
  const unexpectedArgs: string[] = [];
  const unknownFlags: string[] = [];

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
    if (arg === '--json') {
      json = true;
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
    if (arg.startsWith('-')) {
      unknownFlags.push(arg);
      continue;
    }
    if (filePath === undefined) {
      filePath = arg;
      continue;
    }
    unexpectedArgs.push(arg);
  }

  return {
    filePath,
    corpusPath,
    corpusFlagPresent,
    json,
    openAiApiKeyFlag,
    openAiKeyFlagPresent,
    unexpectedArgs,
    unknownFlags,
  };
}

interface ParsedRagConformanceArgs {
  readonly adapterName?: string;
  readonly adapterFlagPresent: boolean;
  readonly json: boolean;
  readonly list: boolean;
  readonly unexpectedArgs: readonly string[];
  readonly unknownFlags: readonly string[];
}

interface ParsedRagIndexArgs {
  readonly filePath?: string;
  readonly status: boolean;
  readonly json: boolean;
  readonly forceRebuild: boolean;
  readonly openAiApiKeyFlag?: string;
  readonly openAiKeyFlagPresent: boolean;
  readonly unexpectedArgs: readonly string[];
  readonly unknownFlags: readonly string[];
}

function parseRagIndexArgs(args: readonly string[]): ParsedRagIndexArgs {
  let filePath: string | undefined;
  let status = false;
  let json = false;
  let forceRebuild = false;
  let openAiApiKeyFlag: string | undefined;
  let openAiKeyFlagPresent = false;
  const unexpectedArgs: string[] = [];
  const unknownFlags: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--status') {
      status = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--force-rebuild') {
      forceRebuild = true;
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
    if (arg.startsWith('-')) {
      unknownFlags.push(arg);
      continue;
    }
    if (filePath === undefined) {
      filePath = arg;
      continue;
    }
    unexpectedArgs.push(arg);
  }

  return {
    filePath,
    status,
    json,
    forceRebuild,
    ...(openAiApiKeyFlag !== undefined ? { openAiApiKeyFlag } : {}),
    openAiKeyFlagPresent,
    unexpectedArgs,
    unknownFlags,
  };
}

function parseRagConformanceArgs(args: readonly string[]): ParsedRagConformanceArgs {
  let adapterName: string | undefined;
  let adapterFlagPresent = false;
  let json = false;
  let list = false;
  const unexpectedArgs: string[] = [];
  const unknownFlags: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--adapter') {
      adapterFlagPresent = true;
      adapterName = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--adapter=')) {
      adapterFlagPresent = true;
      adapterName = arg.slice('--adapter='.length);
      continue;
    }
    if (arg.startsWith('-')) {
      unknownFlags.push(arg);
      continue;
    }
    unexpectedArgs.push(arg);
  }

  return {
    ...(adapterName !== undefined ? { adapterName } : {}),
    adapterFlagPresent,
    json,
    list,
    unexpectedArgs,
    unknownFlags,
  };
}

interface ParsedRagRetrieveArgs {
  readonly filePath?: string;
  readonly query?: string;
  readonly queryFlagPresent: boolean;
  readonly queryParams: Record<string, string>;
  readonly paramFlagPresent: boolean;
  readonly paramError?: string;
  readonly openAiApiKeyFlag?: string;
  readonly openAiKeyFlagPresent: boolean;
  readonly unexpectedArgs: readonly string[];
  readonly unknownFlags: readonly string[];
}

function parseRagRetrieveArgs(args: readonly string[]): ParsedRagRetrieveArgs {
  let filePath: string | undefined;
  let query: string | undefined;
  let queryFlagPresent = false;
  let paramFlagPresent = false;
  let paramError: string | undefined;
  let openAiApiKeyFlag: string | undefined;
  let openAiKeyFlagPresent = false;
  const unexpectedArgs: string[] = [];
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
    if (arg.startsWith('-')) {
      unknownFlags.push(arg);
      continue;
    }
    if (filePath === undefined) {
      filePath = arg;
      continue;
    }
    unexpectedArgs.push(arg);
  }

  return {
    filePath,
    query,
    queryFlagPresent,
    queryParams,
    paramFlagPresent,
    ...(paramError ? { paramError } : {}),
    ...(openAiApiKeyFlag !== undefined ? { openAiApiKeyFlag } : {}),
    openAiKeyFlagPresent,
    unexpectedArgs,
    unknownFlags,
  };
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

function errorMessageWithClose(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const closeError = (error as { readonly closeError?: unknown } | undefined)?.closeError;
  if (!closeError) return message;
  const closeMessage = closeError instanceof Error ? closeError.message : String(closeError);
  return `${message}; close failed: ${closeMessage}`;
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
