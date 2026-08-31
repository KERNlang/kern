import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkVerifiedKernKirProgram } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';
import { nativeExecute } from '../kern-5-c-py-1-contract/support.mjs';
import {
  ENTRY,
  LIMITS,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  handlerSource,
  normalizeEnvelope,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
} from '../kern-5-rt2-boolean-if/k0-support.mjs';

export {
  ENTRY,
  LIMITS,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  handlerSource,
  normalizeEnvelope,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
};

const CHILD_MAX_BYTES = 400_000;

export const OPERATORS = Object.freeze(['&&', '||', '==', '!=', '<', '<=', '>', '>=']);

export function boolArgs(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'boolean', value }]));
}

export function stepRequest(requestId, args, maxSteps) {
  return {
    arguments: args,
    control: { preCancelled: false, timeoutMs: null },
    entry: ENTRY,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: { ...LIMITS, maxSteps },
    requestId,
  };
}

const LINK_CODES = Object.freeze([
  'handler-entry-ambiguous',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'handler-link-error',
  'projection-authentication-error',
]);

export async function admission(source) {
  const verified = await project(source);
  if (verified === undefined) return { projection: 'projection-rejected' };
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  const direct = await executeKernKir(verified, runtimeRequest('rt3-admission', {}), provider([]));
  return {
    javascript: javascript.outcome === 'failure' ? javascript.code : 'admitted',
    projection: 'projected',
    python: python.outcome === 'failure' ? python.code : 'admitted',
    rt1:
      direct.outcome === 'failure' && LINK_CODES.includes(direct.diagnostics[0]?.code)
        ? direct.diagnostics[0].code
        : 'admitted',
    verified,
  };
}

const BATCH_DRIVER = [
  "import { readFile, writeFile } from 'node:fs/promises';",
  'const [entryPath, inputPath, outputPath] = process.argv.slice(2);',
  'const module = await import(entryPath);',
  'const requests = JSON.parse(await readFile(inputPath, "utf8"));',
  'const envelopes = [];',
  'for (const request of requests) {',
  '  envelopes.push(await module.execute(request, {',
  '    invoke: async () => ({ presence: "value", value: { tag: "text", value: "reply-value" } }),',
  '  }));',
  '}',
  'await writeFile(outputPath, JSON.stringify({ envelopes, format: module.format }));',
].join('\n');

export async function executeJavaScriptBatch(bytes, requests) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kern-rt3-js-')));
  try {
    const entry = join(directory, 'entry.mjs');
    const driver = join(directory, 'driver.mjs');
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await Promise.all([
      writeFile(entry, bytes),
      writeFile(driver, BATCH_DRIVER),
      writeFile(input, JSON.stringify(requests)),
    ]);
    const node22 = process.env.KERN_NODE22 ?? process.execPath;
    const version = spawnSync(node22, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^v22\./u, `KERN_NODE22 must select Node 22, received ${version.stdout.trim()}`);
    const run = spawnSync(
      node22,
      [
        '--experimental-permission',
        `--allow-fs-read=${directory}`,
        `--allow-fs-write=${directory}`,
        driver,
        entry,
        input,
        output,
      ],
      { cwd: directory, encoding: 'utf8', maxBuffer: CHILD_MAX_BYTES, timeout: 20_000 },
    );
    assert.equal(run.signal, null, `JavaScript child timed out: ${run.stderr}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '', 'the JavaScript child must use the output file as its protocol');
    assert.equal(run.stderr, '', 'clean JavaScript execution must not emit stderr');
    const encoded = await readFile(output, 'utf8');
    assert.ok(Buffer.byteLength(encoded) <= CHILD_MAX_BYTES, 'JavaScript child response exceeded its bound');
    const response = JSON.parse(encoded);
    assert.deepEqual(Object.keys(response).sort(), ['envelopes', 'format']);
    assert.equal(response.format, KERN_KIR_RUNTIME_FORMAT);
    assert.equal(response.envelopes.length, requests.length);
    return response.envelopes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function executePythonBatch(bytes, requests) {
  const output = await nativeExecute(bytes, { runs: requests.map((request) => ({ request, reply: 'reply-value' })) });
  assert.equal(output.results.length, requests.length);
  return output.results;
}

function firstSuccess(envelopes, budgets) {
  const index = envelopes.findIndex((envelope) => envelope.outcome === 'success');
  assert.ok(index >= 0, 'no step budget in the scanned range produced a successful run');
  assert.ok(
    envelopes.slice(index).every((envelope) => envelope.outcome === 'success'),
    'step consumption must be monotonic in the step budget',
  );
  assert.ok(
    envelopes
      .slice(0, index)
      .every((envelope) => envelope.diagnostics[0]?.code === 'runtime-limit-exceeded'),
    'below the step budget every run must fail with the step limit',
  );
  return budgets[index];
}

function range(count) {
  return Array.from({ length: count }, (_unused, index) => index + 1);
}

export const DIRECT_BUDGETS = Object.freeze(range(120));
export const EMITTED_BUDGETS = Object.freeze(range(60));

export async function stepBudgets(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the metering fixture');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const emittedRequests = EMITTED_BUDGETS.map((maxSteps) => stepRequest(`${requestId}-${maxSteps}`, args, maxSteps));
  const directEnvelopes = [];
  for (const maxSteps of DIRECT_BUDGETS) {
    directEnvelopes.push(
      await executeKernKir(verified, stepRequest(`${requestId}-${maxSteps}`, args, maxSteps), provider([])),
    );
  }
  const linkIndex = DIRECT_BUDGETS.findIndex(
    (maxSteps) => linkVerifiedKernKirProgram(verified, ENTRY, { ...LIMITS, maxSteps }).outcome === 'success',
  );
  assert.ok(linkIndex >= 0, 'no step budget in the scanned range linked the fixture');
  return {
    direct: firstSuccess(directEnvelopes, DIRECT_BUDGETS),
    javascript: firstSuccess(await executeJavaScriptBatch(javascript.artifact.bytes, emittedRequests), EMITTED_BUDGETS),
    link: DIRECT_BUDGETS[linkIndex],
    python: firstSuccess(await executePythonBatch(python.artifact.bytes, emittedRequests), EMITTED_BUDGETS),
  };
}
