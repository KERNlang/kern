export const PRE_M4135_COVERAGE_POLICY_DIGEST =
  '254f089ec5d7c0162144aaf78114d33ed603c5cca04ae484f53111c7a83e5d9c';
export const PRE_M4135_CANONICALIZER_MAIN_DIGEST =
  '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195';

export const PRE_M4135_COVERAGE_POLICY_REPLACEMENTS = [
  {
    current: '      "digest": "959481ea210be8b1740400fe53ed999f08c61232de7855457f54a21f43213b0c",\n' +
      '      "path": "examples/kern-canonicalizer/canonicalizer.kern",\n',
    historical: `      "digest": "${PRE_M4135_CANONICALIZER_MAIN_DIGEST}",\n` +
      '      "path": "examples/kern-canonicalizer/canonicalizer.kern",\n',
  },
  {
    current: '    { "expressionKinds": [], "id": "exception-flow", "nodeKinds": ["throw"], "propertyKeys": ["throw.value"] },\n' +
      '    { "expressionKinds": ["new"], "id": "new-expression", "nodeKinds": [], "propertyKeys": [] }\n',
    historical: '    { "expressionKinds": [], "id": "exception-flow", "nodeKinds": ["throw"], "propertyKeys": ["throw.value"] }\n',
  },
];
