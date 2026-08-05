export const PRE_M4135_COMPILED_EXPRESSION_REPLACEMENTS = [
  {
    current: "    'call',\n    'new',\n    'lambda',\n",
    historical: "    'call',\n    'lambda',\n",
  },
  {
    current:
      'function boundedConstructorArity(name) {\n' +
      "    return name === 'Map' ? 0 : name === 'Error' ? 1 : -1;\n" +
      '}\n' +
      'function projectNew(node, path) {\n' +
      '    const call = node.argument;\n' +
      "    if (call.kind !== 'call' || call.optional || call.typeArgs !== undefined || call.callee.kind !== 'ident') {\n" +
      "        fail('invalid-expression', path, 'constructor must be a non-optional untyped call of a bare identifier');\n" +
      '    }\n' +
      '    const constructorName = call.callee.name;\n' +
      '    const expectedArity = boundedConstructorArity(constructorName);\n' +
      '    if (expectedArity < 0) {\n' +
      "        fail('invalid-expression', `${path}.constructor`, `unsupported constructor ${constructorName}`);\n" +
      '    }\n' +
      "    if (call.args.length !== expectedArity || call.args.some((argument) => argument.kind === 'spread')) {\n" +
      "        fail('invalid-expression', `${path}.args`, `${constructorName} constructor expects exactly ${expectedArity} arguments`);\n" +
      '    }\n' +
      '    const fields = Object.create(null);\n' +
      '    fields.args = {\n' +
      "        tag: 'list',\n" +
      '        value: call.args.map((argument, index) => projectValueIr(argument, `${path}.args[${index}]`)),\n' +
      '    };\n' +
      "    Reflect.set(fields, 'constructor', { tag: 'text', value: constructorName });\n" +
      "    return expression('new', fields);\n" +
      '}\n',
    historical: '',
  },
  {
    current:
      "        case 'new':\n" +
      '            return projectNew(node, path);\n',
    historical: '',
  },
  {
    current:
      "    if (kind === 'new') {\n" +
      "        const values = exactRecord(fields, ['args', 'constructor'], path);\n" +
      "        const args = field(values, 'args');\n" +
      "        if (args.tag !== 'list')\n" +
      "            fail('invalid-expression', `${path}.args`, 'expected expression list');\n" +
      "        const constructorName = text(field(values, 'constructor'), `${path}.constructor`);\n" +
      '        const expectedArity = boundedConstructorArity(constructorName);\n' +
      '        if (expectedArity < 0)\n' +
      "            fail('invalid-expression', `${path}.constructor`, `unsupported constructor ${constructorName}`);\n" +
      '        if (args.value.length !== expectedArity) {\n' +
      "            fail('invalid-expression', `${path}.args`, `${constructorName} constructor expects exactly ${expectedArity} arguments`);\n" +
      '        }\n' +
      '        args.value.forEach((argument, index) => nested(argument, `${path}.args[${index}]`));\n' +
      '        return;\n' +
      '    }\n',
    historical: '',
  },
];

export const POST_M4153_COMPILED_CONSTITUTION_RECONSTRUCTIONS = [
  {
    path: 'kir-structural/catalog.generated.js',
    expectedDigest: '3ce00d888537910886d578b5baf231dfd07eda11e5d6ac1099b360554058aa88',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5f.1';",
        historical: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5e.1';",
      },
      {
        current:
          '        "expression-v1",\n' +
          '        {\n' +
          '            "schemaStatus": "bound",\n' +
          '            "allowedChildren": null,\n' +
          '            "disposition": "structural-candidate",\n' +
          '            "reasonId": "schema-bound",\n' +
          '            "properties": {\n' +
          '                "expr": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "lowered-expression",\n' +
          '                    "reasonId": "portable-expression-required"',
        historical:
          '        "expression-v1",\n' +
          '        {\n' +
          '            "schemaStatus": "bound",\n' +
          '            "allowedChildren": null,\n' +
          '            "disposition": "structural-candidate",\n' +
          '            "reasonId": "schema-bound",\n' +
          '            "properties": {\n' +
          '                "expr": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "excluded-host-expression",\n' +
          '                    "reasonId": "opaque-host-expression-forbidden"',
      },
    ],
  },
  {
    path: 'kir-structural/types.js',
    expectedDigest: 'c6485ba27532604c82f2fc7a362654b171bc8bb5f9752600a51dc88e568e77a7',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5f.1-alpha';",
        historical: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5e.1-alpha';",
      },
    ],
  },
];

export const PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_DIGEST =
  'fa3a0cddc280ff2d8dd9f09cf575953b5adbaaf6f8c716c05e06faf2d43cd6ea';

export const PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_REPLACEMENTS = [
  {
    current: '  "format": "kern.kir.structural.r1.5f.1",',
    historical: '  "format": "kern.kir.structural.r1.5e.1",',
  },
  {
    current:
      '      "nodeKind": "expression-v1",\n' +
      '      "propertyName": "expr",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "lowered-expression",\n' +
      '      "reasonId": "portable-expression-required"',
    historical:
      '      "nodeKind": "expression-v1",\n' +
      '      "propertyName": "expr",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "excluded-host-expression",\n' +
      '      "reasonId": "opaque-host-expression-forbidden"',
  },
];
