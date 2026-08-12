import { parentPort, workerData } from 'node:worker_threads';

import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import { evaluateSuccessfulLineComposition } from '../check-kern-frontend-successful-line-composition.mjs';
import { loadFrontendSuccessfulLinePolicy } from './policy.mjs';
import { loadSuccessfulLineSource } from './source.mjs';

function runtimeFor(config) {
  const runtime = new KernRuntime();
  for (const name of config.evolved) runtime.dynamicNodeTypes.add(name);
  for (const name of config.multiline) runtime.multilineBlockTypes.add(name);
  for (const name of config.templates) {
    runtime.templateRegistry.set(name, { body: '', imports: [], name, slots: [] });
  }
  if (config.hints !== null) runtime.registerParserHints(config.hints.type, config.hints.hints);
  return runtime;
}

const policy = loadFrontendSuccessfulLinePolicy();
const source = loadSuccessfulLineSource();
let admittedRefs = 0;
const failures = [];
const predecessorExcluded = [];

for (const entry of workerData) {
  try {
    const result = evaluateSuccessfulLineComposition(entry.raw, runtimeFor(entry.config), policy, source);
    if (entry.expectedCode === null && result.status === 'decision') {
      admittedRefs += entry.refs.length;
    } else if (entry.expectedCode !== null && result.status === 'failure' && result.code === entry.expectedCode) {
      predecessorExcluded.push(...entry.refs.map((ref) => ({ code: result.code, ref })));
    } else {
      failures.push({
        message: `expected ${entry.expectedCode ?? 'decision'}, received ${result.status === 'failure' ? result.code : 'decision'}`,
        refs: entry.refs,
      });
    }
  } catch (error) {
    failures.push({
      message: error instanceof Error ? error.message : String(error),
      refs: entry.refs,
    });
  }
}

parentPort.postMessage({ admittedRefs, failures, predecessorExcluded });
