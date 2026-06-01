import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 7000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      if (response.status === 422 || response.status === 400 || response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

const temp = await mkdtemp(join(tmpdir(), 'kern-go-smoke-'));
let server;

try {
  await run('pnpm', ['--filter', '@kernlang/cli', 'build']);

  const source = `interface name=Input
  field name=value type=number

server name=GoSmoke port=0
  route method=post path=/double
    validate Input
    derive name=doubled expr={{body.value * 2}}
    guard name=min expr={{doubled >= 10}} else=422
    respond 200 json={{ { result: doubled } }}
`;
  const fixture = join(temp, 'go-smoke.kern');
  await writeFile(fixture, source);

  await run('node', [join(root, 'packages/cli/dist/cli.js'), fixture, '--target=go', '--emit=backend'], { cwd: temp });

  const generated = await readFile(join(temp, 'routes.go'), 'utf8');
  assert.match(generated, /doubled := kernrt\.Number\(kernrt\.Get\(body, "value"\)\) \* 2/);

  // Verify everything compiles, then build a real binary and run THAT directly.
  // `go run .` execs a child binary that outlives a SIGTERM sent to `go run`,
  // orphaning the server and holding this process's stdio pipes open forever
  // (the harness would hang). Running the built binary lets `server.kill()`
  // terminate the actual server so cleanup is clean.
  await run('go', ['build', './...'], { env: { GOWORK: 'off' }, cwd: temp });
  const serverBin = join(temp, 'kern-go-server');
  await run('go', ['build', '-o', serverBin, '.'], { env: { GOWORK: 'off' }, cwd: temp });

  const port = String(41000 + Math.floor(Math.random() * 1000));
  server = spawn(serverBin, [], {
    cwd: temp,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: port, GOWORK: 'off' },
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk;
  });

  await waitFor(`http://127.0.0.1:${port}/double`);

  const rejected = await fetch(`http://127.0.0.1:${port}/double`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 4 }),
  });
  assert.equal(rejected.status, 422);
  assert.deepEqual(await rejected.json(), { detail: 'min guard failed' });

  const accepted = await fetch(`http://127.0.0.1:${port}/double`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 6 }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { result: 12 });

  server.kill('SIGTERM');
} catch (error) {
  if (server) server.kill('SIGTERM');
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
