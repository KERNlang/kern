import { loadCanonicalizerPolicy } from './policy.mjs';

export const REVIEW_BOUNDARY_FIXTURES = [
  {
    id: 'unsupported-decimal-value',
    base: 'multiple-roots',
    category: 'profile rejection',
    mutate(tables) {
      const integer = tables.valueTag.indexOf('int');
      tables.valueTag[integer] = 'decimal';
      tables.valueText[integer] = '1.5';
    },
  },
  {
    id: 'unsupported-negative-integer-expression',
    base: 'multiple-roots',
    category: 'profile rejection',
    mutate(tables) {
      const integer = tables.valueRole.findIndex(
        (role, index) => role === 'record:value' && tables.valueTag[index] === 'int',
      );
      tables.valueText[integer] = '-12';
    },
  },
  {
    id: 'nonzero-root-value-order',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.valueOrder[tables.propValue[0] - 1] = 7;
    },
  },
];

const boundaryText = '\\'.repeat(loadCanonicalizerPolicy().kirLimits.maxStringBytes);
const boundaryExpression = `[${JSON.stringify(boundaryText)}, ${JSON.stringify(boundaryText)}]`;

export const ESCAPED_OUTPUT_BOUNDARY_FIXTURE = {
  id: 'escaped-output-boundary',
  source: [
    'fn name=escapedBoundary returns="string[]"',
    '  handler lang=kern',
    `    return value=${JSON.stringify(boundaryExpression)}`,
    '',
  ].join('\n'),
  golden: [
    'fn name=escapedBoundary returns=string[]',
    '  handler lang="kern"',
    `    return value=${JSON.stringify(boundaryExpression)}`,
    '',
  ].join('\n'),
};
