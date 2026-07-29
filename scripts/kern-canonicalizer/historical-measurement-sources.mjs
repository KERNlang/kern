import { reconstructHistoricalSource } from './historical-source.mjs';

export function reconstructLegacyParameterMeasurementSource({
  additionalNames = [],
  currentSource,
  expectedDigest,
  extraReplacements = [],
  milestone,
  witnessMilestone,
  name,
}) {
  const sourceWrapper = [
    '  const source = reconstructLegacyParameterSource({',
    ...(additionalNames.length === 0
      ? []
      : [`    additionalNames: [${additionalNames.map((value) => `'${value}'`).join(', ')}],`]),
    '    currentSource: readFileSync(WITNESS_SOURCE_URL),',
    '    expectedDigest: WITNESS_SOURCE_SHA256,',
    `    milestone: '${witnessMilestone}',`,
    `    name: '${name}',`,
    '  });',
  ].join('\n');
  return reconstructHistoricalSource({
    currentSource,
    expectedDigest,
    milestone,
    replacements: [
      ...extraReplacements,
      {
        current:
          "import { reconstructLegacyParameterSource } from './historical-parameter-sources.mjs';\n",
        historical: '',
      },
      {
        current: sourceWrapper,
        historical: '  const source = readFileSync(WITNESS_SOURCE_URL);',
      },
    ],
  });
}
