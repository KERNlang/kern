import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import { generateR0AbiArtifacts } from './oracle.mjs';
import { assertGeneratedKirV1 } from './r0-abi-kir-auth.mjs';
import { assertExecutableR0Kir, buildCompileCase } from './r0-abi-test-kir.mjs';
import {
  parseCanonicalJsonBytes,
  readCanonicalJsonFile,
  resolveOutputFile,
  runTargetArtifact,
  sha256Hex,
} from './r0-abi-oracle-helpers.mjs';

const root = process.cwd();
const fixturePath = resolve(root, 'scripts/kern-5-r0-contracts/fixtures/topology-mutations.json');
const topologyFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
function programFor(runtimeCase) {
  if (runtimeCase.kirProgram) return runtimeCase.kirProgram;
  if (runtimeCase.capabilitySteps === 0) {
    return { entry: { moduleId: 'r0/no-capability.kern', handlerName: 'composeNoCapability' }, operations: [] };
  }
  if (runtimeCase.capabilitySteps === 1) {
    return { entry: { moduleId: 'r0/compose.kern', handlerName: 'compose' }, operations: ['resolve'] };
  }
  assert.equal(runtimeCase.capabilitySteps, 2, `unsupported R0 capability count for ${runtimeCase.id}`);
  return {
    entry: { moduleId: 'r0/two-capabilities.kern', handlerName: 'composeTwoCapabilities' },
    operations: ['resolve', 'resolveNext'],
  };
}

function compileInput(runtimeCases) {
  const cases = runtimeCases.map((runtimeCase) => {
    const program = programFor(runtimeCase);
    const compileCase = buildCompileCase({ id: runtimeCase.id, ...program });
    assertExecutableR0Kir(compileCase, program.operations);
    return compileCase;
  });
  const input = {
    format: 'kern.r0.abi-probe-input.1',
    cases,
  };
  assert.doesNotMatch(
    JSON.stringify(input),
    /"(?:arguments|capabilitySteps|capabilityTranscript|control|expectedJsonText|eventOps|errorCode|outcome|topology)"/u,
  );
  return input;
}

function assertTopologyFixture(fixture) {
  assert.equal(fixture.format, 'kern.r0.abi-topology-fixtures.1');
  assert.equal(fixture.cases.length, 9);
  assert.deepEqual(
    fixture.cases.map((entry) => entry.capabilitySteps),
    [0, 1, 2, 1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    fixture.cases.map((entry) => entry.eventOps),
    [
      ['stdout'],
      ['capability', 'stdout'],
      ['capability', 'capability', 'stdout'],
      [],
      [],
      [],
      [],
      [],
      ['capability', 'stdout'],
    ],
  );
  assert.deepEqual(
    fixture.cases.map((entry) => entry.outcome),
    ['success', 'success', 'success', 'failure', 'failure', 'failure', 'failure', 'failure', 'success'],
  );
  assert.deepEqual(
    fixture.cases.map((entry) => entry.control),
    [
      { preCancelled: false, cancelAtTick: null, timeoutTicks: null },
      { preCancelled: false, cancelAtTick: null, timeoutTicks: null },
      { preCancelled: false, cancelAtTick: null, timeoutTicks: null },
      { preCancelled: false, cancelAtTick: null, timeoutTicks: null },
      { preCancelled: true, cancelAtTick: null, timeoutTicks: null },
      { preCancelled: false, cancelAtTick: 1, timeoutTicks: null },
      { preCancelled: false, cancelAtTick: null, timeoutTicks: 1 },
      { preCancelled: false, cancelAtTick: null, timeoutTicks: 2 },
      { preCancelled: false, cancelAtTick: 2, timeoutTicks: null },
    ],
  );
  for (const entry of fixture.cases) {
    assert.deepEqual(Object.keys(entry.arguments).sort(), ['text', 'textList']);
    assert.equal(entry.capabilityTranscript.length, entry.capabilitySteps);
    if (entry.outcome === 'success') {
      assert.notEqual(entry.expectedJsonText, entry.arguments.text);
    }
    for (const step of entry.capabilityTranscript) {
      assert.equal(step.input.presence, 'absent');
      assert.equal(('result' in step) !== ('error' in step), true);
    }
  }
}

function assertEnvelope(caseFixture, envelope) {
  assert.equal(envelope.format, 'kern.runtime.kir.r0');
  assert.equal(envelope.outcome, caseFixture.outcome);
  assert.deepEqual(envelope.events.map((event) => event.op), caseFixture.eventOps);
  if (caseFixture.outcome === 'failure') {
    assert.deepEqual(envelope.events, []);
    assert.equal(envelope.result.presence, 'absent');
    assert.equal(envelope.completion.kind, 'error');
    assert.deepEqual(envelope.diagnostics.map((diagnostic) => diagnostic.code), [caseFixture.errorCode]);
    return;
  }
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'text');
  assert.equal(envelope.result.value.value, caseFixture.expectedJsonText);
  const stdout = envelope.events.find((event) => event.op === 'stdout');
  assert.ok(stdout, 'successful envelope must contain one stdout event');
  assert.equal(stdout.text, caseFixture.expectedJsonText);
  for (const event of envelope.events.filter((event) => event.op === 'capability')) {
    assert.equal(event.input.presence, 'absent');
  }
}

function resultFor(probe, id) {
  const result = probe.results.find((entry) => entry.id === id);
  assert.ok(result, `missing topology result ${id}`);
  return result;
}

function generatedCaseFor(generation, id) {
  const generated = generation.cases.find((entry) => entry.id === id);
  assert.ok(generated, `missing generated artifact case ${id}`);
  return generated;
}

function targetFor(generated, target) {
  const result = generated.targets.find((entry) => entry.target === target);
  assert.ok(result, `missing generated ${target} target`);
  return result;
}

function runtimeRequest(caseInput, generated, manifest) {
  return {
    format: 'kern.runtime.kir.r0',
    requestId: `r0-abi-${caseInput.id}`,
    artifactManifestSha256: manifest.sha256,
    kirSha256: generated.kirSha256,
    entry: manifest.value.entry,
    arguments: caseInput.arguments,
    capabilityTranscript: caseInput.capabilityTranscript,
    control: caseInput.control,
    limits: {
      maxBytes: 65536,
      maxCollectionLength: 128,
      maxDepth: 16,
      maxDiagnostics: 8,
      maxEvents: 16,
      maxIterations: 128,
      maxStringBytes: 8192,
    },
  };
}

function inspectTarget(outputRoot, authenticated, generated, target, forbiddenText) {
  assert.deepEqual(Object.keys(target).sort(), ['artifact', 'compilerRequestSha256', 'format', 'manifest', 'target']);
  assert.equal(target.format, 'kern.compiler.result.r0');
  assert.match(target.compilerRequestSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(target.artifact).sort(), ['path', 'sha256']);
  assert.deepEqual(Object.keys(target.manifest).sort(), ['path', 'sha256']);
  const artifactPath = resolveOutputFile(outputRoot, target.artifact.path, `${target.target} artifact path`);
  const manifestPath = resolveOutputFile(outputRoot, target.manifest.path, `${target.target} manifest path`);
  const manifest = readCanonicalJsonFile(manifestPath, `${target.target} target manifest`);
  const manifestSha256 = sha256Hex(manifest.bytes);
  assert.equal(target.manifest.sha256, manifestSha256);
  assert.equal(manifest.value.format, 'kern.target.artifact.r0');
  assert.equal(manifest.value.target, target.target);
  assert.equal(manifest.value.runtimeAbi, 'kern.runtime.kir.r0');
  assert.equal(manifest.value.kirSha256, authenticated.kirSha256);
  assert.equal(manifest.value.semanticSha256, authenticated.semanticSha256);

  const executable = manifest.value.artifacts.find((entry) => entry.executable === true);
  assert.ok(executable, `${target.target} target manifest needs one executable artifact`);
  assert.equal(executable.path, target.artifact.path);
  for (const listed of manifest.value.artifacts) {
    const listedPath = resolveOutputFile(outputRoot, listed.path, `${target.target} manifest artifact path`);
    const bytes = readFileSync(listedPath);
    assert.equal(listed.sha256, sha256Hex(bytes));
    if (/javascript|python|text/u.test(listed.mediaType)) {
      const source = bytes.toString('utf8');
      for (const forbidden of forbiddenText) {
        assert.equal(source.includes(forbidden), false, `${target.target} artifact embeds fixture answer ${forbidden}`);
      }
    }
  }

  const artifactBytes = readFileSync(artifactPath);
  assert.equal(target.artifact.sha256, sha256Hex(artifactBytes));
  assert.equal(executable.sha256, target.artifact.sha256);
  return { artifactPath, manifest: { ...manifest, sha256: manifestSha256 } };
}

async function generateAndExecute(runtimeCases) {
  const input = compileInput(runtimeCases);
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'kern-r0-abi-oracle-'));
  try {
    const generation = await generateR0AbiArtifacts(input, { outputRoot });
    assert.equal(generation.format, 'kern.r0.abi-artifact-generation.1');
    assert.deepEqual(
      generation.cases.map((entry) => entry.id),
      input.cases.map((entry) => entry.id),
    );
    const forbiddenText = topologyFixture.cases.flatMap((entry) => [entry.id, entry.expectedJsonText]).filter(Boolean);
    const results = input.cases.map((caseInput) => {
      const caseRuntime = runtimeCases.find((entry) => entry.id === caseInput.id);
      const generated = generatedCaseFor(generation, caseInput.id);
      const authenticated = assertGeneratedKirV1(generated, `${caseInput.id} generated KIR`);
      assert.deepEqual(generated.kirBytesHex, caseInput.kirBytesHex, `${caseInput.id} generator changed KIR authority`);
      assert.deepEqual(generated.sourceEvidenceCatalog, caseInput.sourceEvidenceCatalog, `${caseInput.id} generator changed evidence authority`);
      assert.match(generated.kirSha256, /^[0-9a-f]{64}$/u);
      assert.match(generated.semanticSha256, /^[0-9a-f]{64}$/u);
      const javascriptEsm = targetFor(generated, 'javascript-esm');
      const python = targetFor(generated, 'python');
      const jsArtifact = inspectTarget(outputRoot, authenticated, generated, javascriptEsm, forbiddenText);
      const pythonArtifact = inspectTarget(outputRoot, authenticated, generated, python, forbiddenText);
      const jsBytes = runTargetArtifact(
        'javascript-esm',
        jsArtifact.artifactPath,
        runtimeRequest(caseRuntime, generated, jsArtifact.manifest),
      );
      const pythonBytes = runTargetArtifact(
        'python',
        pythonArtifact.artifactPath,
        runtimeRequest(caseRuntime, generated, pythonArtifact.manifest),
      );
      assert.deepEqual(jsBytes, pythonBytes, `${caseInput.id} target stdout bytes differ`);
      return {
        id: caseInput.id,
        kirSha256: generated.kirSha256,
        semanticSha256: generated.semanticSha256,
        javascriptEsm: {
          artifactSha256: javascriptEsm.artifact.sha256,
          manifestSha256: javascriptEsm.manifest.sha256,
          canonicalEnvelopeBytesHex: jsBytes.toString('hex'),
          envelope: parseCanonicalJsonBytes(jsBytes, `${caseInput.id} JavaScript envelope`),
        },
        python: {
          artifactSha256: python.artifact.sha256,
          manifestSha256: python.manifest.sha256,
          canonicalEnvelopeBytesHex: pythonBytes.toString('hex'),
          envelope: parseCanonicalJsonBytes(pythonBytes, `${caseInput.id} Python envelope`),
        },
      };
    });
    return { generation, results, dispose: () => rmSync(outputRoot, { force: true, recursive: true }) };
  } catch (error) {
    rmSync(outputRoot, { force: true, recursive: true });
    throw error;
  }
}

test('R0 ABI test owns authenticated compile-only KIR inputs and runtime topology separately', () => {
  assertTopologyFixture(topologyFixture);
  const input = compileInput(topologyFixture.cases);
  assert.deepEqual(Object.keys(input).sort(), ['cases', 'format']);
  for (const entry of input.cases) {
    assert.deepEqual(Object.keys(entry).sort(), ['entry', 'id', 'kirBytesHex', 'sourceEvidenceCatalog']);
  }
});

test('both target artifacts execute every authenticated topology with identical canonical envelopes', async () => {
  const probe = await generateAndExecute(topologyFixture.cases);
  try {
    for (const caseFixture of topologyFixture.cases) {
      const result = resultFor(probe, caseFixture.id);
      assert.equal(result.javascriptEsm.canonicalEnvelopeBytesHex, result.python.canonicalEnvelopeBytesHex);
      assertEnvelope(caseFixture, result.javascriptEsm.envelope);
      assertEnvelope(caseFixture, result.python.envelope);
    }
  } finally {
    probe.dispose();
  }
});

test('two clean artifact generations preserve every target and manifest digest', async () => {
  const first = await generateAndExecute(topologyFixture.cases);
  const second = await generateAndExecute(topologyFixture.cases);
  try {
    for (const caseFixture of topologyFixture.cases) {
      const initial = resultFor(first, caseFixture.id);
      const repeated = resultFor(second, caseFixture.id);
      assert.equal(repeated.kirSha256, initial.kirSha256);
      assert.equal(repeated.semanticSha256, initial.semanticSha256);
      for (const target of ['javascriptEsm', 'python']) {
        assert.equal(repeated[target].artifactSha256, initial[target].artifactSha256);
        assert.equal(repeated[target].manifestSha256, initial[target].manifestSha256);
        assert.equal(repeated[target].canonicalEnvelopeBytesHex, initial[target].canonicalEnvelopeBytesHex);
      }
    }
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('topology mutations change authenticated semantic input and cannot reuse one target result', async () => {
  const probe = await generateAndExecute(topologyFixture.cases);
  try {
    const baseline = resultFor(probe, 'nested-record-list-no-capability');
    for (const caseFixture of topologyFixture.cases.slice(1, 3)) {
      const mutated = resultFor(probe, caseFixture.id);
      assert.notEqual(mutated.kirSha256, baseline.kirSha256, `${caseFixture.id} reused base KIR bytes`);
      assert.notEqual(
        mutated.semanticSha256,
        baseline.semanticSha256,
        `${caseFixture.id} reused base semantic bytes`,
      );
      assert.notEqual(
        mutated.javascriptEsm.canonicalEnvelopeBytesHex,
        baseline.javascriptEsm.canonicalEnvelopeBytesHex,
        `${caseFixture.id} reused the base JavaScript envelope`,
      );
      assert.notEqual(
        mutated.python.canonicalEnvelopeBytesHex,
        baseline.python.canonicalEnvelopeBytesHex,
        `${caseFixture.id} reused the base Python envelope`,
      );
    }
  } finally {
    probe.dispose();
  }
});

test('logical controls select the specified winner atomically without changing KIR input', async () => {
  const probe = await generateAndExecute(topologyFixture.cases);
  try {
    const settled = resultFor(probe, 'nested-record-list-one-capability-success');
    const controlCases = topologyFixture.cases.filter(
      (entry) =>
        entry.id !== 'nested-record-list-one-capability-success' &&
        (entry.control.preCancelled || entry.control.cancelAtTick !== null || entry.control.timeoutTicks !== null),
    );
    assert.deepEqual(
      controlCases.map((entry) => entry.id),
      ['pre-cancelled', 'cancel-before-settle', 'timeout-before-settle', 'timeout-tie-settle', 'success-after-settle'],
    );

    for (const caseFixture of controlCases) {
      const controlled = resultFor(probe, caseFixture.id);
      assert.equal(controlled.kirSha256, settled.kirSha256, `${caseFixture.id} changed KIR for runtime control`);
      assert.equal(
        controlled.semanticSha256,
        settled.semanticSha256,
        `${caseFixture.id} changed semantic KIR for runtime control`,
      );
      assertEnvelope(caseFixture, controlled.javascriptEsm.envelope);
      assertEnvelope(caseFixture, controlled.python.envelope);
    }
  } finally {
    probe.dispose();
  }
});

test('runtime and novel topology mutations require external target execution rather than fixture replay', async () => {
  const baseProbe = await generateAndExecute(topologyFixture.cases);
  const oneCapabilityCase = topologyFixture.cases.find(
    (entry) => entry.id === 'nested-record-list-one-capability-success',
  );
  assert.ok(oneCapabilityCase, 'one-capability fixture is required');

  const dynamicArgumentText = '{"items":[13,[21]],"meta":{"mode":"dynamic"}}';
  const expectedJsonText =
    '{"labels":["dynamic","input"],"payload":{"items":[13,[21]],"meta":{"mode":"dynamic"}},"reply":"capability-dynamic"}';
  const dynamicCase = {
    ...oneCapabilityCase,
    id: 'nested-record-list-one-capability-dynamic-input',
    arguments: { text: dynamicArgumentText, textList: ['dynamic', 'input'] },
    capabilityTranscript: oneCapabilityCase.capabilityTranscript.map((step) => ({
      ...step,
      result: {
        ...step.result,
        value: { ...step.result.value, value: 'capability-dynamic' },
      },
    })),
  };
  const novelArgumentText = '{"items":[34,[55]],"meta":{"mode":"novel"}}';
  const novelExpectedJsonText =
    '{"labels":["novel","topology"],"payload":{"items":[34,[55]],"meta":{"mode":"novel"}},"reply":"capability-novel"}';
  const novelCase = {
    ...dynamicCase,
    id: 'generated-novel-topology-identity',
    topology: 'nested-record-list-novel-reply',
    kirProgram: {
      entry: { moduleId: 'r0/generated-novel.kern', handlerName: 'composeNovel' },
      operations: ['resolveNovel'],
    },
    arguments: { text: novelArgumentText, textList: ['novel', 'topology'] },
    capabilityTranscript: dynamicCase.capabilityTranscript.map((step) => ({
      ...step,
      operation: 'resolveNovel',
      result: {
        ...step.result,
        value: { ...step.result.value, value: 'capability-novel' },
      },
    })),
  };
  const mutatedProbe = await generateAndExecute([dynamicCase, novelCase]);
  try {
    const baseline = resultFor(baseProbe, 'nested-record-list-one-capability-success');
    const dynamic = resultFor(mutatedProbe, dynamicCase.id);
    const novel = resultFor(mutatedProbe, novelCase.id);

    assert.equal(dynamic.kirSha256, baseline.kirSha256);
    assert.equal(dynamic.semanticSha256, baseline.semanticSha256);
    assert.notEqual(dynamic.javascriptEsm.canonicalEnvelopeBytesHex, baseline.javascriptEsm.canonicalEnvelopeBytesHex);
    assertEnvelope({ outcome: 'success', eventOps: ['capability', 'stdout'], expectedJsonText }, dynamic.javascriptEsm.envelope);
    assertEnvelope({ outcome: 'success', eventOps: ['capability', 'stdout'], expectedJsonText }, dynamic.python.envelope);
    assert.notEqual(novel.kirSha256, baseline.kirSha256);
    assert.notEqual(novel.semanticSha256, baseline.semanticSha256);
    assert.notEqual(novel.javascriptEsm.artifactSha256, baseline.javascriptEsm.artifactSha256);
    assert.notEqual(novel.python.artifactSha256, baseline.python.artifactSha256);
    assertEnvelope(
      { outcome: 'success', eventOps: ['capability', 'stdout'], expectedJsonText: novelExpectedJsonText },
      novel.javascriptEsm.envelope,
    );
    assertEnvelope(
      { outcome: 'success', eventOps: ['capability', 'stdout'], expectedJsonText: novelExpectedJsonText },
      novel.python.envelope,
    );
  } finally {
    baseProbe.dispose();
    mutatedProbe.dispose();
  }
});

test('synthetic KIR formats and source-evidence catalog drift fail authentication', async () => {
  const probe = await generateAndExecute([topologyFixture.cases[0]]);
  try {
    const generated = generatedCaseFor(probe.generation, topologyFixture.cases[0].id);
    assert.throws(
      () => assertGeneratedKirV1({ ...generated, kirBytesHex: generated.semanticBytesHex }, 'synthetic KIR'),
      /KirV1Error|KIR v1|components|format/u,
    );
    const sourceEvidenceCatalog = generated.sourceEvidenceCatalog.map((source, index) =>
      index === 0 ? { ...source, source: `${source.source}\n# catalog drift` } : source,
    );
    assert.throws(
      () => assertGeneratedKirV1({ ...generated, sourceEvidenceCatalog }, 'evidence mismatch'),
      /source.*binding|source bytes|evidence/u,
    );
  } finally {
    probe.dispose();
  }
});
