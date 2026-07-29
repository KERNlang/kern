export const PRE_M4130_M4127_MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';\n",
    historical:
      "import { loadCanonicalizerPolicy } from './policy.mjs';\n",
  },
  {
    current:
      '  const policy = loadPreM4130CanonicalizerPolicy();\n' +
      '  assert.deepEqual({\n',
    historical:
      '  const policy = loadCanonicalizerPolicy();\n' +
      '  assert.deepEqual({\n',
  },
  {
    current:
      'export function measureCanonicalizerCombinedHeadroomM4127() {\n' +
      '  const policy = loadPreM4130CanonicalizerPolicy();\n',
    historical:
      'export function measureCanonicalizerCombinedHeadroomM4127() {\n' +
      '  const policy = loadCanonicalizerPolicy();\n',
  },
];

export const PRE_M4130_SINGLE_POLICY_MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';\n",
    historical:
      "import { loadCanonicalizerPolicy } from './policy.mjs';\n",
  },
  {
    current: '  const policy = loadPreM4130CanonicalizerPolicy();',
    historical: '  const policy = loadCanonicalizerPolicy();',
  },
];
