import { type RetrievedChunk, synthesizeRagAnswer } from '@kernlang/core';
import type {
  AsyncRuntimeCapabilityProvider,
  KernRunnerCapabilityContext,
  RuntimeCapabilityValue,
} from '@kernlang/core/runner';
import { assertRuntimeCapabilityValue, invokeRunnerCapabilityAsync } from '@kernlang/core/runner';

export interface CliAsyncNetCapabilityOptions {
  readonly allowedOrigins: readonly string[];
  readonly fetch?: typeof fetch;
}

const NET_FETCH_TIMEOUT_MS = 10_000;
const NET_FETCH_MAX_REQUEST_BYTES = 1_000_000;
const NET_FETCH_MAX_RESPONSE_BYTES = 1_000_000;
const LLM_COMPLETE_TIMEOUT_MS = 30_000;
const LLM_COMPLETE_MAX_PROMPT_BYTES = 200_000;
const LLM_COMPLETE_MAX_RESPONSE_BYTES = 1_000_000;
const LLM_COMPLETE_MAX_TEXT_BYTES = 200_000;
const MAX_RAG_ANSWER_CHUNKS = 1000;
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

interface ByteStreamReader {
  read(): Promise<{ done?: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
  releaseLock(): void;
}

interface TimeoutSignal {
  readonly signal: AbortSignal;
  cancel(): void;
}

export function createCliAsyncNetCapability(options: CliAsyncNetCapabilityOptions): AsyncRuntimeCapabilityProvider {
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const hostFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof hostFetch !== 'function') {
    throw new Error('host fetch is unavailable.');
  }

  return {
    async fetch(call) {
      const input = recordInput(call.input, 'net.fetch');
      assertOnlyFields(input, ['url', 'method', 'body'], 'net.fetch');
      const urlText = nonEmptyStringField(input, 'url', 'net.fetch url');
      const url = parseAbsoluteUrl(urlText, 'net.fetch url');
      assertAllowedUrl(url, allowedOrigins);
      const method = optionalStringField(input, 'method') ?? 'GET';
      if (method !== 'GET' && method !== 'POST') {
        throw new Error('net.fetch method must be GET or POST in CLI async preview.');
      }
      const hasBody = Object.hasOwn(input, 'body');
      if (method === 'GET' && hasBody) {
        throw new Error('net.fetch GET requests cannot carry a body in CLI async preview.');
      }
      const requestBody = hasBody ? stringField(input, 'body', 'net.fetch body') : undefined;
      if (requestBody !== undefined && new TextEncoder().encode(requestBody).byteLength > NET_FETCH_MAX_REQUEST_BYTES) {
        throw new Error(`net.fetch request body exceeds ${NET_FETCH_MAX_REQUEST_BYTES} bytes in CLI async preview.`);
      }
      const timeout = timeoutSignal(NET_FETCH_TIMEOUT_MS);
      try {
        const response = await hostFetch(url, {
          method,
          redirect: 'error',
          signal: timeout.signal,
          ...(requestBody !== undefined ? { body: requestBody } : {}),
        });
        const responseBody = await readResponseText(response, NET_FETCH_MAX_RESPONSE_BYTES, 'net.fetch');
        return {
          body: responseBody,
          ok: response.ok,
          status: response.status,
          url: response.url,
        };
      } finally {
        timeout.cancel();
      }
    },
  };
}

function timeoutSignal(ms: number): TimeoutSignal {
  const timeout = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (typeof timeout === 'function') return { signal: timeout(ms), cancel() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    },
  };
}

function normalizeAllowedOrigins(rawOrigins: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of rawOrigins) {
    if (raw === 'data:') {
      out.add(raw);
      continue;
    }
    const url = parseAbsoluteUrl(raw, '--allow-net origin');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('--allow-net origin must be http:, https:, or data:.');
    }
    if (url.username !== '' || url.password !== '') {
      throw new Error('--allow-net origin must not include credentials.');
    }
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new Error('--allow-net must be an origin without a path, query, or hash.');
    }
    out.add(url.origin);
  }
  return out;
}

export interface CliAsyncLlmCapabilityOptions {
  readonly response: string;
}

export function createCliAsyncLlmCapability(options: CliAsyncLlmCapabilityOptions): AsyncRuntimeCapabilityProvider {
  if (typeof options.response !== 'string') {
    throw new Error('llm.complete preview response must be a string.');
  }
  return {
    async complete(call) {
      const input = recordInput(call.input, 'llm.complete');
      assertOnlyFields(input, ['prompt'], 'llm.complete');
      nonEmptyStringField(input, 'prompt', 'llm.complete prompt');
      return options.response;
    },
  };
}

export interface CliAsyncOpenAICompatibleLlmCapabilityOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface CliAsyncRagAnswerCapabilityOptions {
  readonly llm: AsyncRuntimeCapabilityProvider;
  readonly assertRetrievedChunks?: (query: string, chunks: readonly RetrievedChunk[]) => void;
}

export function createCliAsyncOpenAICompatibleLlmCapability(
  options: CliAsyncOpenAICompatibleLlmCapabilityOptions,
): AsyncRuntimeCapabilityProvider {
  const apiKey = nonEmptyRawString(options.apiKey, 'llm.complete provider API key');
  const model = nonEmptyRawString(options.model, 'llm.complete provider model');
  const baseUrl = parseOpenAICompatibleBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL);
  const endpoint = openAICompatibleChatCompletionsUrl(baseUrl);
  const hostFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof hostFetch !== 'function') {
    throw new Error('host fetch is unavailable.');
  }

  return {
    async complete(call) {
      const input = recordInput(call.input, 'llm.complete');
      assertOnlyFields(input, ['prompt'], 'llm.complete');
      const prompt = nonEmptyStringField(input, 'prompt', 'llm.complete prompt');
      if (new TextEncoder().encode(prompt).byteLength > LLM_COMPLETE_MAX_PROMPT_BYTES) {
        throw new Error(`llm.complete prompt exceeds ${LLM_COMPLETE_MAX_PROMPT_BYTES} bytes in CLI async preview.`);
      }
      const timeout = timeoutSignal(LLM_COMPLETE_TIMEOUT_MS);
      try {
        const response = await hostFetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: timeout.signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
          }),
        });
        const responseBody = await readResponseText(response, LLM_COMPLETE_MAX_RESPONSE_BYTES, 'llm.complete');
        if (!response.ok) {
          throw new Error(
            `llm.complete provider request failed with status ${response.status}: ${truncateForDiagnostic(
              redactSecret(responseBody, apiKey),
            )}`,
          );
        }
        return openAICompatibleCompletionText(responseBody, apiKey);
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(redactSecret(error.message, apiKey));
        }
        throw error;
      } finally {
        timeout.cancel();
      }
    },
  };
}

export function createCliAsyncRagAnswerCapability(
  options: CliAsyncRagAnswerCapabilityOptions,
): AsyncRuntimeCapabilityProvider {
  if (
    typeof options.llm !== 'function' &&
    !(options.llm && typeof options.llm === 'object' && typeof options.llm.complete === 'function')
  ) {
    throw new Error('rag.answer requires a llm.complete async provider with a complete method.');
  }
  return {
    async answer(call, context) {
      const input = recordInput(call.input, 'rag.answer');
      assertOnlyFields(
        input,
        ['query', 'chunks', 'prompt', 'maxContextChars', 'requireCitations', 'minCitedChunks', 'minGroundingCoverage'],
        'rag.answer',
      );
      const query = nonEmptyStringField(input, 'query', 'rag.answer query');
      const chunks = ragAnswerChunks(input);
      options.assertRetrievedChunks?.(query, chunks);
      const prompt = optionalNonEmptyStringField(input, 'prompt', 'rag.answer prompt');
      const maxContextChars = optionalPositiveIntegerField(input, 'maxContextChars', 'rag.answer maxContextChars');
      const requireCitations = optionalBooleanField(input, 'requireCitations', 'rag.answer requireCitations');
      const minCitedChunks = optionalNonNegativeIntegerField(input, 'minCitedChunks', 'rag.answer minCitedChunks');
      const minGroundingCoverage = optionalRatioField(input, 'minGroundingCoverage', 'rag.answer minGroundingCoverage');
      const result = await synthesizeCliRagAnswer({
        llm: options.llm,
        context,
        query,
        chunks,
        prompt,
        maxContextChars,
        requireCitations,
        minCitedChunks,
        minGroundingCoverage,
      });
      if (!result.passed) {
        throw new Error(
          `RAG answer synthesis failed: ${result.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join('; ')}`,
        );
      }
      return assertRuntimeCapabilityValue(
        {
          answer: result.answer,
          passed: result.passed,
          status: result.status,
          groundingCoverage: result.groundingCoverage,
          citedChunkIds: result.citedChunkIds,
          sources: result.sources,
        },
        'rag.answer result',
      );
    },
  };
}

async function synthesizeCliRagAnswer(options: {
  readonly llm: AsyncRuntimeCapabilityProvider;
  readonly context: KernRunnerCapabilityContext;
  readonly query: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly prompt?: string;
  readonly maxContextChars?: number;
  readonly requireCitations?: boolean;
  readonly minCitedChunks?: number;
  readonly minGroundingCoverage?: number;
}) {
  try {
    return await synthesizeRagAnswer({
      query: options.query,
      chunks: options.chunks,
      complete: async (llmPrompt) => {
        const text = await invokeRunnerCapabilityAsync(
          { llm: options.llm },
          { namespace: 'llm', operation: 'complete', input: { prompt: llmPrompt } },
          options.context,
        );
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('rag.answer llm.complete result must be a non-empty string.');
        }
        return text;
      },
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
      ...(options.maxContextChars !== undefined ? { maxContextChars: options.maxContextChars } : {}),
      ...(options.requireCitations !== undefined ? { requireCitations: options.requireCitations } : {}),
      ...(options.minCitedChunks !== undefined ? { minCitedChunks: options.minCitedChunks } : {}),
      ...(options.minGroundingCoverage !== undefined ? { minGroundingCoverage: options.minGroundingCoverage } : {}),
    });
  } catch (error) {
    throw new Error(`RAG answer synthesis failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function assertAllowedUrl(url: URL, allowedOrigins: ReadonlySet<string>): void {
  if (url.protocol !== 'data:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('net.fetch url protocol must be http:, https:, or data: in CLI async preview.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('net.fetch url must not include credentials in CLI async preview.');
  }
  const id = url.protocol === 'data:' ? 'data:' : url.origin;
  if (!allowedOrigins.has(id)) {
    throw new Error(`net.fetch url origin '${id}' is not allowed in CLI async preview.`);
  }
}

function parseAbsoluteUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

async function readResponseText(response: Response, maxBytes: number, label: string): Promise<string> {
  const body = response.body as {
    getReader?: () => ByteStreamReader;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | ArrayBuffer | string>;
  } | null;
  if (!body) return '';
  if (typeof body.getReader !== 'function') return await readAsyncIterableResponseText(body, maxBytes, label);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value ?? new Uint8Array();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} response body exceeds ${maxBytes} bytes in CLI async preview.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Preserve the primary fetch/body error if the stream implementation is strict.
    }
  }
}

async function readAsyncIterableResponseText(
  body: { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | ArrayBuffer | string> },
  maxBytes: number,
  label: string,
): Promise<string> {
  if (typeof body[Symbol.asyncIterator] !== 'function') {
    throw new Error(`${label} response body stream is not readable in CLI async preview.`);
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for await (const chunk of body as AsyncIterable<Uint8Array | ArrayBuffer | string>) {
    const value = chunkToBytes(chunk);
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      throw new Error(`${label} response body exceeds ${maxBytes} bytes in CLI async preview.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function chunkToBytes(chunk: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  return new Uint8Array(chunk);
}

function parseOpenAICompatibleBaseUrl(value: string): URL {
  const url = parseAbsoluteUrl(value, 'llm.complete provider base URL');
  if (url.username !== '' || url.password !== '') {
    throw new Error('llm.complete provider base URL must not include credentials.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('llm.complete provider base URL must not include query or hash.');
  }
  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('llm.complete provider base URL must be https: unless it targets localhost.');
  }
  return url;
}

function openAICompatibleChatCompletionsUrl(baseUrl: URL): URL {
  const endpoint = new URL(baseUrl.href);
  const pathname = endpoint.pathname.replace(/\/+$/u, '');
  endpoint.pathname = `${pathname}/chat/completions`;
  return endpoint;
}

function openAICompatibleCompletionText(responseBody: string, apiKey: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    throw new Error(
      `llm.complete provider response was not valid JSON: ${truncateForDiagnostic(redactSecret(responseBody, apiKey))}`,
    );
  }
  const content = openAICompatibleContent(parsed);
  if (content === undefined) {
    throw new Error('llm.complete provider response must contain choices[0].message.content as a string.');
  }
  if (new TextEncoder().encode(content).byteLength > LLM_COMPLETE_MAX_TEXT_BYTES) {
    throw new Error(
      `llm.complete provider completion exceeds ${LLM_COMPLETE_MAX_TEXT_BYTES} bytes in CLI async preview.`,
    );
  }
  return content;
}

function openAICompatibleContent(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (first === null || typeof first !== 'object') return undefined;
  const message = (first as { message?: unknown }).message;
  if (message === null || typeof message !== 'object') return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

function nonEmptyRawString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (/[\r\n]/u.test(value)) {
    throw new Error(`${label} must not contain line breaks.`);
  }
  return value;
}

function redactSecret(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');
}

function truncateForDiagnostic(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function recordInput(
  input: RuntimeCapabilityValue | undefined,
  label: string,
): Readonly<Record<string, RuntimeCapabilityValue>> {
  if (!isRecordInput(input)) {
    throw new Error(`${label} input must be a record.`);
  }
  return input;
}

function assertOnlyFields(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  allowedFields: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} input field '${key}' is not supported in CLI async preview.`);
    }
  }
}

function isRecordInput(
  input: RuntimeCapabilityValue | undefined,
): input is Readonly<Record<string, RuntimeCapabilityValue>> {
  return input !== undefined && input !== null && typeof input === 'object' && !Array.isArray(input);
}

function stringField(input: Readonly<Record<string, RuntimeCapabilityValue>>, field: string, label: string): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function nonEmptyStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): string {
  const value = stringField(input, field, label);
  if (value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
): string | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`net.fetch ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalNonEmptyStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): string | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalBooleanField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): boolean | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function optionalPositiveIntegerField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): number | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function optionalNonNegativeIntegerField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): number | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function optionalRatioField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): number | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }
  return value;
}

function ragAnswerChunks(input: Readonly<Record<string, RuntimeCapabilityValue>>): readonly RetrievedChunk[] {
  const value = input.chunks;
  if (!Array.isArray(value)) {
    throw new Error("rag.answer input field 'chunks' must be an array.");
  }
  if (value.length > MAX_RAG_ANSWER_CHUNKS) {
    throw new Error(`rag.answer input field 'chunks' must contain at most ${MAX_RAG_ANSWER_CHUNKS} chunks.`);
  }
  return value.map((chunk, index) => ragAnswerChunk(chunk, index));
}

function ragAnswerChunk(value: RuntimeCapabilityValue, index: number): RetrievedChunk {
  if (!isRecordInput(value)) {
    throw new Error(`rag.answer input field 'chunks[${index}]' must be a record.`);
  }
  const id = nonEmptyStringField(value, 'id', `rag.answer chunks[${index}].id`);
  const text = nonEmptyStringField(value, 'text', `rag.answer chunks[${index}].text`);
  const source = nonEmptyStringField(value, 'source', `rag.answer chunks[${index}].source`);
  const scoreValue = value.score;
  if (typeof scoreValue !== 'number' || !Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 1) {
    throw new Error(`rag.answer chunks[${index}].score must be a number between 0 and 1.`);
  }
  return {
    id,
    text,
    score: scoreValue,
    source,
    citation: ragAnswerCitation(value, index),
    ...ragAnswerMetadata(value, index),
  };
}

function ragAnswerCitation(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  chunkIndex: number,
): RetrievedChunk['citation'] {
  const nested = input.citation;
  if (nested !== undefined && nested !== null && !isRecordInput(nested)) {
    throw new Error(`rag.answer input field 'chunks[${chunkIndex}].citation' must be a record.`);
  }
  const nestedCitation = isRecordInput(nested) ? nested : {};
  const nestedUri = optionalNullablePortableString(
    nestedCitation,
    'uri',
    `rag.answer chunks[${chunkIndex}].citation.uri`,
  );
  const nestedLocator = optionalNullablePortableString(
    nestedCitation,
    'locator',
    `rag.answer chunks[${chunkIndex}].citation.locator`,
  );
  const flatUri = optionalNullablePortableString(input, 'citationUri', `rag.answer chunks[${chunkIndex}].citationUri`);
  const flatLocator = optionalNullablePortableString(
    input,
    'citationLocator',
    `rag.answer chunks[${chunkIndex}].citationLocator`,
  );
  const uri = nestedUri ?? flatUri;
  const locator = nestedLocator ?? flatLocator;
  return {
    ...(uri !== undefined ? { uri } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

function optionalNullablePortableString(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): string | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null.`);
  }
  return value;
}

function ragAnswerMetadata(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  chunkIndex: number,
): { readonly metadata?: Record<string, RuntimeCapabilityValue> } {
  const metadata = input.metadata;
  if (metadata === undefined || metadata === null) return {};
  if (!isRecordInput(metadata)) {
    throw new Error(`rag.answer input field 'chunks[${chunkIndex}].metadata' must be a record.`);
  }
  return { metadata: cloneMetadata(metadata) };
}

function cloneMetadata(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
): Record<string, RuntimeCapabilityValue> {
  const out: Record<string, RuntimeCapabilityValue> = {};
  for (const [key, value] of Object.entries(input)) out[key] = value;
  return out;
}
