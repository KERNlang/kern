import { readFileSync } from 'node:fs';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { loadPolicy as loadF2Policy } from '../kern-frontend-f2-expression/decoder.mjs';
import { loadComposition as loadF2Composition } from '../kern-frontend-f2-expression/worker.mjs';
import { loadPolicy as loadF2BPolicy } from '../kern-frontend-f2-batch/worker.mjs';
import { __test as f3Test, loadPolicy as loadF3Policy, runDocumentOutcome as runF3DocumentOutcome } from '../kern-frontend-f3-line-tree/worker.mjs';
import { decodeDocument, fail, sha256 } from './decoder.mjs';
import { __test as moduleSetTest, runModuleSetWith } from './module-set-worker.mjs';
import {
  AUTHORITY_PATHS, COMPOSITION_PATHS, F2_COMPOSITION_PATHS, F3_COMPOSITION_PATHS, F4_COMPOSITION_PATHS,
  validatePolicy,
} from './policy-validation.mjs';
import { buildPrerequisiteInput } from './prerequisite-transport.mjs';
const POLICY_URL = new URL('./policy.json', import.meta.url);
let f4ExecutionCount = 0;
export { validatePolicy } from './policy-validation.mjs';

export function loadPolicy() {
  const bytes = readFileSync(POLICY_URL, 'utf8');
  return { bytes, policy: validatePolicy(JSON.parse(bytes)), sha256: sha256(bytes) };
}

function loadJsonAuthority(policy, index) {
  const descriptor = policy.authorities[index];
  const bytes = readFileSync(new URL(`../../${descriptor.path}`, import.meta.url), 'utf8');
  if (sha256(bytes) !== descriptor.sha256) fail(`authority ${index} digest`);
  return JSON.parse(bytes);
}

function loadAuthorities(policy) {
  const catalog = loadJsonAuthority(policy, 0);
  const constitution = loadJsonAuthority(policy, 1);
  loadJsonAuthority(policy, 2);
  loadJsonAuthority(policy, 3);
  const keywordPolicy = loadJsonAuthority(policy, 4);
  if (!Array.isArray(catalog.nodeTypes) || catalog.nodeTypes.length !== 302 ||
      !Array.isArray(constitution.nodes) || constitution.nodes.length !== 302 ||
      !Array.isArray(constitution.properties) || constitution.properties.length !== 1149 ||
      catalog.nodeTypes.some((id, index) => constitution.nodes[index]?.id !== id) ||
      keywordPolicy.format !== 'kern.frontend.keyword-handler-shadow.1' ||
      keywordPolicy.sourceProfile !== 'parser-normalized-logical-line-v1' ||
      !Array.isArray(keywordPolicy.handlerCatalog) || keywordPolicy.handlerCatalog.length !== 26) {
    fail('authority rows');
  }
  return { catalog, constitution, keywordPolicy };
}

function loadComposition(policy) {
  const rawModules = COMPOSITION_PATHS.map((path) => ({
    path,
    source: readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'),
  }));
  for (const { path, source } of rawModules) {
    const descriptor = policy.composition.find((row) => row.path === path);
    if (!descriptor || sha256(source) !== descriptor.sha256) fail(`composition digest ${path}`);
  }
  for (const [label, descriptor] of [
    ['F1', policy.f1Policy], ['F2', policy.f2Policy], ['F2B', policy.f2bPolicy], ['F3', policy.f3Policy],
  ]) {
    const bytes = readFileSync(new URL(`../../${descriptor.path}`, import.meta.url), 'utf8');
    if (sha256(bytes) !== descriptor.sha256) fail(`${label} policy digest`);
  }
  const loadedF2Policy = loadF2Policy();
  const loadedF2 = loadF2Composition(loadedF2Policy);
  const byPath = new Map(rawModules.map((module) => [module.path, module.source]));
  const composition = [
    ...F3_COMPOSITION_PATHS.map((path) => byPath.get(path)),
    loadedF2.composition,
    byPath.get('examples/kern-frontend/f2-batch-main.kern'),
    ...F4_COMPOSITION_PATHS.map((path) => byPath.get(path)),
  ].join('\n');
  if (/(?:parseDocument|parseLines|bootstrap|kern\.frontend\..*-shadow)/u.test(composition)) {
    fail('forbidden composition authority');
  }
  if (!/fn name=classifyf4document returns="string\[\]" export=true/u.test(composition) ||
      !/fn name=structuref3document returns="string\[\]" export=true/u.test(composition) ||
      !/fn name=parsef2expression returns="string\[\]" export=true/u.test(composition) ||
      !/fn name=parsef2batch returns="string\[\]" export=true/u.test(composition)) fail('composition exports');
  return {
    composition,
    f2Policy: loadedF2Policy,
    f2bPolicy: loadF2BPolicy().policy,
    modules: rawModules.map(({ path, source }) => ({ path, sha256: sha256(source) })),
  };
}

function authorityTransport(authorities) {
  const { catalog, constitution, keywordPolicy } = authorities;
  const nodePropertyStarts = [];
  const nodePropertyCounts = [];
  let cursor = 0;
  for (const id of catalog.nodeTypes) {
    const start = cursor;
    while (cursor < constitution.properties.length && constitution.properties[cursor].nodeKind === id) cursor += 1;
    nodePropertyStarts.push(start);
    nodePropertyCounts.push(cursor - start);
  }
  if (cursor !== constitution.properties.length) fail('property authority order');
  return {
    nodeIds: [...catalog.nodeTypes],
    nodeSchemaStatuses: constitution.nodes.map((node) => node.schemaStatus),
    nodeAllowedModes: constitution.nodes.map((node) =>
      node.allowedChildren === null ? 'unrestricted' : node.allowedChildren.length === 0 ? 'closed' : 'explicit'),
    nodeChildTapes: constitution.nodes.map((node) => node.allowedChildren?.join('|') ?? ''),
    nodePropertyStarts,
    nodePropertyCounts,
    propertyNodes: constitution.properties.map((property) => property.nodeKind),
    propertyNames: constitution.properties.map((property) => property.propertyName),
    propertyKinds: constitution.properties.map((property) => property.schemaKind),
    propertyRequired: constitution.properties.map((property) => property.required ? 'true' : 'false'),
    propertyValueTapes: constitution.properties.map((property) => property.values?.join(',') ?? ''),
    propertyDispositions: constitution.properties.map((property) => property.disposition),
    propertyReasonIds: constitution.properties.map((property) => property.reasonId),
    keywordForms: [...keywordPolicy.handlerCatalog],
    keywordSourceProfiles: keywordPolicy.handlerCatalog.map(() => keywordPolicy.sourceProfile),
  };
}

function prepare(moduleId, source, options = {}, testF3Options = undefined, observe = undefined) {
  if (typeof moduleId !== 'string' || typeof source !== 'string') fail('request shape');
  const policyState = loadPolicy();
  const prerequisiteOutcome = observe === undefined
    ? runF3DocumentOutcome(source, testF3Options)
    : f3Test.runDocumentOutcomeWithObserver(source, testF3Options, observe);
  const f3Policy = loadF3Policy();
  const loaded = loadComposition(policyState.policy);
  return {
    moduleId, source, options, policyState, f3Policy,
    prerequisiteOutcome,
    authorities: authorityTransport(loadAuthorities(policyState.policy)),
    loaded,
  };
}

function applyMutation(input, mutation) {
  if (Array.isArray(mutation)) {
    for (const item of mutation) applyMutation(input, item);
    return;
  }
  if (mutation === undefined) return;
  if (mutation === 'authority-row-reorder') {
    [input.authorities.nodeIds[0], input.authorities.nodeIds[1]] =
      [input.authorities.nodeIds[1], input.authorities.nodeIds[0]];
  } else if (mutation === 'authority-node-status') {
    input.authorities.nodeSchemaStatuses[0] = input.authorities.nodeSchemaStatuses[0] === 'bound' ? 'missing' : 'bound';
  } else if (mutation === 'authority-child-tape') {
    input.authorities.nodeChildTapes[0] = `${input.authorities.nodeChildTapes[0]}item`;
  } else if (mutation === 'authority-property-row-reorder') {
    for (const key of [
      'propertyNodes', 'propertyNames', 'propertyKinds', 'propertyRequired', 'propertyValueTapes',
      'propertyDispositions', 'propertyReasonIds',
    ]) {
      [input.authorities[key][0], input.authorities[key][1]] =
        [input.authorities[key][1], input.authorities[key][0]];
    }
  } else if (mutation === 'authority-property-disposition') {
    input.authorities.propertyDispositions[0] =
      input.authorities.propertyDispositions[0] === 'included-value' ? 'excluded-host-type' : 'included-value';
  } else if (mutation === 'authority-property-values') {
    input.authorities.propertyValueTapes[0] = `${input.authorities.propertyValueTapes[0]}x`;
  } else if (mutation === 'authority-property-reason') {
    input.authorities.propertyReasonIds[0] = `${input.authorities.propertyReasonIds[0]}x`;
  } else if (mutation === 'authority-keyword-reorder') {
    [input.authorities.keywordForms[0], input.authorities.keywordForms[1]] =
      [input.authorities.keywordForms[1], input.authorities.keywordForms[0]];
  } else if (mutation === 'authority-keyword-profile') {
    input.authorities.keywordSourceProfiles[0] = `${input.authorities.keywordSourceProfiles[0]}x`;
  } else if (mutation === 'f1-record-kind') {
    if (input.recordKinds.length === 0) input.recordKinds.push(0);
    else input.recordKinds[0] = input.recordKinds[0] === 0 ? 1 : 0;
  } else if (mutation === 'f2b-segment-span') {
    if (input.segmentFirstRecords.length === 0) {
      input.segmentFirstRecords.push(0);
      input.segmentLastRecords.push(0);
      input.segmentOuterStarts.push(0);
      input.segmentOuterEnds.push(1);
      input.segmentBodyStarts.push(0);
      input.segmentBodyEnds.push(0);
      input.segmentBodies.push('');
      input.segmentBodyDigests.push('');
      input.segmentRecordDigests.push('');
    } else input.segmentOuterStarts[0] += 1;
  } else if (mutation === 'f3-parent-edge') {
    if (input.edgeParents.length === 0) fail('mutation requires parent edge');
    input.edgeParents[0] = input.edgeParents[0] === -1 ? 0 : -1;
  } else fail(`unknown mutation ${mutation}`);
}

function execute(prepared, mutation, testPhaseKeyMutation = '', suppliedInput = undefined, observe = undefined, captureArguments = undefined, testArgumentCount = undefined) {
  if (testPhaseKeyMutation !== '' && testPhaseKeyMutation !== 'equal' &&
      testPhaseKeyMutation !== 'decreasing') fail('phase key mutation');
  const input = suppliedInput ?? buildPrerequisiteInput(prepared);
  applyMutation(input, mutation);
  const { authorities: a } = input;
  const p = prepared.policyState.policy.profileLimits;
  const f3p = prepared.f3Policy.policy;
  const f3l = f3p.profileLimits;
  const f2p = prepared.loaded.f2Policy.profileLimits;
  const f2bp = prepared.loaded.f2bPolicy.profileLimits;
  let args = [
    prepared.moduleId, prepared.source,
    input.recordKinds, input.recordFlags, input.recordStarts, input.recordEnds, input.f1RecordTape,
    input.segmentFirstRecords, input.segmentLastRecords, input.segmentOuterStarts, input.segmentOuterEnds,
    input.segmentBodyStarts, input.segmentBodyEnds, input.f3ExpectedFields, f3p.rawOpenerTypes,
    input.segmentBodies, input.segmentBodyDigests, input.segmentRecordDigests, input.f2bExpectedFields,
    f2bp.maxSegments, f2bp.maxAggregateBodyScalars, f2bp.maxAggregateNodes,
    f2bp.maxAbsoluteSpans, f2bp.maxWorkSteps,
    f2p.maxSourceScalars, f2p.maxTokens, f2p.maxNodes, f2p.nodesPerChunk, f2p.maxChunks,
    f2p.maxTapeScalars, f2p.maxNestingDepth, f2p.maxWorkSteps,
    f3l.maxRecords, f3l.maxLogicalLines, f3l.maxParentEdges, f3l.maxDecoratorRuns, f3l.maxRawBlocks,
    f3l.maxStructuralDiagnostics, f3l.maxWorkSteps,
    input.lineFirstRecords, input.lineLastRecords, input.lineStarts, input.lineEnds,
    input.lineFirstPhysical, input.lineLastPhysical, input.lineIndents, input.lineContentStarts,
    input.lineRoles, input.lineFirstSegments, input.lineSegmentCounts,
    input.edgeChildren, input.edgeParents, input.edgeChildIndents, input.edgeParentIndents,
    input.decoratorFirsts, input.decoratorLasts, input.decoratorSuccessors, input.decoratorDispositions,
    input.rawOwners, input.rawOpeners, input.rawClosers, input.rawBodyStarts, input.rawBodyEnds,
    input.rawInlineFlags, input.rawTypes,
    a.nodeIds, a.nodeSchemaStatuses, a.nodeAllowedModes, a.nodeChildTapes, a.nodePropertyStarts, a.nodePropertyCounts,
    a.propertyNodes, a.propertyNames, a.propertyKinds, a.propertyRequired, a.propertyValueTapes,
    a.propertyDispositions, a.propertyReasonIds, a.keywordForms, a.keywordSourceProfiles,
    p.maxDeclarations, p.maxPropertyOccurrences, p.maxAttachments, p.maxDecorators, p.maxSymbols, p.maxBindings,
    p.maxDiagnostics, p.maxEncodedBytes, p.maxFacts, p.maxWorkSteps, prepared.options.forceLateFailure === true,
    p.maxExpressionEvidence, p.maxF4LocalF2Calls, p.maxAggregateExpressionScalars,
    p.maxAggregateExpressionNodes, p.maxExpressionAbsoluteSpans, p.maxExpressionBoundaryEntries,
    p.maxExpressionReceiptScalars, testPhaseKeyMutation,
    p.maxModuleIdScalars, p.maxModuleIdSegments, p.maxImportSpecifierScalars, p.maxImportSpecifierSegments,
  ];
  args = args.concat(input.prerequisiteStates, p.maxSourceScalars, p.maxRecords, p.maxLogicalLines);
  if (testArgumentCount !== undefined) {
    if (!Number.isInteger(testArgumentCount) || testArgumentCount < 0) fail('test argument count');
    args = args.slice(0, testArgumentCount);
    while (args.length < testArgumentCount) args.push('');
  } else if (args.length !== 109 || args.some((value) => value === undefined)) {
    fail(`runtime argument transport ${args.length}`);
  }
  captureArguments?.(Object.freeze([...args]));
  f4ExecutionCount += 1;
  observe?.('f4');
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: args,
    identity: { handlerName: 'classifyf4document', sourcePath: 'examples/kern-frontend/f4-declarations-main.kern' },
    source: prepared.loaded.composition,
  }, { enabled: true, limits: prepared.policyState.policy.runtimeLimits, scheduler: prepared.policyState.policy.scheduler });
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
      envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' || envelope.events.length !== 0) {
    fail(`runtime envelope ${JSON.stringify(envelope)}`);
  }
  return materialize(envelope.result.value);
}

function runPrepared(prepared, mutation, testPhaseKeyMutation = '', suppliedInput = undefined, observe = undefined, captureArguments = undefined, testArgumentCount = undefined) {
  const executionsBefore = f4ExecutionCount;
  const fields = execute(prepared, mutation, testPhaseKeyMutation, suppliedInput, observe, captureArguments, testArgumentCount);
  const receipt = decodeDocument(fields, {
    moduleId: prepared.moduleId,
    sourceScalars: Array.from(prepared.source).length,
    sourceSha256: sha256(prepared.source),
    sourcePoints: Array.from(prepared.source),
    f2Policy: prepared.loaded.f2Policy,
    f2bSegments: prepared.prerequisiteOutcome.batch?.receipt.segments ?? [],
    f2bExpressions: prepared.prerequisiteOutcome.batch?.expressions ?? [],
    f2bAbsoluteSpans: prepared.prerequisiteOutcome.batch?.receipt.absoluteSpans ?? [],
  });
  const prerequisites = prepared.prerequisiteOutcome.document ?? {
    scan: prepared.prerequisiteOutcome.scan,
    batch: prepared.prerequisiteOutcome.batch,
  };
  return { fields, receipt, prerequisites, runtimeInvocations: f4ExecutionCount - executionsBefore };
}

export function runDocument(moduleId, source) {
  return runPrepared(prepare(moduleId, source));
}

export const __test = Object.freeze({
  runDocumentWithForcedLateFailure(moduleId, source) {
    return runPrepared(prepare(moduleId, source, { forceLateFailure: true }));
  },
  runDocumentWithMutation(moduleId, source, mutation) {
    return runPrepared(prepare(moduleId, source), mutation);
  },
  runDocumentWithProfileLimits(moduleId, source, profileLimits) {
    const prepared = prepare(moduleId, source);
    const policy = structuredClone(prepared.policyState.policy);
    Object.assign(policy.profileLimits, profileLimits);
    validatePolicy(policy);
    prepared.policyState = { ...prepared.policyState, policy };
    return runPrepared(prepared);
  },
  runDocumentWithPhaseKeyMutation(moduleId, source, mutation) {
    if (mutation !== 'equal' && mutation !== 'decreasing') fail('phase key mutation');
    return runPrepared(prepare(moduleId, source), undefined, mutation);
  },
  runDocumentWithTestInput(moduleId, source, testOptions = {}) {
    if (!testOptions || typeof testOptions !== 'object' || Array.isArray(testOptions) ||
        typeof testOptions.mutateInput !== 'function') fail('test input options');
    const prepared = prepare(moduleId, source);
    const input = buildPrerequisiteInput(prepared, testOptions);
    testOptions.mutateInput(input);
    applyMutation(input, testOptions.mutation);
    let actualArgs;
    try {
      const result = runPrepared(prepared, undefined, '', input, undefined, (args) => { actualArgs = args; });
      return { ...result, __testActualArgs: actualArgs, __testInput: input, __testOutcome: 'returned' };
    } catch (error) {
      return { __testActualArgs: actualArgs, __testInput: input,
        __testOutcome: 'runtime-envelope-rejection', __testError: String(error?.message ?? error) };
    }
  },
  runDocumentWithF3Options(moduleId, source, f3Options, observe = undefined) {
    return runPrepared(prepare(moduleId, source, {}, f3Options, observe), undefined, '', undefined, observe);
  },
  runDocumentWithArgumentCount(moduleId, source, argumentCount) {
    return runPrepared(prepare(moduleId, source), undefined, '', undefined, undefined, undefined, argumentCount);
  },
  runDiagnosticPropertyRuleRank(code, rank) {
    const { policy } = loadPolicy();
    const frame = (value) => `i${Array.from(value).length}:${value}`;
    const row = [code, 'error', '1', '1', '-1'].map(frame).join('');
    const envelope = executeKernRuntimeHandlerSync({
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: ['ok', '', 0, 0, 0, -1, -1, -1, row, 1, 0, rank,
        policy.profileLimits.maxDiagnostics, policy.profileLimits.maxEncodedBytes, 0,
        policy.profileLimits.maxWorkSteps],
      identity: { handlerName: 'f4diagstateappend', sourcePath: 'examples/kern-frontend/f4-diagnostic-merge.kern' },
      source: loadComposition(policy).composition,
    }, { enabled: true, limits: policy.runtimeLimits, scheduler: policy.scheduler });
    if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
        envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' || envelope.events.length !== 0) {
      fail(`diagnostic rank runtime envelope ${JSON.stringify(envelope)}`);
    }
    return materialize(envelope.result.value);
  },
  runModuleSetWithReceiptMutation(modules, mutateReceipt, options = {}) {
    if (typeof mutateReceipt !== 'function') fail('receipt mutation');
    return moduleSetTest.runModuleSetWithOptions((moduleId, source) => {
      const result = runDocument(moduleId, source);
      const receipt = structuredClone(result.receipt);
      mutateReceipt(receipt, moduleId);
      return { ...result, receipt };
    }, loadPolicy, modules, options);
  },
  runModuleSetWithForcedLateFailure(modules) {
    return moduleSetTest.runModuleSetWithOptions(runDocument, loadPolicy, modules, { forceLateFailure: true });
  },
});

export function runModuleSet(modules) {
  return runModuleSetWith(runDocument, loadPolicy, modules);
}
