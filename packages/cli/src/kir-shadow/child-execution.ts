import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { KernKirRequest } from '@kernlang/core/runtime/kir';
import type { ShadowCompilations } from './compile-report.js';
import { KIR_SHADOW_CHILD_MAX_BYTES, KIR_SHADOW_CHILD_TIMEOUT_MS } from './limits.js';
import { normalizeEnvelope } from './normalize.js';
import type { NormalizedEnvelope } from './types.js';
import { KirShadowUnavailableError } from './types.js';

const CHILD_ENV = Object.freeze({ LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });

const JAVASCRIPT_DRIVER = `
const chunks=[];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
if(payload.format!=='kern.cli.kir-shadow.javascript.1') throw new Error('frame');
const module=await import('data:text/javascript;base64,'+payload.artifact);
const envelope=await module.execute(payload.request);
process.stdout.write(JSON.stringify({format:'kern.cli.kir-shadow.javascript.1',manifest:module.manifest,envelope}));
`;

const PYTHON_DRIVER = `
import asyncio, base64, builtins, io, json, sys
payload = json.loads(sys.stdin.read())
if payload.get("format") != "kern.cli.kir-shadow.python.1":
    raise RuntimeError("frame")
artifact = base64.b64decode(payload["artifact"], validate=True)
virtual_path = "<kern-cli-kir-shadow-entry>"
real_open = builtins.open
def virtual_open(path, mode="r", *args, **kwargs):
    if path == virtual_path and mode == "rb":
        return io.BytesIO(artifact)
    raise PermissionError("filesystem unavailable")
builtins.open = virtual_open
namespace = {"__builtins__": builtins, "__file__": virtual_path, "__name__": "kern_cli_kir_shadow_entry"}
try:
    exec(compile(artifact, virtual_path, "exec"), namespace)
    def deny_filesystem(event, args):
        if event in ("open", "os.system", "os.posix_spawn", "subprocess.Popen"):
            raise PermissionError("filesystem unavailable")
    sys.addaudithook(deny_filesystem)
    envelope = asyncio.run(namespace["execute"](payload["request"]))
finally:
    builtins.open = real_open
response = {"format": "kern.cli.kir-shadow.python.1", "manifest": namespace["manifest"], "envelope": envelope}
sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
`;

function parseResponse(stdout: string, format: string, manifest: unknown): NormalizedEnvelope {
  if (Buffer.byteLength(stdout) > KIR_SHADOW_CHILD_MAX_BYTES)
    throw new KirShadowUnavailableError('child-response-too-large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new KirShadowUnavailableError('child-response-malformed');
  const response = parsed as Record<string, unknown>;
  if (
    !isDeepStrictEqual(Object.keys(response).sort(), ['envelope', 'format', 'manifest']) ||
    response.format !== format ||
    !isDeepStrictEqual(response.manifest, manifest)
  ) {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  return normalizeEnvelope(response.envelope);
}

function runChild(executable: string, args: readonly string[], input: string, failureCode: string): string {
  const run = spawnSync(executable, args, {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: CHILD_ENV,
    input,
    maxBuffer: KIR_SHADOW_CHILD_MAX_BYTES,
    timeout: KIR_SHADOW_CHILD_TIMEOUT_MS,
    windowsHide: true,
  });
  if (run.error || run.signal !== null || run.status !== 0) {
    throw new KirShadowUnavailableError(failureCode);
  }
  return run.stdout;
}

function executableOnPath(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function pythonExecutable(): string {
  const configured = process.env.KERN_PYTHON ?? 'python3';
  const executable = isAbsolute(configured) ? configured : executableOnPath(configured);
  if (!executable) throw new KirShadowUnavailableError('python-host-missing');
  const output = runChild(
    executable,
    ['-I', '-S', '-B', '-c', 'import json,sys;sys.stdout.write(json.dumps(list(sys.version_info[:3])))'],
    '',
    'python-host-unavailable',
  );
  let version: unknown;
  try {
    version = JSON.parse(output);
  } catch {
    throw new KirShadowUnavailableError('python-host-unavailable');
  }
  if (!Array.isArray(version) || version.length !== 3 || version.some((part) => !Number.isSafeInteger(part))) {
    throw new KirShadowUnavailableError('python-host-unavailable');
  }
  if ((version[0] as number) !== 3 || (version[1] as number) < 12) {
    throw new KirShadowUnavailableError('python-host-too-old');
  }
  return executable;
}

export function executeJavaScriptChild(
  compilation: ShadowCompilations['javascriptEsm'],
  request: KernKirRequest,
): NormalizedEnvelope {
  const input = JSON.stringify({
    artifact: Buffer.from(compilation.artifact.bytes).toString('base64'),
    format: 'kern.cli.kir-shadow.javascript.1',
    request,
  });
  const stdout = runChild(
    process.execPath,
    ['--experimental-permission', '--input-type=module', '--eval', JAVASCRIPT_DRIVER],
    input,
    'javascript-child-unavailable',
  );
  const manifest = JSON.parse(new TextDecoder().decode(compilation.manifest.bytes));
  return parseResponse(stdout, 'kern.cli.kir-shadow.javascript.1', manifest);
}

export function executePythonChild(
  compilation: ShadowCompilations['python'],
  request: KernKirRequest,
): NormalizedEnvelope {
  const input = JSON.stringify({
    artifact: Buffer.from(compilation.artifact.bytes).toString('base64'),
    format: 'kern.cli.kir-shadow.python.1',
    request,
  });
  const stdout = runChild(
    pythonExecutable(),
    ['-I', '-S', '-B', '-X', 'utf8', '-c', PYTHON_DRIVER],
    input,
    'python-child-unavailable',
  );
  const manifest = JSON.parse(new TextDecoder().decode(compilation.manifest.bytes));
  return parseResponse(stdout, 'kern.cli.kir-shadow.python.1', manifest);
}
