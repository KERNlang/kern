export const ASSIGNMENT_TARGET_PROJECTION_M4129_STATEMENT_REPLACEMENT = {
  current:
    '      let name=targetFields value="typefields(targetId, valueParent, valueRole)"\n' +
    '      let name=targetKindId value="targetFields[1]"\n',
  historical:
    '      let name=targetKindId value="recordfield(targetId, \\"kind\\", valueParent, valueRole)"\n',
};

export const PRE_M4129_M4106_MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import assert from 'node:assert/strict';\n" +
      "import { resolve } from 'node:path';\n",
    historical:
      "import assert from 'node:assert/strict';\n" +
      "import { readFileSync } from 'node:fs';\n" +
      "import { resolve } from 'node:path';\n",
  },
  {
    current:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n} from './composition.mjs';\n" +
      "import {\n  loadPreM4129CanonicalizerComposition,\n} from './historical-composition.mjs';\n",
    historical:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n  verifyCanonicalizerComposition,\n} from './composition.mjs';\n",
  },
  {
    current:
      "const WITNESS_ID =\n" +
      "  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';\n" +
      'const PROFILE_ROWS',
    historical:
      "const WITNESS_ID =\n" +
      "  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';\n" +
      "const WITNESS_SOURCE_URL =\n" +
      "  new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url);\n" +
      'const PROFILE_ROWS',
  },
  {
    current:
      '  const source = loadPreM4129CanonicalizerComposition().statementHelpers;\n',
    historical: '  const source = readFileSync(WITNESS_SOURCE_URL);\n',
  },
  {
    current:
      '  const composition = loadPreM4129CanonicalizerComposition();\n',
    historical:
      '  const composition = verifyCanonicalizerComposition();\n',
  },
];

export const PRE_M4129_M4116_MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n} from './composition.mjs';\n" +
      "import {\n  loadPreM4129CanonicalizerComposition,\n} from './historical-composition.mjs';\n",
    historical:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n  verifyCanonicalizerComposition,\n} from './composition.mjs';\n",
  },
  {
    current:
      '  const composition = loadPreM4129CanonicalizerComposition();\n',
    historical:
      '  const composition = verifyCanonicalizerComposition();\n',
  },
];

export const PRE_M4129_COMPOSITE_MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n} from './composition.mjs';\n",
    historical:
      "import {\n  CANONICALIZER_COMPOSITE_PATH,\n  verifyCanonicalizerComposition,\n} from './composition.mjs';\n",
  },
  {
    current:
      "import {\n  loadPreM4129CanonicalizerComposition,\n} from './historical-composition.mjs';\n",
    historical: '',
  },
  {
    current:
      '  const composition = loadPreM4129CanonicalizerComposition();\n',
    historical:
      '  const composition = verifyCanonicalizerComposition();\n',
  },
];
