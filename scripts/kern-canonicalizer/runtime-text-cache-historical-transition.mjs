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
    currentDigest: '7aadfc8f052c0ed5677a13589524fdf50e1351c577496e3ebd2ec925f59e3844',
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
          '  if (options.textCodePointCacheBudget !== undefined) {\n' +
          '    installInternalTextCodePointCache(state, options.textCodePointCacheBudget);\n' +
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
          '  if (options.textCodePointCacheBudget !== undefined) {\n' +
          '    installInternalTextCodePointCache(state, options.textCodePointCacheBudget);\n' +
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
    currentDigest: 'f48ae62ff8df8e2d27c73ac99114c3aac0b06a87a307ed89461cdd2dc4aff762',
    expectedDigest: '909f576f295d7670d77d6bc80729b461b27f3b9d22b03333689a649925d378b6',
    replacements: Object.freeze([
      Object.freeze({
        current:
          'export interface InternalEffectMachineAsyncOptions {\n' +
          '  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;\n' +
          '  readonly capabilityTimeoutMs?: number;\n' +
          '  readonly iterationBudget?: number;\n' +
          '  readonly observer?: InternalEffectMachineObserver;\n' +
          '  readonly textCodePointCacheBudget?: number;\n' +
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
          '  readonly textCodePointCacheBudget?: number;\n' +
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
    currentDigest: 'a87e24e920afc99560755356ee48afec42efd3fcf2b666139244f8a6d46c31e4',
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
          '    if (options.textCodePointCacheBudget !== undefined) {\n' +
          '        installInternalTextCodePointCache(state, options.textCodePointCacheBudget);\n' +
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
          '    if (options.textCodePointCacheBudget !== undefined) {\n' +
          '        installInternalTextCodePointCache(state, options.textCodePointCacheBudget);\n' +
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
    currentDigest: '6d0a7d36b6d03dfea5e2ab790b3047cb6fb66b189c94e9e36e44a780b2887d2e',
    expectedDigest: 'c8ae80db9f937c8257279f7e916b17c20302da2e9a9e19ebe1a257536b3f0be5',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { codePointIndexOf } from '../../codegen/text-contract.js';\n" +
          "import { isValueIR } from '../../value-ir.js';\n" +
          "import { copyInternalEffectMachineState, internalEffectMachineStateForEnv, } from './internal-effect-machine-helper-state.js';\n" +
          "import { acquireInternalTextCodePoints } from './internal-text-code-point-cache.js';\n" +
          "import { hasBinding } from './semantic-env.js';\n" +
          'function requireString(value, label) {\n' +
          "    if (typeof value !== 'string')\n" +
          '        throw new Error(`portable: ${label} requires a string`);\n' +
          '    return value;\n' +
          '}\n' +
          'function executionTextCodePoints(value, label, env) {\n' +
          '    return acquireInternalTextCodePoints(internalEffectMachineStateForEnv(env), value, label);\n' +
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
        current: '    const receiver = requireString(evaluate(receiverArg, env), label);\n',
        historical:
          '    const receiver = requireWellFormedString(evaluate(receiverArg, env), label);\n',
      }),
      Object.freeze({
        current:
          "        case 'length':\n" +
          '            return executionTextCodePoints(receiver, label, env).length;\n',
        historical:
          "        case 'length':\n" +
          '            return textCodePoints(receiver).length;\n',
      }),
      Object.freeze({
        current:
          "        case 'charAt': {\n" +
          '            const index = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const cps = executionTextCodePoints(receiver, label, env);\n',
        historical:
          "        case 'charAt': {\n" +
          '            const index = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const cps = textCodePoints(receiver);\n',
      }),
      Object.freeze({
        current:
          "        case 'slice': {\n" +
          '            const start = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const end = requireSafeIntegerArg(node.args[2], env, evaluate, label);\n' +
          '            const cps = executionTextCodePoints(receiver, label, env);\n',
        historical:
          "        case 'slice': {\n" +
          '            const start = requireSafeIntegerArg(node.args[1], env, evaluate, label);\n' +
          '            const end = requireSafeIntegerArg(node.args[2], env, evaluate, label);\n' +
          '            const cps = textCodePoints(receiver);\n',
      }),
      Object.freeze({
        current:
          "        case 'indexOf': {\n" +
          '            const needle = requireString(evaluate(node.args[1], env), label);\n' +
          '            return codePointIndexOf(executionTextCodePoints(receiver, label, env), executionTextCodePoints(needle, label, env));\n' +
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
          '            const prefix = requireString(evaluate(node.args[1], env), label);\n' +
          '            executionTextCodePoints(receiver, label, env);\n' +
          '            executionTextCodePoints(prefix, label, env);\n' +
          '            return receiver.startsWith(prefix);\n' +
          '        }\n',
        historical:
          "        case 'startsWith': {\n" +
          '            const prefix = requireWellFormedString(evaluate(node.args[1], env), label);\n' +
          '            return receiver.startsWith(prefix);\n' +
          '        }\n',
      }),
    ]),
  }),
  Object.freeze({
    path: 'runtime-envelope/execute.js',
    currentDigest: '3e97ac161284d5b11f6a3dd719c56d70aaceb55874db6317e6d09a028c1c392f',
    expectedDigest: '49da512b024e714edbb56f6dfd30c6daa2e498da4cc720707d7fbeedd9eb0eb5',
    replacements: Object.freeze([
      Object.freeze({
        current:
          '        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer, accepted.limits.maxBytes);\n',
        historical:
          '        const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer);\n',
      }),
      Object.freeze({
        current: '            textCodePointCacheBudget: accepted.limits.maxBytes,\n',
        historical: '',
      }),
    ]),
  }),
  Object.freeze({
    path: 'runtime-envelope/internal-engine.js',
    currentDigest: '81cfee8462b211c45c69c34aef1c4c0768224e526f4c4e2fa2bc52eabd1b9f5e',
    expectedDigest: 'de6f456489eef0424743743d109ccc391f183f2bfb7af299ccbd1ef830010ee0',
    replacements: Object.freeze([
      Object.freeze({
        current:
          'export function runInternalRuntimeEngineSync(nodes, env, iterationBudget, observer, textCodePointCacheBudget) {\n' +
          '    // execute.ts owns direct admission before scheduler installation.\n' +
          '    return runInternalEffectMachineSync(nodes, env, { iterationBudget, observer, textCodePointCacheBudget });\n' +
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
