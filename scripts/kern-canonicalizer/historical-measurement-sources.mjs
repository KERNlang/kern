import { reconstructHistoricalSource } from './historical-source.mjs';

export function reconstructLegacyParameterMeasurementSource({
  currentSource,
  expectedDigest,
  milestone,
  witnessMilestone,
  name,
}) {
  const sourceWrapper = [
    '  const source = reconstructLegacyParameterSource({',
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
