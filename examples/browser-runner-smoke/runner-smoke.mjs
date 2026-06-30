import {
  analyzeKernSourceCapabilities,
  createMemoryStorageCapability,
  createWebCryptoCapability,
  executeKernSource,
} from '../../packages/core/dist/runner-browser.js';

export const BROWSER_RUNNER_SMOKE_SOURCE = [
  'fn name=main returns=void',
  '  handler lang="kern"',
  '    capability namespace=storage operation=set name=setOk input="{ key: \\"theme\\", value: \\"browser\\" }"',
  '    capability namespace=storage operation=get name=theme input="{ key: \\"theme\\" }"',
  '    capability namespace=crypto operation=randomHex name=hex input="{ length: 3 }"',
  '    capability namespace=crypto operation=randomUUID name=id',
  '    capability namespace=crypto operation=randomBytes name=bytes input="{ length: 2 }"',
  '    print value="theme"',
  '    print value="hex"',
  '    print value="id"',
  '    print value="bytes.length"',
  '    print value="bytes[0]"',
].join('\n');

export function createDeterministicCryptoSource() {
  return {
    randomUUID() {
      return '00000000-0000-4000-8000-000000000000';
    },
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = (index + 1) & 0xff;
      }
      return array;
    },
  };
}

export function runBrowserRunnerSmoke(options = {}) {
  try {
    const now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    const startedAt =
      typeof options.startedAt === 'number'
        ? options.startedAt
        : typeof globalThis.__KERN_RUNNER_SCRIPT_START === 'number'
          ? globalThis.__KERN_RUNNER_SCRIPT_START
          : now();

    const analysis = analyzeKernSourceCapabilities(BROWSER_RUNNER_SMOKE_SOURCE, {
      providedCapabilities: [
        'storage.set',
        'storage.get',
        'crypto.randomHex',
        'crypto.randomUUID',
        'crypto.randomBytes',
      ],
    });
    const stdout = executeKernSource(BROWSER_RUNNER_SMOKE_SOURCE, {
      capabilities: {
        crypto: createWebCryptoCapability({ crypto: createDeterministicCryptoSource() }),
        storage: createMemoryStorageCapability(),
      },
      capabilityContext: { sourceName: 'examples/browser-runner-smoke' },
    });
    const finishedAt = now();
    const expectedStdout = 'browser\n010203\n00000000-0000-4000-8000-000000000000\n2\n1\n';
    const requirementIds = analysis.requirements.map((requirement) => requirement.id).sort();
    const ok =
      stdout === expectedStdout &&
      !analysis.hasParseErrors &&
      requirementIds.join(',') === 'crypto.randomBytes,crypto.randomHex,crypto.randomUUID,storage.get,storage.set' &&
      analysis.missingProviders.length === 0 &&
      analysis.plannedCapabilities.length === 0 &&
      analysis.unknownCapabilities.length === 0 &&
      analysis.malformedCapabilities.length === 0;

    return {
      ok,
      stdout,
      expectedStdout,
      requirementIds,
      parseDiagnostics: analysis.parseDiagnostics,
      browserElapsedMs: Math.max(0, Math.ceil(finishedAt - startedAt)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderBrowserRunnerSmoke(target = globalThis.document?.getElementById('kern-runner-smoke')) {
  if (!target) return;
  try {
    const result = runBrowserRunnerSmoke();
    target.dataset.status = result.ok ? 'pass' : 'fail';
    target.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    target.dataset.status = 'fail';
    target.textContent = JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  }
}
