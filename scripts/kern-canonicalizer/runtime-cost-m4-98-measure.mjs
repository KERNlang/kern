import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEASUREMENT_SCRIPT = `
import { measureCanonicalizerRuntimeBottleneckM496 as measure }
  from './scripts/kern-canonicalizer/runtime-bottleneck-m4-96-measure.mjs';
const result = measure(Number(process.argv[1]), {
  verifyPublicParity: process.argv[2] === 'true',
});
process.stdout.write(JSON.stringify(result));
`;

export function measureCanonicalizerRuntimeCostM498(
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      MEASUREMENT_SCRIPT,
      String(iterationBudget),
      String(verifyPublicParity),
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(output);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const budget = Number(process.argv[2]);
  if (Number.isSafeInteger(budget) && budget > 0) {
    process.stdout.write(`${JSON.stringify(measureCanonicalizerRuntimeCostM498(budget), null, 2)}\n`);
  }
}
