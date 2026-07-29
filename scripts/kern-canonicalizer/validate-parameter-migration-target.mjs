const PRE_M4131_IMPORT_REPLACEMENT = {
  current:
    "import { loadPreM4131CoverageInputs } from './historical-parameter-sources.mjs';\n",
  historical: '',
};

export const PRE_M4131_M4127_MEASUREMENT_REPLACEMENTS = [
  PRE_M4131_IMPORT_REPLACEMENT,
  {
    current:
      '  const currentCoveragePolicy = loadCoveragePolicy();\n' +
      '  const historical = loadPreM4131CoverageInputs(currentCoveragePolicy);\n' +
      '  const sourceRoot = sourceFunctionRoots(\n' +
      '    historical.policy,\n' +
      '    historical.sourceOverrides,\n' +
      '  ).get(WITNESS_ID);',
    historical:
      '  const coveragePolicy = loadCoveragePolicy();\n' +
      '  const sourceRoot = sourceFunctionRoots(coveragePolicy).get(WITNESS_ID);',
  },
];

export const PRE_M4131_RUNTIME_MEASUREMENT_REPLACEMENTS = [
  PRE_M4131_IMPORT_REPLACEMENT,
  {
    current:
      '  const currentCoveragePolicy = loadCoveragePolicy();\n' +
      '  const historical = loadPreM4131CoverageInputs(currentCoveragePolicy);\n' +
      '  const sourceRoot = sourceFunctionRoots(\n' +
      '    historical.policy,\n' +
      '    historical.sourceOverrides,\n' +
      '  ).get(WITNESS_ID);',
    historical:
      '  const sourceRoot = sourceFunctionRoots(loadCoveragePolicy()).get(WITNESS_ID);',
  },
];
