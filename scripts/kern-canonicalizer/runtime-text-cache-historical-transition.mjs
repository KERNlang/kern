export const RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  commit: 'd33b9f50',
  currentInventory: Object.freeze({
    count: 317,
    digest: '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67',
  }),
  predecessorInventory: Object.freeze({
    count: 316,
    digest: 'ac340824eaa0a587dfe41d9bd8ffdfaf835e47c8cafab146f8031967e9d41345',
  }),
  addedPaths: Object.freeze([
    'ir/semantics/internal-text-code-point-cache.js',
  ]),
});

export const RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES = Object.freeze([
  Object.freeze({
    path: 'ir/semantics/internal-effect-machine-types.js',
    digest: '08fd6f79b559c59e699c32b7926d2e21635327afbc625e07f0e11b470e926583',
  }),
]);

export const POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS = Object.freeze([
  Object.freeze({
    sourceKey: 'effectMachineSha256',
    currentDigest: 'f6277499778284644273b675b3dcf9381236d784a6faac61f140d87f7371d4c1',
    expectedDigest: '3de758e08833d0881159f4716710701a605b45a0f56313bb191fabe02666e2eb',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { installInternalTextCodePointCache } from './internal-text-code-point-cache.js';\n",
        historical: '',
      }),
      Object.freeze({
        current:
          'export function runInternalEffectMachineSync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineSyncOptions = {},\n' +
          '): Trace {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '  };\n' +
          '  if (options.textCodePointCacheMaxStringBytes !== undefined) {\n' +
          '    installInternalTextCodePointCache(state, options.textCodePointCacheMaxStringBytes);\n' +
          '  }\n' +
          '  const machine = runMachine(nodes, env, state);\n',
        historical:
          'export function runInternalEffectMachineSync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineSyncOptions = {},\n' +
          '): Trace {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '  };\n' +
          '  const machine = runMachine(nodes, env, state);\n',
      }),
      Object.freeze({
        current:
          'export async function runInternalEffectMachineAsync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineAsyncOptions = {},\n' +
          '): Promise<Trace> {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '  };\n' +
          '  if (options.textCodePointCacheMaxStringBytes !== undefined) {\n' +
          '    installInternalTextCodePointCache(state, options.textCodePointCacheMaxStringBytes);\n' +
          '  }\n' +
          '  const machine = runMachine(nodes, env, state);\n',
        historical:
          'export async function runInternalEffectMachineAsync(\n' +
          '  nodes: readonly IRNode[],\n' +
          '  env: SemanticEnv,\n' +
          '  options: InternalEffectMachineAsyncOptions = {},\n' +
          '): Promise<Trace> {\n' +
          '  const state: InternalEffectMachineState = {\n' +
          '    observer: options.observer,\n' +
          '    remainingIterations: options.iterationBudget,\n' +
          '  };\n' +
          '  const machine = runMachine(nodes, env, state);\n',
      }),
    ]),
  }),
  Object.freeze({
    sourceKey: 'effectMachineTypesSha256',
    currentDigest: 'f31e9769f76417d81a710894fb5facd7b51e2a86f49b29ecd41101edab852ed0',
    expectedDigest: '909f576f295d7670d77d6bc80729b461b27f3b9d22b03333689a649925d378b6',
    replacements: Object.freeze([
      Object.freeze({
        current:
          'export interface InternalEffectMachineAsyncOptions {\n' +
          '  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;\n' +
          '  readonly capabilityTimeoutMs?: number;\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '}\n',
        historical:
          'export interface InternalEffectMachineAsyncOptions {\n' +
          '  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;\n' +
          '  readonly capabilityTimeoutMs?: number;\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '}\n',
      }),
      Object.freeze({
        current:
          'export interface InternalEffectMachineSyncOptions {\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheMaxStringBytes?: number;\n' +
          '}\n',
        historical:
          'export interface InternalEffectMachineSyncOptions {\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '}\n',
      }),
    ]),
  }),
]);

export const POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS = Object.freeze([
  Object.freeze({
    path: 'ir/semantics/internal-effect-machine.js',
    currentDigest: 'b9d9f79098a602a9a5417810050e06da6552220b6a2c27b66285410ed648fbfb',
    expectedDigest: 'b8ea55b9d196b1631712e17e3e09c52c5a91ca5bba6329b7467f6ff11ffbf27f',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { installInternalTextCodePointCache } from './internal-text-code-point-cache.js';\n",
        historical: '',
      }),
      Object.freeze({
        current:
          'export function runInternalEffectMachineSync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '    };\n' +
          '    if (options.textCodePointCacheMaxStringBytes !== undefined) {\n' +
          '        installInternalTextCodePointCache(state, options.textCodePointCacheMaxStringBytes);\n' +
          '    }\n' +
          '    const machine = runMachine(nodes, env, state);\n',
        historical:
          'export function runInternalEffectMachineSync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '    };\n' +
          '    const machine = runMachine(nodes, env, state);\n',
      }),
      Object.freeze({
        current:
          'export async function runInternalEffectMachineAsync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '    };\n' +
          '    if (options.textCodePointCacheMaxStringBytes !== undefined) {\n' +
          '        installInternalTextCodePointCache(state, options.textCodePointCacheMaxStringBytes);\n' +
          '    }\n' +
          '    const machine = runMachine(nodes, env, state);\n',
        historical:
          'export async function runInternalEffectMachineAsync(nodes, env, options = {}) {\n' +
          '    const state = {\n' +
          '        observer: options.observer,\n' +
          '        remainingIterations: options.iterationBudget,\n' +
          '    };\n' +
          '    const machine = runMachine(nodes, env, state);\n',
      }),
    ]),
  }),
  Object.freeze({
    path: 'ir/semantics/portable-string.js',
    currentDigest: '827b08a47292a1bb25ee849eb2386af6c7ae497189cb401f509c031f538690b1',
    expectedDigest: 'c8ae80db9f937c8257279f7e916b17c20302da2e9a9e19ebe1a257536b3f0be5',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { isValueIR } from '../../value-ir.js';\n" +
          "import { copyInternalEffectMachineState, internalEffectMachineStateForEnv, } from './internal-effect-machine-helper-state.js';\n" +
          "import { internalTextScalarAt, internalTextScalarIndexOf, internalTextScalarLength, internalTextScalarSlice, internalTextStartsWith, } from './internal-text-code-point-cache.js';\n" +
          "import { hasBinding } from './semantic-env.js';\n" +
          'function requireString(value, label) {\n' +
          "    if (typeof value !== 'string')\n" +
          '        throw new Error(`portable: ${label} requires a string`);\n' +
          '    return value;\n' +
          '}\n' +
          'function executionOwner(env) {\n' +
          '    return internalEffectMachineStateForEnv(env);\n' +
          '}\n',
        historical:
          "import { codePointIndexOf, isWellFormedText, textCodePoints, textMalformedSurrogateFailMessage, } from '../../codegen/text-contract.js';\n" +
          "import { isValueIR } from '../../value-ir.js';\n" +
          "import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';\n" +
          "import { hasBinding } from './semantic-env.js';\n" +
          'function requireWellFormedString(value, label) {\n' +
          "    if (typeof value !== 'string')\n" +
          '        throw new Error(`portable: ${label} requires a string`);\n' +
          '    if (!isWellFormedText(value)) {\n' +
          '        throw new Error(textMalformedSurrogateFailMessage(label));\n' +
          '    }\n' +
          '    return value;\n' +
          '}\n',
      }),
      Object.freeze({
        current: '    const receiverValue = evaluate(receiverArg, env);\n',
        historical:
          '    const receiver = requireWellFormedString(evaluate(receiverArg, env), label);\n',
      }),
      Object.freeze({
        current:
          "        case 'length': {\n" +
          '            const receiver = requireString(receiverValue, label);\n' +
          '            return internalTextScalarLength(executionOwner(env), receiver, label);\n' +
          '        }\n',
        historical:
          "        case 'length':\n" +
          '            return textCodePoints(receiver).length;\n',
      }),
      Object.freeze({
        current:
          "        case 'charAt': {\n" +
          '            const indexValue = evaluateIndexArg(node.args[1], env, evaluate);\n' +
          '            const receiver = requireString(receiverValue, label);\n' +
          '            const length = internalTextScalarLength(executionOwner(env), receiver, label);\n' +
          '            const index = requireSafeIntegerValue(indexValue, label);\n' +
          '            if (index < 0 || index >= length) {\n' +
          '                throw new Error(`portable: ${label} index ${index} is out of bounds for a string of length ${length}`);\n' +
          '            }\n' +
          '            return internalTextScalarAt(executionOwner(env), receiver, index, label);\n',
        historical:
          "        case 'charAt': {\n" +
          '            const index = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const cps = textCodePoints(receiver);\n' +
          '            if (index < 0 || index >= cps.length) {\n' +
          '                throw new Error(`portable: ${label} index ${index} is out of bounds for a string of length ${cps.length}`);\n' +
          '            }\n' +
          '            return cps[index];\n',
      }),
      Object.freeze({
        current:
          "        case 'slice': {\n" +
          '            const startValue = evaluateIndexArg(node.args[1], env, evaluate);\n' +
          '            const endValue = evaluateIndexArg(node.args[2], env, evaluate);\n' +
          '            const receiver = requireString(receiverValue, label);\n' +
          '            const length = internalTextScalarLength(executionOwner(env), receiver, label);\n' +
          '            const start = requireSafeIntegerValue(startValue, label);\n' +
          '            const end = requireSafeIntegerValue(endValue, label);\n' +
          '            if (start < 0 || end < 0 || start > length || end > length || start > end) {\n' +
          '                throw new Error(`portable: ${label}(${start}, ${end}) is out of bounds for a string of length ${length} (0 <= start <= end <= length required)`);\n' +
          '            }\n' +
          '            return internalTextScalarSlice(executionOwner(env), receiver, start, end, label);\n',
        historical:
          "        case 'slice': {\n" +
          '            const start = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const end = requireSafeIntegerArg(node.args[2], env, evaluate, label);\n' +
          '            const cps = textCodePoints(receiver);\n' +
          '            if (start < 0 || end < 0 || start > cps.length || end > cps.length || start > end) {\n' +
          '                throw new Error(`portable: ${label}(${start}, ${end}) is out of bounds for a string of length ${cps.length} (0 <= start <= end <= length required)`);\n' +
          '            }\n' +
          "            return cps.slice(start, end).join('');\n",
      }),
      Object.freeze({
        current:
          "        case 'indexOf': {\n" +
          '            const needleValue = evaluate(node.args[1], env);\n' +
          '            const receiver = requireString(receiverValue, label);\n' +
          '            return internalTextScalarIndexOf(executionOwner(env), receiver, needleValue, label);\n' +
          '        }\n',
        historical:
          "        case 'indexOf': {\n" +
          '            const needle = requireWellFormedString(evaluate(node.args[1], env), label);\n' +
          '            return codePointIndexOf(textCodePoints(receiver), textCodePoints(needle));\n' +
          '        }\n',
      }),
      Object.freeze({
        current:
          "        case 'startsWith': {\n" +
          '            const prefixValue = evaluate(node.args[1], env);\n' +
          '            const receiver = requireString(receiverValue, label);\n' +
          '            return internalTextStartsWith(receiver, prefixValue, label);\n' +
          '        }\n',
        historical:
          "        case 'startsWith': {\n" +
          '            const prefix = requireWellFormedString(evaluate(node.args[1], env), label);\n' +
          '            return receiver.startsWith(prefix);\n' +
          '        }\n',
      }),
      Object.freeze({
        current:
          'function evaluateIndexArg(node, env, evaluate) {\n' +
          '    // Float/int fence escape hatch (see `SemanticEnv`): bounds-checked, never printed.\n' +
          '    const indexEnv = { ...env, intIndexCtx: true };\n' +
          '    copyInternalEffectMachineState(env, indexEnv);\n' +
          '    return evaluate(node, indexEnv);\n' +
          '}\n' +
          'function requireSafeIntegerValue(value, label) {\n' +
          "    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {\n" +
          '        throw new Error(`portable: ${label} index arguments must be safe integers`);\n' +
          '    }\n' +
          '    return value;\n' +
          '}\n',
        historical:
          'function requireSafeIntegerArg(node, env, evaluate, label) {\n' +
          '    // Float/int fence escape hatch (see `SemanticEnv`): bounds-checked, never printed.\n' +
          '    const indexEnv = { ...env, intIndexCtx: true };\n' +
          '    copyInternalEffectMachineState(env, indexEnv);\n' +
          '    const value = evaluate(node, indexEnv);\n' +
          "    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {\n" +
          '        throw new Error(`portable: ${label} index arguments must be safe integers`);\n' +
          '    }\n' +
          '    return value;\n' +
          '}\n',
      }),
    ]),
  }),
  Object.freeze({
    path: 'runtime-envelope/execute.js',
    currentDigest: '5a385612dae2dd814ce925ff50e3452c254cc90a5e99b1ede327de44652c3d8b',
    expectedDigest: '49da512b024e714edbb56f6dfd30c6daa2e498da4cc720707d7fbeedd9eb0eb5',
    replacements: Object.freeze([
      Object.freeze({
        current:
          '        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxStringBytes);\n',
        historical:
          '        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer);\n',
      }),
      Object.freeze({
        current: '            textCodePointCacheMaxStringBytes: accepted.limits.maxStringBytes,\n',
        historical: '',
      }),
    ]),
  }),
  Object.freeze({
    path: 'runtime-envelope/internal-engine.js',
    currentDigest: '367b8bf7f223edaf96e2da25684347c9d654273943016f12f6d17cc851e9408d',
    expectedDigest: 'de6f456489eef0424743743d109ccc391f183f2bfb7af299ccbd1ef830010ee0',
    replacements: Object.freeze([
      Object.freeze({
        current:
          'export function runInternalRuntimeEngineSync(nodes, env, iterationBudget, observer, textCodePointCacheMaxStringBytes) {\n' +
          '    // execute.ts owns direct admission before scheduler installation.\n' +
          '    return runInternalEffectMachineSync(nodes, env, {\n' +
          '        iterationBudget,\n' +
          '        observer,\n' +
          '        textCodePointCacheMaxStringBytes,\n' +
          '    });\n' +
          '}\n',
        historical:
          'export function runInternalRuntimeEngineSync(nodes, env, iterationBudget, observer) {\n' +
          '    // execute.ts owns direct admission before scheduler installation.\n' +
          '    return runInternalEffectMachineSync(nodes, env, { iterationBudget, observer });\n' +
          '}\n',
      }),
    ]),
  }),
]);
