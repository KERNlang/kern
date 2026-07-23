function lines(...items) {
  return `${items.join('\n')}\n`;
}

const BOUNDARY_PARAMETERS = Array.from(
  { length: 22 },
  (_, index) => `  param name=p${index} type=number`,
);

function withFinalLine(source, finalLine) {
  const sourceLines = source.trimEnd().split('\n');
  sourceLines[sourceLines.length - 1] = finalLine;
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
    admittedProfileLimits: { maxNodeRows: 26, maxPropertyRows: 50, maxValueRows: 388 },
    expectedRows: { nodes: 26, properties: 28, values: 38 },
    source: lines(
      'fn name=f0 returns=void',
      '  param name=a type=number',
      '  param name=b type=number',
      '  handler lang=kern',
      '    return',
      ...Array.from({ length: 7 }, (_, index) => [
        `fn name=f${index + 1} returns=void`,
        '  handler lang=kern',
        '    return',
      ]).flat(),
    ),
  },
  {
    id: 'over-property-row-limit',
    admittedProfileLimits: { maxNodeRows: 25, maxPropertyRows: 51, maxValueRows: 388 },
    expectedRows: { nodes: 25, properties: 51, values: 80 },
    source: lines(
      'fn name=properties returns=void export=true',
      ...BOUNDARY_PARAMETERS,
      '  handler lang=kern',
      '    for name=i from=0 to=0',
    ),
  },
  {
    id: 'over-value-row-limit',
    admittedProfileLimits: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 389 },
    expectedRows: { nodes: 12, properties: 15, values: 389 },
    source: withFinalLine(
      PROFILE_BOUNDARY_FIXTURE.source,
      String.raw`    return value="op == \"^\" || op == \"<<\" || op == \">>\" || foo(op)"`,
    ),
  },
];
