function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from({ length: 13 }, (_, index) => `  param name=p${index} type=number`);

export const PROFILE_BOUNDARY_FIXTURE = {
  id: 'profile-row-boundary',
  expectedRows: { nodes: 16, properties: 30, values: 72 },
  source: lines(
    'fn name=bounded returns="number[]"',
    ...BOUNDARY_PARAMETERS,
    '  handler lang=kern',
    '    return value="[0,1,2,3,4,5]"',
  ),
  golden: lines(
    'fn name=bounded returns=number[]',
    ...BOUNDARY_PARAMETERS,
    '  handler lang="kern"',
    '    return value="[0, 1, 2, 3, 4, 5]"',
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
    expectedRows: { nodes: 16, properties: 30, values: 76 },
    source: lines(
      'fn name=values returns="number[]"',
      ...BOUNDARY_PARAMETERS,
      '  handler lang=kern',
      '    return value="[0,1,2,3,4,5,6]"',
    ),
  },
];
