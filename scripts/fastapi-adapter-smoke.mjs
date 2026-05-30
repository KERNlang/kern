import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { emitFastAPIAdapter } from '../packages/python/dist/adapters/fastapi.js';

const root = resolve(new URL('..', import.meta.url).pathname);

async function waitFor(url) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 6 }), // valid value that returns 200
      });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function killProcess(child, timeoutMs = 5000) {
  return new Promise((resolveKill) => {
    let finished = false;
    child.on('exit', () => {
      finished = true;
      resolveKill();
    });
    
    child.kill('SIGTERM');
    
    setTimeout(() => {
      if (!finished) {
        console.warn('Uvicorn process did not exit on SIGTERM. Escalating to SIGKILL.');
        child.kill('SIGKILL');
        resolveKill();
      }
    }, timeoutMs);
  });
}

const temp = await mkdtemp(join(tmpdir(), 'kern-fastapi-smoke-'));
let server;

try {
  // Ensure dependencies are installed (in case they are not, per instructions)
  try {
    execSync('python3 -c "import fastapi, uvicorn"', { stdio: 'ignore' });
  } catch {
    console.log('fastapi or uvicorn not found, installing...');
    execSync('python3 -m pip install --user fastapi uvicorn', { stdio: 'inherit' });
  }

  // 5a. Construct synthetic PurePythonHandler
  const syntheticHandler = {
    method: 'POST',
    path: '/double',
    fnName: 'handle_double',
    signature: 'def handle_double(request: dict) -> tuple:',
    bodyLines: [
      '    value = request["body"].get("value", 0)',
      '    doubled = value * 2',
      '    if doubled < 10:',
      '        return (422, {"detail": "min guard failed"})',
      '    return (200, {"result": doubled})',
    ],
    imports: new Set(),
    pathParamTypes: {},
    queryParamTypes: {},
    validatesSchema: undefined,
    responseHeaders: {},
  };

  // 5b. Call emitFastAPIAdapter
  const { appPy, pureHandlersPy } = emitFastAPIAdapter([syntheticHandler]);

  // 5c. Write to a temp dir
  await writeFile(join(temp, 'app.py'), appPy);
  await writeFile(join(temp, 'pure_handlers.py'), pureHandlersPy);
  await writeFile(join(temp, '__init__.py'), '');

  console.log('Emitted app.py:');
  console.log(appPy);
  console.log('Emitted pure_handlers.py:');
  console.log(pureHandlersPy);

  // 6. Run BEHAVIORAL portability check first (before starting FastAPI server)
  console.log('Running behavioral portability check...');
  execSync(
    `python3 -c "import pure_handlers; result = pure_handlers.handle_double({'method': 'POST', 'path_params': {}, 'query': {}, 'body': {'value': 6}, 'headers': {}, 'user': None}); assert result == (200, {'result': 12}), result"`,
    { cwd: temp, stdio: 'inherit' }
  );
  console.log('Behavioral portability check passed!');

  // 5d. Boot via uvicorn
  const port = String(42000 + Math.floor(Math.random() * 1000));
  console.log(`Starting uvicorn server on port ${port}...`);

  server = spawn('python3', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', port, '--no-access-log'], {
    cwd: temp,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  server.stdout.on('data', (chunk) => {
    console.log(`[uvicorn stdout]: ${chunk}`);
  });
  server.stderr.on('data', (chunk) => {
    console.error(`[uvicorn stderr]: ${chunk}`);
  });

  await waitFor(`http://127.0.0.1:${port}/double`);
  console.log('Uvicorn server is up and running!');

  // 5e. Curl POST /double with {"value": 6} -> expect 200 {"result": 12}
  console.log('Testing path with valid value...');
  const accepted = await fetch(`http://127.0.0.1:${port}/double`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 6 }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { result: 12 });
  console.log('Valid value test passed!');

  // Curl with {"value": 4} -> expect 422 {"detail": "min guard failed"}
  console.log('Testing path with invalid value...');
  const rejected = await fetch(`http://127.0.0.1:${port}/double`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 4 }),
  });
  assert.equal(rejected.status, 422);
  assert.deepEqual(await rejected.json(), { detail: 'min guard failed' });
  console.log('Invalid value test passed!');

  console.log('All tests passed successfully!');
} catch (error) {
  console.error('Smoke test failed:', error);
  process.exitCode = 1;
} finally {
  if (server) {
    console.log('Stopping uvicorn server...');
    await killProcess(server);
  }
  await rm(temp, { recursive: true, force: true });
}
