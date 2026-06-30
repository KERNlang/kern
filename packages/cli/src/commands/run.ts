import * as nodeCrypto from 'node:crypto';
import {
  canonicalRagEmbedModel,
  collectRagSemanticFacts,
  type IRNode,
  parseDocumentWithDiagnostics,
  parseExpression,
  RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
  RAG_EMBED_MODEL_LOCAL_HASH,
  RAG_EMBED_MODEL_LOCAL_SEMANTIC,
  validateRagSemantics,
} from '@kernlang/core';
import {
  assertLocalRagCapabilityChunksWereRetrieved,
  createAsyncLocalRagIngestCapability,
  createAsyncLocalRagRetrieveCapability,
  createLocalRagCapability,
  createLocalRagCapabilitySession,
  type LocalRagCapabilitySession,
  nativeEligibilityClassifier,
  typescriptClosureClassifier,
} from '@kernlang/core/node';
import {
  type AsyncCapabilityId,
  type AsyncRuntimeCapabilityHandler,
  type AsyncRuntimeCapabilityProvider,
  analyzeKernSourceCapabilities,
  CAPABILITY_DESCRIPTORS,
  type CapabilityAnalysis,
  type CapabilityId,
  type CapabilityRequirement,
  createMemoryStorageCapability,
  createWebCryptoCapability,
  executeKernSourceAsync as executeKernSourceAsyncFromRunner,
  executeKernSource as executeKernSourceFromRunner,
  KernRunnerError,
  type MalformedCapabilityRequirement,
  type UnknownCapabilityRequirement,
  type UnsupportedAsyncCapabilityRequirement,
  type WebCryptoCapabilitySource,
} from '@kernlang/core/runner';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createCliAsyncFsCapability } from './run-async-fs.js';
import {
  type CliAsyncOpenAICompatibleLlmCapabilityOptions,
  createCliAsyncLlmCapability,
  createCliAsyncNetCapability,
  createCliAsyncOpenAICompatibleLlmCapability,
  createCliAsyncRagAnswerCapability,
} from './run-async-host.js';

const USAGE =
  'Usage: kern run [--capabilities | --async-preview] [--fs-root <dir> [--fs-write-root <dir>]] [--allow-net <origin>] [--llm-response <text> | --llm-provider openai [--llm-model <model>] [--llm-base-url <url>]] <file.kern>';
const RUN_PROVIDED_CAPABILITY_NAMESPACES = Object.freeze(['crypto', 'rag', 'storage'] as const);
const RUN_ASYNC_PROVIDER_FLAGS = Object.freeze({
  'fs.list': ['--fs-root <dir>'],
  'fs.readText': ['--fs-root <dir>'],
  'fs.writeText': ['--fs-root <dir> + --fs-write-root <dir>'],
  'llm.complete': ['--llm-response <text> or --llm-provider openai'],
  'net.fetch': ['--allow-net <origin>'],
  'rag.answer': ['--llm-response <text> or --llm-provider openai'],
  'rag.ingest': [],
  'rag.retrieveAsync': [],
} satisfies Record<AsyncCapabilityId, readonly string[]>);

// The same parser capabilities the rest of the Node CLI injects (see compile.ts),
// so `kern run` parses identically to `kern compile` — block-bodied arrow closures
// and native-eligibility hints resolve instead of failing closed at parse time.
const NODE_PARSE_CAPS = {
  closureClassifier: typescriptClosureClassifier,
  nativeEligibilityClassifier,
} as const;

/**
 * Parse + execute `source`, returning the program's stdout as a single string,
 * or throwing {@link KernRunnerError} on any setup failure or runner abstention.
 * Pure with respect to process state so {@link runRun} is the one place that
 * touches stdout/stderr/exitCode — and so the executor is unit-testable without
 * spawning. The helper always provides volatile storage and explicit host crypto;
 * when sourcePath is provided, explicit RAG capability calls may also read
 * declared local corpus files through the injected Node capability.
 *
 * Atomicity: the runner returns the COMPLETE trace or throws, so stdout is built
 * only after the whole body succeeds; a body that abstains mid-way leaks nothing.
 */
export function executeKernSource(source: string, options: { sourcePath?: string } = {}): string {
  const capabilities = createRunCapabilities(source, options.sourcePath);
  return executeKernSourceFromRunner(source, {
    parseOptions: NODE_PARSE_CAPS,
    capabilities,
    capabilityContext: options.sourcePath ? { sourceName: options.sourcePath } : undefined,
  });
}

export async function executeKernSourceAsync(
  source: string,
  options: {
    sourcePath?: string;
    fsRoot?: string;
    fsWriteRoot?: string;
    netAllowedOrigins?: readonly string[];
    llmResponse?: string;
    llmProvider?: CliAsyncOpenAICompatibleLlmCapabilityOptions;
  },
): Promise<string> {
  if (options.llmResponse !== undefined && options.llmProvider !== undefined) {
    throw new KernRunnerError('kern run --async-preview: --llm-response and --llm-provider are mutually exclusive.');
  }
  const requiredCapabilities = sourceCapabilityRequirementIds(source);
  const sourceRequiresRagAnswer = requiredCapabilities.has('rag.answer');
  const sourceRequiresRagIngest = requiredCapabilities.has('rag.ingest');
  const sourceRequiresRagRetrieveAsync = requiredCapabilities.has('rag.retrieveAsync');
  const canProvideRagIngest = sourceRequiresRagIngest && sourceRagIngestUsesCliEmbedders(source);
  const canProvideRagRetrieveAsync = sourceRequiresRagRetrieveAsync && sourceRagRetrieveAsyncUsesCliEmbedders(source);
  const ragSession = createLocalRagCapabilitySession();
  const capabilities = createRunCapabilities(source, options.sourcePath, ragSession);
  const asyncCapabilities: Record<string, AsyncRuntimeCapabilityProvider | undefined> = {};
  const asyncRagCapabilities: Record<string, AsyncRuntimeCapabilityHandler | undefined> = {};
  const providedAsyncCapabilities: string[] = [];
  try {
    if (options.fsRoot) {
      const fsSetup = await createCliAsyncFsCapability(
        options.fsWriteRoot === undefined
          ? { readRoot: options.fsRoot }
          : { readRoot: options.fsRoot, writeRoot: options.fsWriteRoot },
      );
      asyncCapabilities.fs = fsSetup.provider;
      providedAsyncCapabilities.push(...fsSetup.providedAsyncCapabilities);
    }
    if (options.netAllowedOrigins && options.netAllowedOrigins.length > 0) {
      asyncCapabilities.net = createCliAsyncNetCapability({ allowedOrigins: options.netAllowedOrigins });
      providedAsyncCapabilities.push('net.fetch');
    }
    if (options.llmResponse !== undefined) {
      asyncCapabilities.llm = createCliAsyncLlmCapability({ response: options.llmResponse });
      providedAsyncCapabilities.push('llm.complete');
    }
    if (options.llmProvider !== undefined) {
      asyncCapabilities.llm = createCliAsyncOpenAICompatibleLlmCapability(options.llmProvider);
      providedAsyncCapabilities.push('llm.complete');
    }
    if (canProvideRagIngest) {
      if (!options.sourcePath) {
        throw new Error('rag.ingest requires a source file path.');
      }
      Object.assign(
        asyncRagCapabilities,
        createAsyncLocalRagIngestCapability(source, { sourcePath: options.sourcePath }),
      );
      providedAsyncCapabilities.push('rag.ingest');
    }
    if (canProvideRagRetrieveAsync) {
      if (!options.sourcePath) {
        throw new Error('rag.retrieveAsync requires a source file path.');
      }
      Object.assign(
        asyncRagCapabilities,
        createAsyncLocalRagRetrieveCapability(source, {
          sourcePath: options.sourcePath,
          session: ragSession,
        }),
      );
      providedAsyncCapabilities.push('rag.retrieveAsync');
    }
    if (sourceRequiresRagAnswer) {
      const llm = asyncCapabilities.llm;
      if (llm === undefined) {
        throw new Error('rag.answer requires --llm-response or --llm-provider openai.');
      }
      Object.assign(
        asyncRagCapabilities,
        createCliAsyncRagAnswerCapability({
          llm,
          assertRetrievedChunks(query, chunks) {
            assertLocalRagCapabilityChunksWereRetrieved(query, chunks, ragSession);
          },
        }),
      );
      providedAsyncCapabilities.push('rag.answer');
    }
    if (Object.keys(asyncRagCapabilities).length > 0) asyncCapabilities.rag = asyncRagCapabilities;
  } catch (err) {
    throw new KernRunnerError(
      `kern run --async-preview: capability setup failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return await executeKernSourceAsyncFromRunner(source, {
    parseOptions: NODE_PARSE_CAPS,
    capabilities,
    providedCapabilities: runProvidedCapabilities(),
    asyncCapabilities,
    providedAsyncCapabilities,
    capabilityContext: options.sourcePath ? { sourceName: options.sourcePath } : undefined,
  });
}

interface LoadedRunSource {
  readonly filePath: string;
  readonly source: string;
}

type ParsedRunArgs =
  | { readonly mode: 'execute'; readonly fileArg: string }
  | {
      readonly mode: 'capabilities';
      readonly fileArg: string;
      readonly fsRoot?: string;
      readonly fsWriteRoot?: string;
      readonly netAllowedOrigins: readonly string[];
      readonly llmResponse?: string;
      readonly llmProvider?: ParsedLlmProviderOptions;
    }
  | {
      readonly mode: 'async-preview';
      readonly fileArg: string;
      readonly fsRoot?: string;
      readonly fsWriteRoot?: string;
      readonly netAllowedOrigins: readonly string[];
      readonly llmResponse?: string;
      readonly llmProvider?: ParsedLlmProviderOptions;
    };

interface ParsedLlmProviderOptions {
  readonly provider: 'openai';
  readonly model?: string;
  readonly baseUrl?: string;
}

type RunLlmProviderOptions = CliAsyncOpenAICompatibleLlmCapabilityOptions | ParsedLlmProviderOptions;

interface RunCapabilityRequirementReport {
  readonly id: string;
  readonly namespace: string;
  readonly operation: string;
  readonly status?: string;
  readonly syncBoundary?: string;
  readonly inputShape?: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  readonly sourceLine: number;
  readonly reason?: string;
  readonly containerType?: string;
}

interface RunAsyncProviderHint {
  readonly id: AsyncCapabilityId;
  readonly namespace: string;
  readonly operation: string;
  readonly providerFlags: readonly string[];
  readonly required: boolean;
  readonly provided: boolean;
  readonly missing: boolean;
}

interface RunLlmProviderPolicyReport {
  readonly provider: 'openai';
  readonly configured: boolean;
  readonly apiKeyPresent: boolean;
  readonly apiKeyValid: boolean;
  readonly modelPresent: boolean;
  readonly modelValid: boolean;
  readonly baseUrlPresent: boolean;
  readonly baseUrlValid: boolean;
}

interface RunProviderPolicyBlocker {
  readonly provider: 'openai';
  readonly reason: 'missing-api-key' | 'invalid-api-key' | 'missing-model' | 'invalid-model' | 'invalid-base-url';
}

interface RunCapabilityReport {
  readonly schemaVersion: 1;
  readonly mode: 'kern-run-capabilities';
  readonly file: string;
  readonly hasCapabilityBlockers: boolean;
  readonly capabilityReadinessMode: 'sync' | 'async-preview';
  readonly hasSyncCapabilityBlockers: boolean;
  readonly hasAsyncCapabilityBlockers: boolean;
  readonly providedCapabilities: readonly CapabilityId[];
  readonly providedAsyncCapabilities: readonly AsyncCapabilityId[];
  readonly asyncBoundaryRequired: boolean;
  readonly hasParseErrors: boolean;
  readonly requirements: readonly RunCapabilityRequirementReport[];
  readonly plannedCapabilities: readonly RunCapabilityRequirementReport[];
  readonly asyncPlannedCapabilities: readonly RunCapabilityRequirementReport[];
  readonly missingProviders: readonly RunCapabilityRequirementReport[];
  readonly missingAsyncProviders: readonly RunCapabilityRequirementReport[];
  readonly unsupportedAsyncExecutions: readonly RunCapabilityRequirementReport[];
  readonly unknownCapabilities: readonly RunCapabilityRequirementReport[];
  readonly malformedCapabilities: readonly RunCapabilityRequirementReport[];
  readonly unknownProvidedCapabilities: readonly string[];
  readonly unknownProvidedAsyncCapabilities: readonly string[];
  readonly asyncProviderHints: readonly RunAsyncProviderHint[];
  readonly llmProviderPolicy?: RunLlmProviderPolicyReport;
  readonly providerPolicyBlockers: readonly RunProviderPolicyBlocker[];
  readonly parseDiagnostics: CapabilityAnalysis['parseDiagnostics'];
}

export function analyzeRunCapabilities(
  source: string,
  filePath: string,
  options: {
    fsRoot?: string;
    fsWriteRoot?: string;
    netAllowedOrigins?: readonly string[];
    llmResponse?: string;
    llmProvider?: RunLlmProviderOptions;
  } = {},
): RunCapabilityReport {
  const providedCapabilities = runProvidedCapabilities();
  const requiredCapabilities = sourceCapabilityRequirementIds(source);
  const providedAsyncCapabilities = runProvidedAsyncCapabilities(options, {
    includeRagAnswer: requiredCapabilities.has('rag.answer'),
    includeRagIngest: requiredCapabilities.has('rag.ingest') && sourceRagIngestUsesCliEmbedders(source),
    includeRagRetrieveAsync:
      requiredCapabilities.has('rag.retrieveAsync') && sourceRagRetrieveAsyncUsesCliEmbedders(source),
  });
  const llmProviderPolicy = options.llmProvider ? llmProviderPolicyReport(options.llmProvider) : undefined;
  const providerPolicyBlockers = providerPolicyBlockersForOptions(options, llmProviderPolicy);
  const analysis = analyzeKernSourceCapabilities(source, {
    parseOptions: NODE_PARSE_CAPS,
    providedCapabilities,
    providedAsyncCapabilities,
  });
  const hasSyncCapabilityBlockers =
    analysis.hasParseErrors ||
    analysis.plannedCapabilities.length > 0 ||
    analysis.missingProviders.length > 0 ||
    analysis.unknownCapabilities.length > 0 ||
    analysis.malformedCapabilities.length > 0 ||
    analysis.unknownProvidedCapabilities.length > 0;
  const hasAsyncCapabilityBlockers =
    analysis.hasParseErrors ||
    analysis.missingProviders.length > 0 ||
    analysis.missingAsyncProviders.length > 0 ||
    analysis.unsupportedAsyncExecutions.length > 0 ||
    providerPolicyBlockers.length > 0 ||
    analysis.unknownCapabilities.length > 0 ||
    analysis.malformedCapabilities.length > 0 ||
    analysis.unknownProvidedCapabilities.length > 0 ||
    analysis.unknownProvidedAsyncCapabilities.length > 0;
  const capabilityReadinessMode = providedAsyncCapabilities.length > 0 ? 'async-preview' : 'sync';
  const hasCapabilityBlockers =
    capabilityReadinessMode === 'async-preview' ? hasAsyncCapabilityBlockers : hasSyncCapabilityBlockers;

  return {
    schemaVersion: 1,
    mode: 'kern-run-capabilities',
    file: filePath,
    hasCapabilityBlockers,
    capabilityReadinessMode,
    hasSyncCapabilityBlockers,
    hasAsyncCapabilityBlockers,
    providedCapabilities,
    providedAsyncCapabilities,
    asyncBoundaryRequired: analysis.asyncBoundaryRequired,
    hasParseErrors: analysis.hasParseErrors,
    requirements: analysis.requirements.map(knownRequirementReport),
    plannedCapabilities: analysis.plannedCapabilities.map(knownRequirementReport),
    asyncPlannedCapabilities: analysis.asyncPlannedCapabilities.map(knownRequirementReport),
    missingProviders: analysis.missingProviders.map(knownRequirementReport),
    missingAsyncProviders: analysis.missingAsyncProviders.map(knownRequirementReport),
    unsupportedAsyncExecutions: analysis.unsupportedAsyncExecutions.map(unsupportedAsyncRequirementReport),
    unknownCapabilities: analysis.unknownCapabilities.map(unknownRequirementReport),
    malformedCapabilities: analysis.malformedCapabilities.map(malformedRequirementReport),
    unknownProvidedCapabilities: analysis.unknownProvidedCapabilities,
    unknownProvidedAsyncCapabilities: analysis.unknownProvidedAsyncCapabilities,
    asyncProviderHints: asyncProviderHints(providedAsyncCapabilities, analysis.asyncPlannedCapabilities),
    ...(llmProviderPolicy ? { llmProviderPolicy } : {}),
    providerPolicyBlockers,
    parseDiagnostics: analysis.parseDiagnostics,
  };
}

function createRunCapabilities(source: string, sourcePath: string | undefined, ragSession?: LocalRagCapabilitySession) {
  try {
    return {
      crypto: createWebCryptoCapability({ crypto: cliCryptoSource() }),
      ...(sourcePath
        ? { rag: createLocalRagCapability(source, { sourcePath, ...(ragSession ? { session: ragSession } : {}) }) }
        : {}),
      storage: createMemoryStorageCapability(),
    };
  } catch (err) {
    throw new KernRunnerError(
      `kern run: capability setup failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function cliCryptoSource(): WebCryptoCapabilitySource {
  const candidate =
    (nodeCrypto as { readonly webcrypto?: unknown }).webcrypto ?? (globalThis as { crypto?: unknown }).crypto;
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('host crypto must provide randomUUID and getRandomValues.');
  }
  const crypto = candidate as {
    readonly randomUUID?: unknown;
    readonly getRandomValues?: unknown;
  };
  if (typeof crypto.randomUUID !== 'function' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'host crypto must provide randomUUID and getRandomValues via node:crypto.webcrypto or globalThis.crypto.',
    );
  }
  const randomUUID = crypto.randomUUID as () => string;
  const getRandomValues = crypto.getRandomValues as (array: Uint8Array) => Uint8Array;
  return {
    randomUUID: () => randomUUID.call(crypto),
    getRandomValues(array) {
      getRandomValues.call(crypto, array);
      return array;
    },
  };
}

/** `kern run <file.kern>` — execute the KERN-native `fn main` through the reference runner. */
export async function runRun(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  if (!parsed) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const loaded = loadRunSource(parsed.fileArg);
  if (!loaded) return;

  if (parsed.mode === 'capabilities') {
    try {
      await validateAsyncPreviewProviderFlags({
        fsRoot: parsed.fsRoot,
        fsWriteRoot: parsed.fsWriteRoot,
        netAllowedOrigins: parsed.netAllowedOrigins,
        llmResponse: parsed.llmResponse,
      });
      const report = analyzeRunCapabilities(loaded.source, loaded.filePath, {
        fsRoot: parsed.fsRoot,
        fsWriteRoot: parsed.fsWriteRoot,
        netAllowedOrigins: parsed.netAllowedOrigins,
        llmResponse: parsed.llmResponse,
        ...(parsed.llmProvider ? { llmProvider: parsed.llmProvider } : {}),
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.hasCapabilityBlockers ? 2 : 0;
    } catch (err) {
      if (err instanceof KernRunnerError) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = Number.isInteger(err.exitCode) && err.exitCode > 0 ? err.exitCode : 2;
        return;
      }
      process.stderr.write(
        `kern run --capabilities: unexpected failure (${err instanceof Error ? err.message : String(err)})\n`,
      );
      process.exitCode = 1;
    }
    return;
  }

  try {
    const llmProvider =
      parsed.mode === 'async-preview' && parsed.llmProvider
        ? resolveCliLlmProviderOptions(parsed.llmProvider)
        : undefined;
    const output =
      parsed.mode === 'async-preview'
        ? await executeKernSourceAsync(loaded.source, {
            sourcePath: loaded.filePath,
            fsRoot: parsed.fsRoot,
            fsWriteRoot: parsed.fsWriteRoot,
            netAllowedOrigins: parsed.netAllowedOrigins,
            llmResponse: parsed.llmResponse,
            ...(llmProvider ? { llmProvider } : {}),
          })
        : executeKernSource(loaded.source, { sourcePath: loaded.filePath });
    // `process.exitCode` + a return (instead of `process.exit()`) lets Node flush
    // stdout/stderr naturally before exiting — no truncation on a pipe.
    if (output) process.stdout.write(output);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof KernRunnerError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = Number.isInteger(err.exitCode) && err.exitCode > 0 ? err.exitCode : 2;
      return;
    }
    process.stderr.write(`kern run: unexpected failure (${err instanceof Error ? err.message : String(err)})\n`);
    process.exitCode = 1;
  }
}

function parseRunArgs(args: readonly string[]): ParsedRunArgs | undefined {
  const rest = args.slice(1);
  let capabilityReportMode = false;
  let asyncPreviewMode = false;
  let fsRoot: string | undefined;
  let fsWriteRoot: string | undefined;
  const netAllowedOrigins: string[] = [];
  let llmResponse: string | undefined;
  let llmProvider: ParsedLlmProviderOptions | undefined;
  let llmModel: string | undefined;
  let llmBaseUrl: string | undefined;
  const files: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--capabilities') {
      if (capabilityReportMode) return undefined;
      capabilityReportMode = true;
      continue;
    }
    if (arg === '--async-preview') {
      if (asyncPreviewMode) return undefined;
      asyncPreviewMode = true;
      continue;
    }
    if (arg === '--fs-root' || arg === '--fs-write-root') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) return undefined;
      if (arg === '--fs-root') {
        if (fsRoot !== undefined) return undefined;
        fsRoot = value;
      } else {
        if (fsWriteRoot !== undefined) return undefined;
        fsWriteRoot = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--allow-net') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) return undefined;
      netAllowedOrigins.push(value);
      index += 1;
      continue;
    }
    if (arg === '--llm-response') {
      const value = rest[index + 1];
      if (value === undefined) return undefined;
      if (llmResponse !== undefined) return undefined;
      llmResponse = value;
      index += 1;
      continue;
    }
    if (arg === '--llm-provider') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) return undefined;
      if (value !== 'openai') return undefined;
      if (llmProvider !== undefined) return undefined;
      llmProvider = { provider: 'openai' };
      index += 1;
      continue;
    }
    if (arg === '--llm-model' || arg === '--llm-base-url') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) return undefined;
      if (arg === '--llm-model') {
        if (llmModel !== undefined) return undefined;
        llmModel = value;
      } else {
        if (llmBaseUrl !== undefined) return undefined;
        llmBaseUrl = value;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) return undefined;
    files.push(arg);
  }

  const fileArg = files[0];
  if (files.length !== 1 || !fileArg || (capabilityReportMode && asyncPreviewMode)) return undefined;
  if (llmResponse !== undefined && llmProvider !== undefined) return undefined;
  if ((llmModel !== undefined || llmBaseUrl !== undefined) && llmProvider === undefined) return undefined;
  const resolvedLlmProvider =
    llmProvider !== undefined
      ? {
          provider: llmProvider.provider,
          ...(llmModel !== undefined ? { model: llmModel } : {}),
          ...(llmBaseUrl !== undefined ? { baseUrl: llmBaseUrl } : {}),
        }
      : undefined;
  if (
    !asyncPreviewMode &&
    !capabilityReportMode &&
    (fsRoot !== undefined ||
      fsWriteRoot !== undefined ||
      netAllowedOrigins.length > 0 ||
      llmResponse !== undefined ||
      resolvedLlmProvider !== undefined)
  ) {
    return undefined;
  }
  if (fsWriteRoot && !fsRoot) return undefined;
  if (capabilityReportMode) {
    return {
      mode: 'capabilities',
      fileArg,
      netAllowedOrigins,
      ...(fsRoot ? { fsRoot } : {}),
      ...(fsWriteRoot ? { fsWriteRoot } : {}),
      ...(llmResponse !== undefined ? { llmResponse } : {}),
      ...(resolvedLlmProvider !== undefined ? { llmProvider: resolvedLlmProvider } : {}),
    };
  }
  if (asyncPreviewMode) {
    return {
      mode: 'async-preview',
      fileArg,
      netAllowedOrigins,
      ...(fsRoot ? { fsRoot } : {}),
      ...(fsWriteRoot ? { fsWriteRoot } : {}),
      ...(llmResponse !== undefined ? { llmResponse } : {}),
      ...(resolvedLlmProvider !== undefined ? { llmProvider: resolvedLlmProvider } : {}),
    };
  }
  return { mode: 'execute', fileArg };
}

function loadRunSource(fileArg: string): LoadedRunSource | undefined {
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    process.stderr.write(`kern run: cannot read file '${fileArg}'\n`);
    process.exitCode = 2;
    return undefined;
  }

  try {
    return { filePath, source: readFileSync(filePath, 'utf-8') };
  } catch (err) {
    process.stderr.write(`kern run: cannot read file '${fileArg}': ${(err as Error).message}\n`);
    process.exitCode = 2;
    return undefined;
  }
}

function runProvidedCapabilities(): readonly CapabilityId[] {
  const namespaces = new Set<string>(RUN_PROVIDED_CAPABILITY_NAMESPACES);
  return Object.values(CAPABILITY_DESCRIPTORS)
    .filter((descriptor) => descriptor.status === 'shipped' && namespaces.has(descriptor.namespace))
    .map((descriptor) => descriptor.id);
}

function runProvidedAsyncCapabilities(
  options: {
    fsRoot?: string;
    fsWriteRoot?: string;
    netAllowedOrigins?: readonly string[];
    llmResponse?: string;
    llmProvider?: RunLlmProviderOptions;
  },
  providerOptions: {
    readonly includeRagAnswer?: boolean;
    readonly includeRagIngest?: boolean;
    readonly includeRagRetrieveAsync?: boolean;
  } = {},
): readonly AsyncCapabilityId[] {
  const provided: AsyncCapabilityId[] = [];
  if (options.fsRoot) {
    provided.push('fs.list', 'fs.readText');
    if (options.fsWriteRoot) provided.push('fs.writeText');
  }
  if (options.netAllowedOrigins && options.netAllowedOrigins.length > 0) provided.push('net.fetch');
  if (options.llmResponse !== undefined || options.llmProvider !== undefined) {
    provided.push('llm.complete');
    if (providerOptions.includeRagAnswer === true) provided.push('rag.answer');
  }
  if (providerOptions.includeRagIngest === true) provided.push('rag.ingest');
  if (providerOptions.includeRagRetrieveAsync === true) provided.push('rag.retrieveAsync');
  return provided;
}

function llmProviderPolicyReport(options: RunLlmProviderOptions): RunLlmProviderPolicyReport {
  const apiKey = normalizedProviderText(
    'apiKey' in options && options.apiKey !== undefined ? options.apiKey : process.env.KERN_LLM_API_KEY,
  );
  const model = normalizedProviderText(options.model ?? process.env.KERN_LLM_MODEL);
  const baseUrl = normalizedProviderText(options.baseUrl ?? process.env.KERN_LLM_BASE_URL);
  const apiKeyPresent = apiKey !== undefined;
  const apiKeyValid = apiKey === undefined || !providerTextHasLineBreak(apiKey);
  const modelPresent = model !== undefined;
  const modelValid = model === undefined || !providerTextHasLineBreak(model);
  const baseUrlPresent = baseUrl !== undefined;
  const baseUrlValid = baseUrl === undefined || isValidOpenAICompatibleBaseUrl(baseUrl);
  return {
    provider: 'openai',
    configured: apiKeyPresent && apiKeyValid && modelPresent && modelValid && baseUrlValid,
    apiKeyPresent,
    apiKeyValid,
    modelPresent,
    modelValid,
    baseUrlPresent,
    baseUrlValid,
  };
}

function providerPolicyBlockersForOptions(
  options: { readonly llmResponse?: string },
  llmProviderPolicy: RunLlmProviderPolicyReport | undefined,
): readonly RunProviderPolicyBlocker[] {
  if (!llmProviderPolicy) return [];
  if (options.llmResponse !== undefined) return [];
  const blockers: RunProviderPolicyBlocker[] = [];
  if (!llmProviderPolicy.apiKeyPresent) blockers.push({ provider: 'openai', reason: 'missing-api-key' });
  if (llmProviderPolicy.apiKeyPresent && !llmProviderPolicy.apiKeyValid) {
    blockers.push({ provider: 'openai', reason: 'invalid-api-key' });
  }
  if (!llmProviderPolicy.modelPresent) blockers.push({ provider: 'openai', reason: 'missing-model' });
  if (llmProviderPolicy.modelPresent && !llmProviderPolicy.modelValid) {
    blockers.push({ provider: 'openai', reason: 'invalid-model' });
  }
  if (!llmProviderPolicy.baseUrlValid) blockers.push({ provider: 'openai', reason: 'invalid-base-url' });
  return blockers;
}

function isValidOpenAICompatibleBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.search !== '' || url.hash !== '') return false;
  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  return url.protocol === 'https:' || isLocalHttp;
}

function normalizedProviderText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function providerTextHasLineBreak(value: string): boolean {
  return /[\r\n]/u.test(value);
}

async function validateAsyncPreviewProviderFlags(options: {
  fsRoot?: string;
  fsWriteRoot?: string;
  netAllowedOrigins?: readonly string[];
  llmResponse?: string;
  llmProvider?: CliAsyncOpenAICompatibleLlmCapabilityOptions;
}): Promise<void> {
  try {
    if (options.fsRoot) {
      await createCliAsyncFsCapability(
        options.fsWriteRoot === undefined
          ? { readRoot: options.fsRoot }
          : { readRoot: options.fsRoot, writeRoot: options.fsWriteRoot },
      );
    }
    if (options.netAllowedOrigins && options.netAllowedOrigins.length > 0) {
      createCliAsyncNetCapability({ allowedOrigins: options.netAllowedOrigins });
    }
    if (options.llmResponse !== undefined) {
      createCliAsyncLlmCapability({ response: options.llmResponse });
    }
    if (options.llmProvider !== undefined) {
      createCliAsyncOpenAICompatibleLlmCapability(options.llmProvider);
    }
  } catch (err) {
    throw new KernRunnerError(
      `kern run --capabilities: capability setup failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function sourceCapabilityRequirementIds(source: string): ReadonlySet<CapabilityId> {
  return new Set(
    analyzeKernSourceCapabilities(source, { parseOptions: NODE_PARSE_CAPS }).requirements.map(
      (requirement) => requirement.id,
    ),
  );
}

function sourceRagIngestUsesCliEmbedders(source: string): boolean {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return false;
  if (validateRagSemantics(root).length > 0) return false;
  const facts = collectRagSemanticFacts(root);
  const storesByName = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const corporaByName = new Map(facts.corpora.map((corpus) => [corpus.name, corpus]));
  const localPersistentIndexes = facts.indexes.filter(
    (index) => (storesByName.get(index.storeName)?.kind ?? 'memory') === 'local-persistent',
  );
  if (localPersistentIndexes.length === 0) return false;
  return localPersistentIndexes.every((index) => {
    const corpus = corporaByName.get(index.corpusName);
    if (!corpus) return false;
    const embed = index.embedName ? corpus.embeds.find((candidate) => candidate.name === index.embedName) : undefined;
    if (index.embedName && !embed) return false;
    let model: ReturnType<typeof canonicalRagEmbedModel>;
    try {
      model = canonicalRagEmbedModel(embed?.model);
    } catch {
      return false;
    }
    return (
      model === RAG_EMBED_MODEL_LOCAL_HASH ||
      model === RAG_EMBED_MODEL_LOCAL_SEMANTIC ||
      model === RAG_EMBED_MODEL_FAKE_DETERMINISTIC
    );
  });
}

function sourceRagRetrieveAsyncUsesCliEmbedders(source: string): boolean {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return false;
  if (validateRagSemantics(root).length > 0) return false;
  const facts = collectRagSemanticFacts(root);
  const requestedNames = requestedRagRetrieveAsyncNames(root);
  const runtimeRetrievals =
    requestedNames === undefined
      ? facts.runtimeRetrievals
      : facts.runtimeRetrievals.filter((retrieval) => requestedNames.has(retrieval.name));
  if (runtimeRetrievals.length === 0) return false;
  const indexesByName = new Map(facts.indexes.map((index) => [index.name, index]));
  const storesByName = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const corporaByName = new Map(facts.corpora.map((corpus) => [corpus.name, corpus]));
  return runtimeRetrievals.every((retrieval) => {
    if (retrieval.indexNames.length === 0) return false;
    return retrieval.indexNames.every((indexName) => {
      const index = indexesByName.get(indexName);
      if (!index) return false;
      const storeKind = storesByName.get(index.storeName)?.kind ?? 'memory';
      if (storeKind !== 'memory' && storeKind !== 'local-persistent') return false;
      return ragIndexUsesCliEmbedder(index, corporaByName);
    });
  });
}

function requestedRagRetrieveAsyncNames(root: IRNode): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  let hasUnnamedRetrieveAsync = false;
  for (const node of walkRunIrNodes(root)) {
    if (node.type !== 'capability') continue;
    if (node.props?.namespace !== 'rag' || node.props?.operation !== 'retrieveAsync') continue;
    const input = node.props.input;
    if (typeof input !== 'string') {
      hasUnnamedRetrieveAsync = true;
      continue;
    }
    try {
      const parsed = parseExpression(input);
      if (parsed.kind !== 'objectLit') {
        hasUnnamedRetrieveAsync = true;
        continue;
      }
      const name = stringLiteralRecordField(parsed, 'retrieval') ?? stringLiteralRecordField(parsed, 'retrievalName');
      if (name) names.add(name);
      else hasUnnamedRetrieveAsync = true;
    } catch {
      hasUnnamedRetrieveAsync = true;
    }
  }
  return hasUnnamedRetrieveAsync || names.size === 0 ? undefined : names;
}

function stringLiteralRecordField(node: ReturnType<typeof parseExpression>, key: string): string | undefined {
  if (node.kind !== 'objectLit') return undefined;
  for (const entry of node.entries) {
    if ('kind' in entry || entry.key !== key) continue;
    if (entry.value.kind !== 'strLit') return undefined;
    const value = entry.value.value.trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

function* walkRunIrNodes(root: IRNode): Generator<IRNode> {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    yield node;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

function ragIndexUsesCliEmbedder(
  index: { readonly corpusName: string; readonly embedName?: string },
  corporaByName: ReadonlyMap<
    string,
    { readonly embeds: readonly { readonly name: string; readonly model?: string }[] }
  >,
): boolean {
  const corpus = corporaByName.get(index.corpusName);
  if (!corpus) return false;
  const embed = index.embedName ? corpus.embeds.find((candidate) => candidate.name === index.embedName) : undefined;
  if (index.embedName && !embed) return false;
  let model: ReturnType<typeof canonicalRagEmbedModel>;
  try {
    model = canonicalRagEmbedModel(embed?.model);
  } catch {
    return false;
  }
  return (
    model === RAG_EMBED_MODEL_LOCAL_HASH ||
    model === RAG_EMBED_MODEL_LOCAL_SEMANTIC ||
    model === RAG_EMBED_MODEL_FAKE_DETERMINISTIC
  );
}

function resolveCliLlmProviderOptions(options: ParsedLlmProviderOptions): CliAsyncOpenAICompatibleLlmCapabilityOptions {
  if (options.provider !== 'openai') {
    throw new KernRunnerError('kern run: unsupported llm provider.');
  }
  const apiKey = normalizedProviderText(process.env.KERN_LLM_API_KEY);
  if (apiKey === undefined) {
    throw new KernRunnerError('kern run: --llm-provider openai requires KERN_LLM_API_KEY.');
  }
  if (providerTextHasLineBreak(apiKey)) {
    throw new KernRunnerError('kern run: --llm-provider openai KERN_LLM_API_KEY must not contain line breaks.');
  }
  const model = normalizedProviderText(options.model ?? process.env.KERN_LLM_MODEL);
  if (model === undefined) {
    throw new KernRunnerError('kern run: --llm-provider openai requires --llm-model <model> or KERN_LLM_MODEL.');
  }
  if (providerTextHasLineBreak(model)) {
    throw new KernRunnerError('kern run: --llm-provider openai model must not contain line breaks.');
  }
  const baseUrl = normalizedProviderText(options.baseUrl ?? process.env.KERN_LLM_BASE_URL);
  if (baseUrl !== undefined && !isValidOpenAICompatibleBaseUrl(baseUrl)) {
    throw new KernRunnerError(
      'kern run: --llm-provider openai base URL must be https: unless it targets localhost, and must not include credentials, query, or hash.',
    );
  }
  return {
    apiKey,
    model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
}

function asyncProviderHints(
  providedAsyncCapabilities: readonly AsyncCapabilityId[],
  requirements: readonly CapabilityRequirement[],
): readonly RunAsyncProviderHint[] {
  const provided = new Set<string>(providedAsyncCapabilities);
  const required = new Set<string>(requirements.map((requirement) => requirement.id));
  return Object.values(CAPABILITY_DESCRIPTORS)
    .map((descriptor): RunAsyncProviderHint | undefined => {
      if (descriptor.syncBoundary !== 'async-planned') return undefined;
      const providerFlags = asyncProviderFlags(descriptor.id);
      if (!providerFlags || providerFlags.length === 0) return undefined;
      return {
        id: descriptor.id as AsyncCapabilityId,
        namespace: descriptor.namespace,
        operation: descriptor.operation,
        providerFlags,
        required: required.has(descriptor.id),
        provided: provided.has(descriptor.id),
        missing: required.has(descriptor.id) && !provided.has(descriptor.id),
      };
    })
    .filter((hint): hint is RunAsyncProviderHint => hint !== undefined);
}

function asyncProviderFlags(id: string): readonly string[] | undefined {
  return Object.hasOwn(RUN_ASYNC_PROVIDER_FLAGS, id) ? RUN_ASYNC_PROVIDER_FLAGS[id as AsyncCapabilityId] : undefined;
}

function knownRequirementReport(requirement: CapabilityRequirement): RunCapabilityRequirementReport {
  return {
    id: requirement.id,
    namespace: requirement.namespace,
    operation: requirement.operation,
    status: requirement.descriptor.status,
    syncBoundary: requirement.descriptor.syncBoundary,
    inputShape: requirement.descriptor.inputShape,
    ...(requirement.bindingName ? { bindingName: requirement.bindingName } : {}),
    ...(requirement.literalInput ? { literalInput: requirement.literalInput } : {}),
    sourceLine: requirement.sourceLine,
  };
}

function unsupportedAsyncRequirementReport(
  requirement: UnsupportedAsyncCapabilityRequirement,
): RunCapabilityRequirementReport {
  return {
    ...knownRequirementReport(requirement),
    reason: requirement.reason,
    ...(requirement.containerType ? { containerType: requirement.containerType } : {}),
  };
}

function unknownRequirementReport(requirement: UnknownCapabilityRequirement): RunCapabilityRequirementReport {
  return {
    id: requirement.id,
    namespace: requirement.namespace,
    operation: requirement.operation,
    ...(requirement.bindingName ? { bindingName: requirement.bindingName } : {}),
    ...(requirement.literalInput ? { literalInput: requirement.literalInput } : {}),
    sourceLine: requirement.sourceLine,
  };
}

function malformedRequirementReport(requirement: MalformedCapabilityRequirement): RunCapabilityRequirementReport {
  const id = [requirement.namespace, requirement.operation].filter(Boolean).join('.');
  return {
    id,
    namespace: requirement.namespace ?? '',
    operation: requirement.operation ?? '',
    ...(requirement.bindingName ? { bindingName: requirement.bindingName } : {}),
    ...(requirement.literalInput ? { literalInput: requirement.literalInput } : {}),
    sourceLine: requirement.sourceLine,
    reason: requirement.reason,
  };
}
