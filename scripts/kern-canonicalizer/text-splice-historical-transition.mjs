export const TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  commit: '2c030fef',
  currentInventory: Object.freeze({
    count: 316,
    digest: 'ac340824eaa0a587dfe41d9bd8ffdfaf835e47c8cafab146f8031967e9d41345',
  }),
  predecessorInventory: Object.freeze({
    count: 314,
    digest: '0c00e26bc2201f037b1cae907bee6af7e952ae17e396ed4c0ea9250b5f68d27f',
  }),
  addedPaths: Object.freeze([
    'ir/semantics/internal-effect-machine-deferred-binding.js',
    'ir/semantics/internal-effect-machine-text-splice.js',
  ]),
});

export const POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS = Object.freeze([
  Object.freeze({
    path: 'ir/semantics/internal-effect-machine-do.js',
    currentDigest: 'ffb793cdbdd0ba288ca8098e580a9f42ed738171463bfb2fa64a97c55119b132',
    expectedDigest: '9b46fbdd8ce5d09e68a18cb72195a2dd052ef5025aa796248c172cab07e5db0c',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { parseInternalMachineTextSplice, runInternalMachineTextSplice, } from './internal-effect-machine-text-splice.js';\n",
        historical: '',
      }),
      Object.freeze({
        current:
          '    const textSplice = parseInternalMachineTextSplice(parsed);\n' +
          '    if (textSplice)\n' +
          '        return textSplice;\n' +
          '    throw new Error(\'do: only "<array>.push(<element>)", "Map.set(<map>, <key>, <value>)", and exact Text.splice bindings are supported\');\n',
        historical:
          '    throw new Error(\'do: only "<array>.push(<element>)" and "Map.set(<map>, <key>, <value>)" are supported\');\n',
      }),
      Object.freeze({
        current:
          "    if (parsed.kind === 'text-splice' && hasBinding(env, 'Text')) {\n" +
          "        throw new Error('portable machine: namespace \"Text\" is shadowed');\n" +
          '    }\n',
        historical: '',
      }),
      Object.freeze({
        current:
          "    if (parsed.kind === 'text-splice')\n" +
          '        return runInternalMachineTextSplice(parsed, env);\n',
        historical: '',
      }),
    ]),
  }),
  Object.freeze({
    path: 'ir/semantics/internal-effect-machine-leaf.js',
    currentDigest: '2023bea3b53ea89b79fd5c35d278858fcbb259bddeb37932ddaa8dbaf80fa9a1',
    expectedDigest: '856999a39deb9bc0ef75e14e9a57e30a5fe7fe2fa534aeb3d8c9da3b4650bb7c',
    replacements: Object.freeze([
      Object.freeze({
        current:
          "import { defineDeferredInternalMachineBinding } from './internal-effect-machine-deferred-binding.js';\n",
        historical: '',
      }),
      Object.freeze({
        current:
          "import { assertInternalMachineTextSplicePreflight } from './internal-effect-machine-text-splice.js';\n",
        historical: '',
      }),
      Object.freeze({
        current:
          "        const parsedDo = node.type === 'do' ? parseInternalMachineDo(node, env) : undefined;\n" +
          "        if (parsedDo?.kind === 'text-splice') {\n" +
          '            assertInternalMachineTextSplicePreflight(parsedDo, env, deferredBindings);\n' +
          '        }\n' +
          '        else {\n' +
          '            assertDeferredMachineLeafKnownValues(node, env, deferredBindings);\n' +
          '        }\n',
        historical:
          '        assertDeferredMachineLeafKnownValues(node, env, deferredBindings);\n',
      }),
      Object.freeze({
        current:
          "    if (node.type === 'let' || node.type === 'fmt' || node.type === 'expression-v1') {\n" +
          '        defineDeferredInternalMachineBinding(node, env, name);\n' +
          '    }\n',
        historical:
          "    if (node.type === 'let' || node.type === 'fmt' || node.type === 'expression-v1')\n" +
          '        defineBinding(env, name, null);\n',
      }),
      Object.freeze({
        current:
          "        else if (parsed.kind === 'map-set') {\n" +
          '            addInternalMachineExpressionBindings(out, parsed.key);\n' +
          '            addInternalMachineExpressionBindings(out, parsed.value);\n' +
          '        }\n' +
          '        else {\n' +
          '            out.add(parsed.startName);\n' +
          '            out.add(parsed.endName);\n' +
          '            out.add(parsed.replacementName);\n' +
          '            out.add(parsed.maxOutputCodePointsName);\n' +
          '        }\n',
        historical:
          '        else {\n' +
          '            addInternalMachineExpressionBindings(out, parsed.key);\n' +
          '            addInternalMachineExpressionBindings(out, parsed.value);\n' +
          '        }\n',
      }),
      Object.freeze({
        current:
          "    const parsedRight = parseRequiredExpression(node, 'value');\n" +
          '    const right = evalPortableValue(parsedRight, env);\n',
        historical:
          "    const right = evalPortableValue(parseRequiredExpression(node, 'value'), env);\n",
      }),
    ]),
  }),
]);
