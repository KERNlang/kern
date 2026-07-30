export const EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS = [
  {
    current: [
      '    if cond="kind == \\"throw\\""',
      '      if cond="facts[0] != 0"',
      '        return value="false"',
      '      let name=valueId value="facts[2]"',
      '      if cond="valueId <= 0 || facts[1] != 1"',
      '        return value="false"',
      '      return value="exprsource(valueId, valueTag, valueParent, valueRole, valueOrder, valueText, valueBool) != \\"\\""',
      '',
    ].join('\n'),
    historical: '',
  },
  {
    current: [
      '    if cond="kind == \\"throw\\""',
      '      let name=valueId value="facts[2]"',
      '      let name=expression value="exprsource(valueId, valueTag, valueParent, valueRole, valueOrder, valueText, valueBool)"',
      '      do value="out.push(prefix + \\"throw value=\\" + quotesource(expression, true))"',
      '      return value="out"',
      '',
    ].join('\n'),
    historical: '',
  },
];
