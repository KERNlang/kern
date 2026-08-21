import { readFileSync } from 'node:fs';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { fail, sha256 } from './decoder.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';

const COMPOSITION_PATHS = [
  'examples/kern-frontend/f4-declarations-helpers.kern',
  'examples/kern-frontend/f4-module-set-f2-helpers.kern',
  'examples/kern-frontend/f4-path-contract.kern',
  'examples/kern-frontend/f4-module-set-output.kern',
  'examples/kern-frontend/f4-module-set-prefix.kern',
  'examples/kern-frontend/f4-module-set-graph.kern',
  'examples/kern-frontend/f4-module-set-main.kern',
];

function loadComposition(policy) {
  const sources = COMPOSITION_PATHS.map((path) => {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    const descriptor = policy.composition.find((row) => row.path === path);
    if (!descriptor || sha256(source) !== descriptor.sha256) fail(`module-set composition digest ${path}`);
    return source;
  });
  const composition = sources.join('\n');
  if (!/fn name=linkf4moduleset returns="string\[\]" export=true/u.test(composition)) {
    fail('module-set composition export');
  }
  return composition;
}

function exactModule(module, index) {
  if (!module || typeof module !== 'object' || Array.isArray(module) ||
      JSON.stringify(Object.keys(module)) !== JSON.stringify(['moduleId', 'source']) ||
      typeof module.moduleId !== 'string' ||
      typeof module.source !== 'string') fail(`module ${index} shape`);
  return module;
}

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
}

function interfaceBlock(receipt) {
  const symbols = receipt.symbols.map((row) => frame([
    receipt.header.moduleId, row.kind, row.name, row.exported ? 'true' : 'false',
  ].map(frame).join(''))).join('');
  const bindings = receipt.bindings.map((row) => frame([
    receipt.header.moduleId, row.targetModuleId, row.imported, row.local,
    row.requestedKind, row.reexport ? 'true' : 'false',
  ].map(frame).join(''))).join('');
  return frame([symbols, bindings].map(frame).join(''));
}

function resourcePrefixArguments(ids, documents, profile, options) {
  const identities = documents.map(({ receipt }) => receipt);
  return [
    ids, options.mode ?? 'full', options.resourceKind ?? '',
    identities.map((receipt) => receipt.header.moduleId),
    identities.map((receipt) => receipt.header.format),
    identities.map((receipt) => receipt.status),
    identities.map((receipt) => receipt.seal),
    identities.map(interfaceBlock),
    profile.maxModules, profile.maxSymbols, profile.maxBindings, profile.maxWorkSteps,
    options.forceLateFailure === true,
    profile.maxModuleIdScalars, profile.maxModuleIdSegments,
    profile.maxImportSpecifierScalars, profile.maxImportSpecifierSegments,
    profile.maxEncodedBytes,
  ];
}

function runModuleSetWithOptions(runDocument, loadPolicy, modules, options) {
  if (!Array.isArray(modules)) fail('module set shape');
  const accepted = modules.map(exactModule);
  const ids = accepted.map(({ moduleId }) => moduleId);
  const { policy } = loadPolicy();
  const p = policy.profileLimits;
  const documents = [];
  let symbolCount = 0;
  let bindingCount = 0;
  let mode = options.mode ?? 'full';
  let resourceKind = options.resourceKind ?? '';
  if (options.mode === undefined && ids.length > p.maxModules) {
    mode = 'resource-prefix';
    resourceKind = 'maxModules';
  } else {
    for (let index = 0; index < accepted.length; index += 1) {
      const { moduleId, source } = accepted[index];
      options.observe?.({ stage: 'f4a', index, moduleId });
      const document = runDocument(moduleId, source);
      documents.push(document);
      symbolCount += document.receipt.symbols.length;
      bindingCount += document.receipt.bindings.length;
      if (options.mode === undefined) {
        if (symbolCount > p.maxSymbols) {
          mode = 'resource-prefix';
          resourceKind = 'maxSymbols';
          break;
        }
        if (bindingCount > p.maxBindings) {
          mode = 'resource-prefix';
          resourceKind = 'maxBindings';
          break;
        }
      }
    }
  }
  const inputIdentities = documents.map(({ receipt }) => ({
    moduleId: receipt.header.moduleId,
    format: receipt.header.format,
    status: receipt.status,
    seal: receipt.seal,
  }));
  const args = resourcePrefixArguments(ids, documents, p, {
    mode, resourceKind, forceLateFailure: options.forceLateFailure,
  });
  options.mutateArguments?.(args);
  const runtimeArguments = structuredClone(args);
  options.observe?.({ stage: 'f4b', args: structuredClone(runtimeArguments) });
  const inputSeal = sha256(runtimeArguments);
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: runtimeArguments,
    identity: {
      handlerName: 'linkf4moduleset',
      sourcePath: 'examples/kern-frontend/f4-module-set-main.kern',
    },
    source: loadComposition(policy),
  }, {
    enabled: true,
    limits: policy.runtimeLimits,
    scheduler: policy.scheduler,
  });
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
      envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' ||
      envelope.events.length !== 0) fail(`module-set runtime envelope ${JSON.stringify(envelope)}`);
  const fields = materialize(envelope.result.value);
  return {
    fields,
    receipt: decodeModuleSet(fields, {
      moduleCount: modules.length, moduleIds: ids, mode, resourceKind, inputSeal, inputIdentities,
      f4bArguments: runtimeArguments,
    }),
    documents,
    documentRuntimeInvocations: documents.length,
    moduleSetRuntimeInvocations: 1,
  };
}

export function runModuleSetWith(runDocument, loadPolicy, modules) {
  return runModuleSetWithOptions(runDocument, loadPolicy, modules, {});
}

export const __test = Object.freeze({ runModuleSetWithOptions });
