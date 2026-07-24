function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from(
  { length: 27 },
  (_, index) => `  param name=p${index} type=number`,
);

function withLinesBeforeFinal(source, ...insertedLines) {
  const sourceLines = source.trimEnd().split('\n');
  const finalLine = sourceLines.pop();
  sourceLines.push(...insertedLines, finalLine);
  return lines(...sourceLines);
}
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
    admittedProfileLimits: { maxNodeRows: 39, maxPropertyRows: 61, maxValueRows: 461 },
    expectedRows: { nodes: 39, properties: 45, values: 62 },
    source: lines(
      'fn name=f0 returns=void',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  param name=d type=number',
      '  param name=e type=number',
      '  param name=f type=number',
      '  handler lang=kern',
      '    return',
      ...Array.from({ length: 10 }, (_, index) => [
        `fn name=f${index + 1} returns=void`,
        '  handler lang=kern',
        '    return',
      ]).flat(),
    ),
  },
  {
    id: 'over-property-row-limit',
    admittedProfileLimits: { maxNodeRows: 38, maxPropertyRows: 62, maxValueRows: 461 },
    expectedRows: { nodes: 31, properties: 62, values: 99 },
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
    admittedProfileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 462 },
    expectedRows: { nodes: 18, properties: 21, values: 462 },
    source: withLinesBeforeFinal(
      PROFILE_BOUNDARY_FIXTURE.source,
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
    ),
  },
];
