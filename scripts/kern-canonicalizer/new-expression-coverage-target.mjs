export const PRE_M4135_COVERAGE_POLICY_DIGEST =
  '254f089ec5d7c0162144aaf78114d33ed603c5cca04ae484f53111c7a83e5d9c';
export const PRE_M4135_CANONICALIZER_MAIN_DIGEST =
  '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195';

export const PRE_M4135_COVERAGE_POLICY_REPLACEMENTS = [
  {
    current: '    "expressionKinds": ["binary", "boolean", "call", "identifier", "index", "integer", "list", "member", "new", "null", "text", "unary"],\n' +
      '    "id": "kern.kir-canonicalizer.profile.m4.141",\n' +
      '    "nodeKinds": ["assign", "do", "else", "fn", "for", "handler", "if", "let", "param", "return", "throw", "while"],\n',
    historical: '    "expressionKinds": ["binary", "boolean", "call", "identifier", "index", "integer", "list", "member", "null", "text", "unary"],\n' +
      '    "id": "kern.kir-canonicalizer.profile.m4.60",\n' +
      '    "nodeKinds": ["assign", "do", "else", "fn", "for", "handler", "if", "let", "param", "return", "while"],\n',
  },
  {
    current: '      {\n' +
      '        "family": "while-iteration",\n' +
      '        "provenanceDigest": "5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07",\n' +
      '        "provenanceKind": "prerequisite"\n' +
      '      },\n' +
      '      {\n' +
      '        "family": "new-expression",\n' +
      '        "provenanceDigest": "ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e",\n' +
      '        "provenanceKind": "prerequisite"\n' +
      '      },\n' +
      '      {\n' +
      '        "family": "exception-flow",\n' +
      '        "provenanceDigest": "2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4",\n' +
      '        "provenanceKind": "prerequisite"\n' +
      '      }\n',
    historical: '      {\n' +
      '        "family": "while-iteration",\n' +
      '        "provenanceDigest": "5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07",\n' +
      '        "provenanceKind": "prerequisite"\n' +
      '      }\n',
  },
  {
    current: '      "return.trailingComment", "return.value",\n' +
      '      "throw.value",\n' +
      '      "while.cond"\n',
    historical: '      "return.trailingComment", "return.value",\n' +
      '      "while.cond"\n',
  },
  {
    current: '      "digest": "959481ea210be8b1740400fe53ed999f08c61232de7855457f54a21f43213b0c",\n' +
      '      "path": "examples/kern-canonicalizer/canonicalizer.kern",\n',
    historical: `      "digest": "${PRE_M4135_CANONICALIZER_MAIN_DIGEST}",\n` +
      '      "path": "examples/kern-canonicalizer/canonicalizer.kern",\n',
  },
  {
    current: '  "families": []\n',
    historical: '  "families": [\n' +
      '    { "expressionKinds": [], "id": "exception-flow", "nodeKinds": ["throw"], "propertyKeys": ["throw.value"] }\n' +
      '  ]\n',
  },
];
