import { readFileSync } from 'node:fs';
import { encodeCanonicalValue } from '../../packages/core/dist/canonical-value/canonical.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';
import { decodeResult } from './decoder.mjs';
import { COMPOSITION_PATHS, loadPinned, sha256, validatePolicy } from './policy-validation.mjs';

const ROOT_URL = new URL('../../', import.meta.url);
const POLICY_URL = new URL('./policy.json', import.meta.url);

function loadPolicy() {
  const bytes = readFileSync(POLICY_URL, 'utf8');
  const policy = validatePolicy(JSON.parse(bytes));
  const pinned = loadPinned(policy, ROOT_URL);
  return { bytes, policy, pinned, sha256: sha256(bytes) };
}

function composition(state) {
  const source = COMPOSITION_PATHS.map((path) => state.pinned.get(path)).join('\n');
  if (!/fn name=projectf5moduleset returns="string\[\]" export=true/u.test(source)) {
    throw new Error('F5 projection worker: composition export');
  }
  return source;
}

function location(source, scalar) {
  const points = Array.from(source);
  let line = 1;
  let col = 1;
  for (let index = 0; index < scalar && index < points.length; index += 1) {
    if (points[index] === '\n') {
      line += 1;
      col = 1;
    } else col += 1;
  }
  return { line, col };
}

function inheritedDiagnostics(modules, f4) {
  const byId = new Map(modules.map((module) => [module.moduleId, module.source]));
  return f4.documents.flatMap((document) => {
    const source = byId.get(document.receipt.header.moduleId) ?? '';
    return document.receipt.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      ...location(source, diagnostic.startScalar),
      ...Object.fromEntries(Object.entries(location(source, diagnostic.endScalar)).map(([key, value]) =>
        [key === 'line' ? 'endLine' : 'endCol', value])),
    }));
  });
}

function receipt(status, diagnostics, policyHash, workSteps = 0) {
  return Object.freeze({
    header: Object.freeze({
      format: 'kern.frontend.f5-projection.1', policySha256: policyHash,
      terminalSeal: status === 'projected' ? 'projection:closed' : 'failure',
    }),
    status, diagnostics: Object.freeze(diagnostics), workSteps,
  });
}

function executeProjection(modules, f4, state) {
  const args = [
    modules.map((module) => module.moduleId),
    f4.documents.flatMap((document) => document.fields),
    f4.documents.map((document) => document.receipt.seal),
    f4.fields,
    state.policy.profileLimits.maxModules,
    state.policy.profileLimits.maxInstructionScalars,
    state.policy.profileLimits.maxWorkSteps,
    state.policy.profileLimits.maxNodes,
    state.policy.profileLimits.maxDepth,
    state.policy.profileLimits.maxCollectionLength,
    state.policy.profileLimits.maxStringCodePoints,
  ];
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: structuredClone(args),
    identity: {
      handlerName: 'projectf5moduleset',
      sourcePath: 'examples/kern-frontend/f5-projection-main.kern',
    },
    source: composition(state),
  }, { enabled: true, limits: state.policy.runtimeLimits, scheduler: state.policy.scheduler });
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
      envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' || envelope.events.length !== 0) {
    throw new Error(`F5 projection worker: runtime envelope ${JSON.stringify(envelope)}`);
  }
  return decodeResult(materialize(envelope.result.value), state.policy);
}

function runProjectionWith(modules, f4Runner, validator, stateTransform = (state) => state) {
  if (!Array.isArray(modules) || modules.length === 0 || modules.some((module) =>
    module === null || typeof module !== 'object' || Array.isArray(module) ||
    Object.keys(module).sort().join('|') !== 'moduleId|source' ||
    typeof module.moduleId !== 'string' || typeof module.source !== 'string')) {
    throw new TypeError('F5 projection worker: request shape');
  }
  const state = stateTransform(loadPolicy());
  const f4 = f4Runner(modules);
  const f4Invocations = f4.documentRuntimeInvocations + f4.moduleSetRuntimeInvocations;
  if (f4.receipt.status !== 'linked' || f4.documents.some((document) => document.receipt.status !== 'classified')) {
    return {
      receipt: receipt('rejected', inheritedDiagnostics(modules, f4), state.sha256),
      bytes: null, f4RuntimeInvocations: f4Invocations, f5RuntimeInvocations: 0,
    };
  }
  const result = executeProjection(modules, f4, state);
  if (result.status !== 'projected') {
    return {
      receipt: receipt('fatal', [{ code: result.code, severity: 'error' }], state.sha256, result.workSteps),
      bytes: null, f4RuntimeInvocations: f4Invocations, f5RuntimeInvocations: 1,
    };
  }
  const staged = encodeCanonicalValue(result.instructions, state.policy.canonicalLimits);
  validator(staged, state.policy.canonicalLimits);
  return {
    receipt: receipt('projected', [], state.sha256, result.workSteps),
    bytes: new Uint8Array(staged), f4RuntimeInvocations: f4Invocations, f5RuntimeInvocations: 1,
  };
}

export function runProjection(modules) {
  return runProjectionWith(modules, runModuleSet, decodeModuleKir);
}

export const __test = Object.freeze({
  runProjectionWithF4Runner(modules, runner) {
    return runProjectionWith(modules, runner, decodeModuleKir);
  },
  runProjectionWithValidator(modules, validator) {
    return runProjectionWith(modules, runModuleSet, validator);
  },
  runProjectionWithProfileLimits(modules, profileLimits) {
    return runProjectionWith(modules, runModuleSet, decodeModuleKir, (state) => ({
      ...state,
      policy: { ...state.policy, profileLimits: { ...state.policy.profileLimits, ...profileLimits } },
    }));
  },
});
