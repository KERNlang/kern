#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const FIXTURE = resolve(ROOT, 'examples/native-runtime-smoke.kern');
const ASYNC_FS_FIXTURE = resolve(ROOT, 'examples/native-runtime-async-fs-preview.kern');
const ASYNC_HOST_FIXTURE = resolve(ROOT, 'examples/native-runtime-async-host-preview.kern');
const RAG_ANSWER_FIXTURE = resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern');
const RAG_ASYNC_RETRIEVE_FIXTURE = resolve(
  ROOT,
  'examples/rag-starter/runtime-answer-async-retrieve-preview.kern',
);
const RAG_ANSWER_CAPABILITY_FIXTURE = resolve(ROOT, 'examples/rag-starter/runtime-answer-capability-preview.kern');
const EXPECTED_STDOUT = 'sum-ok\n0\n1\n20\nrag\nruntime\nfmt-6\nbranch\ncaught\nfinally\ntrue\npreview\ntrue\n3\n';
const EXPECTED_ASYNC_FS_STDOUT = '1\nasync smoke\ntrue\n';
const EXPECTED_ASYNC_HOST_STDOUT = 'host input\nhost-preview\nhost answer\n';
const EXPECTED_RAG_ANSWER_MARKERS = [
  '1\n1\n[1] id=',
  'source="corpus/refunds.md"',
  'citation={"uri":"corpus/refunds.md"',
  'Refunds are available within thirty days',
  '\nRefunds are available within thirty days [1]\n',
];
const RAG_ANSWER_ORDER =
  /1\n1\n\[1\] id=[\s\S]*Refunds are available within thirty days[\s\S]*\nRefunds are available within thirty days \[1\]\n/u;
const EXPECTED_RAG_ANSWER_CAPABILITY_STDOUT = '1\ntrue\ngrounded\nRefunds are available within thirty days [1]\n';

class SmokeFailure extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

if (!existsSync(CLI)) {
  console.error(`missing built CLI at ${CLI}; run pnpm --filter @kernlang/cli build first`);
  process.exit(2);
}

function runCli(args, envOverrides = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...envOverrides },
    timeout: 20000,
  });
}

const result = runCli(['run', FIXTURE]);

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

if (result.signal) {
  console.error(`kern run smoke was killed by signal ${result.signal}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}

if (result.status !== 0) {
  console.error(`kern run smoke exited ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

if (result.stderr) {
  console.error(`kern run smoke emitted unexpected stderr:\n${result.stderr}`);
  process.exit(1);
}

if (result.stdout !== EXPECTED_STDOUT) {
  console.error('kern run smoke stdout drifted');
  console.error(`expected:\n${EXPECTED_STDOUT}`);
  console.error(`actual:\n${result.stdout ?? ''}`);
  process.exit(1);
}

const fsRoot = mkdtempSync(join(tmpdir(), 'kern-run-async-fs-smoke-'));
let asyncFsFailure;
try {
  writeFileSync(join(fsRoot, 'input.txt'), 'async smoke');
  const asyncFsResult = runCli([
    'run',
    '--async-preview',
    '--fs-root',
    fsRoot,
    '--fs-write-root',
    fsRoot,
    ASYNC_FS_FIXTURE,
  ]);

  if (asyncFsResult.error) {
    throw new SmokeFailure(asyncFsResult.error.message, 2);
  }

  if (asyncFsResult.signal) {
    throw new SmokeFailure(
      [
        `kern run async fs smoke was killed by signal ${asyncFsResult.signal}`,
        asyncFsResult.stderr ? asyncFsResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
      2,
    );
  }

  if (asyncFsResult.status !== 0) {
    throw new SmokeFailure(
      [`kern run async fs smoke exited ${asyncFsResult.status}`, asyncFsResult.stderr ? asyncFsResult.stderr : '']
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (asyncFsResult.stderr) {
    throw new SmokeFailure(`kern run async fs smoke emitted unexpected stderr:\n${asyncFsResult.stderr}`);
  }

  if (asyncFsResult.stdout !== EXPECTED_ASYNC_FS_STDOUT) {
    throw new SmokeFailure(
      [
        'kern run async fs smoke stdout drifted',
        `expected:\n${EXPECTED_ASYNC_FS_STDOUT}`,
        `actual:\n${asyncFsResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }

  const written = readFileSync(join(fsRoot, 'out.txt'), 'utf-8');
  if (written !== 'async smoke') {
    throw new SmokeFailure(`kern run async fs smoke wrote unexpected file contents: ${JSON.stringify(written)}`);
  }
} catch (error) {
  asyncFsFailure = error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
} finally {
  rmSync(fsRoot, { recursive: true, force: true });
}

if (asyncFsFailure) {
  console.error(asyncFsFailure.message);
  process.exit(asyncFsFailure.exitCode);
}

const hostRoot = mkdtempSync(join(tmpdir(), 'kern-run-async-host-smoke-'));
let asyncHostFailure;
try {
  writeFileSync(join(hostRoot, 'input.txt'), 'host input');
  const asyncHostResult = runCli([
    'run',
    '--async-preview',
    '--fs-root',
    hostRoot,
    '--allow-net',
    'data:',
    '--llm-response',
    'host answer',
    ASYNC_HOST_FIXTURE,
  ]);

  if (asyncHostResult.error) {
    throw new SmokeFailure(asyncHostResult.error.message, 2);
  }

  if (asyncHostResult.signal) {
    throw new SmokeFailure(
      [
        `kern run async host smoke was killed by signal ${asyncHostResult.signal}`,
        asyncHostResult.stderr ? asyncHostResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
      2,
    );
  }

  if (asyncHostResult.status !== 0) {
    throw new SmokeFailure(
      [`kern run async host smoke exited ${asyncHostResult.status}`, asyncHostResult.stderr ? asyncHostResult.stderr : '']
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (asyncHostResult.stderr) {
    throw new SmokeFailure(`kern run async host smoke emitted unexpected stderr:\n${asyncHostResult.stderr}`);
  }

  if (asyncHostResult.stdout !== EXPECTED_ASYNC_HOST_STDOUT) {
    throw new SmokeFailure(
      [
        'kern run async host smoke stdout drifted',
        `expected:\n${EXPECTED_ASYNC_HOST_STDOUT}`,
        `actual:\n${asyncHostResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
} catch (error) {
  asyncHostFailure =
    error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
} finally {
  rmSync(hostRoot, { recursive: true, force: true });
}

if (asyncHostFailure) {
  console.error(asyncHostFailure.message);
  process.exit(asyncHostFailure.exitCode);
}

let ragAnswerFailure;
try {
  const ragAnswerResult = runCli([
    'run',
    '--async-preview',
    '--llm-response',
    'Refunds are available within thirty days [1]',
    RAG_ANSWER_FIXTURE,
  ]);

  if (ragAnswerResult.error) {
    throw new SmokeFailure(ragAnswerResult.error.message, 2);
  }

  if (ragAnswerResult.signal) {
    throw new SmokeFailure(
      [
        `kern run rag answer smoke was killed by signal ${ragAnswerResult.signal}`,
        ragAnswerResult.stderr ? ragAnswerResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
      2,
    );
  }

  if (ragAnswerResult.status !== 0) {
    throw new SmokeFailure(
      [`kern run rag answer smoke exited ${ragAnswerResult.status}`, ragAnswerResult.stderr ? ragAnswerResult.stderr : '']
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (ragAnswerResult.stderr) {
    throw new SmokeFailure(`kern run rag answer smoke emitted unexpected stderr:\n${ragAnswerResult.stderr}`);
  }

  const missingMarkers = EXPECTED_RAG_ANSWER_MARKERS.filter((marker) => !ragAnswerResult.stdout?.includes(marker));
  if (missingMarkers.length > 0) {
    throw new SmokeFailure(
      [
        'kern run rag answer smoke stdout drifted',
        `missing markers:\n${missingMarkers.join('\n')}`,
        `actual:\n${ragAnswerResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
  if (!RAG_ANSWER_ORDER.test(ragAnswerResult.stdout ?? '')) {
    throw new SmokeFailure(
      [
        'kern run rag answer smoke stdout order drifted',
        'expected retrieved context text before deterministic llm response',
        `actual:\n${ragAnswerResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
} catch (error) {
  ragAnswerFailure =
    error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
}

if (ragAnswerFailure) {
  console.error(ragAnswerFailure.message);
  process.exit(ragAnswerFailure.exitCode);
}

let ragAsyncRetrieveFailure;
try {
  const ragAsyncRetrieveResult = runCli([
    'run',
    '--async-preview',
    '--llm-response',
    'Refunds are available within thirty days [1]',
    RAG_ASYNC_RETRIEVE_FIXTURE,
  ]);

  if (ragAsyncRetrieveResult.error) {
    throw new SmokeFailure(ragAsyncRetrieveResult.error.message, 2);
  }

  if (ragAsyncRetrieveResult.signal) {
    throw new SmokeFailure(
      [
        `kern run rag async retrieve smoke was killed by signal ${ragAsyncRetrieveResult.signal}`,
        ragAsyncRetrieveResult.stderr ? ragAsyncRetrieveResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
      2,
    );
  }

  if (ragAsyncRetrieveResult.status !== 0) {
    throw new SmokeFailure(
      [
        `kern run rag async retrieve smoke exited ${ragAsyncRetrieveResult.status}`,
        ragAsyncRetrieveResult.stderr ? ragAsyncRetrieveResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (ragAsyncRetrieveResult.stderr) {
    throw new SmokeFailure(`kern run rag async retrieve smoke emitted unexpected stderr:\n${ragAsyncRetrieveResult.stderr}`);
  }

  const missingMarkers = EXPECTED_RAG_ANSWER_MARKERS.filter((marker) => !ragAsyncRetrieveResult.stdout?.includes(marker));
  if (missingMarkers.length > 0) {
    throw new SmokeFailure(
      [
        'kern run rag async retrieve smoke stdout drifted',
        `missing markers:\n${missingMarkers.join('\n')}`,
        `actual:\n${ragAsyncRetrieveResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
  if (!RAG_ANSWER_ORDER.test(ragAsyncRetrieveResult.stdout ?? '')) {
    throw new SmokeFailure(
      [
        'kern run rag async retrieve smoke stdout order drifted',
        'expected retrieved context text before deterministic llm response',
        `actual:\n${ragAsyncRetrieveResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
} catch (error) {
  ragAsyncRetrieveFailure =
    error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
}

if (ragAsyncRetrieveFailure) {
  console.error(ragAsyncRetrieveFailure.message);
  process.exit(ragAsyncRetrieveFailure.exitCode);
}

let ragAnswerCapabilityFailure;
try {
  const ragAnswerCapabilityResult = runCli([
    'run',
    '--async-preview',
    '--llm-response',
    'Refunds are available within thirty days [1]',
    RAG_ANSWER_CAPABILITY_FIXTURE,
  ]);

  if (ragAnswerCapabilityResult.error) {
    throw new SmokeFailure(ragAnswerCapabilityResult.error.message, 2);
  }

  if (ragAnswerCapabilityResult.signal) {
    throw new SmokeFailure(
      [
        `kern run rag.answer smoke was killed by signal ${ragAnswerCapabilityResult.signal}`,
        ragAnswerCapabilityResult.stderr ? ragAnswerCapabilityResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
      2,
    );
  }

  if (ragAnswerCapabilityResult.status !== 0) {
    throw new SmokeFailure(
      [
        `kern run rag.answer smoke exited ${ragAnswerCapabilityResult.status}`,
        ragAnswerCapabilityResult.stderr ? ragAnswerCapabilityResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (ragAnswerCapabilityResult.stderr) {
    throw new SmokeFailure(`kern run rag.answer smoke emitted unexpected stderr:\n${ragAnswerCapabilityResult.stderr}`);
  }

  if (ragAnswerCapabilityResult.stdout !== EXPECTED_RAG_ANSWER_CAPABILITY_STDOUT) {
    throw new SmokeFailure(
      [
        'kern run rag.answer smoke stdout drifted',
        `expected:\n${EXPECTED_RAG_ANSWER_CAPABILITY_STDOUT}`,
        `actual:\n${ragAnswerCapabilityResult.stdout ?? ''}`,
      ].join('\n'),
    );
  }
} catch (error) {
  ragAnswerCapabilityFailure =
    error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
}

if (ragAnswerCapabilityFailure) {
  console.error(ragAnswerCapabilityFailure.message);
  process.exit(ragAnswerCapabilityFailure.exitCode);
}

let providerReportFailure;
try {
  const providerReportResult = runCli(
    [
      'run',
      '--capabilities',
      '--llm-provider',
      'openai',
      '--llm-model',
      'test-model',
      RAG_ANSWER_FIXTURE,
    ],
    { KERN_LLM_API_KEY: '', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' },
  );

  if (providerReportResult.error) {
    throw new SmokeFailure(providerReportResult.error.message, 2);
  }
  if (providerReportResult.signal) {
    throw new SmokeFailure(`kern run provider report smoke was killed by signal ${providerReportResult.signal}`, 2);
  }
  if (providerReportResult.status !== 2) {
    throw new SmokeFailure(
      [
        `kern run provider report smoke exited ${providerReportResult.status}`,
        providerReportResult.stdout ? `stdout:\n${providerReportResult.stdout}` : '',
        providerReportResult.stderr ? providerReportResult.stderr : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (providerReportResult.stderr) {
    throw new SmokeFailure(`kern run provider report smoke emitted unexpected stderr:\n${providerReportResult.stderr}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(providerReportResult.stdout ?? '');
  } catch (error) {
    throw new SmokeFailure(`kern run provider report smoke emitted invalid JSON: ${error.message}`);
  }
  if (!parsed?.llmProviderPolicy || parsed.llmProviderPolicy.apiKeyPresent !== false) {
    throw new SmokeFailure('kern run provider report smoke did not expose missing-key provider policy');
  }
  if (!Array.isArray(parsed.providerPolicyBlockers) || parsed.providerPolicyBlockers[0]?.reason !== 'missing-api-key') {
    throw new SmokeFailure('kern run provider report smoke did not expose missing-key policy blocker');
  }
} catch (error) {
  providerReportFailure =
    error instanceof SmokeFailure ? error : new SmokeFailure(error instanceof Error ? error.message : String(error), 2);
}

if (providerReportFailure) {
  console.error(providerReportFailure.message);
  process.exit(providerReportFailure.exitCode);
}

console.log('kern run smoke passed');
