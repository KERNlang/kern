const CLAIM = 'kern.runtime.trace-retention-ownership.r0';

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

function sourceEvent(value) {
  return replacement(
    `appendInternalReferenceTraceEvent(out, ${value}, env.internalReferenceTraceRetention);`,
    `appendInternalReferenceTraceEvent(out, ${value}, env);`,
  );
}

function sourceEvents(value) {
  return replacement(
    `appendInternalReferenceTraceEvents(out, ${value}, env.internalReferenceTraceRetention);`,
    `appendInternalReferenceTraceEvents(out, ${value}, env);`,
  );
}

function compiledEvent(value) {
  return replacement(
    `appendInternalReferenceTraceEvent(out, ${value}, env.internalReferenceTraceRetention);`,
    `appendInternalReferenceTraceEvent(out, ${value}, env);`,
  );
}

function compiledEvents(value) {
  return replacement(
    `appendInternalReferenceTraceEvents(out, ${value}, env.internalReferenceTraceRetention);`,
    `appendInternalReferenceTraceEvents(out, ${value}, env);`,
  );
}

const SOURCE_HELPER_IMPORT =
  "import {\n  appendInternalReferenceTraceEvent,\n  appendInternalReferenceTraceEvents,\n} from './internal-reference-trace-retention.js';\n";
const COMPILED_HELPER_IMPORT =
  "import { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, } from './internal-reference-trace-retention.js';\n";

export const TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '36d0f660a66c1f3198ca050d4ab56ad688512dbd',
  successorCommit: '0df8834f1ec2509118128fbe1f0676ae6d525d25',
  compiledInventory: Object.freeze({
    predecessor: Object.freeze({
      count: 318,
      digest: '6f5b73bf8e24f621f5eb1b25344875037783d9943784dcedd2c20f3ca2bfb16b',
    }),
    successor: Object.freeze({
      count: 317,
      digest: '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67',
    }),
  }),
  restoredCompiledPath: Object.freeze({
    digest: 'fcb8f18dedc2c0594319f2567a66a3d22d2b3189d3a64a071967c5b3ede110b7',
    path: 'ir/semantics/internal-reference-trace-retention.js',
  }),
  restoredSourcePath: Object.freeze({
    digest: 'b7f0bc1d686827c908d728d8fd53bfc3d2a2a12e8cdfb643aa74443f528817d6',
    path: 'packages/core/src/ir/semantics/internal-reference-trace-retention.ts',
  }),
});

export const RESTORED_TRACE_RETENTION_SOURCE = Buffer.from(`import type { SemanticEnv } from './semantic-env.js';
import { isExternallyObservableTraceEvent, type Trace, type TraceEvent } from './trace.js';

export type InternalReferenceTraceRetention = 'full' | 'observable-only';

const referenceTraceRetention = Symbol('internalReferenceTraceRetention');
type RetentionEnvironment = SemanticEnv & {
  [referenceTraceRetention]?: InternalReferenceTraceRetention;
};

function retentionFor(env: SemanticEnv): InternalReferenceTraceRetention {
  return (env as RetentionEnvironment)[referenceTraceRetention] ?? 'full';
}

export function bindInternalReferenceTraceRetention(
  env: SemanticEnv,
  retention: InternalReferenceTraceRetention,
): () => void {
  const target = env as RetentionEnvironment;
  const previous = Object.getOwnPropertyDescriptor(target, referenceTraceRetention);
  Object.defineProperty(target, referenceTraceRetention, {
    configurable: true,
    enumerable: false,
    value: retention,
    writable: false,
  });
  return () => {
    if (previous) Object.defineProperty(target, referenceTraceRetention, previous);
    else Reflect.deleteProperty(target, referenceTraceRetention);
  };
}

export function copyInternalReferenceTraceRetention(source: SemanticEnv, target: SemanticEnv): void {
  const retention = (source as RetentionEnvironment)[referenceTraceRetention];
  if (retention !== undefined) bindInternalReferenceTraceRetention(target, retention);
}

export function appendInternalReferenceTraceEvent(out: Trace, event: TraceEvent, env: SemanticEnv): void {
  if (retentionFor(env) === 'full' || isExternallyObservableTraceEvent(event)) out.events.push(event);
}

export function appendInternalReferenceTraceEvents(out: Trace, events: readonly TraceEvent[], env: SemanticEnv): void {
  for (const event of events) appendInternalReferenceTraceEvent(out, event, env);
}
`);

export const RESTORED_TRACE_RETENTION_COMPILED = Buffer.from(`import { isExternallyObservableTraceEvent } from './trace.js';
const referenceTraceRetention = Symbol('internalReferenceTraceRetention');
function retentionFor(env) {
    return env[referenceTraceRetention] ?? 'full';
}
export function bindInternalReferenceTraceRetention(env, retention) {
    const target = env;
    const previous = Object.getOwnPropertyDescriptor(target, referenceTraceRetention);
    Object.defineProperty(target, referenceTraceRetention, {
        configurable: true,
        enumerable: false,
        value: retention,
        writable: false,
    });
    return () => {
        if (previous)
            Object.defineProperty(target, referenceTraceRetention, previous);
        else
            Reflect.deleteProperty(target, referenceTraceRetention);
    };
}
export function copyInternalReferenceTraceRetention(source, target) {
    const retention = source[referenceTraceRetention];
    if (retention !== undefined)
        bindInternalReferenceTraceRetention(target, retention);
}
export function appendInternalReferenceTraceEvent(out, event, env) {
    if (retentionFor(env) === 'full' || isExternallyObservableTraceEvent(event))
        out.events.push(event);
}
export function appendInternalReferenceTraceEvents(out, events, env) {
    for (const event of events)
        appendInternalReferenceTraceEvent(out, event, env);
}
//# sourceMappingURL=internal-reference-trace-retention.js.map`);

export const POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS = Object.freeze([
  entry('packages/core/src/ir/semantics/async-reference-runner.ts', '49c7f71fdcfcb7df5c3914264ee165a5265fdc0959993e2bdc6cbd4358fcabd7', '3a06d4ca4c4f1dfc294918966bf1ecb56c15ed36b0d49e8eac287fde0f23acf3', [
    replacement("} from './internal-capability-interceptor.js';\nimport { recordArrayFieldsFromValue }", `} from './internal-capability-interceptor.js';\n${SOURCE_HELPER_IMPORT}import { recordArrayFieldsFromValue }`),
    replacement("import {\n  appendInternalReferenceTraceEvent,\n  appendInternalReferenceTraceEvents,\n  type CompletionRecord,\n  emptyTrace,\n  type Trace,\n} from './trace.js';", "import { type CompletionRecord, emptyTrace, type Trace } from './trace.js';"),
    sourceEvents('t.events'),
    sourceEvents('bodyTrace.events'),
    sourceEvents('catchTrace.events'),
    sourceEvents('finallyTrace.events'),
    replacement('    markRepeatableLoopBody(iterEnv);\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '    markRepeatableLoopBody(iterEnv);\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
    sourceEvent("{ op: 'iter-next', binding: name, value: i }"),
    replacement('    defineIntBinding(iterEnv, name, i);\n\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '    defineIntBinding(iterEnv, name, i);\n\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
    replacement("    appendInternalReferenceTraceEvent(\n      out,\n      { op: 'iter-next', binding: step.primary[0], value: step.primary[1] },\n      env.internalReferenceTraceRetention,\n    );", "    appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);"),
    replacement('    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);\n\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);\n\n    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n    appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
  ]),
  entry('packages/core/src/ir/semantics/each.ts', '7ab18dc53ae96a599d0e9950d417b608c6df116528766ba2e2c3a63656fed8e9', '5bd7db9814ea2c0bf28c3c0ff783928a77a096911e199ef9ec28348226c2a1fe', [
    replacement("import { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';", `${SOURCE_HELPER_IMPORT}import { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace, type Trace } from './trace.js';`),
    replacement("    appendInternalReferenceTraceEvent(\n      out,\n      { op: 'iter-next', binding: step.primary[0], value: step.primary[1] },\n      env.internalReferenceTraceRetention,\n    );", "    appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);"),
    sourceEvents('childTrace.events'),
  ]),
  entry('packages/core/src/ir/semantics/for.ts', '4016f2e8e0898035101f35c9cff073cff90dc4f3c8afcf6e50d6d5037cd2fcf9', '88b6e7a32e45ab34b4bc2490545d6162f03ca803529c78085731ab763d6de68a', [
    replacement("import { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';", `${SOURCE_HELPER_IMPORT}import { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace, type Trace } from './trace.js';`),
    replacement("    appendInternalReferenceTraceEvent(\n      out,\n      { op: 'iter-next', binding: name, value: i },\n      env.internalReferenceTraceRetention,\n    );", "    appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: name, value: i }, env);"),
    sourceEvents('childTrace.events'),
  ]),
  entry('packages/core/src/ir/semantics/reference-runner.ts', 'acac7bede1db6868f27dea13d55a37f3afa3ba35f3312444f758beaf327c6cd8', 'f80905ca6f498fe2ccadd8a78ce76b790bd8554ec0c5717a0151cd9f95ecf958', [
    replacement("import { appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { emptyTrace, type Trace } from './trace.js';"),
    sourceEvents('t.events'),
  ]),
  entry('packages/core/src/ir/semantics/semantic-env.ts', '679729043d89f199140dbf6a9f658204a3f0df1bd93f109e616ebcaefac6f624', 'd14e53797b711329c59843e03b69800c974b1fe478dff42feedf1460b01950ff', [
    replacement("import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';\n", "import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';\nimport { copyInternalReferenceTraceRetention } from './internal-reference-trace-retention.js';\n"),
    replacement("  /** Execution-scoped policy for retaining internal reference-runner events. */\n  internalReferenceTraceRetention?: InternalReferenceTraceRetention;\n", ''),
    replacement("export type InternalReferenceTraceRetention = 'full' | 'observable-only';\n\nexport function bindInternalReferenceTraceRetention(\n  env: SemanticEnv,\n  retention: InternalReferenceTraceRetention,\n): () => void {\n  const previous = env.internalReferenceTraceRetention;\n  env.internalReferenceTraceRetention = retention;\n  return () => {\n    if (previous === undefined) delete env.internalReferenceTraceRetention;\n    else env.internalReferenceTraceRetention = previous;\n  };\n}\n\n", ''),
    replacement('    internalReferenceTraceRetention: undefined,\n', ''),
    replacement('    internalReferenceTraceRetention: parent.internalReferenceTraceRetention,\n', ''),
    replacement('  copyInternalEffectMachineState(parent, child);\n', '  copyInternalEffectMachineState(parent, child);\n  copyInternalReferenceTraceRetention(parent, child);\n'),
  ]),
  entry('packages/core/src/ir/semantics/trace.ts', '8bec1e8883571345f2fe06cd22e67f5aff1495e38a24c4e1bb74c30aefd3b9f8', 'd65449435746be502561239da329fea57c03e7ec1fd8db5df699749a3a6d3d72', [
    replacement("export type InternalReferenceTraceRetention = 'full' | 'observable-only';\n", ''),
    replacement("export function appendInternalReferenceTraceEvent(\n  out: Trace,\n  event: TraceEvent,\n  retention: InternalReferenceTraceRetention = 'full',\n): void {\n  if (retention === 'full' || isExternallyObservableTraceEvent(event)) out.events.push(event);\n}\n\nexport function appendInternalReferenceTraceEvents(\n  out: Trace,\n  events: readonly TraceEvent[],\n  retention: InternalReferenceTraceRetention = 'full',\n): void {\n  for (const event of events) appendInternalReferenceTraceEvent(out, event, retention);\n}\n\n", ''),
  ]),
  entry('packages/core/src/ir/semantics/try.ts', 'c5e1a4c94d5c60aef25f3308fa418f38bf2f2e6ddda5460b90c68e0b5c4b91ab', '9b7657049de32bbb4d19f4aa056c92599d24dea472d3c02678f1cdb9e786cf26', [
    replacement("import { makeCaughtErrorValue } from './portable-error.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvents, type CompletionRecord, emptyTrace, type Trace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { makeCaughtErrorValue } from './portable-error.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { type CompletionRecord, emptyTrace, type Trace } from './trace.js';"),
    sourceEvents('bodyTrace.events'), sourceEvents('catchTrace.events'), sourceEvents('finallyTrace.events'),
  ]),
  entry('packages/core/src/ir/semantics/while.ts', '8e67175ae6623fa40c23b3b13e9aeee03cd28dfdc0b5599eef19c63dfdb12439', '2f82acd62130c44734513c17b3b60385ce2f56eb0cc0d9b38a7c9e5c286d5c13', [
    replacement("import { evalPortableValue } from './portable-scalar.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { evalPortableValue } from './portable-scalar.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace, type Trace } from './trace.js';"),
    sourceEvents('childTrace.events'),
  ]),
  entry('packages/core/src/runtime-envelope/internal-legacy-engine.ts', 'e9ec12cdef0d8745c4fc558b2168159a75aed38d22f3436bcb79e4c19e4823a4', '6409df6da00c07ac2a7f6a205e45d213632b2f8d9dce79ead173f87b17325797', [
    replacement("import {\n  bindInternalReferenceTraceRetention,\n  type InternalReferenceTraceRetention,\n  type SemanticEnv,\n} from '../ir/semantics/index.js';", "import type { SemanticEnv } from '../ir/semantics/index.js';\nimport {\n  bindInternalReferenceTraceRetention,\n  type InternalReferenceTraceRetention,\n} from '../ir/semantics/internal-reference-trace-retention.js';"),
  ]),
]);

export const POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS = Object.freeze([
  entry('ir/semantics/async-reference-runner.js', '0fc3c1d64265be955ff20dcafc51a5d20ffdb9c74e339562804cbc1c44c03861', 'db15e388c8fd623ef72aa769ba6fee8a4efd5631847bb54b6d08fe6d739e0fa8', [
    replacement("import { invokeInternalRuntimeCapabilityAsync, invokeInternalRuntimeSyncCapabilityAsync, } from './internal-capability-interceptor.js';\n", `import { invokeInternalRuntimeCapabilityAsync, invokeInternalRuntimeSyncCapabilityAsync, } from './internal-capability-interceptor.js';\n${COMPILED_HELPER_IMPORT}`),
    replacement("import { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, emptyTrace, } from './trace.js';", "import { emptyTrace } from './trace.js';"),
    compiledEvents('t.events'), compiledEvents('bodyTrace.events'), compiledEvents('catchTrace.events'), compiledEvents('finallyTrace.events'),
    replacement('        markRepeatableLoopBody(iterEnv);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '        markRepeatableLoopBody(iterEnv);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
    compiledEvent("{ op: 'iter-next', binding: name, value: i }"),
    replacement('        defineIntBinding(iterEnv, name, i);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '        defineIntBinding(iterEnv, name, i);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
    compiledEvent("{ op: 'iter-next', binding: step.primary[0], value: step.primary[1] }"),
    replacement('        for (const [k, v] of step.bindings)\n            defineBinding(iterEnv, k, v);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env.internalReferenceTraceRetention);', '        for (const [k, v] of step.bindings)\n            defineBinding(iterEnv, k, v);\n        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n        appendInternalReferenceTraceEvents(out, childTrace.events, env);'),
  ]),
  entry('ir/semantics/each.js', 'ec89c60f635da2586022040184e7055776cd0726dfd8670d9204fa2d100a7d63', '7f09d5e4badefe29286c6c548495a10d9b12996a22e0331bdf1cddfa2eca2371', [
    replacement("import { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, emptyTrace } from './trace.js';", `${COMPILED_HELPER_IMPORT}import { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace } from './trace.js';`),
    compiledEvent("{ op: 'iter-next', binding: step.primary[0], value: step.primary[1] }"), compiledEvents('childTrace.events'),
  ]),
  entry('ir/semantics/for.js', '2e54b929ec9677112c57605be66e4c7e47a5a1daddba4f6f897856183e14491a', 'ed574724e8793b68720305fcf962af260531fbdb113ff39d5a0387fd6bd41f21', [
    replacement("import { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, emptyTrace } from './trace.js';", `${COMPILED_HELPER_IMPORT}import { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace } from './trace.js';`),
    compiledEvent("{ op: 'iter-next', binding: name, value: i }"), compiledEvents('childTrace.events'),
  ]),
  entry('ir/semantics/reference-runner.js', 'd8cb91f58d63680653e723edd7f16917608f57ee337e827b2f742cdff92efde1', '0dcd52b244d2e944038cb4ce21bcb9b3d280aeca6e586b25ad436c9f7e9b8e37', [
    replacement("import { appendInternalReferenceTraceEvents, emptyTrace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { emptyTrace } from './trace.js';"), compiledEvents('t.events'),
  ]),
  entry('ir/semantics/semantic-env.js', 'c8607c991d3536928d82df4c2c78923f72255a74c2805429e62cff7eafaf44f5', 'bf62366b31d5579e55674addaea5b5e4be1e0c9307ada9f183eff96aded60d0e', [
    replacement("import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';\n", "import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';\nimport { copyInternalReferenceTraceRetention } from './internal-reference-trace-retention.js';\n"),
    replacement("export function bindInternalReferenceTraceRetention(env, retention) {\n    const previous = env.internalReferenceTraceRetention;\n    env.internalReferenceTraceRetention = retention;\n    return () => {\n        if (previous === undefined)\n            delete env.internalReferenceTraceRetention;\n        else\n            env.internalReferenceTraceRetention = previous;\n    };\n}\n", ''),
    replacement('        internalReferenceTraceRetention: undefined,\n', ''),
    replacement('        internalReferenceTraceRetention: parent.internalReferenceTraceRetention,\n', ''),
    replacement('    copyInternalEffectMachineState(parent, child);\n', '    copyInternalEffectMachineState(parent, child);\n    copyInternalReferenceTraceRetention(parent, child);\n'),
  ]),
  entry('ir/semantics/trace.js', '709cffe635c3103b7cc04ea55b6af781cce5419b1715d3cd9a9cd35b9cc200fb', '9c6e405a78353e42c7333a2f5a001bd37017edf27695030a0164bbc0d8ae1d66', [
    replacement("export function appendInternalReferenceTraceEvent(out, event, retention = 'full') {\n    if (retention === 'full' || isExternallyObservableTraceEvent(event))\n        out.events.push(event);\n}\nexport function appendInternalReferenceTraceEvents(out, events, retention = 'full') {\n    for (const event of events)\n        appendInternalReferenceTraceEvent(out, event, retention);\n}\n", ''),
  ]),
  entry('ir/semantics/try.js', '24cd61cd197c3a8b217082c4122d3e4c016c216fd15db55de5734b9d1fd104a4', 'e52e71c4b7ac7d5e440bef70ea9da4f34f5ad8d8eea33253bd0774214b4ba1a1', [
    replacement("import { makeCaughtErrorValue } from './portable-error.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvents, emptyTrace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { makeCaughtErrorValue } from './portable-error.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace } from './trace.js';"),
    compiledEvents('bodyTrace.events'), compiledEvents('catchTrace.events'), compiledEvents('finallyTrace.events'),
  ]),
  entry('ir/semantics/while.js', 'eb1e3f0b195749a670329b709c22b9fe43aca399a9cb2322ba3b7e6255c922b0', '3548bbeb979363f64870c8742fc33a2c96f89c7232fbaa2939ba8042fed3d189', [
    replacement("import { evalPortableValue } from './portable-scalar.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { appendInternalReferenceTraceEvents, emptyTrace } from './trace.js';", "import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\nimport { evalPortableValue } from './portable-scalar.js';\nimport { referenceRunSequence } from './reference-runner.js';\nimport { emptyTrace } from './trace.js';"), compiledEvents('childTrace.events'),
  ]),
  entry('runtime-envelope/internal-legacy-engine.js', '909589487f864fb992043bb631760272eb47abd5deb87f8fd8a54b1e5ffeb829', 'f389d3e694083cdfac4129225a042ce6aeb0ea3d5a8b80e6a9eddc70e16920d3', [
    replacement("import { bindInternalReferenceTraceRetention, } from '../ir/semantics/index.js';", "import { bindInternalReferenceTraceRetention, } from '../ir/semantics/internal-reference-trace-retention.js';"),
  ]),
]);

export function validateTraceRetentionOwnershipHistoricalTransition({
  compiledReconstructions = POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS,
  sourceReconstructions = POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS,
  transition = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION,
} = {}) {
  if (
    transition.claim !== CLAIM ||
    transition.successorCommit !== '0df8834f1ec2509118128fbe1f0676ae6d525d25' ||
    transition.predecessorCommit !== '36d0f660a66c1f3198ca050d4ab56ad688512dbd' ||
    transition.compiledInventory.successor.count !== 317 ||
    transition.compiledInventory.predecessor.count !== 318 ||
    transition.restoredCompiledPath.path !== 'ir/semantics/internal-reference-trace-retention.js' ||
    sourceReconstructions.length !== 9 ||
    compiledReconstructions.length !== 9
  ) throw new TypeError('trace retention ownership historical transition rejection: immutable identity changed');
  return true;
}
