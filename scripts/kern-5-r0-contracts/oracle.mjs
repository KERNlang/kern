import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { decodeKirV1 } from '../../packages/core/dist/kir-v1/canonical.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { canonicalJsonBytes, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { r0KirLimits } from './r0-abi-kir-limits.mjs';
import { compileJsSource } from './r0-abi-template-esm.mjs';
import { compilePySource } from './r0-abi-template-python.mjs';

function getProp(node, key) {
  return node.properties.find((p) => p.key === key)?.value;
}

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected fields`);
}

function safeIdentifier(value, label) {
  assert.equal(typeof value, 'string', `${label} must be text`);
  assert.match(value, /^[a-z0-9-]+$/u, `${label} must be portable`);
}

const reservedIdentifiers = new Set(['await', 'class', 'def', 'else', 'for', 'function', 'if', 'import', 'lambda', 'return']);
function safeCodeIdentifier(value, label) {
  assert.equal(typeof value, 'string', `${label} must be text`);
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/u, `${label} must be an ASCII identifier`);
  assert.equal(reservedIdentifiers.has(value), false, `${label} must not be reserved`);
}

function safeOutputPath(outputRoot, candidate, label) {
  const path = resolve(outputRoot, candidate);
  const root = resolve(outputRoot);
  assert.ok(path.startsWith(`${root}/`), `${label} must not escape output root`);
  return path;
}

export async function generateR0AbiArtifacts(input, options = {}) {
  assert.ok(input && typeof input === 'object', 'input must be an object');
  assert.equal(input.format, 'kern.r0.abi-probe-input.1');
  assert.ok(Array.isArray(input.cases), 'cases must be an array');
  const outputRoot = options.outputRoot;
  assert.ok(typeof outputRoot === 'string', 'outputRoot must be a string path');

  const cases = input.cases.map((caseInput) => {
    exactKeys(caseInput, ['entry', 'id', 'kirBytesHex', 'sourceEvidenceCatalog'], 'compile case');
    safeIdentifier(caseInput.id, 'compile case id');
    exactKeys(caseInput.entry, ['handlerName', 'moduleId'], 'compile entry');
    assert.equal(typeof caseInput.kirBytesHex, 'string', 'KIR bytes must be hex');
    assert.match(caseInput.kirBytesHex, /^(?:[0-9a-f]{2})+$/u, 'KIR bytes must be canonical lowercase hex');
    const kirBytes = Buffer.from(caseInput.kirBytesHex, 'hex');
    const kir = decodeKirV1(kirBytes, caseInput.sourceEvidenceCatalog, { limits: r0KirLimits });
    const semanticBytes = kir.semanticBytes;
    const evidenceBytes = kir.evidenceBytes;
    const semanticBytesHex = Buffer.from(semanticBytes).toString('hex');
    const evidenceBytesHex = Buffer.from(evidenceBytes).toString('hex');
    const kirSha256 = sha256Hex(kirBytes);
    const semanticSha256 = sha256Hex(semanticBytes);
    const evidenceSha256 = sha256Hex(evidenceBytes);

    const moduleKir = decodeModuleKir(semanticBytes, r0KirLimits);
    const mod = moduleKir.modules.find((m) => m.id === caseInput.entry.moduleId);
    assert.ok(mod, `module ${caseInput.entry.moduleId} not found`);
    const fn = mod.roots.find((r) => r.kind === 'fn' && getProp(r, 'name')?.value === caseInput.entry.handlerName);
    assert.ok(fn, `handler ${caseInput.entry.handlerName} not found in ${caseInput.entry.moduleId}`);

    const paramNames = fn.children.filter((c) => c.kind === 'param').map((p) => getProp(p, 'name').value);
    const handlerNode = fn.children.find((c) => c.kind === 'handler');
    assert.ok(handlerNode, 'fn is missing handler body');
    safeCodeIdentifier(caseInput.entry.handlerName, 'entry handler name');
    for (const name of paramNames) safeCodeIdentifier(name, 'parameter name');
    const capabilitySeal = handlerNode.children.filter((node) => node.kind === 'capability').map((node) => {
      const name = getProp(node, 'name')?.value;
      safeCodeIdentifier(name, 'capability binding');
      const namespace = getProp(node, 'namespace')?.value;
      const operation = getProp(node, 'operation')?.value;
      assert.equal(typeof namespace, 'string', 'capability namespace must be text');
      assert.equal(typeof operation, 'string', 'capability operation must be text');
      assert.notEqual(namespace, '', 'capability namespace must not be empty');
      assert.notEqual(operation, '', 'capability operation must not be empty');
      return { namespace, operation };
    });
    for (const node of handlerNode.children.filter((node) => node.kind === 'let')) safeCodeIdentifier(getProp(node, 'name')?.value, 'let binding');

    const compilerRequest = (target) => ({
      entry: caseInput.entry,
      format: 'kern.compiler.request.r0',
      kir: { bytesHex: caseInput.kirBytesHex, format: 'kern.kir.v1', sha256: kirSha256 },
      runtimeAbi: 'kern.runtime.kir.r0',
      target,
    });
    const jsCompilerRequestSha256 = sha256Hex(canonicalJsonBytes(compilerRequest('javascript-esm')));
    const pyCompilerRequestSha256 = sha256Hex(canonicalJsonBytes(compilerRequest('python')));
    const jsArtifactPath = `${kirSha256}/javascript-esm/main.mjs`;
    const pyArtifactPath = `${kirSha256}/python/main.py`;
    const jsManifestPath = `${kirSha256}/javascript-esm/manifest.json`;
    const pyManifestPath = `${kirSha256}/python/manifest.json`;
    const jsSource = compileJsSource({
      kirSha256,
      entry: caseInput.entry,
      artifactPath: jsArtifactPath,
      capabilitySeal,
      manifestFile: './manifest.json',
      paramNames,
      target: 'javascript-esm',
      handlerChildren: handlerNode.children,
    });
    const pySource = compilePySource({
      kirSha256,
      entry: caseInput.entry,
      artifactPath: pyArtifactPath,
      capabilitySeal,
      manifestFile: './manifest.json',
      paramNames,
      target: 'python',
      handlerChildren: handlerNode.children,
    });

    const jsArtifactBytes = Buffer.from(jsSource, 'utf8');
    const pyArtifactBytes = Buffer.from(pySource, 'utf8');
    const jsArtifactSha256 = sha256Hex(jsArtifactBytes);
    const pyArtifactSha256 = sha256Hex(pyArtifactBytes);

    const jsManifestValue = {
      artifacts: [
        {
          executable: true,
          mediaType: 'text/javascript',
          path: jsArtifactPath,
          sha256: jsArtifactSha256,
        },
      ],
      capabilities: capabilitySeal,
      entry: caseInput.entry,
      compilerRequestSha256: jsCompilerRequestSha256,
      format: 'kern.target.artifact.r0',
      kirSha256,
      runtimeAbi: 'kern.runtime.kir.r0',
      semanticSha256,
      target: 'javascript-esm',
    };
    const pyManifestValue = {
      artifacts: [
        {
          executable: true,
          mediaType: 'text/x-python',
          path: pyArtifactPath,
          sha256: pyArtifactSha256,
        },
      ],
      capabilities: capabilitySeal,
      entry: caseInput.entry,
      compilerRequestSha256: pyCompilerRequestSha256,
      format: 'kern.target.artifact.r0',
      kirSha256,
      runtimeAbi: 'kern.runtime.kir.r0',
      semanticSha256,
      target: 'python',
    };

    const jsManifestBytes = canonicalJsonBytes(jsManifestValue);
    const pyManifestBytes = canonicalJsonBytes(pyManifestValue);
    const jsManifestSha256 = sha256Hex(jsManifestBytes);
    const pyManifestSha256 = sha256Hex(pyManifestBytes);

    const fullJsArtifact = safeOutputPath(outputRoot, jsArtifactPath, 'JavaScript artifact path');
    const fullPyArtifact = safeOutputPath(outputRoot, pyArtifactPath, 'Python artifact path');
    const fullJsManifest = safeOutputPath(outputRoot, jsManifestPath, 'JavaScript manifest path');
    const fullPyManifest = safeOutputPath(outputRoot, pyManifestPath, 'Python manifest path');

    mkdirSync(dirname(fullJsArtifact), { recursive: true });
    mkdirSync(dirname(fullPyArtifact), { recursive: true });
    mkdirSync(dirname(fullJsManifest), { recursive: true });
    mkdirSync(dirname(fullPyManifest), { recursive: true });

    writeFileSync(fullJsArtifact, jsArtifactBytes);
    writeFileSync(fullPyArtifact, pyArtifactBytes);
    writeFileSync(fullJsManifest, jsManifestBytes);
    writeFileSync(fullPyManifest, pyManifestBytes);

    return {
      evidenceBytesHex,
      evidenceSha256,
      id: caseInput.id,
      kirBytesHex: caseInput.kirBytesHex,
      kirSha256,
      semanticBytesHex,
      semanticSha256,
      sourceEvidenceCatalog: caseInput.sourceEvidenceCatalog,
      targets: [
        {
          artifact: { path: jsArtifactPath, sha256: jsArtifactSha256 },
          compilerRequestSha256: jsCompilerRequestSha256,
          format: 'kern.compiler.result.r0',
          manifest: { path: jsManifestPath, sha256: jsManifestSha256 },
          target: 'javascript-esm',
        },
        {
          artifact: { path: pyArtifactPath, sha256: pyArtifactSha256 },
          compilerRequestSha256: pyCompilerRequestSha256,
          format: 'kern.compiler.result.r0',
          manifest: { path: pyManifestPath, sha256: pyManifestSha256 },
          target: 'python',
        },
      ],
    };
  });

  return {
    cases,
    format: 'kern.r0.abi-artifact-generation.1',
  };
}
