import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function encodeCanonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value), `canonical JSON only permits safe integer numbers, received ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(encodeCanonicalJson).join(',')}]`;
  assert.equal(typeof value, 'object', `canonical JSON rejects ${typeof value}`);
  const entries = Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${encodeCanonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${encodeCanonicalJson(value)}\n`, 'utf8');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseCanonicalJsonBytes(bytes, label) {
  assert.ok(Buffer.isBuffer(bytes), `${label} must be raw bytes`);
  assert.equal(bytes.at(-1), 0x0a, `${label} must end with one LF`);
  assert.notEqual(bytes.at(-2), 0x0a, `${label} must not end with two LFs`);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(bytes, canonicalJsonBytes(value), `${label} must use recursive code-point key ordering`);
  return value;
}

export function readCanonicalJsonFile(path, label) {
  return {
    bytes: readFileSync(path),
    value: parseCanonicalJsonBytes(readFileSync(path), label),
  };
}

export function resolveOutputFile(outputRoot, candidate, label) {
  assert.equal(isAbsolute(candidate), false, `${label} must be repository-relative to the generated output root`);
  const path = resolve(outputRoot, candidate);
  const rel = relative(outputRoot, path);
  assert.ok(rel !== '' && !rel.startsWith('../') && rel !== '..', `${label} must not escape generated output root`);
  return path;
}

function node22Path() {
  const path = process.env.KERN_NODE22 ?? process.execPath;
  const version = execFileSync(path, ['--version'], { encoding: 'utf8' }).trim();
  assert.match(version, /^v22\./u, `KERN_NODE22 or the test runner must be Node 22, received ${version}`);
  return path;
}

function run(command, args, input, label) {
  const result = spawnSync(command, args, {
    encoding: null,
    input,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} failed: ${result.stderr.toString('utf8')}`);
  return result.stdout;
}

export function runTargetArtifact(target, artifactPath, request) {
  const input = canonicalJsonBytes(request);
  if (target === 'javascript-esm') return run(node22Path(), [artifactPath], input, 'Node 22 target artifact');
  if (target === 'python') return run('python3', [artifactPath], input, 'Python target artifact');
  assert.fail(`unsupported target ${target}`);
}
