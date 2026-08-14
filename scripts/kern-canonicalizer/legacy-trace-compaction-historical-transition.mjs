const CLAIM = 'kern.runtime.legacy-trace-compaction.r0';

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

const SOURCE_IMPORT =
  "import {\n  appendInternalReferenceTraceEvent,\n  appendInternalReferenceTraceEvents,\n} from './internal-reference-trace-retention.js';\n";
const COMPILED_IMPORT =
  "import { appendInternalReferenceTraceEvent, appendInternalReferenceTraceEvents, } from './internal-reference-trace-retention.js';\n";

const SOURCE_APPEND_REPLACEMENTS = Object.freeze([
  replacement('appendInternalReferenceTraceEvents(out, t.events, env);', 'out.events.push(...t.events);'),
  replacement('appendInternalReferenceTraceEvents(out, bodyTrace.events, env);', 'out.events.push(...bodyTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, catchTrace.events, env);', 'out.events.push(...catchTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, finallyTrace.events, env);', 'out.events.push(...finallyTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, childTrace.events, env);', 'out.events.push(...childTrace.events);'),
]);
const COMPILED_APPEND_REPLACEMENTS = Object.freeze([
  replacement('appendInternalReferenceTraceEvents(out, t.events, env);', 'out.events.push(...t.events);'),
  replacement('appendInternalReferenceTraceEvents(out, bodyTrace.events, env);', 'out.events.push(...bodyTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, catchTrace.events, env);', 'out.events.push(...catchTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, finallyTrace.events, env);', 'out.events.push(...finallyTrace.events);'),
  replacement('appendInternalReferenceTraceEvents(out, childTrace.events, env);', 'out.events.push(...childTrace.events);'),
]);

export const LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '45dd2808e9efebcb21e0d2031f58062a444970c8',
  successorCommit: '36d0f660a66c1f3198ca050d4ab56ad688512dbd',
  compiledInventory: Object.freeze({
    predecessor: Object.freeze({
      count: 317,
      digest: '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67',
    }),
    successor: Object.freeze({
      count: 318,
      digest: '6f5b73bf8e24f621f5eb1b25344875037783d9943784dcedd2c20f3ca2bfb16b',
    }),
  }),
  addedCompiledPaths: Object.freeze([
    Object.freeze({
      digest: 'fcb8f18dedc2c0594319f2567a66a3d22d2b3189d3a64a071967c5b3ede110b7',
      path: 'ir/semantics/internal-reference-trace-retention.js',
    }),
  ]),
  addedSourcePaths: Object.freeze([
    Object.freeze({
      digest: 'b7f0bc1d686827c908d728d8fd53bfc3d2a2a12e8cdfb643aa74443f528817d6',
      path: 'packages/core/src/ir/semantics/internal-reference-trace-retention.ts',
    }),
  ]),
});

export const POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS = Object.freeze([
  entry(
    'packages/core/src/ir/semantics/async-reference-runner.ts',
    '3a06d4ca4c4f1dfc294918966bf1ecb56c15ed36b0d49e8eac287fde0f23acf3',
    '476a2b7c10a3edc9c34dc8a14519c8fe2b036f1e8500656c8dca4d5472b1858d',
    [
      replacement(SOURCE_IMPORT, ''),
      ...SOURCE_APPEND_REPLACEMENTS.slice(0, 4),
      replacement(
        '    markRepeatableLoopBody(iterEnv);\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '    markRepeatableLoopBody(iterEnv);\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    out.events.push(...childTrace.events);\n',
      ),
      replacement(
        '    defineIntBinding(iterEnv, name, i);\n\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '    defineIntBinding(iterEnv, name, i);\n\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    out.events.push(...childTrace.events);\n',
      ),
      replacement(
        '    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);\n\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);\n\n' +
          '    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '    out.events.push(...childTrace.events);\n',
      ),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: name, value: i }, env);",
        "out.events.push({ op: 'iter-next', binding: name, value: i });",
      ),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);",
        "out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });",
      ),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/each.ts',
    '5bd7db9814ea2c0bf28c3c0ff783928a77a096911e199ef9ec28348226c2a1fe',
    'bb570bc6f5483ec47361c61532ccac51d0368d07fb9b1833f99fe1d1feae993e',
    [
      replacement(SOURCE_IMPORT, ''),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);",
        "out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });",
      ),
      SOURCE_APPEND_REPLACEMENTS.at(-1),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/for.ts',
    '88b6e7a32e45ab34b4bc2490545d6162f03ca803529c78085731ab763d6de68a',
    'c6b94116852a0b587750022b0d944658f02d864b78bbcff06153a198955ef950',
    [
      replacement(SOURCE_IMPORT, ''),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: name, value: i }, env);",
        "out.events.push({ op: 'iter-next', binding: name, value: i });",
      ),
      SOURCE_APPEND_REPLACEMENTS.at(-1),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/reference-runner.ts',
    'f80905ca6f498fe2ccadd8a78ce76b790bd8554ec0c5717a0151cd9f95ecf958',
    '50bbfa067a6ae08c7fc6a0274641acc49b56fd31251e00b1d034f3bd266b6484',
    [
      replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
      SOURCE_APPEND_REPLACEMENTS[0],
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/semantic-env.ts',
    'd14e53797b711329c59843e03b69800c974b1fe478dff42feedf1460b01950ff',
    'f2f3d1d3399fc296f2311d0ff56f997fa771a5a6aed6208849744c4ce6a93df3',
    [
      replacement("import { copyInternalReferenceTraceRetention } from './internal-reference-trace-retention.js';\n", ''),
      replacement('  copyInternalReferenceTraceRetention(parent, child);\n', ''),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/try.ts',
    '9b7657049de32bbb4d19f4aa056c92599d24dea472d3c02678f1cdb9e786cf26',
    '2c525ce64402b71abee04e7a15f57d48b308c3c4f39ef6167e8dc3ad1d40a529',
    [
      replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
      ...SOURCE_APPEND_REPLACEMENTS.slice(1, 4),
    ],
  ),
  entry(
    'packages/core/src/ir/semantics/while.ts',
    '2f82acd62130c44734513c17b3b60385ce2f56eb0cc0d9b38a7c9e5c286d5c13',
    '50b7e3bb264eda8275138d973071c91fdcfa15c3391cdc36968df21eb939a0fe',
    [
      replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
      SOURCE_APPEND_REPLACEMENTS.at(-1),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/execute-compat.ts',
    'f857fc67a2970296d076822968646e2565092ea33a77d8969a9fefbe065af4f4',
    'e94d6bebd332aac52416dd5963635bb231ce6bade00bf24fbe3364ba71354cc6',
    [
      replacement(
        ": runInternalLegacyEngineSync(nodes, env, 'observable-only');",
        ': runInternalLegacyEngineSync(nodes, env);',
      ),
      replacement(
        ": runInternalLegacyEngineAsync(nodes, env, asyncOptions, 'observable-only'),",
        ': runInternalLegacyEngineAsync(nodes, env, asyncOptions),',
      ),
    ],
  ),
  entry(
    'packages/core/src/runtime-envelope/internal-legacy-engine.ts',
    '6409df6da00c07ac2a7f6a205e45d213632b2f8d9dce79ead173f87b17325797',
    '63bb95ed4737ca17768f6e0cae80711906a3947d5b7dcf91e46813242dcd3ea5',
    [
      replacement(
        "import {\n  bindInternalReferenceTraceRetention,\n  type InternalReferenceTraceRetention,\n} from '../ir/semantics/internal-reference-trace-retention.js';\n",
        '',
      ),
      replacement(
        "export function runInternalLegacyEngineSync(\n  nodes: readonly IRNode[],\n  env: SemanticEnv,\n  traceRetention: InternalReferenceTraceRetention = 'full',\n): Trace {\n  registerAllContracts();\n  const restore = bindInternalReferenceTraceRetention(env, traceRetention);\n  try {\n    return referenceRunSequence(nodes, env);\n  } finally {\n    restore();\n  }\n}",
        'export function runInternalLegacyEngineSync(nodes: readonly IRNode[], env: SemanticEnv): Trace {\n  registerAllContracts();\n  return referenceRunSequence(nodes, env);\n}',
      ),
      replacement(
        "  options: AsyncReferenceRunnerOptions,\n  traceRetention: InternalReferenceTraceRetention = 'full',\n): Promise<Trace> {\n  registerAllContracts();\n  const restore = bindInternalReferenceTraceRetention(env, traceRetention);\n  try {\n    return await asyncReferenceRunSequence(nodes, env, options);\n  } finally {\n    restore();\n  }",
        '  options: AsyncReferenceRunnerOptions,\n): Promise<Trace> {\n  registerAllContracts();\n  return asyncReferenceRunSequence(nodes, env, options);',
      ),
    ],
  ),
]);

export const POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS = Object.freeze([
  entry(
    'ir/semantics/async-reference-runner.js',
    'db15e388c8fd623ef72aa769ba6fee8a4efd5631847bb54b6d08fe6d739e0fa8',
    'a1ded5723f500fe5092a2321194aa71604367f0f945229f451f34e5acb4be1b7',
    [
      replacement(COMPILED_IMPORT, ''),
      ...COMPILED_APPEND_REPLACEMENTS.slice(0, 4),
      replacement(
        '        markRepeatableLoopBody(iterEnv);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '        markRepeatableLoopBody(iterEnv);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        out.events.push(...childTrace.events);\n',
      ),
      replacement(
        '        defineIntBinding(iterEnv, name, i);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '        defineIntBinding(iterEnv, name, i);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        out.events.push(...childTrace.events);\n',
      ),
      replacement(
        '        for (const [k, v] of step.bindings)\n' +
          '            defineBinding(iterEnv, k, v);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        appendInternalReferenceTraceEvents(out, childTrace.events, env);\n',
        '        for (const [k, v] of step.bindings)\n' +
          '            defineBinding(iterEnv, k, v);\n' +
          '        const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);\n' +
          '        out.events.push(...childTrace.events);\n',
      ),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: name, value: i }, env);",
        "out.events.push({ op: 'iter-next', binding: name, value: i });",
      ),
      replacement(
        "appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);",
        "out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });",
      ),
    ],
  ),
  entry('ir/semantics/each.js', '7f09d5e4badefe29286c6c548495a10d9b12996a22e0331bdf1cddfa2eca2371', '02055baec800a286aad528f959c6c852a5447bb1747c9866c36bf0c5a8a90310', [
    replacement(COMPILED_IMPORT, ''),
    replacement("appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: step.primary[0], value: step.primary[1] }, env);", "out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });"),
    COMPILED_APPEND_REPLACEMENTS.at(-1),
  ]),
  entry('ir/semantics/for.js', 'ed574724e8793b68720305fcf962af260531fbdb113ff39d5a0387fd6bd41f21', '2b66a0421164230cb186e052ed836104dc472a59191077d7475d01101cd992e4', [
    replacement(COMPILED_IMPORT, ''),
    replacement("appendInternalReferenceTraceEvent(out, { op: 'iter-next', binding: name, value: i }, env);", "out.events.push({ op: 'iter-next', binding: name, value: i });"),
    COMPILED_APPEND_REPLACEMENTS.at(-1),
  ]),
  entry('ir/semantics/reference-runner.js', '0dcd52b244d2e944038cb4ce21bcb9b3d280aeca6e586b25ad436c9f7e9b8e37', '797b7a1694c0fbd19fd914a4ef7955d0d4f82e7763283328d27a1dffa014a1e4', [
    replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
    COMPILED_APPEND_REPLACEMENTS[0],
  ]),
  entry('ir/semantics/semantic-env.js', 'bf62366b31d5579e55674addaea5b5e4be1e0c9307ada9f183eff96aded60d0e', 'c77f5508b9ae47dec2a9866eb272b6e1ddba7090dfba53ee7d82cb75a0b8da8e', [
    replacement("import { copyInternalReferenceTraceRetention } from './internal-reference-trace-retention.js';\n", ''),
    replacement('    copyInternalReferenceTraceRetention(parent, child);\n', ''),
  ]),
  entry('ir/semantics/try.js', 'e52e71c4b7ac7d5e440bef70ea9da4f34f5ad8d8eea33253bd0774214b4ba1a1', '8c50885b1e450681d7637abef909235315e8490266b455ca55995b28dce667b2', [
    replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
    ...COMPILED_APPEND_REPLACEMENTS.slice(1, 4),
  ]),
  entry('ir/semantics/while.js', '3548bbeb979363f64870c8742fc33a2c96f89c7232fbaa2939ba8042fed3d189', 'f5aa3bbeb0e46f6efeda45f360436e18722f61be378e845e6140ba870ca4abb5', [
    replacement("import { appendInternalReferenceTraceEvents } from './internal-reference-trace-retention.js';\n", ''),
    COMPILED_APPEND_REPLACEMENTS.at(-1),
  ]),
  entry('runtime-envelope/execute-compat.js', '7bc2f2aeaeabe38e89cf202033436aea8bb579ee95c45c3bb85351e9d062b98b', 'e4e85a658f5561776fd82ede85b92cab35d1540770b97a30aaa0508fc0eadb53', [
    replacement(": runInternalLegacyEngineSync(nodes, env, 'observable-only');", ': runInternalLegacyEngineSync(nodes, env);'),
    replacement(": runInternalLegacyEngineAsync(nodes, env, asyncOptions, 'observable-only'));", ': runInternalLegacyEngineAsync(nodes, env, asyncOptions));'),
  ]),
  entry(
    'runtime-envelope/internal-legacy-engine.js',
    'f389d3e694083cdfac4129225a042ce6aeb0ea3d5a8b80e6a9eddc70e16920d3',
    '97699307d34c8ccbd2beb25f426925d581fa613db5cc03ed082c28e1de7c5ffd',
    [
      replacement("import { bindInternalReferenceTraceRetention, } from '../ir/semantics/internal-reference-trace-retention.js';\n", ''),
      replacement(
        "export function runInternalLegacyEngineSync(nodes, env, traceRetention = 'full') {\n    registerAllContracts();\n    const restore = bindInternalReferenceTraceRetention(env, traceRetention);\n    try {\n        return referenceRunSequence(nodes, env);\n    }\n    finally {\n        restore();\n    }\n}",
        'export function runInternalLegacyEngineSync(nodes, env) {\n    registerAllContracts();\n    return referenceRunSequence(nodes, env);\n}',
      ),
      replacement(
        "export async function runInternalLegacyEngineAsync(nodes, env, options, traceRetention = 'full') {\n    registerAllContracts();\n    const restore = bindInternalReferenceTraceRetention(env, traceRetention);\n    try {\n        return await asyncReferenceRunSequence(nodes, env, options);\n    }\n    finally {\n        restore();\n    }\n}",
        'export async function runInternalLegacyEngineAsync(nodes, env, options) {\n    registerAllContracts();\n    return asyncReferenceRunSequence(nodes, env, options);\n}',
      ),
    ],
  ),
]);

const EXPECTED_SOURCE_PATHS = Object.freeze(POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS.map((row) => row.path));
const EXPECTED_COMPILED_PATHS = Object.freeze(POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.map((row) => row.path));

export function validateLegacyTraceCompactionHistoricalTransition({
  compiledReconstructions = POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  sourceReconstructions = POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS,
  transition = LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION,
} = {}) {
  if (
    transition.claim !== CLAIM ||
    transition.successorCommit !== '36d0f660a66c1f3198ca050d4ab56ad688512dbd' ||
    transition.predecessorCommit !== '45dd2808e9efebcb21e0d2031f58062a444970c8' ||
    transition.compiledInventory.successor.count !== 318 ||
    transition.compiledInventory.successor.digest !== '6f5b73bf8e24f621f5eb1b25344875037783d9943784dcedd2c20f3ca2bfb16b' ||
    transition.compiledInventory.predecessor.count !== 317 ||
    transition.compiledInventory.predecessor.digest !== '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67'
  ) throw new TypeError('legacy trace compaction historical transition rejection: immutable identity changed');
  if (
    compiledReconstructions.some((row, index) => row.claim !== CLAIM || row.path !== EXPECTED_COMPILED_PATHS[index]) ||
    sourceReconstructions.some((row, index) => row.claim !== CLAIM || row.path !== EXPECTED_SOURCE_PATHS[index]) ||
    compiledReconstructions.length !== EXPECTED_COMPILED_PATHS.length ||
    sourceReconstructions.length !== EXPECTED_SOURCE_PATHS.length
  ) throw new TypeError('legacy trace compaction historical transition rejection: reconstruction paths changed');
  return true;
}
