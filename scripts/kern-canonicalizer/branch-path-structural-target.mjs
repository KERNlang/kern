export const POST_BRANCH_COMPILED_CONSTITUTION_RECONSTRUCTIONS = [
  {
    path: 'kir-structural/catalog.generated.js',
    expectedDigest: '13d073f5d004db437372c78c5a74a1530fed1cc2167d34abb96242d8142b6b1e',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5g.1';",
        historical: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5f.1';",
      },
      {
        current:
          '                "on": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "lowered-expression",\n' +
          '                    "reasonId": "portable-expression-required"',
        historical:
          '                "on": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "excluded-host-expression",\n' +
          '                    "reasonId": "opaque-host-expression-forbidden"',
      },
      {
        current:
          '                "value": {\n' +
          '                    "schemaKind": "string",\n' +
          '                    "required": false,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "lowered-branch-path-value",\n' +
          '                    "reasonId": "portable-branch-path-value"',
        historical:
          '                "value": {\n' +
          '                    "schemaKind": "string",\n' +
          '                    "required": false,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "included-value",\n' +
          '                    "reasonId": "portable-text"',
      },
    ],
  },
  {
    path: 'kir-structural/types.js',
    expectedDigest: '5e5702daa33be5681ed54c9850ecb458546293c2c326937d11538145307e47e6',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5g.1-alpha';",
        historical: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5f.1-alpha';",
      },
    ],
  },
  {
    path: 'kir-structural/node.js',
    expectedDigest: 'd56b57c477f79c31eaf425070b5c2e9babd256a094857db99c2b0d906267cbba',
    replacements: [
      {
        current: "import { projectBranchPathValue, validateBranchPathValue } from './branch-path-value.js';\n",
        historical: '',
      },
      {
        current: 'function projectProperty(value, contract, path, kind, name, parentKind, quoted) {',
        historical: 'function projectProperty(value, contract, path, kind, name, parentKind) {',
      },
      {
        current:
          "    if (contract.disposition === 'lowered-branch-path-value')\n" +
          '        return projectBranchPathValue(value, quoted, path);\n',
        historical: '',
      },
      {
        current:
          '    const quotedProperties = new Set();\n' +
          '    if (node.__quotedProps !== undefined) {\n' +
          '        for (const [index, value] of array(node.__quotedProps, `${path}.__quotedProps`).entries()) {\n' +
          '            const name = text(value, `${path}.__quotedProps[${index}]`);\n' +
          '            if (quotedProperties.has(name) || !Object.hasOwn(rawProperties, name)) {\n' +
          "                fail('invalid-artifact', `${path}.__quotedProps[${index}]`, 'quoted property metadata is stale or duplicated');\n" +
          '            }\n' +
          "            if (kind === 'path' && contract.properties[name]?.disposition !== 'lowered-branch-path-value') {\n" +
          "                fail('invalid-artifact', `${path}.__quotedProps[${index}]`, 'path quote metadata is reserved for value');\n" +
          '            }\n' +
          '            quotedProperties.add(name);\n' +
          '        }\n' +
          '    }\n',
        historical: '',
      },
      {
        current:
          '            value: projectProperty(rawProperties[name], propertyContract, `${path}.props.${name}`, kind, name, parentKind, quotedProperties.has(name)),',
        historical:
          '            value: projectProperty(rawProperties[name], propertyContract, `${path}.props.${name}`, kind, name, parentKind),',
      },
      {
        current:
          "    if (contract.disposition === 'lowered-branch-path-value') {\n" +
          '        validateBranchPathValue(value, path);\n' +
          '        return;\n' +
          '    }\n',
        historical: '',
      },
    ],
  },
];

export const PRE_BRANCH_CONSTITUTION_SOURCE_DIGEST =
  'fad83fc3f7a4b2b7b5f6b89bff2a47721cc06f1bba8a13a9b55be0bba8997ed7';

export const PRE_BRANCH_CONSTITUTION_SOURCE_REPLACEMENTS = [
  {
    current: '  "format": "kern.kir.structural.r1.5g.1",',
    historical: '  "format": "kern.kir.structural.r1.5f.1",',
  },
  {
    current:
      '      "nodeKind": "branch",\n' +
      '      "propertyName": "on",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "lowered-expression",\n' +
      '      "reasonId": "portable-expression-required"',
    historical:
      '      "nodeKind": "branch",\n' +
      '      "propertyName": "on",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "excluded-host-expression",\n' +
      '      "reasonId": "opaque-host-expression-forbidden"',
  },
  {
    current:
      '      "nodeKind": "path",\n' +
      '      "propertyName": "value",\n' +
      '      "schemaKind": "string",\n' +
      '      "required": false,\n' +
      '      "values": null,\n' +
      '      "disposition": "lowered-branch-path-value",\n' +
      '      "reasonId": "portable-branch-path-value"',
    historical:
      '      "nodeKind": "path",\n' +
      '      "propertyName": "value",\n' +
      '      "schemaKind": "string",\n' +
      '      "required": false,\n' +
      '      "values": null,\n' +
      '      "disposition": "included-value",\n' +
      '      "reasonId": "portable-text"',
  },
];
