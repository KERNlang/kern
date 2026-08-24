#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../packages/core/dist/frontend-projection-assets/', import.meta.url));
const ENTRY = 'scripts/kern-frontend-f5-projection/worker.mjs';
const IMPORTS = /\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gu;
const CORE_PREFIX = '../../packages/core/dist/';
const F5_POLICY = 'scripts/kern-frontend-f5-projection/policy.json';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function portable(path) {
  return path.split(sep).join('/');
}

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath));
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath).toString('utf8'));
}

function scriptClosure() {
  const visited = new Set();
  const pending = [ENTRY];
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = read(current).toString('utf8');
    for (const match of source.matchAll(IMPORTS)) {
      const specifier = match[1];
      if (!specifier.startsWith('.') || specifier.startsWith(CORE_PREFIX)) continue;
      const target = portable(relative(ROOT, resolve(ROOT, dirname(current), specifier)));
      if (!target.startsWith('scripts/') || !target.endsWith('.mjs')) {
        throw new Error(`Frontend projection asset import escapes the script closure: ${current} -> ${specifier}`);
      }
      pending.push(target);
    }
  }
  return [...visited].sort();
}

function policyAssets() {
  const f5 = parseJson(F5_POLICY);
  const f4 = parseJson(f5.f4Policy.path);
  const f1 = parseJson(f4.f1Policy.path);
  const f2 = parseJson(f4.f2Policy.path);
  const f2b = parseJson(f4.f2bPolicy.path);
  const f3 = parseJson(f4.f3Policy.path);
  return [...new Set([
    F5_POLICY,
    f5.f4Policy.path,
    ...f5.composition.map((item) => item.path),
    ...f4.authorities.map((item) => item.path),
    f4.f1Policy.path,
    f4.f2Policy.path,
    f4.f2bPolicy.path,
    f4.f3Policy.path,
    ...f4.composition.map((item) => item.path),
    ...f1.modules,
    ...f2.modules,
    ...f2.parserFragments,
    f2.sourceLedger,
    f2.conformanceCorpus,
    f2.ruleCoverage,
    f2b.sourcePath,
    f3.sourcePath,
    f3.helperPath,
  ])].sort();
}

function projectionRuntimeLimits() {
  const f5 = parseJson(F5_POLICY);
  const f4 = parseJson(f5.f4Policy.path);
  const f1 = parseJson(f4.f1Policy.path);
  const f2 = parseJson(f4.f2Policy.path);
  const f2b = parseJson(f4.f2bPolicy.path);
  const f3 = parseJson(f4.f3Policy.path);
  const maxInputBytes = f5.runtimeLimits.maxBytes;
  const maxModules = Math.min(f5.profileLimits.maxModules, f4.profileLimits.maxModules);
  const jsonWorstCaseBytesPerInputByte = 6;
  const jsonFramingBytesPerModule = 64;
  const jsonFixedFramingBytes = 256;
  const maxAggregateInputBytes = Math.floor(
    (maxInputBytes - maxModules * jsonFramingBytesPerModule - jsonFixedFramingBytes) /
      jsonWorstCaseBytesPerInputByte,
  );
  const peakRssBytes = Math.max(
    f1.profileLimits.maxPeakRssBytes,
    f2.scalingWalls.maxPeakRssKiB * 1024,
    f2b.scalingWalls.maxPeakRssBytes,
    f3.scalingWalls.maxPeakRssBytes,
    f4.scalingWalls.maxPeakRssBytes,
  );
  const limits = {
    ipc: {
      maxErrorBytes: f5.canonicalLimits.maxStringBytes,
      maxInputBytes,
      maxOldSpaceMb: Math.ceil(peakRssBytes / (1024 * 1024)),
      maxOutputBytes: f5.runtimeLimits.maxBytes + f5.canonicalLimits.maxBytes,
      timeoutMs: f5.scheduler.timeoutMs,
    },
    wrapper: {
      maxAggregateInputBytes,
      maxAggregateInputScalars: Math.min(f5.profileLimits.maxInstructionScalars, maxAggregateInputBytes),
      maxModuleIdScalars: f4.profileLimits.maxModuleIdScalars,
      maxModuleIdSegments: f4.profileLimits.maxModuleIdSegments,
      maxModuleIdUtf8Bytes: Math.min(f4.runtimeLimits.maxStringBytes, f5.runtimeLimits.maxStringBytes),
      maxModules,
      maxSourceScalars: Math.min(
        f1.profileLimits.maxSourceScalars,
        f2.profileLimits.maxSourceScalars,
        f4.profileLimits.maxSourceScalars,
        f5.profileLimits.maxStringCodePoints,
      ),
      maxSourceUtf8Bytes: Math.min(
        f1.runtimeLimits.maxStringBytes,
        f2.runtimeLimits.maxStringBytes,
        f4.runtimeLimits.maxStringBytes,
        f5.runtimeLimits.maxStringBytes,
      ),
    },
  };
  for (const [section, values] of Object.entries(limits)) {
    for (const [name, value] of Object.entries(values)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Frontend projection ${section}.${name} must be a positive safe integer`);
      }
    }
  }
  return limits;
}

function rewriteScript(relativePath, source) {
  let rewritten = source.replaceAll('parseExpression', 'parseExpr(?:ession)');
  const coreDistPrefix = portable(relative(dirname(`frontend-projection-assets/${relativePath}`), '.'));
  rewritten = rewritten.replaceAll(`${CORE_PREFIX}index.js`, `${coreDistPrefix}/codegen/text-contract.js`);
  rewritten = rewritten.replaceAll(CORE_PREFIX, `${coreDistPrefix}/`);
  if (relativePath === 'scripts/kern-frontend-f5-projection/policy-validation.mjs') {
    const before = 'const descriptors = [policy.f4Policy, ...policy.mappingAuthorities, ...policy.composition];';
    const after = 'const descriptors = [policy.f4Policy, ...policy.composition];';
    if (!rewritten.includes(before)) throw new Error('Frontend projection F5 pin loader shape changed');
    rewritten = rewritten.replace(before, after);
  }
  return Buffer.from(rewritten);
}

function writeAsset(relativePath, bytes) {
  const destination = resolve(OUTPUT, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function sourceRecord(relativePath, bytes, outputBytes) {
  return {
    bytes: outputBytes.length,
    path: relativePath,
    sha256: sha256(outputBytes),
    sourceBytes: bytes.length,
    sourcePath: relativePath,
    sourceSha256: sha256(bytes),
  };
}

function generatedRuntimeAssets(limits) {
  const adapter = Buffer.from(`'use strict';
const { spawn } = require('node:child_process');
const { join } = require('node:path');

const runner = join(__dirname, 'runner.mjs');
const configuredLimits = ${JSON.stringify(limits)};
const limits = Object.freeze({
  ipc: Object.freeze(configuredLimits.ipc),
  wrapper: Object.freeze(configuredLimits.wrapper),
});

function invoke(payload) {
  return new Promise((resolve, reject) => {
    let input;
    try { input = JSON.stringify(payload); }
    catch (error) { reject(error); return; }
    if (Buffer.byteLength(input) > limits.ipc.maxInputBytes) {
      reject(new RangeError('projection asset input exceeds IPC limit'));
      return;
    }
    const child = spawn(process.execPath, [
      \`--max-old-space-size=\${limits.ipc.maxOldSpaceMb}\`, runner,
    ], { cwd: __dirname, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => fail(new Error('projection asset runner timed out')),
      limits.ipc.timeoutMs);
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation(value);
    };
    const fail = (error) => {
      if (settled) return;
      child.kill('SIGKILL');
      finish(reject, error);
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.ipc.maxOutputBytes) fail(new RangeError('projection asset output exceeds IPC limit'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > limits.ipc.maxErrorBytes) fail(new RangeError('projection asset error output exceeds IPC limit'));
      else stderr.push(chunk);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      const errorText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) finish(reject, new Error(errorText || \`projection asset runner exited \${code}\`));
      else {
        try { finish(resolve, JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
        catch (error) { finish(reject, error); }
      }
    });
    child.stdin.on('error', fail);
    child.stdin.end(input);
  });
}

Object.defineProperty(exports, 'limits', { enumerable: true, value: limits });
exports.project = (modules, budgets) => invoke({ action: 'project', budgets, modules });
exports.decode = (bytes, canonicalLimits) => invoke({ action: 'decode', bytes, canonicalLimits });
`);
  const runner = Buffer.from(`import { readFileSync } from 'node:fs';
import { decodeModuleKir } from '../kir-structural/module-canonical.js';
import { __test, runProjection } from './scripts/kern-frontend-f5-projection/worker.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (input.action === 'project') {
  const result = input.budgets === undefined
    ? runProjection(input.modules)
    : __test.runProjectionWithProfileLimits(input.modules, input.budgets);
  const policy = JSON.parse(readFileSync(new URL('./scripts/kern-frontend-f5-projection/policy.json', import.meta.url), 'utf8'));
  process.stdout.write(JSON.stringify({
    artifact: result.bytes === null ? null : decodeModuleKir(result.bytes, policy.canonicalLimits),
    bytes: result.bytes === null ? null : Buffer.from(result.bytes).toString('base64'),
    receipt: result.receipt,
  }));
} else if (input.action === 'decode') {
  const bytes = Uint8Array.from(Buffer.from(input.bytes, 'base64'));
  process.stdout.write(JSON.stringify({ artifact: decodeModuleKir(bytes, input.canonicalLimits) }));
} else throw new TypeError('projection asset runner action');
`);
  return [
    { bytes: adapter, path: 'adapter.cjs' },
    { bytes: runner, path: 'runner.mjs' },
  ];
}

export function buildKernFrontendProjectionAssets(output = OUTPUT) {
  if (output !== OUTPUT) throw new Error('Frontend projection assets have one package-owned destination');
  const scripts = scriptClosure();
  const data = policyAssets();
  const limits = projectionRuntimeLimits();
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const assets = [];
  for (const relativePath of scripts) {
    const bytes = read(relativePath);
    const outputBytes = rewriteScript(relativePath, bytes.toString('utf8'));
    writeAsset(relativePath, outputBytes);
    assets.push(sourceRecord(relativePath, bytes, outputBytes));
  }
  for (const relativePath of data) {
    const bytes = read(relativePath);
    writeAsset(relativePath, bytes);
    assets.push(sourceRecord(relativePath, bytes, bytes));
  }
  for (const generated of generatedRuntimeAssets(limits)) {
    writeAsset(generated.path, generated.bytes);
    assets.push({
      bytes: generated.bytes.length,
      path: generated.path,
      sha256: sha256(generated.bytes),
      sourceBytes: generated.bytes.length,
      sourcePath: generated.path,
      sourceSha256: sha256(generated.bytes),
    });
  }

  const f5PolicyBytes = read(F5_POLICY);
  const f5 = JSON.parse(f5PolicyBytes.toString('utf8'));
  const compositionBytes = Buffer.from(f5.composition.map((item) => read(item.path).toString('utf8')).join('\n'));
  const manifest = {
    assets: assets.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    canonicalLimits: f5.canonicalLimits,
    compositionDigest: sha256(compositionBytes),
    entry: ENTRY,
    f5PolicyDigest: sha256(f5PolicyBytes),
    format: 'kern.frontend.packaged-projection-assets.1',
    profileLimits: f5.profileLimits,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  writeAsset('assets.json', manifestBytes);
  return {
    assets: manifest.assets.length,
    bytes: manifest.assets.reduce((total, item) => total + item.bytes, manifestBytes.length),
    manifestSha256: sha256(manifestBytes),
    output,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildKernFrontendProjectionAssets();
  if (!statSync(built.output).isDirectory()) throw new Error('Frontend projection asset output was not created');
  process.stdout.write(
    `KERN frontend projection assets: ${built.assets} files, ${built.bytes} bytes, manifest SHA-256 ${built.manifestSha256}.\n`,
  );
}
