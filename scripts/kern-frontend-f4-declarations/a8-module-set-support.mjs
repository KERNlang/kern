import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { sha256 } from './decoder.mjs';
import { QUARANTINE_MODULE_SET, VALID_MODULE_SET } from './fixtures.mjs';
import { referenceModuleGraph } from './m2-reference-graph.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';
import { __test as moduleSetTest } from './module-set-worker.mjs';
import { loadPolicy, runDocument } from './worker.mjs';

const ROOT = new URL('../../', import.meta.url);
const F4B_ARGUMENT_COUNT = 18;
const sourceAt = (path) => readFileSync(new URL(path, ROOT), 'utf8');

export const F4B_COMPOSITION_PATHS = [
  'examples/kern-frontend/f4-declarations-helpers.kern',
  'examples/kern-frontend/f4-module-set-f2-helpers.kern',
  'examples/kern-frontend/f4-path-contract.kern',
  'examples/kern-frontend/f4-module-set-output.kern',
  'examples/kern-frontend/f4-module-set-prefix.kern',
  'examples/kern-frontend/f4-module-set-order.kern',
  'examples/kern-frontend/f4-module-set-closure.kern',
  'examples/kern-frontend/f4-module-set-graph.kern',
  'examples/kern-frontend/f4-module-set-main.kern',
];

const FACT_MODULES = Object.freeze([
  { moduleId: 'a.kern', source: 'use path="./missing-a"\nfn name=a export=true\n' },
  { moduleId: 'b.kern', source: 'use path="./missing-b"\nfn name=b export=true\n' },
]);

const CONTROL_MODULES = Object.freeze([
  { moduleId: 'base.kern', source: 'fn name=x export=true\n' },
  { moduleId: 'middle.kern', source: 'use path="./base"\n  from name=x export=true\n' },
  { moduleId: 'top.kern', source: 'use path="./middle"\n  from name=x export=true\n' },
  { moduleId: 'consumer.kern', source: 'use path="./top"\n  from name=x\n' },
]);

function comparable(receipt) {
  return {
    rejected: receipt.rejected,
    blocked: receipt.blocked,
    linkFacts: receipt.linkFacts,
    validatedComponents: receipt.validatedComponents.map(({ componentMinimumId, members }) => ({
      componentMinimumId,
      members,
    })),
    bindings: receipt.bindings,
  };
}

const identical = (left, right) => isDeepStrictEqual(left, right);

function decoderContext(captured, args = captured.args) {
  return {
    moduleCount: captured.modules.length,
    moduleIds: captured.modules.map(({ moduleId }) => moduleId),
    mode: captured.mode,
    resourceKind: captured.resourceKind,
    inputSeal: sha256(args),
    inputIdentities: captured.inputIdentities,
    f4bArguments: args,
  };
}

export function captureF4BModuleSet(modules) {
  const events = [];
  const result = moduleSetTest.runModuleSetWithOptions(runDocument, loadPolicy, modules, {
    observe: (event) => events.push(event),
  });
  const documentStages = events.filter(({ stage }) => stage === 'f4a');
  const moduleSetStages = events.filter(({ stage }) => stage === 'f4b');
  if (documentStages.length !== modules.length || moduleSetStages.length !== 1 ||
      result.documentRuntimeInvocations !== modules.length ||
      result.moduleSetRuntimeInvocations !== 1 ||
      moduleSetStages[0].args.length !== F4B_ARGUMENT_COUNT) {
    throw new Error(`authentic ABI${F4B_ARGUMENT_COUNT} F4B capture failed: ` +
      `events=${documentStages.length}/${moduleSetStages.length}, ` +
      `invocations=${result.documentRuntimeInvocations}/${result.moduleSetRuntimeInvocations}, ` +
      `args=${moduleSetStages[0].args.length}`);
  }
  const capturedArgs = moduleSetStages[0].args;
  const { policy } = loadPolicy();
  const inputIdentities = result.documents.map(({ receipt }) => ({
    moduleId: receipt.header.moduleId,
    format: receipt.header.format,
    status: receipt.status,
    seal: receipt.seal,
  }));
  const captured = Object.freeze({
    modules,
    args: capturedArgs,
    fields: result.fields,
    receipt: result.receipt,
    documents: result.documents,
    policy,
    moduleSetRuntimeInvocations: result.moduleSetRuntimeInvocations,
    documentRuntimeInvocations: result.documentRuntimeInvocations,
    mode: 'full',
    resourceKind: '',
    inputSeal: sha256(capturedArgs),
    inputIdentities,
  });
  if (captured.inputSeal !== result.receipt.header.inputSeal) {
    throw new Error('authentic F4B input seal mismatch');
  }
  return captured;
}

export function decodeCapturedModuleSet(fields, captured, args = captured.args) {
  return decodeModuleSet(fields, decoderContext(captured, args));
}

export function executeF4BComposition(source, args, policy) {
  const rawEnvelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: args,
    identity: {
      handlerName: 'linkf4moduleset',
      sourcePath: 'examples/kern-frontend/f4-module-set-main.kern',
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
  if (!valid) throw new Error(`A8 F4B runtime envelope: ${JSON.stringify(rawEnvelope)}`);
  return Object.freeze({
    envelope: 'success',
    runtimeInvocations: 1,
    fields: materialize(rawEnvelope.result.value),
  });
}

export function loadPristineF4BComposition(policy) {
  const sources = F4B_COMPOSITION_PATHS.map((path) => {
    const source = sourceAt(path);
    const descriptor = policy.composition.find((row) => row.path === path);
    if (!descriptor || sha256(source) !== descriptor.sha256) {
      throw new Error(`composition skew ${path}`);
    }
    return source;
  });
  const composition = sources.join('\n');
  if (!/fn name=linkf4moduleset returns="string\[\]" export=true/u.test(composition)) {
    throw new Error('module-set composition export');
  }
  return composition;
}

export function replaceF4BExactly(source, target, replacement) {
  if (target === replacement) throw new Error('replacement is a no-op');
  const replacementCount = source.split(target).length - 1;
  if (replacementCount !== 1) {
    throw new Error(`replacement requires exactly one occurrence, received ${replacementCount}`);
  }
  return Object.freeze({ source: source.replace(target, () => replacement), replacementCount });
}

export function runA8PostSortMutation(modules = FACT_MODULES) {
  if (!identical(modules, FACT_MODULES)) {
    throw new Error('A8 F7 requires the frozen two-missing-module fixture');
  }
  const captured = captureF4BModuleSet(modules);
  const pristineComposition = loadPristineF4BComposition(captured.policy);
  const target = '    for name=orderedFactIndex from=0 to=orderedFactWrappers.length';
  const replacement = '    for name=orderedFactIndex from=1 to=orderedFactWrappers.length';
  const changed = replaceF4BExactly(pristineComposition, target, replacement);
  const executed = executeF4BComposition(changed.source, structuredClone(captured.args), captured.policy);

  let decoderPassed = false;
  let decoded = null;
  try {
    decoded = decodeCapturedModuleSet(executed.fields, captured);
    decoderPassed = true;
  } catch {
    decoderPassed = false;
  }

  const pristineFacts = captured.receipt.linkFacts;
  const mutantFacts = decoded?.linkFacts ?? [];
  const retainedExactSuffix = pristineFacts.length > 0 && identical(mutantFacts, pristineFacts.slice(1));
  const omittedFirstFact = pristineFacts[0];

  const reference = referenceModuleGraph(modules, captured.documents);
  const referenceMatchesPristine = identical(comparable(captured.receipt), reference);
  const referenceMismatch = decoded !== null && !identical(comparable(decoded), reference);

  const control = referenceMatchesPristine && captured.receipt.status === 'rejected' &&
    captured.receipt.linkFacts.length === 2;
  const sentinel = changed.replacementCount === 1 &&
    executed.envelope === 'success' &&
    decoderPassed &&
    retainedExactSuffix &&
    omittedFirstFact?.code === 'missing-module' &&
    omittedFirstFact?.moduleId === 'a.kern' &&
    omittedFirstFact?.detail === 'missing-a.kern';
  const killedBy = control && sentinel && referenceMismatch ? 'm2-reference-mismatch' : 'not-killed';

  return Object.freeze({
    id: 'A8-F7',
    control: control ? 'passed' : 'failed',
    sentinel: sentinel ? 'reached' : 'missed',
    abi: captured.args.length,
    runtimeInvocations: executed.runtimeInvocations,
    replacementCount: changed.replacementCount,
    envelope: executed.envelope,
    decoder: decoderPassed ? 'passed' : 'failed',
    pristineFactCount: pristineFacts.length,
    mutantFactCount: mutantFacts.length,
    omittedCode: omittedFirstFact?.code,
    omittedModuleId: omittedFirstFact?.moduleId,
    omittedDetail: omittedFirstFact?.detail,
    retainedExactSuffix,
    killedBy,
  });
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => other !== index)).map((tail) => [value, ...tail]));
}

export function runA8ModuleSetControls() {
  // The acceptance contract fixes a balanced twenty-permutation budget: five
  // deterministic orderings for each possible first module.
  const allPermutations = permutations(CONTROL_MODULES);
  const generatedPermutations = CONTROL_MODULES.flatMap(({ moduleId }) =>
    allPermutations.filter(([first]) => first.moduleId === moduleId).slice(0, 5));
  let permutationsMatched = 0;
  for (const permutation of generatedPermutations) {
    const captured = captureF4BModuleSet(permutation);
    const ref = referenceModuleGraph(permutation, captured.documents);
    if (identical(comparable(captured.receipt), ref)) {
      permutationsMatched += 1;
    }
  }

  const facts = captureF4BModuleSet(FACT_MODULES);
  const linked = captureF4BModuleSet([...VALID_MODULE_SET]);
  const quarantine = captureF4BModuleSet([...QUARANTINE_MODULE_SET]);
  const oracleCanaries = [
    [facts, (graph) => { graph.linkFacts.shift(); }],
    [linked, (graph) => {
      if (!graph.bindings[0]) throw new Error('A8 binding canary precondition');
      graph.bindings[0].startScalar += 1;
    }],
    [quarantine, (graph) => { graph.rejected.shift(); }],
    [quarantine, (graph) => { graph.blocked.pop(); }],
  ];
  const oracleCanariesRejected = oracleCanaries.filter(([captured, mutate]) => {
    const reference = referenceModuleGraph(captured.modules, captured.documents);
    const pristine = comparable(captured.receipt);
    if (!identical(pristine, reference)) return false;
    const corrupted = structuredClone(pristine);
    mutate(corrupted);
    return !identical(corrupted, pristine) && !identical(corrupted, reference);
  }).length;

  return Object.freeze({
    permutationsGenerated: generatedPermutations.length,
    permutationsAttempted: generatedPermutations.length,
    permutationsMatched,
    oracleCanariesRejected,
  });
}
