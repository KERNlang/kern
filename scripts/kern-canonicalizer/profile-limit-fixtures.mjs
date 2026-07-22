function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from({ length: 13 }, (_, index) => `  param name=p${index} type=number`);
export const PROFILE_BOUNDARY_FIXTURE = {
  id: 'profile-row-boundary',
  expectedRows: { nodes: 15, properties: 24, values: 154 },
  source: lines(
    'fn name=hasimportcyclefrom returns=boolean export=true',
    '  param name=module type=number',
    '  param name=useModule type="number[]"',
    '  param name=useTarget type="number[]"',
    '  param name=path type="number[]"',
    '  handler lang="kern"',
    '    if cond="containsid(path, module)"',
    '      return value="true"',
    '    let name=nextPath value="appendid(path, module)"',
    '    for name=i12 from="0" to="useModule.length"',
    '      if cond="(useModule[i12] == module)"',
    '        if cond="(useTarget[i12] != 0)"',
    '          if cond="hasimportcyclefrom(useTarget[i12], useModule, useTarget, nextPath)"',
    '            return value="true"',
    '    return value="false"',
  ),
  golden: lines(
    'fn name=hasimportcyclefrom returns=boolean export=true',
    '  param name=module type=number',
    '  param name=useModule type=number[]',
    '  param name=useTarget type=number[]',
    '  param name=path type=number[]',
    '  handler lang="kern"',
    '    if cond="containsid(path, module)"',
    '      return value="true"',
    '    let name=nextPath value="appendid(path, module)"',
    '    for name=i12 from="0" to="useModule.length"',
    '      if cond="(useModule[i12] == module)"',
    '        if cond="(useTarget[i12] != 0)"',
    '          if cond="hasimportcyclefrom(useTarget[i12], useModule, useTarget, nextPath)"',
    '            return value="true"',
    '    return value="false"',
  ),
};

export const PROFILE_LIMIT_FIXTURES = [
  {
    id: 'over-node-row-limit',
    expectedRows: { nodes: 17, properties: 19, values: 26 },
    source: lines(
      'fn name=f0 returns=void',
      '  param name=a type=number',
      '  param name=b type=number',
      '  handler lang=kern',
      '    return',
      ...Array.from({ length: 4 }, (_, index) => [
        `fn name=f${index + 1} returns=void`,
        '  handler lang=kern',
        '    return',
      ]).flat(),
    ),
  },
  {
    id: 'over-property-row-limit',
    expectedRows: { nodes: 16, properties: 31, values: 69 },
    source: lines(
      'fn name=properties returns="number[]" export=true',
      ...BOUNDARY_PARAMETERS,
      '  handler lang=kern',
      '    return value="[0,1,2,3,4]"',
    ),
  },
  {
    id: 'over-value-row-limit',
    expectedRows: { nodes: 15, properties: 25, values: 155 },
    source: PROFILE_BOUNDARY_FIXTURE.source.replace(' export=true\n', ' export=true async=true\n'),
  },
];
