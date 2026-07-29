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
