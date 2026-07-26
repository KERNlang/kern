function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from(
  { length: 35 },
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
    admittedProfileLimits: { maxNodeRows: 75, maxPropertyRows: 77, maxValueRows: 580 },
    expectedRows: { nodes: 75, properties: 75, values: 100 },
    source: lines(
      ...Array.from({ length: 25 }, (_, index) => [
        `fn name=f${index} returns=void`,
        '  handler lang=kern',
        '    return',
      ]).flat(),
    ),
  },
  {
    id: 'over-property-row-limit',
    admittedProfileLimits: { maxNodeRows: 74, maxPropertyRows: 78, maxValueRows: 580 },
    expectedRows: { nodes: 39, properties: 78, values: 123 },
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
    admittedProfileLimits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 581 },
    expectedRows: { nodes: 29, properties: 32, values: 581 },
    source: withLinesBeforeFinal(
      PROFILE_BOUNDARY_FIXTURE.source,
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="foo(op)"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="null"',
      '    do value="null"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
      '    do value="op == 0"',
    ),
  },
];
