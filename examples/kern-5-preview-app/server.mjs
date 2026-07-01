import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMissingKernAppEntryCapability, loadKernAppDescriptor } from '../../packages/core/dist/runtime.js';
import { executeKernEntrySource, executeKernEntrySourceAsync } from '../../packages/core/dist/runner.js';
import {
  createAsyncLocalRagRetrieveCapability,
  createLocalRagCapability,
  createLocalRagCapabilitySession,
} from '../../packages/core/dist/node.js';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const APP_MANIFEST_PATH = resolve(APP_DIR, 'app.kern');

const HOST_SYNC_CAPABILITIES = Object.freeze(['app-http.queryParam', 'rag.promptContext', 'rag.checkAnswer']);
const HOST_ASYNC_CAPABILITIES = Object.freeze(['rag.retrieveAsync', 'llm.complete']);
const DEMO_RAG_SESSION = createLocalRagCapabilitySession();
const ANSWER_START = '__KERN_ANSWER_START__';
const ANSWER_END = '__KERN_ANSWER_END__';
const STATUS_MARKER = '__KERN_STATUS__';
const SOURCES_START = '__KERN_SOURCES_START__';
const SOURCES_END = '__KERN_SOURCES_END__';
const DEMO_FAILURES = new Set(['missing-llm', 'ungrounded']);

class DemoInputError extends Error {}
class DemoMissingCapabilityError extends Error {
  constructor(capability) {
    super(`missing required host capability: ${capability}`);
    this.capability = capability;
  }
}

let appManifestPromise;

function normalizeQuestion(question) {
  if (typeof question !== 'string' || !question.trim()) throw new DemoInputError('question is required');
  return question.trim();
}

function createAppHttpCapability(query) {
  return {
    queryParam(call) {
      const input = call.input;
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string') {
        throw new Error('app-http.queryParam input must declare name');
      }
      return query[input.name] ?? null;
    },
  };
}

function policyFailureStatus(entry, fallback) {
  const rawStatus = entry.policies?.[0]?.props?.failureStatus;
  const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
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
      const source = await readFile(APP_MANIFEST_PATH, 'utf-8');
      const descriptor = await loadKernAppDescriptor(source, {
        appRoot: APP_DIR,
        canonicalizePath(path) {
          return realpath(path);
        },
        readSource(sourcePath) {
          return readFile(sourcePath, 'utf-8');
        },
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
      return Object.freeze({ ...descriptor, homeView, answerRoute });
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

function markerIndex(lines, marker) {
  const matches = lines.flatMap((line, index) => (line === marker ? [index] : []));
  if (matches.length !== 1) throw new Error(`answer route printed ${matches.length} copies of ${marker}`);
  return matches[0];
}

function parseAnswerRouteOutput(stdout) {
  const lines = stdout.trimEnd().split(/\r?\n/u);
  const answerStart = markerIndex(lines, ANSWER_START);
  const answerEnd = markerIndex(lines, ANSWER_END);
  const statusMarker = markerIndex(lines, STATUS_MARKER);
  const sourcesStart = markerIndex(lines, SOURCES_START);
  const sourcesEnd = markerIndex(lines, SOURCES_END);
  if (
    answerStart >= answerEnd ||
    answerEnd + 1 !== statusMarker ||
    statusMarker + 2 !== sourcesStart ||
    sourcesStart > sourcesEnd
  ) {
    throw new Error('answer route printed malformed output sections');
  }
  const answer = lines.slice(answerStart + 1, answerEnd).join('\n');
  const status = lines[statusMarker + 1];
  if (!answer || !status) {
    throw new Error('answer route printed invalid output fields');
  }
  const sources = lines.slice(sourcesStart + 1, sourcesEnd);
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
  return error instanceof Error && error.message.includes('RAG answer check failed:');
}

function isUnsupportedQuestion(error) {
  return error instanceof Error && error.message.includes('KERN_DEMO_UNSUPPORTED_QUERY');
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
        if (!isRefundQuestion(question)) throw new Error('KERN_DEMO_UNSUPPORTED_QUERY');
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
  const stdout = await executeKernEntrySourceAsync(source, manifest.answerRoute, {
    capabilities: {
      'app-http': createAppHttpCapability({ question: normalized }),
      rag: createLocalRagCapability(source, { sourcePath: manifest.answerRoute.sourcePath, session: DEMO_RAG_SESSION }),
    },
    providedCapabilities,
    asyncCapabilities,
    providedAsyncCapabilities,
    capabilityContext: { sourceName: manifest.answerRoute.sourcePath },
  });
  return parseAnswerRouteOutput(stdout);
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
          if (isGroundingFailure(error) || isUnsupportedQuestion(error)) {
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
