const CLAIM = 'kern.runtime.trace-compaction.r0';

function replacement(current, historical) {
  return Object.freeze({ current, historical });
}

function entry(path, currentDigest, expectedDigest, replacements) {
  return Object.freeze({
    claim: CLAIM,
    currentDigest,
    expectedDigest,
    path,
    replacements: Object.freeze(replacements),
  });
}

export const TRACE_COMPACTION_HISTORICAL_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '1868480434adb54186b4077144748dd1afa7d07d',
  successorCommit: '45dd2808e9efebcb21e0d2031f58062a444970c8',
  compiledInventory: Object.freeze({
    predecessor: Object.freeze({
      count: 317,
      digest: '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67',
    }),
    successor: Object.freeze({
      count: 317,
      digest: '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67',
    }),
  }),
});

export const POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS = Object.freeze([
  entry(
    'packages/core/src/ir/semantics/internal-effect-machine-sequence.ts',
    'be20e7c4f2a6091d9dafe37286fc126ada3b3cc9e60dfad41474df1810c0f578',
    'fbd95b89099ceffbb6c2e8f2136620bfe51bda5bd2a22ba93de1db7743a68bfe',
    [
      replacement(
        "import { emptyTrace, isExternallyObservableTraceEvent, type Trace, type TraceEvent } from './trace.js';\n",
        "import { emptyTrace, type Trace } from './trace.js';\n",
      ),
      replacement(
        "function retainTraceEvent(state: InternalEffectMachineState, event: TraceEvent): boolean {\n" +
          "  return state.traceRetention !== 'observable-only' || isExternallyObservableTraceEvent(event);\n" +
          '}\n\n' +
          'function appendTraceEvents(out: Trace, events: readonly TraceEvent[], state: InternalEffectMachineState): void {\n' +
          '  for (const event of events) if (retainTraceEvent(state, event)) out.events.push(event);\n' +
          '}\n\n' +
          'function appendTrace(out: Trace, next: Trace, state: InternalEffectMachineState): boolean {\n' +
          '  appendTraceEvents(out, next.events, state);\n',
        'function appendTrace(out: Trace, next: Trace): boolean {\n' +
          '  out.events.push(...next.events);\n',
      ),
      replacement(
        '  for (const step of machineEachSteps(node, env, () => consumeIterationBudget(state, node))) {\n' +
          "    const iterationEvent: TraceEvent = { binding: step.primary[0], op: 'iter-next', value: step.primary[1] };\n" +
          '    if (retainTraceEvent(state, iterationEvent)) out.events.push(iterationEvent);\n',
        '  for (const step of machineEachSteps(node, env, () => consumeIterationBudget(state, node))) {\n' +
          '    out.events.push({\n' +
          '      binding: step.primary[0],\n' +
          "      op: 'iter-next',\n" +
          '      value: step.primary[1],\n' +
          '    });\n',
      ),
      replacement(
        '    for (const [name, value] of step.bindings) defineBinding(iterationEnv, name, value);\n' +
          '    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '    appendTraceEvents(out, next.events, state);\n',
        '    for (const [name, value] of step.bindings) defineBinding(iterationEnv, name, value);\n' +
          '    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '    out.events.push(...next.events);\n',
      ),
      replacement(
        '    consumeIterationBudget(state, node);\n' +
          "    const iterationEvent: TraceEvent = { binding: name, op: 'iter-next', value };\n" +
          '    if (retainTraceEvent(state, iterationEvent)) out.events.push(iterationEvent);\n',
        '    consumeIterationBudget(state, node);\n' +
          "    out.events.push({ binding: name, op: 'iter-next', value });\n",
      ),
      replacement(
        '    defineIntBinding(iterationEnv, name, value);\n' +
          '    const next = yield* runInternalEffectMachineSequence(children, iterationEnv, state);\n' +
          '    appendTraceEvents(out, next.events, state);\n',
        '    defineIntBinding(iterationEnv, name, value);\n' +
          '    const next = yield* runInternalEffectMachineSequence(children, iterationEnv, state);\n' +
          '    out.events.push(...next.events);\n',
      ),
      replacement(
        '    markRepeatableLoopBody(iterationEnv);\n' +
          '    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '    appendTraceEvents(out, next.events, state);\n',
        '    markRepeatableLoopBody(iterationEnv);\n' +
          '    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '    out.events.push(...next.events);\n',
      ),
      replacement('    if (appendTrace(out, next, state)) return out;\n', '    if (appendTrace(out, next)) return out;\n'),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
    'fb70d4e40848eb40531321a342f2d2f49b762e1c5d40e2a5fca1d845a4c5e6f3',
    'f31e9769f76417d81a710894fb5facd7b51e2a86f49b29ecd41101edab852ed0',
    [
      replacement(
        'export interface InternalEffectMachineAsyncOptions {\n' +
          '  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;\n' +
          '  readonly capabilityTimeoutMs?: number;\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '  readonly traceRetention?: InternalEffectMachineTraceRetention;\n' +
          '}\n\n' +
          'export interface InternalEffectMachineSyncOptions {\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '  readonly traceRetention?: InternalEffectMachineTraceRetention;\n' +
          '}\n',
        'export interface InternalEffectMachineAsyncOptions {\n' +
          '  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;\n' +
          '  readonly capabilityTimeoutMs?: number;\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '}\n\n' +
          'export interface InternalEffectMachineSyncOptions {\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '}\n',
      ),
      replacement(
        "export type InternalEffectMachineTraceRetention = 'full' | 'observable-only';\n\n",
        '',
      ),
      replacement(
        '  remainingIterations: number | undefined;\n' +
          '  traceRetention?: InternalEffectMachineTraceRetention;\n',
        '  remainingIterations: number | undefined;\n',
      ),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/internal-effect-machine.ts',
    '4d12b4f8bfeaf86a7252b42b2f7ee72ff4d83959704661859bad1376689cd8f3',
    'f6277499778284644273b675b3dcf9381236d784a6faac61f140d87f7371d4c1',
    [
      replacement('  InternalEffectMachineTraceRetention,\n', ''),
      replacement(
        'export function runInternalEffectMachineSync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineSyncOptions = {},\n' +
          '): Trace {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '    traceRetention: options.traceRetention,\n',
        'export function runInternalEffectMachineSync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineSyncOptions = {},\n' +
          '): Trace {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n',
      ),
      replacement(
        'export async function runInternalEffectMachineAsync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineAsyncOptions = {},\n' +
          '): Promise<Trace> {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '    traceRetention: options.traceRetention,\n',
        'export async function runInternalEffectMachineAsync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineAsyncOptions = {},\n' +
          '): Promise<Trace> {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n',
      ),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/trace.ts',
    'd65449435746be502561239da329fea57c03e7ec1fd8db5df699749a3a6d3d72',
    'c8183cfef95af4216299e12cb6e11e1566c3eb2babf00a887af4393ee6e6cb87',
    [
      replacement(
        "export type ExternallyObservableTraceEvent = Extract<TraceEvent, { op: 'capability' | 'stderr' | 'stdout' }>;\n\n" +
          '/** Events safe to retain when an internal caller requests observable-only traces. */\n' +
          'export function isExternallyObservableTraceEvent(event: TraceEvent): event is ExternallyObservableTraceEvent {\n' +
          "  return event.op === 'stdout' || event.op === 'stderr' || event.op === 'capability';\n" +
          '}\n\n',
        '',
      ),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/execute-compat.ts',
    'e94d6bebd332aac52416dd5963635bb231ce6bade00bf24fbe3364ba71354cc6',
    '4bba82a9472920e2c489d27aef595a133f0077210869d79872bf956f18a7e4b0',
    [
      replacement("          accepted.limits.maxStringBytes,\n          'observable-only',\n", '          accepted.limits.maxStringBytes,\n'),
      replacement("            traceRetention: 'observable-only',\n", ''),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/execute.ts',
    'c2e486237c80b71827abbbea86a0242368a400bd99593ad5f7088bed8957053e',
    '4313cc311e4a25ea044fbdea0edba4333b5a13f78734e30f6a218fc69cedda38',
    [
      replacement("      accepted.limits.maxStringBytes,\n      'observable-only',\n", '      accepted.limits.maxStringBytes,\n'),
      replacement("        traceRetention: 'observable-only',\n", ''),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/internal-engine.ts',
    'fab781ad3c50956d75724782c0631127cad4282e43a1af2b233e72daae8b24b0',
    'e9ce6fc2ba0e390b684193aa61a2c91416a4b0545e97c9f412026d924f3ebcab',
    [
      replacement('  type InternalEffectMachineTraceRetention,\n', ''),
      replacement('  traceRetention?: InternalEffectMachineTraceRetention,\n', ''),
      replacement('    traceRetention,\n', ''),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/normalize.ts',
    'ffb142568bfae07fc31b2cd3c5b1e19b5fa7091986bcb9b483d136a3788089fb',
    'd502917998bc55217d29f4db1e0ee783d7e9d646359553af8283b7ba8ebd408e',
    [
      replacement(
        "import { isExternallyObservableTraceEvent, type Trace, type TraceEvent } from '../ir/semantics/trace.js';\n",
        "import type { Trace, TraceEvent } from '../ir/semantics/trace.js';\n",
      ),
      replacement('  if (!isExternallyObservableTraceEvent(input)) return null;\n', ''),
    ],
  ),
]);

export const TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES = Object.freeze([
  Object.freeze({
    path: 'ir/semantics/internal-effect-machine-types.js',
    digest: '08fd6f79b559c59e699c32b7926d2e21635327afbc625e07f0e11b470e926583',
  }),
]);

export const POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS = Object.freeze([
  entry(
    'ir/semantics/internal-effect-machine-sequence.js',
    '281d75212481f53630ce9c5159548538c2e776ef29cab5faaca2023e1830155d',
    'c5b68e8db8701134531acc481dc19001dc2e062e034572b0d30531e8fc325ef0',
    [
      replacement(
        "import { emptyTrace, isExternallyObservableTraceEvent } from './trace.js';\n",
        "import { emptyTrace } from './trace.js';\n",
      ),
      replacement(
        'function retainTraceEvent(state, event) {\n' +
          "    return state.traceRetention !== 'observable-only' || isExternallyObservableTraceEvent(event);\n" +
          '}\n' +
          'function appendTraceEvents(out, events, state) {\n' +
          '    for (const event of events)\n' +
          '        if (retainTraceEvent(state, event))\n' +
          '            out.events.push(event);\n' +
          '}\n' +
          'function appendTrace(out, next, state) {\n' +
          '    appendTraceEvents(out, next.events, state);\n',
        'function appendTrace(out, next) {\n' +
          '    out.events.push(...next.events);\n',
      ),
      replacement(
        '    for (const step of machineEachSteps(node, env, () => consumeIterationBudget(state, node))) {\n' +
          "        const iterationEvent = { binding: step.primary[0], op: 'iter-next', value: step.primary[1] };\n" +
          '        if (retainTraceEvent(state, iterationEvent))\n' +
          '            out.events.push(iterationEvent);\n',
        '    for (const step of machineEachSteps(node, env, () => consumeIterationBudget(state, node))) {\n' +
          '        out.events.push({\n' +
          '            binding: step.primary[0],\n' +
          "            op: 'iter-next',\n" +
          '            value: step.primary[1],\n' +
          '        });\n',
      ),
      replacement(
        '        for (const [name, value] of step.bindings)\n' +
          '            defineBinding(iterationEnv, name, value);\n' +
          '        const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '        appendTraceEvents(out, next.events, state);\n',
        '        for (const [name, value] of step.bindings)\n' +
          '            defineBinding(iterationEnv, name, value);\n' +
          '        const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '        out.events.push(...next.events);\n',
      ),
      replacement(
        '        consumeIterationBudget(state, node);\n' +
          "        const iterationEvent = { binding: name, op: 'iter-next', value };\n" +
          '        if (retainTraceEvent(state, iterationEvent))\n' +
          '            out.events.push(iterationEvent);\n',
        '        consumeIterationBudget(state, node);\n' +
          "        out.events.push({ binding: name, op: 'iter-next', value });\n",
      ),
      replacement(
        '        defineIntBinding(iterationEnv, name, value);\n' +
          '        const next = yield* runInternalEffectMachineSequence(children, iterationEnv, state);\n' +
          '        appendTraceEvents(out, next.events, state);\n',
        '        defineIntBinding(iterationEnv, name, value);\n' +
          '        const next = yield* runInternalEffectMachineSequence(children, iterationEnv, state);\n' +
          '        out.events.push(...next.events);\n',
      ),
      replacement(
        '        markRepeatableLoopBody(iterationEnv);\n' +
          '        const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '        appendTraceEvents(out, next.events, state);\n',
        '        markRepeatableLoopBody(iterationEnv);\n' +
          '        const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);\n' +
          '        out.events.push(...next.events);\n',
      ),
      replacement(
        '        if (appendTrace(out, next, state))\n',
        '        if (appendTrace(out, next))\n',
      ),
    ],
  ),
  entry(
    'ir/semantics/internal-effect-machine.js',
    '2f4762cc6e01cbfc4ac1f890cbcb6702c86906e8a2a8f1ee806af8a34296da39',
    'b9d9f79098a602a9a5417810050e06da6552220b6a2c27b66285410ed648fbfb',
    [
      replacement(
        'export function runInternalEffectMachineSync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '        traceRetention: options.traceRetention,\n',
        'export function runInternalEffectMachineSync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n',
      ),
      replacement(
        'export async function runInternalEffectMachineAsync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '        traceRetention: options.traceRetention,\n',
        'export async function runInternalEffectMachineAsync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n',
      ),
    ],
  ),
  entry(
    'ir/semantics/trace.js',
    '9c6e405a78353e42c7333a2f5a001bd37017edf27695030a0164bbc0d8ae1d66',
    '175460339608c738493cc229f869d8579dfb20dabaec2902542c9fc4cb0510fc',
    [
      replacement(
        '/** Events safe to retain when an internal caller requests observable-only traces. */\n' +
          'export function isExternallyObservableTraceEvent(event) {\n' +
          "    return event.op === 'stdout' || event.op === 'stderr' || event.op === 'capability';\n" +
          '}\n',
        '',
      ),
    ],
  ),
  entry(
    'runtime-envelope/execute-compat.js',
    'e4e85a658f5561776fd82ede85b92cab35d1540770b97a30aaa0508fc0eadb53',
    'fa06481ecc1354b39bdfeec50e9e3dde8efd66003dbae3505c618afcfa7888dd',
    [
      replacement(
        "            ? runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxStringBytes, 'observable-only')\n",
        '            ? runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxStringBytes)\n',
      ),
      replacement("                traceRetention: 'observable-only',\n", ''),
    ],
  ),
  entry(
    'runtime-envelope/execute.js',
    '662199d6f2385cfe232e74bc284d27cf1b2525944d211ddfb525979b44504cec',
    '5a385612dae2dd814ce925ff50e3452c254cc90a5e99b1ede327de44652c3d8b',
    [
      replacement(
        "        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxStringBytes, 'observable-only');\n",
        '        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxStringBytes);\n',
      ),
      replacement("            traceRetention: 'observable-only',\n", ''),
    ],
  ),
  entry(
    'runtime-envelope/internal-engine.js',
    '431b7d904f9c6677a273981af2fd25a79a16130cae42ab4539ffdccc04c71c8f',
    '367b8bf7f223edaf96e2da25684347c9d654273943016f12f6d17cc851e9408d',
    [
      replacement(
        'export function runInternalRuntimeEngineSync(nodes, env, iterationBudget, observer, textCodePointCacheMaxStringBytes, traceRetention) {\n',
        'export function runInternalRuntimeEngineSync(nodes, env, iterationBudget, observer, textCodePointCacheMaxStringBytes) {\n',
      ),
      replacement('        traceRetention,\n', ''),
    ],
  ),
  entry(
    'runtime-envelope/normalize.js',
    '3f2585517edd54b6a9c54b5c9e6cff7f65179ffd49b8e1392a26e15d068e3669',
    '1984c5addba1c2b29a6589879a7fe776ce794d247f3e73d59c053b96afc91cae',
    [
      replacement("import { isExternallyObservableTraceEvent } from '../ir/semantics/trace.js';\n", ''),
      replacement(
        '    if (!isExternallyObservableTraceEvent(input))\n' +
          '        return null;\n',
        '',
      ),
    ],
  ),
]);

const SOURCE_RECONSTRUCTION_PATHS = Object.freeze({
  effectMachineSha256: 'packages/core/src/ir/semantics/internal-effect-machine.ts',
  effectMachineTypesSha256: 'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  sequenceSha256: 'packages/core/src/ir/semantics/internal-effect-machine-sequence.ts',
});

export function traceCompactionSourceReconstruction(sourceKey) {
  const path = SOURCE_RECONSTRUCTION_PATHS[sourceKey];
  return path === undefined
    ? undefined
    : POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS.find((candidate) => candidate.path === path);
}

const EXPECTED_SOURCE_PATHS = Object.freeze([
  'packages/core/src/ir/semantics/internal-effect-machine-sequence.ts',
  'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  'packages/core/src/ir/semantics/internal-effect-machine.ts',
  'packages/core/src/ir/semantics/trace.ts',
  'packages/core/src/runtime-envelope/execute-compat.ts',
  'packages/core/src/runtime-envelope/execute.ts',
  'packages/core/src/runtime-envelope/internal-engine.ts',
  'packages/core/src/runtime-envelope/normalize.ts',
]);
const EXPECTED_COMPILED_PATHS = Object.freeze([
  'ir/semantics/internal-effect-machine-sequence.js',
  'ir/semantics/internal-effect-machine.js',
  'ir/semantics/trace.js',
  'runtime-envelope/execute-compat.js',
  'runtime-envelope/execute.js',
  'runtime-envelope/internal-engine.js',
  'runtime-envelope/normalize.js',
]);

function exactPaths(rows, expected, label) {
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.length ||
    rows.some((row, index) => row.path !== expected[index] || row.claim !== CLAIM)
  ) {
    throw new TypeError(`trace compaction historical transition rejection: ${label} paths changed`);
  }
}

export function validateTraceCompactionHistoricalTransition({
  compiledReconstructions = POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  sourceReconstructions = POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS,
  transition = TRACE_COMPACTION_HISTORICAL_TRANSITION,
  typeOnlyIdentities = TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES,
} = {}) {
  if (
    transition.claim !== CLAIM ||
    transition.successorCommit !== '45dd2808e9efebcb21e0d2031f58062a444970c8' ||
    transition.predecessorCommit !== '1868480434adb54186b4077144748dd1afa7d07d' ||
    transition.compiledInventory.successor.count !== 317 ||
    transition.compiledInventory.successor.digest !== '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67' ||
    JSON.stringify(transition.compiledInventory.successor) !== JSON.stringify(transition.compiledInventory.predecessor)
  ) {
    throw new TypeError('trace compaction historical transition rejection: immutable identity changed');
  }
  exactPaths(sourceReconstructions, EXPECTED_SOURCE_PATHS, 'source');
  exactPaths(compiledReconstructions, EXPECTED_COMPILED_PATHS, 'compiled');
  if (
    JSON.stringify(typeOnlyIdentities) !==
    JSON.stringify([
      {
        path: 'ir/semantics/internal-effect-machine-types.js',
        digest: '08fd6f79b559c59e699c32b7926d2e21635327afbc625e07f0e11b470e926583',
      },
    ])
  ) {
    throw new TypeError('trace compaction historical transition rejection: type-only identity changed');
  }
  return true;
}
