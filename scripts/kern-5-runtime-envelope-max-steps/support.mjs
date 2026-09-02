import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEnv } from '../../packages/core/dist/ir/semantics/index.js';
import { registerAllContracts } from '../../packages/core/dist/ir/semantics/register-all.js';
import {
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
} from '../../packages/core/dist/runtime-envelope/execute-compat.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../../packages/core/dist/runtime-envelope/execute.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
} from '../../packages/core/dist/runtime-envelope/source-runner-engine.js';
import { validateInternalRuntimeLimits } from '../../packages/core/dist/runtime-envelope/value.js';
import {
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

export {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
  executeInternalRuntimeEnvelopeSync,
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  KERN_RUNTIME_HANDLER_ABI,
  makeEnv,
  registerAllContracts,
  validateInternalRuntimeLimits,
};

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const ENVELOPE_LIMIT_KEYS = Object.freeze([
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxIterations',
  'maxStringBytes',
]);

export const LEGACY_ENVELOPE_LIMIT_KEYS = Object.freeze(
  ENVELOPE_LIMIT_KEYS.filter((key) => key !== 'maxIterations'),
);

const BASE = Object.freeze({
  maxBytes: 65_536,
  maxCollectionLength: 16,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
});

export function limits(overrides = {}) {
  return Object.freeze({ ...BASE, maxIterations: 1_048_576, ...overrides });
}

export function legacyLimits(overrides = {}) {
  return Object.freeze({ ...BASE, ...overrides });
}

export const KIR_LIMIT_KEYS = Object.freeze([
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxSteps',
  'maxStringBytes',
]);

export function kirLimits(overrides = {}) {
  return Object.freeze({ ...BASE, maxSteps: 1_048_576, ...overrides });
}

export const IDENTITY = Object.freeze({ handlerName: 'answer', sourcePath: 'app/main.kern' });

export function handlerRequest(source, args = []) {
  return { abi: KERN_RUNTIME_HANDLER_ABI, arguments: args, identity: IDENTITY, source };
}

export const COUNTING_LOOP = [
  'fn name=answer returns=number',
  '  param name=n type=number',
  '  handler lang="kern"',
  '    let name=i value="0"',
  '    while cond="i < n"',
  '      assign op="+=" target=i value="1"',
  '    return value="i"',
].join('\n');

export const LIST_ECHO = [
  'fn name=answer returns="number[]"',
  '  param name=rows type="number[]"',
  '  handler lang="kern"',
  '    return value="rows"',
].join('\n');

export const DIFFERENTIAL_LIST = [
  'fn name=answer returns="number[]"',
  '  param name=n type=number',
  '  handler lang="kern"',
  '    let name=i value="0"',
  '    while cond="i < n"',
  '      assign op="+=" target=i value="1"',
  '    return value="[1, 2, 3, 4, 5, 6]"',
].join('\n');

export function differentialNodes(bound) {
  return [
    { type: 'let', props: { kind: 'let', name: 'i', value: '0' } },
    {
      type: 'while',
      props: { cond: `i < ${bound}` },
      children: [{ type: 'assign', props: { op: '+=', target: 'i', value: '1' } }],
    },
    { type: 'return', props: { value: '[1, 2, 3, 4, 5, 6]' } },
  ];
}

export function countingNodes(bound) {
  return [
    { type: 'let', props: { kind: 'let', name: 'i', value: '0' } },
    {
      type: 'while',
      props: { cond: `i < ${bound}` },
      children: [{ type: 'assign', props: { op: '+=', target: 'i', value: '1' } }],
    },
    { type: 'return', props: { value: 'i' } },
  ];
}

export function loopEnvelopes(iterations, options) {
  const invocation = handlerRequest(COUNTING_LOOP, [iterations]);
  return {
    async: executeKernRuntimeHandlerAsync(invocation, { capabilityTimeoutMs: 100, ...options }),
    sync: executeKernRuntimeHandlerSync(invocation, options),
  };
}

export function listEnvelope(length, options) {
  const rows = Array.from({ length }, (_, index) => index);
  return executeKernRuntimeHandlerSync(handlerRequest(LIST_ECHO, [rows]), options);
}

export function diagnosticCodes(envelope) {
  return envelope.diagnostics.map((diagnostic) => diagnostic.code);
}

export function canonical(envelope) {
  return JSON.stringify(envelope);
}

export function readGolden() {
  return JSON.parse(readFileSync(new URL('./byte-identity.golden.json', import.meta.url), 'utf8'));
}

const SWEEP_ROOTS = Object.freeze(['assets', 'examples', 'generated', 'packages', 'scripts', 'tests']);
const SWEEP_EXTENSIONS = Object.freeze(['.js', '.json', '.mjs', '.ts']);
const SWEEP_SKIPPED = Object.freeze(['dist', 'node_modules']);

function* sourceFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SWEEP_SKIPPED.includes(entry.name)) yield* sourceFiles(path);
    } else if (entry.isFile() && SWEEP_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      yield path;
    }
  }
}

const KIR_ONLY_LIMIT_FILES = new Set([
  'packages/core/src/kir-runtime/contracts.ts',
  'packages/core/src/kir-runtime/inspect.ts',
  'packages/core/src/compiler/kir-js-esm/request.ts',
  'packages/core/src/compiler/kir-js-esm/target-base.ts',
  'packages/core/src/compiler/kir-python/request.ts',
  'packages/core/src/compiler/kir-python/target-base.ts',
  'packages/cli/src/kir-shadow/limits.ts',
]);

export function envelopeShapedFiles() {
  const shaped = [];
  for (const root of SWEEP_ROOTS) {
    for (const path of sourceFiles(join(REPO_ROOT, root))) {
      const text = readFileSync(path, 'utf8');
      if (!LEGACY_ENVELOPE_LIMIT_KEYS.every((key) => text.includes(key))) continue;
      if (KIR_ONLY_LIMIT_FILES.has(relative(REPO_ROOT, path))) continue;
      shaped.push({ hasMaxSteps: text.includes('maxIterations'), path: relative(REPO_ROOT, path) });
    }
  }
  return shaped;
}
