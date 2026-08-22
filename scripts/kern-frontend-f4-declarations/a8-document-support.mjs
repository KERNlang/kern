import { readFileSync } from 'node:fs';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { loadPolicy as loadF2Policy } from '../kern-frontend-f2-expression/decoder.mjs';
import { loadComposition as loadF2Composition } from '../kern-frontend-f2-expression/worker.mjs';
import { decodeDocument, sha256 } from './decoder.mjs';
import { DOCUMENT_FIXTURES } from './fixtures.mjs';
import { renderAuthority } from './generate-authority.mjs';
import {
  COMPOSITION_PATHS,
  F3_COMPOSITION_PATHS,
  F4_COMPOSITION_PATHS,
} from './policy-validation.mjs';
import { __test, loadPolicy } from './worker.mjs';

const ROOT = new URL('../../', import.meta.url);
const sourceAt = (path) => readFileSync(new URL(path, ROOT), 'utf8');

function decoderContext(captured) {
  return {
    moduleId: captured.moduleId,
    sourceScalars: Array.from(captured.source).length,
    sourceSha256: sha256(captured.source),
    sourcePoints: Array.from(captured.source),
    propertyAuthority: captured.propertyAuthority,
    f2Policy: captured.f2Policy,
    f2bSegments: captured.f2bSegments,
    f2bExpressions: captured.f2bExpressions,
    f2bAbsoluteSpans: captured.f2bAbsoluteSpans,
  };
}

export function captureF4ADocument(moduleId, source) {
  const captured = __test.runDocumentWithTestInput(moduleId, source, { mutateInput() {} });
  if (captured.__testOutcome !== 'returned' || captured.runtimeInvocations !== 1 ||
      captured.__testActualArgs?.length !== 109) {
    throw new Error(`authentic F4A capture failed: ${captured.__testError ?? 'invalid result'}`);
  }
  const input = captured.__testInput;
  const batch = captured.prerequisites.batch;
  return Object.freeze({
    moduleId,
    source,
    args: captured.__testActualArgs,
    fields: captured.fields,
    receipt: captured.receipt,
    policy: loadPolicy().policy,
    propertyAuthority: Object.freeze({
      nodeKinds: input.authorities.propertyNodes,
      propertyNames: input.authorities.propertyNames,
      schemaKinds: input.authorities.propertyKinds,
      required: input.authorities.propertyRequired,
      dispositions: input.authorities.propertyDispositions,
    }),
    f2Policy: loadF2Policy(),
    f2bSegments: batch?.receipt.segments ?? [],
    f2bExpressions: batch?.expressions ?? [],
    f2bAbsoluteSpans: batch?.receipt.absoluteSpans ?? [],
  });
}

export function decodeCapturedDocument(fields, captured) {
  return decodeDocument(fields, decoderContext(captured));
}

export function executeF4AComposition(source, args, policy) {
  const rawEnvelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: args,
    identity: {
      handlerName: 'classifyf4document',
      sourcePath: 'examples/kern-frontend/f4-declarations-main.kern',
    },
    source,
  }, {
    enabled: true,
    limits: policy.runtimeLimits,
    scheduler: policy.scheduler,
  });
  const valid = rawEnvelope.outcome === 'success' && rawEnvelope.completion.kind === 'return' &&
    rawEnvelope.result.presence === 'value' && rawEnvelope.result.value.tag === 'list' &&
    rawEnvelope.events.length === 0;
  if (!valid) throw new Error(`A8 F4A runtime envelope: ${JSON.stringify(rawEnvelope)}`);
  return Object.freeze({
    envelope: 'success',
    runtimeInvocations: 1,
    fields: materialize(rawEnvelope.result.value),
  });
}

export function loadPristineF4AComposition(policy, sourceOverrides = {}) {
  const rawModules = COMPOSITION_PATHS.map((path) => ({
    path,
    source: sourceOverrides[path] ?? sourceAt(path),
  }));
  for (const { path, source } of rawModules) {
    const descriptor = policy.composition.find((row) => row.path === path);
    if (!descriptor || sha256(source) !== descriptor.sha256) throw new Error(`composition skew ${path}`);
  }
  for (const descriptor of [policy.f1Policy, policy.f2Policy, policy.f2bPolicy, policy.f3Policy]) {
    if (sha256(sourceAt(descriptor.path)) !== descriptor.sha256) throw new Error(`policy skew ${descriptor.path}`);
  }
  const byPath = new Map(rawModules.map(({ path, source }) => [path, source]));
  return [
    ...F3_COMPOSITION_PATHS.map((path) => byPath.get(path)),
    loadF2Composition(loadF2Policy()).composition,
    byPath.get('examples/kern-frontend/f2-batch-main.kern'),
    ...F4_COMPOSITION_PATHS.map((path) => byPath.get(path)),
  ].join('\n');
}

export function replaceExactly(source, target, replacement) {
  if (target === replacement) throw new Error('replacement is a no-op');
  const replacementCount = source.split(target).length - 1;
  if (replacementCount !== 1) {
    throw new Error(`replacement requires exactly one occurrence, received ${replacementCount}`);
  }
  return Object.freeze({ source: source.replace(target, () => replacement), replacementCount });
}

function report(id, killedBy, replacementCount, execution, control, sentinel) {
  return Object.freeze({
    id,
    control: control ? 'passed' : 'failed',
    sentinel: sentinel ? 'reached' : 'missed',
    abi: execution.abi,
    runtimeInvocations: execution.runtimeInvocations,
    replacementCount,
    envelope: execution.envelope,
    killedBy,
  });
}

function runF1PrerequisiteForgery() {
  const moduleId = 'a8-f1.kern';
  const source = DOCUMENT_FIXTURES.expressionBound;
  const pristine = captureF4ADocument(moduleId, source);
  const mutant = __test.runDocumentWithTestInput(moduleId, source, {
    mutateInput() {},
    mutation: 'f2b-segment-span',
  });
  const killed = mutant.__testOutcome === 'returned' && mutant.receipt.status === 'fatal' &&
    mutant.receipt.diagnostics[0]?.code === 'F4_F2B_DRIFT';
  return report(
    'A8-F1',
    killed ? 'F4_F2B_DRIFT' : 'not-killed',
    0,
    {
      abi: mutant.__testActualArgs?.length ?? 0,
      runtimeInvocations: mutant.runtimeInvocations ?? 0,
      envelope: mutant.__testOutcome === 'returned' ? 'success' : 'failure',
    },
    pristine.receipt.status === 'classified' && pristine.f2bSegments.length > 0,
    killed && mutant.__testActualArgs?.length === 109,
  );
}

function runF4CatalogOmission() {
  const captured = captureF4ADocument('a8-f4.kern', DOCUMENT_FIXTURES.validModuleRoot);
  const pristine = loadPristineF4AComposition(captured.policy);
  const target = String.raw`    do value="out.push(\"25|middleware|parser-normalized-logical-line-v1\")"`;
  const changed = replaceExactly(pristine, target, '    # A8 omitted final keyword authority row');
  const executed = executeF4AComposition(changed.source, structuredClone(captured.args), captured.policy);
  const decoded = decodeCapturedDocument(executed.fields, captured);
  const killed = decoded.status === 'fatal' && decoded.diagnostics[0]?.code === 'F4_AUTHORITY_DRIFT';
  return report('A8-F4', killed ? 'F4_AUTHORITY_DRIFT' : 'not-killed', changed.replacementCount,
    { ...executed, abi: captured.args.length }, captured.receipt.status === 'classified', killed);
}

function constantReturn(fields) {
  const pushes = fields.map((field) =>
    `    do value=${JSON.stringify(`a8Constant.push(${JSON.stringify(field)})`)}`).join('\n');
  return `    let name=a8Constant value="[]"\n${pushes}\n    return value=a8Constant`;
}

function runF5ConstantOutput() {
  const moduleId = 'a8-f5.kern';
  const sourceA = 'fn name=foo export=true\n';
  const sourceB = 'fn name=bar export=true\n';
  const capturedA = captureF4ADocument(moduleId, sourceA);
  const capturedB = captureF4ADocument(moduleId, sourceB);
  const pristine = loadPristineF4AComposition(capturedB.policy);
  const changed = replaceExactly(pristine, '    return value=availableResult', constantReturn(capturedA.fields));
  const executed = executeF4AComposition(changed.source, structuredClone(capturedB.args), capturedB.policy);
  const decoded = decodeCapturedDocument(executed.fields, capturedB);
  const pristineDifferent = capturedA.receipt.symbols[0]?.name === 'foo' &&
    capturedB.receipt.symbols[0]?.name === 'bar';
  const killed = decoded.status === 'classified' && decoded.symbols[0]?.name === 'foo';
  return report('A8-F5', killed ? 'independent-oracle-mismatch' : 'not-killed', changed.replacementCount,
    { ...executed, abi: capturedB.args.length }, pristineDifferent, killed);
}

function runF6PartialFailure() {
  const captured = captureF4ADocument('a8-f6.kern', DOCUMENT_FIXTURES.validModuleRoot);
  const pristine = loadPristineF4AComposition(captured.policy);
  const target = String.raw`    return value="[\"kern.frontend.f4-document.2\", \"fatal\", \"\", String(sourceScalars), \"\", \"\", \"\", \"\", \"\", \"\", \"\", diagnostic, \"\", \"\", \"\", \"0\", \"failure\"]"`;
  const encodedLeak = JSON.stringify(captured.fields[4]).replace(/"/gu, '\\"');
  const replacement = target.replace(
    String.raw`String(sourceScalars), \"\",`,
    `String(sourceScalars), ${encodedLeak},`,
  );
  const changed = replaceExactly(pristine, target, replacement);
  const args = structuredClone(captured.args);
  if (args[90] !== false) throw new Error('F4 force-late ABI coordinate drift');
  args[90] = true;
  const executed = executeF4AComposition(changed.source, args, captured.policy);
  let killed = false;
  try {
    decodeCapturedDocument(executed.fields, captured);
  } catch (error) {
    killed = /fatal atomicity/u.test(String(error?.message ?? error));
  }
  return report('A8-F6', killed ? 'decoder-atomicity-rejection' : 'not-killed', changed.replacementCount,
    { ...executed, abi: args.length }, captured.receipt.status === 'classified', killed && executed.fields[4] !== '');
}

function runF8HardcodedLimits() {
  const moduleId = 'a8-f8.kern';
  const source = 'fn name=bad stray\n  handler lang=kern\n    return value="1 +"\n';
  const captured = captureF4ADocument(moduleId, source);
  const factCount = captured.receipt.facts.length;
  const exact = __test.runDocumentWithProfileLimits(moduleId, source, { maxFacts: factCount });
  const under = __test.runDocumentWithProfileLimits(moduleId, source, { maxFacts: factCount - 1 });
  const pristine = loadPristineF4AComposition(captured.policy);
  const target = 'maxDiagnostics, maxEncodedBytes, maxFacts, maxWorkSteps, forceLateFailure';
  const replacement = 'maxDiagnostics, maxEncodedBytes, 999999, maxWorkSteps, forceLateFailure';
  const changed = replaceExactly(pristine, target, replacement);
  const args = structuredClone(captured.args);
  if (args[88] !== captured.policy.profileLimits.maxFacts) throw new Error('F4 max-facts ABI coordinate drift');
  args[88] = factCount - 1;
  const executed = executeF4AComposition(changed.source, args, captured.policy);
  const decoded = decodeCapturedDocument(executed.fields, captured);
  const control = factCount === 2 && exact.receipt.status === 'rejected' &&
    under.receipt.status === 'fatal' && under.receipt.diagnostics[0]?.code === 'F4_LIMIT';
  const killed = decoded.status === 'rejected' && decoded.facts.length === factCount &&
    changed.source.includes('999999');
  return report('A8-F8', killed ? 'resource-and-source-rejection' : 'not-killed', changed.replacementCount,
    { ...executed, abi: args.length }, control, killed);
}

function runF9SealDrift() {
  const captured = captureF4ADocument('a8-f9.kern', DOCUMENT_FIXTURES.validModuleRoot);
  const pristine = loadPristineF4AComposition(captured.policy);
  const target = ' + expressionReceiptScalars + \\":closed\\"';
  const replacement = ' + expressionReceiptScalars + \\":corrupted\\"';
  const changed = replaceExactly(pristine, target, replacement);
  const executed = executeF4AComposition(changed.source, structuredClone(captured.args), captured.policy);
  let killed = false;
  try {
    decodeCapturedDocument(executed.fields, captured);
  } catch (error) {
    killed = /terminal seal/u.test(String(error?.message ?? error));
  }
  return report('A8-F9', killed ? 'decoder-seal-rejection' : 'not-killed', changed.replacementCount,
    { ...executed, abi: captured.args.length }, captured.receipt.status === 'classified', killed);
}

export async function runA8DocumentMutations() {
  return [
    runF1PrerequisiteForgery(),
    runF4CatalogOmission(),
    runF5ConstantOutput(),
    runF6PartialFailure(),
    runF8HardcodedLimits(),
    runF9SealDrift(),
  ];
}

export function runA8DocumentControls() {
  const { policy } = loadPolicy();
  const lastPath = F4_COMPOSITION_PATHS.at(-1);
  const skewedSource = `${sourceAt(lastPath)}# A8 composition skew\n`;
  let compositionSkewRejected = false;
  try {
    loadPristineF4AComposition(policy, { [lastPath]: skewedSource });
  } catch (error) {
    compositionSkewRejected = /composition skew/u.test(String(error?.message ?? error));
  }

  const constitution = JSON.parse(sourceAt(policy.authorities[1].path));
  const keywordPolicy = JSON.parse(sourceAt(policy.authorities[4].path));
  const checkedAuthority = sourceAt('examples/kern-frontend/f4-authority.generated.kern');
  const pristineAuthority = renderAuthority(constitution, keywordPolicy);
  const stalePolicy = structuredClone(keywordPolicy);
  stalePolicy.handlerCatalog[stalePolicy.handlerCatalog.length - 1] += '-stale';
  const staleAuthorityRejected = pristineAuthority === checkedAuthority &&
    renderAuthority(constitution, stalePolicy) !== checkedAuthority;

  const frame = (value) => `i${Array.from(value).length}:${value}`;
  const row = ['structural', 'invalid-expression', '0', '1', '-1', '0'].map(frame).join('');
  const tape = frame(row);
  const bytes = Buffer.byteLength(tape, 'utf8');
  const exact = __test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 10);
  const limit = __test.runGlobalFactVerify(tape, 0, 0, 5, 3, 1, bytes, 9, 9);
  const driftArgs = [
    [`${tape}x`, 0, 0, 5, 3, 1, bytes, 9, 10],
    [frame('x'), 0, 0, 5, 3, 1, bytes, 9, 10],
    [frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(frame).join('')), 0, 0, 5, 3, 1, bytes, 9, 10],
    [tape, 0, 0, 5, 3, 2, bytes, 9, 10],
    [tape, 0, 0, 5, 3, 1, bytes + 1, 9, 10],
    [tape, 0, 0, 5, 3, 1, bytes, 8, 10],
  ];
  const c13ClaimMutationsRejected = driftArgs.filter((args) =>
    __test.runGlobalFactVerify(...args)[0] === 'drift').length;

  const captured = captureF4ADocument('a8-control.kern', DOCUMENT_FIXTURES.validModuleRoot);
  const decoderCanaries = [
    [(fields) => { fields[0] = 'kern.frontend.f4-document.3'; }, /document identity/u],
    [(fields) => { fields[3] = String(Number(fields[3]) + 1); }, /source scalar drift/u],
    [(fields) => { fields[16] += 'x'; }, /terminal seal/u],
  ];
  const oracleCanariesRejected = decoderCanaries.filter(([mutate, expected]) => {
    const fields = structuredClone(captured.fields);
    mutate(fields);
    try {
      decodeCapturedDocument(fields, captured);
      return false;
    } catch (error) {
      return expected.test(String(error?.message ?? error));
    }
  }).length;

  return Object.freeze({
    compositionSkewRejected,
    staleAuthorityRejected,
    c13ExactControl: exact[0],
    c13ExactLimit: limit[0],
    c13ClaimMutationsRejected,
    oracleCanariesRejected,
  });
}
