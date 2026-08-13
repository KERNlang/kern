import { loadKernCheckerAssets } from '../../packages/cli/dist/kern-checker-assets.js';
import { runKernCheckerFacts as runCompiledKernCheckerFacts } from '../../packages/cli/dist/kern-checker-runtime.js';

export function runKernCheckerFacts(input, options = {}) {
  if (!options.composition && !options.policy) return runCompiledKernCheckerFacts(input);
  const assets = loadKernCheckerAssets();
  const composition = options.composition;
  return runCompiledKernCheckerFacts(input, {
    assets: {
      ...assets,
      checker: composition
        ? { bytes: composition.record.composite.bytes, sha256: composition.record.composite.sha256 }
        : assets.checker,
      policy: options.policy ?? assets.policy,
      source: composition?.source ?? assets.source,
    },
  });
}
