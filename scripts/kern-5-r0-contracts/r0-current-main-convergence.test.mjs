import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { encodeKirEvidence } from '../../packages/core/dist/kir-evidence/canonical.js';
import { encodeKirV1 } from '../../packages/core/dist/kir-v1/canonical.js';
import { reviewKernModuleSets } from '../../packages/review/dist/kir-preview/public.js';
import { generateR0AbiArtifacts } from './oracle.mjs';
import { assertGeneratedKirV1 } from './r0-abi-kir-auth.mjs';
import { r0KirLimits } from './r0-abi-kir-limits.mjs';
import {
  parseCanonicalJsonBytes,
  readCanonicalJsonFile,
  runTargetArtifact,
  sha256Hex,
} from './r0-abi-oracle-helpers.mjs';

const moduleId = 'r0/convergence.kern';
const entry = { moduleId, handlerName: 'compose' };
const limits = {
  maxBytes: 65536,
  maxCollectionLength: 128,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 16,
  maxStringBytes: 8192,
};

function sourceFor(operation) {
  return [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  param name=textList type=string[]',
    '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"',
    `    capability namespace=r0fixture operation=${operation} name=reply`,
    '    let name=result value="Json.stringify({ labels: textList, payload: payload, reply: reply })"',
    '    print value="result"',
    '    return value="result"',
    '',
  ].join('\n');
}

function wrapVerifiedProjection(verified, source) {
  const semanticBytes = verified.bytes;
  const sourceEvidenceCatalog = [{ moduleId, source }];
  const content = 'Json.parse(text)';
  const startByte = Buffer.byteLength(source.slice(0, source.indexOf(content)), 'utf8');
  const evidenceBytes = encodeKirEvidence(
    {
      semanticBytes,
      sources: sourceEvidenceCatalog,
      spans: [
        {
          content,
          endByte: startByte + Buffer.byteLength(content, 'utf8'),
          id: 'convergence-json-parse',
          moduleId,
          nodePath: [0, 2, 0],
          propertyKey: 'value',
          startByte,
        },
      ],
      diagnostics: [
        {
          category: 'validator',
          code: 'convergence-projection',
          id: 'convergence-projection',
          message: 'R0 binds the verified packaged frontend projection without reparsing it.',
          moduleId,
          severity: 'info',
          spanId: 'convergence-json-parse',
        },
      ],
    },
    { limits: r0KirLimits },
  );
  const kirBytes = encodeKirV1({ semanticBytes, evidenceBytes }, sourceEvidenceCatalog, {
    limits: r0KirLimits,
  });
  return { kirBytes, semanticBytes, sourceEvidenceCatalog };
}

function targetFor(generated, target) {
  const result = generated.targets.find((candidate) => candidate.target === target);
  assert.ok(result, `missing ${target} artifact`);
  return result;
}

function requestFor(generated, manifestSha256) {
  return {
    format: 'kern.runtime.kir.r0',
    requestId: 'r0-current-main-convergence',
    artifactManifestSha256: manifestSha256,
    kirSha256: generated.kirSha256,
    entry,
    arguments: {
      text: '{"items":[8,[13,21]],"meta":{"mode":"projected"}}',
      textList: ['current', 'main'],
    },
    capabilityTranscript: [
      {
        namespace: 'r0fixture',
        operation: 'resolveNext',
        input: { presence: 'absent' },
        result: { presence: 'value', value: { tag: 'text', value: 'capability-projected' } },
        delayTicks: 1,
      },
    ],
    control: { preCancelled: false, cancelAtTick: null, timeoutTicks: null },
    limits,
  };
}

test('current main frontend, R0 targets, and advisory Review converge on exact F5 semantic bytes', async () => {
  const base = { modules: [{ moduleId, source: sourceFor('resolve') }] };
  const head = { modules: [{ moduleId, source: sourceFor('resolveNext') }] };
  const projected = await projectKernModules(head);
  assert.equal(projected.status, 'projected');
  assert.deepEqual(projected.diagnostics, []);
  const verified = await verifyKernProjection(head, projected);
  assert.equal(verified.status, 'projected');
  assert.deepEqual(Buffer.from(verified.bytes), Buffer.from(projected.bytes));

  const wrapped = wrapVerifiedProjection(verified, head.modules[0].source);
  const compileCase = {
    id: 'current-main-convergence',
    entry,
    kirBytesHex: Buffer.from(wrapped.kirBytes).toString('hex'),
    sourceEvidenceCatalog: wrapped.sourceEvidenceCatalog,
  };
  assert.deepEqual(Object.keys(compileCase).sort(), ['entry', 'id', 'kirBytesHex', 'sourceEvidenceCatalog']);
  assert.deepEqual(Object.keys({ cases: [compileCase], format: 'kern.r0.abi-probe-input.1' }).sort(), [
    'cases',
    'format',
  ]);

  const outputRoot = mkdtempSync(resolve(tmpdir(), 'kern-r0-current-main-'));
  try {
    const generation = await generateR0AbiArtifacts(
      { cases: [compileCase], format: 'kern.r0.abi-probe-input.1' },
      { outputRoot },
    );
    const generated = generation.cases[0];
    assertGeneratedKirV1(generated, 'current-main convergence');
    assert.deepEqual(
      Buffer.from(generated.semanticBytesHex, 'hex'),
      Buffer.from(wrapped.semanticBytes),
      'accepted KIR v1 must preserve the exact verified F5 semantic bytes',
    );

    const responses = [];
    for (const targetName of ['javascript-esm', 'python']) {
      const target = targetFor(generated, targetName);
      const manifest = readCanonicalJsonFile(resolve(outputRoot, target.manifest.path), `${targetName} manifest`);
      assert.equal(manifest.value.entry.moduleId, moduleId);
      assert.deepEqual(manifest.value.capabilities, [{ namespace: 'r0fixture', operation: 'resolveNext' }]);
      const request = requestFor(generated, sha256Hex(manifest.bytes));
      responses.push(
        runTargetArtifact(targetName, resolve(outputRoot, target.artifact.path), request),
      );
    }
    assert.deepEqual(responses[0], responses[1], 'generated targets must emit byte-identical canonical envelopes');

    const expectedJson =
      '{"labels":["current","main"],"payload":{"items":[8,[13,21]],"meta":{"mode":"projected"}},"reply":"capability-projected"}';
    const envelope = parseCanonicalJsonBytes(responses[0], 'current-main convergence envelope');
    assert.deepEqual(envelope, {
      completion: { kind: 'return' },
      diagnostics: [],
      events: [
        {
          input: { presence: 'absent' },
          namespace: 'r0fixture',
          op: 'capability',
          operation: 'resolveNext',
          result: { presence: 'value', value: { tag: 'text', value: 'capability-projected' } },
        },
        { op: 'stdout', text: expectedJson },
      ],
      format: 'kern.runtime.kir.r0',
      outcome: 'success',
      requestId: 'r0-current-main-convergence',
      result: { presence: 'value', value: { tag: 'text', value: expectedJson } },
    });

    const review = await reviewKernModuleSets({ base, head, mode: 'canonical-kir-preview' });
    assert.equal(review.status, 'complete');
    assert.deepEqual(review.diagnostics, []);
    assert.equal(review.equalSemantics, false);
    assert.deepEqual(
      review.findings
        .filter((finding) => finding.facet === 'capabilities')
        .map(({ facet, change, before, after }) => ({ facet, change, before, after })),
      [
        {
          facet: 'capabilities',
          change: 'capability-changed',
          before: 'r0fixture/resolve',
          after: 'r0fixture/resolveNext',
        },
      ],
    );
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
  }
});
