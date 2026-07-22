function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from({ length: 13 }, (_, index) => `  param name=p${index} type=number`);
export const PROFILE_BOUNDARY_FIXTURE = {
  id: 'profile-row-boundary',
  expectedRows: { nodes: 12, properties: 15, values: 388 },
  source: lines(
    'fn name=validbinaryop returns=boolean export=true',
    '  param name=op type=string',
    '  handler lang="kern"',
    String.raw`    if cond="op == \"+\" || op == \"-\" || op == \"*\" || op == \"/\" || op == \"%\""`,
    '      return value="true"',
    String.raw`    if cond="op == \"**\" || op == \"==\" || op == \"!=\" || op == \"===\" || op == \"!==\""`,
    '      return value="true"',
    String.raw`    if cond="op == \"<\" || op == \"<=\" || op == \">\" || op == \">=\" || op == \"instanceof\""`,
    '      return value="true"',
    String.raw`    if cond="op == \"&&\" || op == \"||\" || op == \"??\" || op == \"&\" || op == \"|\""`,
    '      return value="true"',
    String.raw`    return value="op == \"^\" || op == \"<<\" || op == \">>\" || op == \">>>\""`,
  ),
  golden: lines(
    'fn name=validbinaryop returns=boolean export=true',
    '  param name=op type=string',
    '  handler lang="kern"',
    String.raw`    if cond="(((((op == \"+\") || (op == \"-\")) || (op == \"*\")) || (op == \"/\")) || (op == \"%\"))"`,
    '      return value="true"',
    String.raw`    if cond="(((((op == \"**\") || (op == \"==\")) || (op == \"!=\")) || (op == \"===\")) || (op == \"!==\"))"`,
    '      return value="true"',
    String.raw`    if cond="(((((op == \"<\") || (op == \"<=\")) || (op == \">\")) || (op == \">=\")) || (op == \"instanceof\"))"`,
    '      return value="true"',
    String.raw`    if cond="(((((op == \"&&\") || (op == \"||\")) || (op == \"??\")) || (op == \"&\")) || (op == \"|\"))"`,
    '      return value="true"',
    String.raw`    return value="((((op == \"^\") || (op == \"<<\")) || (op == \">>\")) || (op == \">>>\"))"`,
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
    expectedRows: { nodes: 12, properties: 16, values: 389 },
    source: PROFILE_BOUNDARY_FIXTURE.source.replace(' export=true\n', ' export=true async=true\n'),
  },
];
