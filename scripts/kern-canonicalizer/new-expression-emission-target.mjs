export const NEW_EXPRESSION_EMISSION_M4135_REPLACEMENT = {
  current: [
    '              if cond="kind == \\"new\\" && fieldCount == 2"',
    '                let name=argsKey value="fieldsKeyPrefix + String(Text.length(\\"record:args\\")) + \\":record:args\\""',
    '                let name=constructorKey value="fieldsKeyPrefix + String(Text.length(\\"record:constructor\\")) + \\":record:constructor\\""',
    '                if cond="Map.has(childrenByRole, argsKey) && Map.has(childrenByRole, constructorKey)"',
    '                  let name=argsId value="Map.get(childrenByRole, argsKey)"',
    '                  let name=constructorId value="Map.get(childrenByRole, constructorKey)"',
    '                  if cond="stringat(argsId, valueTag) == \\"list\\" && stringat(constructorId, valueTag) == \\"text\\" && stringat(constructorId, valueText) == \\"Map\\" && !Map.has(childCounts, String(argsId))"',
    '                    assign target=source value="\\"new Map()\\""',
    '                  if cond="stringat(argsId, valueTag) == \\"list\\" && stringat(constructorId, valueTag) == \\"text\\" && stringat(constructorId, valueText) == \\"Error\\" && Map.has(childCounts, String(argsId)) && Map.get(childCounts, String(argsId)) == 1 && Map.has(childrenByOrder, String(argsId) + \\":0\\")"',
    '                    if cond="Map.has(sources, String(Map.get(childrenByOrder, String(argsId) + \\":0\\")))"',
    '                      assign target=source value="\\"new Error(\\" + Map.get(sources, String(Map.get(childrenByOrder, String(argsId) + \\":0\\"))) + \\")\\""',
  ].join('\n') + '\n',
  historical: '',
};

export const NEW_EXPRESSION_EMISSION_M4135_REPLACEMENTS = [
  NEW_EXPRESSION_EMISSION_M4135_REPLACEMENT,
  ...[
    'validbinaryop',
    'exprsource',
    'expressionsources',
    'tablesok',
    'canonicalize',
    'nodetablesok',
    'propertyfacts',
    'valuefacts',
  ].map((name) => ({
    current: `\nfn name=${name}`,
    historical: `\n\nfn name=${name}`,
  })),
];
