import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { emitDjangoAdapter } from '../packages/python/dist/adapters/django.js';

async function main() {
  console.log('--- STARTING DJANGO ADAPTER SMOKE TEST ---');

  // 1. Construct synthetic PurePythonHandler
  const syntheticHandler = {
    method: 'POST',
    path: '/double',
    fnName: 'handle_post_double',
    signature: 'def handle_post_double(request: dict) -> tuple:',
    bodyLines: [
      "    body = request.get('body', {})",
      "    value = body.get('value')",
      "    if not isinstance(value, (int, float)):",
      "        return 400, {'detail': 'invalid input type'}",
      "    if value < 5:",
      "        return 422, {'detail': 'min guard failed'}",
      "    return 200, {'result': value * 2}"
    ],
    imports: new Set(['import json']),
    pathParamTypes: {},
    queryParamTypes: {},
    responseHeaders: {}
  };

  // 2. Call emitDjangoAdapter
  console.log('Emitting Django adapter artifacts...');
  const artifacts = emitDjangoAdapter([syntheticHandler]);

  // 3. Write files to a temporary directory in the workspace
  const tempDirName = `temp-django-smoke-${Math.floor(Math.random() * 1000000)}`;
  const tempDir = path.resolve(tempDirName);
  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`Created temp directory at: ${tempDir}`);

  // Write the 5 files
  fs.writeFileSync(path.join(tempDir, 'urls.py'), artifacts.urlsPy);
  fs.writeFileSync(path.join(tempDir, 'views.py'), artifacts.viewsPy);
  fs.writeFileSync(path.join(tempDir, 'settings.py'), artifacts.settingsPy);
  fs.writeFileSync(path.join(tempDir, 'manage.py'), artifacts.managePy);
  fs.writeFileSync(path.join(tempDir, 'pure_handlers.py'), artifacts.pureHandlersPy);

  // Make manage.py executable
  fs.chmodSync(path.join(tempDir, 'manage.py'), '755');

  let serverProcess = null;

  try {
    // 8. Behavioral Portability Check
    console.log('Running behavioral portability check (direct Python invocation)...');
    const testPortabilityPy = `
import sys
from pure_handlers import handle_post_double

# Test 1: {"value": 6} -> (200, {"result": 12})
req1 = {
    "method": "POST",
    "path_params": {},
    "query": {},
    "body": {"value": 6},
    "headers": {},
    "user": None
}
status1, body1 = handle_post_double(req1)
print(f"Portability Test 1 result: status={status1}, body={body1}")
if status1 != 200 or body1 != {"result": 12}:
    print("FAIL: Portability Test 1 failed", file=sys.stderr)
    sys.exit(1)

# Test 2: {"value": 4} -> (422, {"detail": "min guard failed"})
req2 = {
    "method": "POST",
    "path_params": {},
    "query": {},
    "body": {"value": 4},
    "headers": {},
    "user": None
}
status2, body2 = handle_post_double(req2)
print(f"Portability Test 2 result: status={status2}, body={body2}")
if status2 != 422 or body2 != {"detail": "min guard failed"}:
    print("FAIL: Portability Test 2 failed", file=sys.stderr)
    sys.exit(1)

print("SUCCESS: Portability tests passed")
sys.exit(0)
`;
    fs.writeFileSync(path.join(tempDir, 'test_portability.py'), testPortabilityPy);
    execSync('python3 test_portability.py', { cwd: tempDir, stdio: 'inherit' });

    // 4. Boot via spawn
    const port = Math.floor(Math.random() * 10000) + 30000;
    console.log(`Booting Django server on port ${port}...`);
    
    serverProcess = spawn('python3', [
      'manage.py',
      'runserver',
      '--noreload',
      `127.0.0.1:${port}`
    ], {
      cwd: tempDir
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Django stdout]: ${data.toString().trim()}`);
    });
    serverProcess.stderr.on('data', (data) => {
      console.error(`[Django stderr]: ${data.toString().trim()}`);
    });

    // 5. WaitFor the server
    console.log('Waiting for Django server to respond...');
    const serverReady = await waitForServer(port);
    if (!serverReady) {
      throw new Error('Timeout waiting for Django server to start');
    }
    console.log('Django server is UP and responding!');

    // 6. Assertions using curl/fetch
    console.log('Testing {"value": 6} -> Expecting 200 and result 12');
    const res1 = await fetch(`http://127.0.0.1:${port}/double`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 6 })
    });
    if (res1.status !== 200) {
      throw new Error(`Expected status 200, got ${res1.status}`);
    }
    const body1 = await res1.json();
    console.log('Received response:', body1);
    if (body1.result !== 12) {
      throw new Error(`Expected result 12, got ${JSON.stringify(body1)}`);
    }

    console.log('Testing {"value": 4} -> Expecting 422 and "min guard failed"');
    const res2 = await fetch(`http://127.0.0.1:${port}/double`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 4 })
    });
    if (res2.status !== 422) {
      throw new Error(`Expected status 422, got ${res2.status}`);
    }
    const body2 = await res2.json();
    console.log('Received response:', body2);
    if (body2.detail !== 'min guard failed') {
      throw new Error(`Expected detail "min guard failed", got ${JSON.stringify(body2)}`);
    }

    console.log('--- ALL SMOKE TESTS PASSED ---');
  } finally {
    if (serverProcess) {
      console.log('Killing Django server process...');
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Clean up temp dir
    try {
      console.log('Cleaning up temporary files...');
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Error during cleanup:', e);
    }
  }
}

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/double`;
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 6 })
      });
      if (res.status === 200 || res.status === 400 || res.status === 422) {
        return true;
      }
    } catch (e) {
      // Ignore network errors during startup
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
