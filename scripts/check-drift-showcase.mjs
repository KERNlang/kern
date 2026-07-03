#!/usr/bin/env node
/**
 * Backend↔frontend drift showcase — assembles EXISTING codegen to prove one
 * story end to end:
 *
 *   ONE examples/drift-showcase/app.kern compiles to (a) a real Express
 *   backend and (b) a real FastAPI backend that answer the SAME requests
 *   with the SAME {status, body} (a conformance check, in the spirit of
 *   scripts/check-kern-5-preview-app.mjs but driving two real HTTP servers
 *   instead of one native-runtime app), AND (c) a typed TS client — derived
 *   from the SAME route descriptors the two emitters consume — such that a
 *   route's response-shape change breaks a frontend consumer's `tsc`
 *   typecheck at COMPILE TIME, not just at runtime.
 *
 * Nothing here is a new compiler pipeline: step 1/2 call the production
 * `transpileExpress`/`transpileFastAPI` entry points (the same ones
 * `kern compile --target=express|fastapi` uses); step 3 reuses the exact
 * `buildSchema`/`pascalCase`/`camelKey` helpers the emitters read `schema`
 * nodes with (scripts/lib/drift-client-codegen.mjs). The discriminating
 * proof is step 4: the SAME frontend/consumer.ts is typechecked twice —
 * once against the client generated from the CURRENT app.kern (must pass),
 * once against a client regenerated from a MUTATED route contract (must
 * fail, and fail citing the specific broken property).
 *
 * Run: node scripts/check-drift-showcase.mjs
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

class DriftShowcaseFailure extends Error {}

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DEMO_DIR = join(REPO, 'examples/drift-showcase');
const APP_KERN = join(DEMO_DIR, 'app.kern');
const FRONTEND_CONSUMER = join(DEMO_DIR, 'frontend/consumer.ts');
const GEN_DIR = join(DEMO_DIR, 'generated');
const EXPRESS_DIR = join(GEN_DIR, 'express');
const FASTAPI_DIR = join(GEN_DIR, 'fastapi');
const CLIENT_DIR = join(GEN_DIR, 'client');
const NEGATIVE_DIR = join(GEN_DIR, 'negative-control');
const TSC_BIN = join(REPO, 'node_modules/.bin/tsc');
const TSX_BIN = join(REPO, 'node_modules/.bin/tsx');

const { parse } = await import(join(REPO, 'packages/core/dist/parser.js'));
const { transpileExpress } = await import(join(REPO, 'packages/express/dist/transpiler-express.js'));
const { transpileFastAPI } = await import(join(REPO, 'packages/python/dist/transpiler-fastapi.js'));
const { extractRouteDescriptors, generateClientModule, withMutatedResponse } = await import(
  join(REPO, 'scripts/lib/drift-client-codegen.mjs')
);

function writeArtifacts(outDir, mainFileName, mainContent, artifacts) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, mainFileName), mainContent);
  for (const artifact of artifacts ?? []) {
    const filePath = join(outDir, artifact.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, artifact.content);
  }
}

async function waitForServer(url, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.text();
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new DriftShowcaseFailure(`server at ${url} did not become ready: ${lastError}`);
}

async function killProcess(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    let finished = false;
    child.once('exit', () => {
      finished = true;
      resolve();
    });
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!finished) child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
  });
}

async function fetchJson(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new DriftShowcaseFailure(`expected JSON from ${method} ${path}, got ${JSON.stringify(text.slice(0, 200))}`);
  }
  return { status: response.status, body: json };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function runTsc(entryFile) {
  try {
    const stdout = execSync(
      `${JSON.stringify(TSC_BIN)} --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --ignoreConfig ${JSON.stringify(entryFile)}`,
      { cwd: dirname(entryFile), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, exitCode: 0, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return { ok: false, exitCode: error.status ?? 1, output };
  }
}

let expressServer;
let fastapiServer;

try {
  console.log('== drift showcase: compile app.kern to both backends ==');
  rmSync(GEN_DIR, { recursive: true, force: true });
  const source = readFileSync(APP_KERN, 'utf8');
  const root = parse(source);

  const expressResult = transpileExpress(root);
  if (expressResult.diagnostics?.some((d) => d.outcome !== 'consumed' && d.outcome !== 'expressed')) {
    throw new DriftShowcaseFailure(
      `Express codegen left unconsumed IR nodes: ${JSON.stringify(expressResult.diagnostics)}`,
    );
  }
  writeArtifacts(EXPRESS_DIR, 'server.ts', expressResult.code, expressResult.artifacts);

  const fastapiResult = transpileFastAPI(root);
  if (fastapiResult.diagnostics?.some((d) => d.outcome !== 'consumed' && d.outcome !== 'expressed')) {
    throw new DriftShowcaseFailure(
      `FastAPI codegen left unconsumed IR nodes: ${JSON.stringify(fastapiResult.diagnostics)}`,
    );
  }
  writeArtifacts(FASTAPI_DIR, 'app.py', fastapiResult.code, fastapiResult.artifacts);
  console.log('  express + fastapi backends written to examples/drift-showcase/generated/');

  console.log('== drift showcase: boot both backends ==');
  try {
    execSync('python3 -c "import fastapi, uvicorn"', { stdio: 'ignore' });
  } catch {
    console.log('  fastapi/uvicorn not found — installing...');
    execSync('python3 -m pip install --user fastapi uvicorn', { stdio: 'inherit' });
  }

  const expressPort = 43_000 + Math.floor(Math.random() * 1_000);
  const fastapiPort = 44_000 + Math.floor(Math.random() * 1_000);
  const expressBase = `http://127.0.0.1:${expressPort}`;
  const fastapiBase = `http://127.0.0.1:${fastapiPort}`;

  expressServer = spawn(TSX_BIN, ['server.ts'], {
    cwd: EXPRESS_DIR,
    env: { ...process.env, PORT: String(expressPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let expressLog = '';
  expressServer.stdout.on('data', (chunk) => {
    expressLog += chunk;
  });
  expressServer.stderr.on('data', (chunk) => {
    expressLog += chunk;
  });

  fastapiServer = spawn(
    'python3',
    ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(fastapiPort), '--no-access-log'],
    { cwd: FASTAPI_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let fastapiLog = '';
  fastapiServer.stdout.on('data', (chunk) => {
    fastapiLog += chunk;
  });
  fastapiServer.stderr.on('data', (chunk) => {
    fastapiLog += chunk;
  });

  try {
    await waitForServer(`${expressBase}/api/status`);
  } catch (error) {
    throw new DriftShowcaseFailure(`Express server failed to start.\n${expressLog}\n${error.message}`);
  }
  try {
    await waitForServer(`${fastapiBase}/api/status`);
  } catch (error) {
    throw new DriftShowcaseFailure(`FastAPI server failed to start.\n${fastapiLog}\n${error.message}`);
  }
  console.log(`  express listening on ${expressBase}, fastapi listening on ${fastapiBase}`);

  console.log('== drift showcase: differential conformance across both legs ==');
  const REQUESTS = [
    {
      name: 'GET /api/status',
      method: 'GET',
      path: '/api/status',
      expected: { status: 200, body: { ok: true, service: 'drift-showcase', version: 1 } },
    },
    {
      name: 'GET /api/items/:id',
      method: 'GET',
      path: '/api/items/42',
      expected: { status: 200, body: { id: '42', title: 'Widget', price: 9.99 } },
    },
    {
      name: 'POST /api/items',
      method: 'POST',
      path: '/api/items',
      requestBody: { title: 'Gadget', price: 19.99 },
      expected: {
        status: 201,
        body: { id: 'itm_1', title: 'Gadget', price: 19.99, createdAt: '2026-07-03T00:00:00Z' },
      },
    },
  ];

  for (const req of REQUESTS) {
    const [expressResponse, fastapiResponse] = await Promise.all([
      fetchJson(expressBase, req.method, req.path, req.requestBody),
      fetchJson(fastapiBase, req.method, req.path, req.requestBody),
    ]);
    if (!deepEqual(expressResponse, fastapiResponse)) {
      throw new DriftShowcaseFailure(
        `${req.name} diverged between backends:\n  express: ${JSON.stringify(expressResponse)}\n  fastapi: ${JSON.stringify(fastapiResponse)}`,
      );
    }
    if (!deepEqual(expressResponse, req.expected)) {
      throw new DriftShowcaseFailure(
        `${req.name} did not match expected response:\n  got:      ${JSON.stringify(expressResponse)}\n  expected: ${JSON.stringify(req.expected)}`,
      );
    }
    console.log(`  ${req.name} — express == fastapi == expected (status ${expressResponse.status})`);
  }

  await killProcess(expressServer);
  await killProcess(fastapiServer);
  expressServer = undefined;
  fastapiServer = undefined;

  console.log('== drift showcase: derive typed client from the SAME route descriptors ==');
  const descriptors = extractRouteDescriptors(root);
  if (descriptors.length !== REQUESTS.length) {
    throw new DriftShowcaseFailure(
      `expected ${REQUESTS.length} route descriptors, extracted ${descriptors.length}`,
    );
  }
  const currentClient = generateClientModule(descriptors);
  writeArtifacts(CLIENT_DIR, 'types.ts', currentClient.typesTs, [
    { path: 'client.ts', content: currentClient.clientTs },
  ]);
  console.log(`  generated client for ${descriptors.map((d) => d.camelName).join(', ')}`);

  console.log('== drift showcase: positive control — tsc against the CURRENT contract must PASS ==');
  const positive = runTsc(FRONTEND_CONSUMER);
  if (!positive.ok) {
    throw new DriftShowcaseFailure(
      `frontend consumer failed to typecheck against the CURRENT client (it should pass):\n${positive.output}`,
    );
  }
  console.log('  tsc exit 0 — frontend consumer typechecks against the current route contract');

  console.log('== drift showcase: negative control — tsc against a MUTATED contract must FAIL ==');
  const mutatedFieldName = 'unitPrice';
  const mutatedDescriptors = withMutatedResponse(descriptors, {
    camelName: 'getApiItemsId',
    responseType: `{ id: string, title: string, ${mutatedFieldName}: number }`,
  });
  const mutatedClient = generateClientModule(mutatedDescriptors);
  const negativeFrontendDir = join(NEGATIVE_DIR, 'frontend');
  mkdirSync(negativeFrontendDir, { recursive: true });
  writeFileSync(join(negativeFrontendDir, 'consumer.ts'), readFileSync(FRONTEND_CONSUMER, 'utf8'));
  writeArtifacts(join(NEGATIVE_DIR, 'generated/client'), 'types.ts', mutatedClient.typesTs, [
    { path: 'client.ts', content: mutatedClient.clientTs },
  ]);
  const negative = runTsc(join(negativeFrontendDir, 'consumer.ts'));
  if (negative.ok) {
    throw new DriftShowcaseFailure(
      'frontend consumer typechecked cleanly against a MUTATED client — the drift-showcase negative control ' +
        'did not fire. A route response-shape change must break the frontend build at compile time.',
    );
  }
  if (!negative.output.includes('price') || !negative.output.includes('TS2339')) {
    throw new DriftShowcaseFailure(
      `frontend consumer failed to typecheck against the mutated client, but not for the expected reason ` +
        `(expected a TS2339 'price' property error):\n${negative.output}`,
    );
  }
  console.log(`  tsc exit ${negative.exitCode} — renaming price -> ${mutatedFieldName} breaks the frontend build:`);
  console.log(
    negative.output
      .trim()
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
  );

  console.log('\ndrift showcase passed: express == fastapi on the wire, and route drift breaks the frontend build.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await killProcess(expressServer);
  await killProcess(fastapiServer);
}
