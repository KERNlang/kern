export const POST_EACH_COMPILED_CONSTITUTION_RECONSTRUCTIONS = [
  {
    path: 'kir-structural/catalog.generated.js',
    expectedDigest: '98982b42afa73d8dff8a3bc93f7a35af714792e1872b0b28f26df5a1a9f0d1b2',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5h.1';",
        historical: "export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = 'kern.kir.structural.r1.5g.1';",
      },
      {
        current:
          '                "in": {\n' +
          '                    "schemaKind": "rawExpr",\n' +
          '                    "required": true,\n' +
          '                    "values": null,\n' +
          '                    "disposition": "lowered-each-collection-reference",\n' +
          '                    "reasonId": "portable-each-collection-reference-required"',
        historical:
          '                "in": {\n' +
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
    expectedDigest: 'c7fe5699e66fc899c8564f193d0829ff2687dfe799b22fa9cf4baeff5cbda0bd',
    replacements: [
      {
        current: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5h.1-alpha';",
        historical: "export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5g.1-alpha';",
      },
    ],
  },
  {
    path: 'kir-structural/node.js',
    expectedDigest: '73a38fe825048a735f8e0de36ead1b70ca730cec1a6871f3969a96c0b2200778',
    replacements: [
      {
        current:
          "import { projectEachCollectionReference, validateEachCollectionReference } from './each-collection-reference.js';\n",
        historical: '',
      },
      {
        current:
          "    if (contract.disposition === 'lowered-each-collection-reference')\n" +
          '        return projectEachCollectionReference(value, path);\n',
        historical: '',
      },
      {
        current:
          "    if (contract.disposition === 'lowered-each-collection-reference') {\n" +
          '        validateEachCollectionReference(value, path);\n' +
          '        return;\n' +
          '    }\n',
        historical: '',
      },
    ],
  },
  {
    path: 'ir/semantics/each-runtime.js',
    expectedDigest: '74c4886990fe75ebf7b384e43a05c810634488ba77020bbb640f991ba2ae5f3d',
    replacements: [
      {
        current: "import { classifyEachCollectionReference } from '../../each-collection-reference.js';",
        historical:
          "import { parseExpression } from '../../parser-expression.js';\n" +
          "import { isParenthesized, isValueIR } from '../../value-ir.js';",
      },
      {
        current:
          '    const classification = classifyEachCollectionReference(inRaw);\n' +
          "    if (classification.status === 'missing-binding') {\n" +
          '        throw new Error(`each: binding "${classification.name}" not found in env`);\n' +
          '    }\n' +
          "    if (classification.status === 'reference') {\n" +
          '        const reference = classification.reference;\n' +
          "        if (reference.form === 'binding') {\n" +
          '            throw new Error(`each: binding "${reference.name}" not found in env`);\n' +
          '        }\n' +
          '        const fields = recordArrayFieldsForBinding(env, reference.receiver);\n' +
          '        if (fields === undefined || !fields.has(reference.property)) {\n' +
          '            throw new Error(`each: nested record-array receiver "${reference.receiver}.${reference.property}" is not proven`);\n' +
          '        }\n' +
          '        const expression = {\n' +
          "            kind: 'member',\n" +
          "            object: { kind: 'ident', name: reference.receiver },\n" +
          '            optional: false,\n' +
          '            property: reference.property,\n' +
          '        };\n' +
          '        const collection = evalRecordArrayFieldReferenceValue(expression, env);\n' +
          '        if (collection === undefined) {\n' +
          '            throw new Error(`each: nested record-array receiver "${reference.receiver}.${reference.property}" must be an array`);\n' +
          '        }\n' +
          '        assertNestedIterationScalarElements(collection, `${reference.receiver}.${reference.property}`);\n' +
          '        return collection;\n' +
          '    }',
        historical:
          '    const expr = parseExpression(inRaw);\n' +
          "    if (expr.kind === 'ident') {\n" +
          '        throw new Error(`each: binding "${expr.name}" not found in env`);\n' +
          '    }\n' +
          "    if (expr.kind === 'member' &&\n" +
          '        !expr.optional &&\n' +
          '        isValueIR(expr.object) &&\n' +
          "        expr.object.kind === 'ident' &&\n" +
          '        !isParenthesized(expr.object)) {\n' +
          '        const fields = recordArrayFieldsForBinding(env, expr.object.name);\n' +
          '        if (fields === undefined || !fields.has(expr.property)) {\n' +
          '            throw new Error(`each: nested record-array receiver "${expr.object.name}.${expr.property}" is not proven`);\n' +
          '        }\n' +
          '        const collection = evalRecordArrayFieldReferenceValue(expr, env);\n' +
          '        if (collection === undefined) {\n' +
          '            throw new Error(`each: nested record-array receiver "${expr.object.name}.${expr.property}" must be an array`);\n' +
          '        }\n' +
          '        assertNestedIterationScalarElements(collection, `${expr.object.name}.${expr.property}`);\n' +
          '        return collection;\n' +
          '    }',
      },
    ],
  },
];

export const PRE_EACH_CONSTITUTION_SOURCE_DIGEST =
  '7e1072291f97583b2fc27dcd033732a76db104e99ebf12b09d2c5907057e408c';

export const PRE_EACH_CONSTITUTION_SOURCE_REPLACEMENTS = [
  {
    current: '  "format": "kern.kir.structural.r1.5h.1",',
    historical: '  "format": "kern.kir.structural.r1.5g.1",',
  },
  {
    current:
      '      "nodeKind": "each",\n' +
      '      "propertyName": "in",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "lowered-each-collection-reference",\n' +
      '      "reasonId": "portable-each-collection-reference-required"',
    historical:
      '      "nodeKind": "each",\n' +
      '      "propertyName": "in",\n' +
      '      "schemaKind": "rawExpr",\n' +
      '      "required": true,\n' +
      '      "values": null,\n' +
      '      "disposition": "excluded-host-expression",\n' +
      '      "reasonId": "opaque-host-expression-forbidden"',
  },
];
