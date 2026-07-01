import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeKernSourceCapabilities,
  createMemoryStorageCapability,
  executeKernSource,
  executeKernSourceAsync,
} from '../../packages/core/dist/runner.js';
import {
  createAsyncLocalRagRetrieveCapability,
  createLocalRagCapability,
  createLocalRagCapabilitySession,
} from '../../packages/core/dist/node.js';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const UI_PATH = resolve(APP_DIR, 'ui.kern');
const ROUTE_PATH = resolve(APP_DIR, 'answer-route.kern');

const PROVIDED_CAPABILITIES = Object.freeze(['storage.get', 'rag.promptContext', 'rag.checkAnswer']);
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

function normalizeQuestion(question) {
  if (typeof question !== 'string' || !question.trim()) throw new DemoInputError('question is required');
  return question.trim();
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
  const source = await readFile(UI_PATH, 'utf-8');
  return executeKernSource(source, { capabilityContext: { sourceName: UI_PATH } });
}

export async function answerQuestion(question, options = {}) {
  const normalized = normalizeQuestion(question);
  const failure = options.failure;
  const source = await readFile(ROUTE_PATH, 'utf-8');
  const asyncCapabilities = {
    rag: createAsyncLocalRagRetrieveCapability(source, { sourcePath: ROUTE_PATH, session: DEMO_RAG_SESSION }),
  };
  const providedAsyncCapabilities = ['rag.retrieveAsync'];
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
    providedAsyncCapabilities.push('llm.complete');
  }
  const capabilityAnalysis = analyzeKernSourceCapabilities(source, {
    providedCapabilities: PROVIDED_CAPABILITIES,
    providedAsyncCapabilities,
  });
  const missingLlm = capabilityAnalysis.missingAsyncProviders.find((requirement) => requirement.id === 'llm.complete');
  if (missingLlm) throw new DemoMissingCapabilityError(missingLlm.id);
  const stdout = await executeKernSourceAsync(source, {
    capabilities: {
      storage: createMemoryStorageCapability({ initial: { question: normalized } }),
      rag: createLocalRagCapability(source, { sourcePath: ROUTE_PATH, session: DEMO_RAG_SESSION }),
    },
    providedCapabilities: PROVIDED_CAPABILITIES,
    asyncCapabilities,
    providedAsyncCapabilities,
    capabilityContext: { sourceName: ROUTE_PATH },
  });
  return parseAnswerRouteOutput(stdout);
}

export function createPreviewAppServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await renderUiHtml();
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/answer') {
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
            response.writeHead(422, { 'content-type': 'application/json; charset=utf-8' });
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
