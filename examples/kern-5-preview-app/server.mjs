import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeKernAppEntryPolicySlot,
  findMissingKernAppEntryCapability,
  loadKernAppDescriptor,
} from '../../packages/core/dist/runtime.js';
import { executeKernEntrySource } from '../../packages/core/dist/runner.js';
import {
  executeKernRuntimeHandlerAsync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';
import { INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS } from '../../packages/core/dist/runtime-envelope/types.js';
import {
  createAsyncLocalRagRetrieveCapability,
  createLocalRagCapability,
  createLocalRagCapabilitySession,
} from '../../packages/core/dist/node.js';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const APP_MANIFEST_PATH = resolve(APP_DIR, 'app.kern');
const RUNTIME_HANDLER_CONFIG_PATH = resolve(APP_DIR, 'runtime-handler-config.json');
const RUNTIME_HANDLER_CONFIG_FORMAT = 'kern.preview.runtime-handler.config.v1';
const RUNTIME_HANDLER_LIMIT_KEYS = INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const HOST_SYNC_CAPABILITIES = Object.freeze(['rag.promptContext', 'rag.checkAnswer']);
const HOST_ASYNC_CAPABILITIES = Object.freeze(['rag.retrieveAsync', 'llm.complete']);
const DEMO_RAG_SESSION = createLocalRagCapabilitySession();
const DEMO_FAILURES = new Set(['missing-llm', 'ungrounded']);

class DemoInputError extends Error {}
class DemoMissingCapabilityError extends Error {
  constructor(capability) {
    super(`missing required host capability: ${capability}`);
    this.capability = capability;
  }
}
class DemoRuntimeHandlerFailure extends Error {
  constructor(envelope, knownGroundingFailure = false) {
    super('typed runtime handler failed');
    this.diagnosticCodes = envelope.diagnostics.map(({ code }) => code);
    this.knownGroundingFailure = knownGroundingFailure;
  }
}

let appManifestPromise;

function normalizeQuestion(question) {
  if (typeof question !== 'string' || !question.trim()) throw new DemoInputError('question is required');
  return question.trim();
}

function policyFailureStatus(entry, fallback) {
  const rawStatus = entry.policies?.[0]?.props?.failureStatus;
  const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function positiveSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function runtimeHandlerLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime handler config limits must be an object');
  }
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== RUNTIME_HANDLER_LIMIT_KEYS.length ||
    actualKeys.some((key, index) => key !== RUNTIME_HANDLER_LIMIT_KEYS[index])
  ) {
    throw new Error(`runtime handler config limits must contain exactly ${RUNTIME_HANDLER_LIMIT_KEYS.join(',')}`);
  }
  return Object.freeze(
    Object.fromEntries(
      RUNTIME_HANDLER_LIMIT_KEYS.map((key) => [key, positiveSafeInteger(value[key], `runtime handler config ${key}`)]),
    ),
  );
}

export function parseRuntimeHandlerConfig(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('runtime handler config must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime handler config must be an object');
  }
  const expectedKeys = ['capabilityTimeoutMs', 'format', 'limits', 'schedulerTimeoutMs'];
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`runtime handler config must contain exactly ${expectedKeys.join(',')}`);
  }
  if (value.format !== RUNTIME_HANDLER_CONFIG_FORMAT) {
    throw new Error('runtime handler config format is unsupported');
  }
  return Object.freeze({
    capabilityTimeoutMs: positiveSafeInteger(value.capabilityTimeoutMs, 'runtime handler config capabilityTimeoutMs'),
    limits: runtimeHandlerLimits(value.limits),
    schedulerTimeoutMs: positiveSafeInteger(
      value.schedulerTimeoutMs,
      'runtime handler config schedulerTimeoutMs',
      MAX_TIMER_DELAY_MS,
    ),
  });
}

function singleEntry(entries, label, predicate) {
  const matches = entries.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`app manifest must declare exactly one ${label}, found ${matches.length}`);
  }
  return matches[0];
}

function assertHostSupportsEntry(entry) {
  const missingSync = entry.requiredSyncCapabilities.filter((id) => !HOST_SYNC_CAPABILITIES.includes(id));
  const missingAsync = entry.requiredAsyncCapabilities.filter((id) => !HOST_ASYNC_CAPABILITIES.includes(id));
  if (missingSync.length > 0 || missingAsync.length > 0) {
    throw new Error(
      `${entry.label} requires unsupported host capabilities: ${[...missingSync, ...missingAsync].join(', ')}`,
    );
  }
}

export async function loadPreviewAppManifest() {
  if (!appManifestPromise) {
    appManifestPromise = (async () => {
      const [source, runtimeHandlerConfigSource] = await Promise.all([
        readFile(APP_MANIFEST_PATH, 'utf-8'),
        readFile(RUNTIME_HANDLER_CONFIG_PATH, 'utf-8'),
      ]);
      const runtimeHandlerConfig = parseRuntimeHandlerConfig(runtimeHandlerConfigSource);
      const descriptor = await loadKernAppDescriptor(source, {
        appRoot: APP_DIR,
        canonicalizePath(path) {
          return realpath(path);
        },
        readSource(sourcePath) {
          return readFile(sourcePath, 'utf-8');
        },
        runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
      });
      const homeView = singleEntry(descriptor.views, 'view for path "/"', (view) => view.path === '/');
      const answerRoute = singleEntry(
        descriptor.routes,
        'route GET /api/answer',
        (route) => route.key === 'GET /api/answer',
      );
      if (answerRoute.node.props?.response !== 'json') {
        throw new Error('route GET /api/answer must declare response=json');
      }
      assertHostSupportsEntry(homeView);
      assertHostSupportsEntry(answerRoute);
      return Object.freeze({ ...descriptor, homeView, answerRoute, runtimeHandlerConfig });
    })().catch((error) => {
      appManifestPromise = undefined;
      throw error;
    });
  }
  return appManifestPromise;
}

function isRefundQuestion(question) {
  return /\b(refund|refunds|receipt|money back|policy)\b/i.test(question);
}

function normalizeDemoFailure(value) {
  if (value === null || value === '') return undefined;
  if (DEMO_FAILURES.has(value)) return value;
  throw new DemoInputError('unsupported failure mode');
}

function projectAnswerRouteEnvelope(envelope, knownGroundingFailure) {
  if (envelope.outcome !== 'success') throw new DemoRuntimeHandlerFailure(envelope, knownGroundingFailure);
  if (envelope.completion.kind !== 'return' || envelope.result.presence !== 'value') {
    throw new DemoRuntimeHandlerFailure(envelope);
  }
  if (envelope.events.some(({ op }) => op === 'stdout' || op === 'stderr')) {
    throw new DemoRuntimeHandlerFailure(envelope);
  }
  const value = envelope.result.value;
  if (value.tag !== 'list' || value.value.length < 3) throw new DemoRuntimeHandlerFailure(envelope);
  const fields = value.value.map((field) => {
    if (field.tag !== 'text' || field.value.length === 0) throw new DemoRuntimeHandlerFailure(envelope);
    return field.value;
  });
  const [answer, status, ...sources] = fields;
  const citations = sources.map((source, index) => ({
    label: `[${index + 1}]`,
    source,
    chunkIndex: index,
  }));
  const grounded = status === 'grounded';
  return {
    answer,
    status,
    grounded,
    citations,
    chunkCount: sources.length,
    source: sources[0] ?? null,
    sources,
    diagnostics: {
      status,
      grounded,
      chunkCount: sources.length,
      sources,
    },
  };
}

function isGroundingFailure(error) {
  return (
    error instanceof DemoRuntimeHandlerFailure &&
    error.knownGroundingFailure &&
    error.diagnosticCodes.includes('capability-error')
  );
}

export async function renderUiHtml() {
  const manifest = await loadPreviewAppManifest();
  const source = await readFile(manifest.homeView.sourcePath, 'utf-8');
  const providedCapabilities = HOST_SYNC_CAPABILITIES.filter((id) => manifest.homeView.requiredSyncCapabilities.includes(id));
  const providedAsyncCapabilities = HOST_ASYNC_CAPABILITIES.filter((id) =>
    manifest.homeView.requiredAsyncCapabilities.includes(id),
  );
  const missingProvider = findMissingKernAppEntryCapability(
    manifest.homeView,
    providedCapabilities,
    providedAsyncCapabilities,
  );
  if (missingProvider) throw new DemoMissingCapabilityError(missingProvider);
  return executeKernEntrySource(source, manifest.homeView, {
    providedCapabilities,
    capabilityContext: { sourceName: manifest.homeView.sourcePath },
  });
}

export async function answerQuestion(question, options = {}) {
  const normalized = normalizeQuestion(question);
  const failure = options.failure;
  let knownGroundingFailure = false;
  const manifest = await loadPreviewAppManifest();
  const source = await readFile(manifest.answerRoute.sourcePath, 'utf-8');
  const asyncCapabilities = {
    rag: createAsyncLocalRagRetrieveCapability(source, {
      sourcePath: manifest.answerRoute.sourcePath,
      session: DEMO_RAG_SESSION,
    }),
  };
  const providedCapabilities = HOST_SYNC_CAPABILITIES.filter((id) =>
    manifest.answerRoute.requiredSyncCapabilities.includes(id),
  );
  const providedAsyncCapabilities = HOST_ASYNC_CAPABILITIES.filter(
    (id) =>
      manifest.answerRoute.requiredAsyncCapabilities.includes(id) &&
      (failure !== 'missing-llm' || id !== 'llm.complete'),
  );
  if (failure !== 'missing-llm') {
    asyncCapabilities.llm = {
      // Demo-only deterministic adapter; real hosts inject a model provider.
      async complete(call) {
        const input = call?.input;
        const question =
          input && typeof input === 'object' && !Array.isArray(input) && typeof input.question === 'string'
            ? input.question
            : '';
        if (failure === 'ungrounded') return 'Refunds are approved by manager preference without evidence.';
        if (!isRefundQuestion(question)) {
          knownGroundingFailure = true;
          throw new Error('KERN_DEMO_UNSUPPORTED_QUERY');
        }
        return 'Refunds are available within thirty days when the customer includes the receipt [1].\nSupport should cite the refund policy before promising money back [1].';
      },
    };
  }
  const missingProvider = findMissingKernAppEntryCapability(
    manifest.answerRoute,
    providedCapabilities,
    providedAsyncCapabilities,
  );
  if (missingProvider) throw new DemoMissingCapabilityError(missingProvider);
  // Policy-slot skeleton (5.2): run declared pre-slot policies before the
  // route handler and post-slot policies after it. Today only passthrough
  // policies exist; 5.3 guard kinds slot into these same two hook points.
  await executeKernAppEntryPolicySlot(manifest.answerRoute, 'pre');
  const ragCapabilities = createLocalRagCapability(source, {
    sourcePath: manifest.answerRoute.sourcePath,
    session: DEMO_RAG_SESSION,
  });
  const envelope = await executeKernRuntimeHandlerAsync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [normalized],
      identity: {
        handlerName: manifest.answerRoute.handler,
        sourcePath: relative(APP_DIR, manifest.answerRoute.sourcePath),
      },
      source,
    },
    {
      asyncCapabilities,
      capabilities: {
        rag: {
          checkAnswer(call) {
            try {
              return ragCapabilities.checkAnswer(call);
            } catch (error) {
              if (error instanceof Error && error.message.startsWith('RAG answer check failed:')) {
                knownGroundingFailure = true;
              }
              throw error;
            }
          },
          promptContext: ragCapabilities.promptContext,
        },
      },
      capabilityContext: { sourceName: manifest.answerRoute.sourcePath },
      capabilityTimeoutMs: manifest.runtimeHandlerConfig.capabilityTimeoutMs,
      enabled: true,
      limits: manifest.runtimeHandlerConfig.limits,
      scheduler: { timeoutMs: manifest.runtimeHandlerConfig.schedulerTimeoutMs },
    },
  );
  const result = projectAnswerRouteEnvelope(envelope, knownGroundingFailure);
  await executeKernAppEntryPolicySlot(manifest.answerRoute, 'post');
  return result;
}

export function createPreviewAppServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      const manifest = await loadPreviewAppManifest();
      if (method.toUpperCase() === 'GET' && url.pathname === manifest.homeView.path) {
        const html = await renderUiHtml();
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      if (
        method.toUpperCase() === manifest.answerRoute.method.toUpperCase() &&
        url.pathname === manifest.answerRoute.path
      ) {
        let result;
        try {
          result = await answerQuestion(url.searchParams.get('question') ?? '', {
            failure: normalizeDemoFailure(url.searchParams.get('failure')),
          });
        } catch (error) {
          if (error instanceof DemoInputError) {
            const message = error.message === 'unsupported failure mode' ? error.message : 'question is required';
            response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: message }));
            return;
          }
          if (isGroundingFailure(error)) {
            response.writeHead(policyFailureStatus(manifest.answerRoute, 422), {
              'content-type': 'application/json; charset=utf-8',
            });
            response.end(JSON.stringify({ error: 'no grounded answer for this question', diagnostics: { grounded: false } }));
            return;
          }
          if (error instanceof DemoMissingCapabilityError) {
            response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
            response.end(
              JSON.stringify({
                error: 'required host capability is unavailable',
                diagnostics: { capability: error.capability, grounded: false },
              }),
            );
            return;
          }
          throw error;
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not found' }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'preview app request failed' }));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createPreviewAppServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      console.log(`KERN 5 preview app listening on http://127.0.0.1:${address.port}/`);
    }
  });
}
