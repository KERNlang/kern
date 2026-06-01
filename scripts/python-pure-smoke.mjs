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
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

const temp = await mkdtemp(join(tmpdir(), 'kern-python-smoke-'));

try {
  const source = `interface name=Input
  field name=value type=number

server name=PureSmoke port=0
  route method=post path=/double
    validate Input
    derive name=doubled expr={{body.value * 2}}
    guard name=min expr={{doubled >= 10}} else=422
    respond 200 json={{ { result: doubled } }}
`;
  const fixture = join(temp, 'python-smoke.kern');
  await writeFile(fixture, source);

  // Transpile the fixture
  await run('node', [
    join(root, 'packages/cli/dist/cli.js'),
    fixture,
    '--target=python',
    '--emit=backend',
  ], { cwd: temp });

  const generatedPath = join(temp, 'python_smoke.py');
  const generatedCode = await readFile(generatedPath, 'utf8');

  // Verify that there are absolutely no leaked framework imports
  assert.ok(!generatedCode.includes('from fastapi'), 'Leaked from fastapi import');
  assert.ok(!generatedCode.includes('import fastapi'), 'Leaked import fastapi');
  assert.ok(!generatedCode.includes('from pydantic'), 'Leaked from pydantic import');
  assert.ok(!generatedCode.includes('import pydantic'), 'Leaked import pydantic');
  assert.ok(!generatedCode.includes('HTTPException'), 'Leaked HTTPException');
  assert.ok(!generatedCode.includes('JSONResponse'), 'Leaked JSONResponse');
  assert.ok(!generatedCode.includes('Depends('), 'Leaked Depends');

  // Execute the generated python handler with hand-built PureRequest
  const pythonScript = `
import sys
sys.path.append('${temp}')
from python_smoke import handle_post_double

# 1. Test rejected guard case
req1 = {
    'method': 'POST',
    'path_params': {},
    'query': {},
    'body': {'value': 4},
    'headers': {},
    'user': None
}
res1 = handle_post_double(req1)
print("Rejected Result:", res1)
assert isinstance(res1, tuple), f"Expected tuple but got {type(res1)}"
assert res1[0] == 422, f"Expected status 422 but got {res1[0]}"
assert res1[1] == {"detail": "min guard failed"}, f"Expected detail but got {res1[1]}"

# 2. Test successful response case
req2 = {
    'method': 'POST',
    'path_params': {},
    'query': {},
    'body': {'value': 6},
    'headers': {},
    'user': None
}
res2 = handle_post_double(req2)
print("Successful Result:", res2)
assert isinstance(res2, tuple), f"Expected tuple but got {type(res2)}"
assert res2[0] == 200, f"Expected status 200 but got {res2[0]}"
assert res2[1] == {"result": 12} or res2[1] == {"result": 12.0}, f"Expected result 12 but got {res2[1]}"

print("SMOKE SUCCESS")
`;

  const scriptPath = join(temp, 'assert_smoke.py');
  await writeFile(scriptPath, pythonScript);

  const { stdout, stderr } = await run('python3', [scriptPath], { cwd: temp });
  console.log(stdout);
  if (stderr) console.error(stderr);

  assert.ok(stdout.includes('SMOKE SUCCESS'), 'Python smoke test assertions failed to complete successfully');
  console.log('Pure Python smoke test passed!');
} finally {
  await rm(temp, { recursive: true, force: true });
}
