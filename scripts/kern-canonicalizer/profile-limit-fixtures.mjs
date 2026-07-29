function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from(
  { length: 93 },
  (_, index) => `  param name=p${index} type=number`,
);

const VALUE_BOUNDARY_EXPRESSION = `[${[
  ...Array.from({ length: 596 }, () => '0'),
  '-1',
  'null',
  'null',
  'null',
  'null',
].join(', ')}]`;

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
    admittedProfileLimits: { maxNodeRows: 123, maxPropertyRows: 193, maxValueRows: 2411 },
    expectedRows: { nodes: 123, properties: 123, values: 164 },
    source: lines(
      ...Array.from({ length: 41 }, (_, index) => [
        `fn name=f${index} returns=void`,
        '  handler lang=kern',
        '    return',
      ]).flat(),
    ),
  },
  {
    id: 'over-property-row-limit',
    admittedProfileLimits: { maxNodeRows: 122, maxPropertyRows: 194, maxValueRows: 2411 },
    expectedRows: { nodes: 97, properties: 194, values: 297 },
    source: lines(
      'fn name=properties returns=void export=true',
      ...BOUNDARY_PARAMETERS,
      '  handler lang=kern',
      '    do value="0"',
      '    for name=i from=0 to=0',
    ),
  },
  {
    id: 'over-value-row-limit',
    admittedProfileLimits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2412 },
    expectedRows: { nodes: 4, properties: 4, values: 2412 },
    source: lines(
      'fn name=values returns=void',
      '  handler lang=kern',
      `    do value="${VALUE_BOUNDARY_EXPRESSION}"`,
      '    return',
    ),
  },
];
