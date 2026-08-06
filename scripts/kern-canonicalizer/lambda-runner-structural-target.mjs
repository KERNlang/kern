export const POST_LAMBDA_COMPILED_CONSTITUTION_RECONSTRUCTIONS = [
  {
    path: 'kir-structural/catalog.generated.js',
    expectedDigest: '7a61d14cfeb256238a7f59cc33c1de22d75aae13e7578fff208d0dd570581f40',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5i.1';",
        historical: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5h.1';",
      },
      {
        current:
          '    ],\n' +
          '    [\n' +
          '        "lambda",\n' +
          '        {\n' +
          '            "schemaStatus": "bound",\n' +
          '            "allowedChildren": [],\n' +
          '            "runnerSyntheticAllowedParents": [\n' +
          '                "handler"\n' +
          '            ],\n' +
          '            "disposition": "structural-candidate",\n' +
          '            "reasonId": "runner-contract-only",\n' +
          '            "properties": {\n' +
          '                "expr": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "lowered-expression",\n' +
          '                    "reasonId": "portable-expression-required"\n' +
          '                }\n' +
          '            }\n' +
          '        }\n' +
          '    ]\n' +
          ']);',
        historical: '    ]\n]);',
      },
    ],
  },
  {
    path: 'kir-structural/node.js',
    expectedDigest: '52c8ceaa808d9421e2cc60a47d116cc1436d188b292ca9362adea2a522c0e524',
    replacements: [
      {
        current:
          'function assertNodeParent(contract, kind, parentKind, path) {\n' +
          '    const allowed = contract.runnerSyntheticAllowedParents;\n' +
          '    if (allowed !== undefined && (parentKind === undefined || !allowed.includes(parentKind))) {\n' +
          "        fail('invalid-child', path, `${kind} is not allowed below ${parentKind ?? 'the structural root'}`);\n" +
          '    }\n' +
          '}\n' +
          'function childAllowed(contract, parentKind, childKind) {\n' +
          '    const childContract = STRUCTURAL_KIR_NODE_CATALOG.get(childKind);\n' +
          '    if (childContract?.runnerSyntheticAllowedParents?.includes(parentKind))\n' +
          '        return true;\n' +
          '    return contract.allowedChildren === null || contract.allowedChildren.includes(childKind);\n' +
          '}\n',
        historical: '',
      },
      {
        current: '    assertNodeParent(contract, kind, parentKind, `${path}.type`);\n',
        historical: '',
      },
      {
        current:
          '    children.forEach((child, index) => {\n' +
          '        if (!childAllowed(contract, kind, child.kind)) {\n' +
          "            fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);\n" +
          '        }\n' +
          '    });',
        historical:
          '    if (contract.allowedChildren !== null) {\n' +
          '        children.forEach((child, index) => {\n' +
          '            if (!contract.allowedChildren?.includes(child.kind)) {\n' +
          "                fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);\n" +
          '            }\n' +
          '        });\n' +
          '    }',
      },
      {
        current: '    assertNodeParent(contract, kind, parentKind, `${path}.kind`);\n',
        historical: '',
      },
      {
        current:
          '    children.forEach((child, index) => {\n' +
          '        if (!childAllowed(contract, kind, child.kind))\n' +
          "            fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);\n" +
          '    });',
        historical:
          '    if (contract.allowedChildren !== null)\n' +
          '        children.forEach((child, index) => {\n' +
          '            if (!contract.allowedChildren?.includes(child.kind))\n' +
          "                fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);\n" +
          '        });',
      },
    ],
  },
  {
    path: 'kir-structural/types.js',
    expectedDigest: 'a38d1477834eb90f48e4892aca80308352d317a37e7084ca35f21c40285c595b',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5i.1-alpha';",
        historical: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5h.1-alpha';",
      },
    ],
  },
];

export const PRE_LAMBDA_CONSTITUTION_SOURCE_DIGEST =
  'f9bef5fa63a370d084ff324cf1257b05d30170a5bf86cfa03393ec341b5d47ae';

export const PRE_LAMBDA_CONSTITUTION_SOURCE_REPLACEMENTS = [
  {
    current: '  "format": "kern.kir.structural.r1.5i.1",',
    historical: '  "format": "kern.kir.structural.r1.5h.1",',
  },
  {
    current:
      '    "nonCatalogSchemas": 7,\n' +
      '    "runnerSyntheticNodes": 1,\n' +
      '    "runnerSyntheticProperties": 1',
    historical: '    "nonCatalogSchemas": 7',
  },
  {
    current:
      '  ],\n' +
      '  "runnerSyntheticNodes": [\n' +
      '    {\n' +
      '      "id": "lambda",\n' +
      '      "schemaStatus": "bound",\n' +
      '      "allowedChildren": [],\n' +
      '      "allowedParents": [\n' +
      '        "handler"\n' +
      '      ],\n' +
      '      "disposition": "structural-candidate",\n' +
      '      "reasonId": "runner-contract-only"\n' +
      '    }\n' +
      '  ],\n' +
      '  "runnerSyntheticProperties": [\n' +
      '    {\n' +
      '      "nodeKind": "lambda",\n' +
      '      "propertyName": "expr",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "lowered-expression",\n' +
      '      "reasonId": "portable-expression-required"\n' +
      '    }\n' +
      '  ]\n' +
      '}',
    historical: '  ]\n}',
  },
];
