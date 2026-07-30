function lines(...items) {
  return `${items.join('\n')}\n`;
}

const VALUE_BOUNDARY_EXPRESSION = `[[${Array.from({ length: 785 }, () => '0').join(', ')}], [${
  [
    ...Array.from({ length: 785 }, () => '0'),
    'null',
    'null',
    'null',
  ].join(', ')
}]]`;

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
    admittedProfileLimits: { maxNodeRows: 206, maxPropertyRows: 332, maxValueRows: 6304 },
    expectedRows: { nodes: 206, properties: 206, values: 816 },
    source: lines(
      'fn name=nodes returns=void',
      '  handler lang=kern',
      ...Array.from({ length: 203 }, () => '    do value="0"'),
      '    return',
    ),
  },
  {
    id: 'over-property-row-limit',
    admittedProfileLimits: { maxNodeRows: 205, maxPropertyRows: 333, maxValueRows: 6304 },
    expectedRows: { nodes: 112, properties: 333, values: 994 },
    source: lines(
      'fn name=properties returns=void',
      '  handler lang=kern',
      ...Array.from(
        { length: 110 },
        (_, index) => `    for name=i${index} from=0 to=0`,
      ),
    ),
  },
  {
    id: 'over-value-row-limit',
    admittedProfileLimits: { maxNodeRows: 205, maxPropertyRows: 332, maxValueRows: 6305 },
    expectedRows: { nodes: 4, properties: 4, values: 6305 },
    source: lines(
      'fn name=values returns=void',
      '  handler lang=kern',
      `    do value="${VALUE_BOUNDARY_EXPRESSION}"`,
      '    return',
    ),
  },
];
