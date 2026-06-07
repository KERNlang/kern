import { CORE_FIXTURE_UNDEFINED, type CoreTypeContract } from './schema.js';

export const LIST_CONTRACT = {
  name: 'List',
  kind: 'collection',
  strict: true,
  operations: [
    {
      id: 'List.length',
      kind: 'property',
      args: ['List'],
      returns: 'Number',
      lowers: {
        kern: 'List.length($0)',
        ts: '__kernListLength($0)',
        python: '__kern_list_length($0)',
      },
      fixtures: [
        { args: [[]], returns: 0 },
        { args: [[1, 2, 3]], returns: 3 },
        { args: ['not-list'], throws: { code: 'strict-type', message: 'List.length expects List.' } },
      ],
      review: {
        summary: 'Strict list cardinality.',
        graph: ['List', 'Number', 'strict', 'portable'],
      },
    },
    {
      id: 'List.index',
      kind: 'method',
      args: ['List', 'Number'],
      returns: ['String', 'Boolean', 'Number', 'List', 'Record', 'Function', 'Null', 'Undefined'],
      lowers: {
        kern: 'List.index($0, $1)',
        ts: '__kernListIndex($0, $1)',
        python: '__kern_list_index($0, $1)',
      },
      fixtures: [
        { args: [[10, 20, 30], 0], returns: 10 },
        { args: [[10, 20, 30], 2], returns: 30 },
        { args: [[10, 20, 30], 3], returns: CORE_FIXTURE_UNDEFINED },
        { args: [[10, 20, 30], -1], returns: CORE_FIXTURE_UNDEFINED },
        { args: [[10, 20, 30], 1.5], returns: CORE_FIXTURE_UNDEFINED },
        { args: [[10, CORE_FIXTURE_UNDEFINED, 30], 1], returns: CORE_FIXTURE_UNDEFINED },
        { args: [[], 0], returns: CORE_FIXTURE_UNDEFINED },
        { args: [[10], '0'], throws: { code: 'strict-type', message: 'List.index expects List, Number.' } },
      ],
      review: {
        summary: 'Strict list index by numeric offset; misses return Undefined.',
        graph: ['List', 'Number', 'Undefined', 'strict', 'portable'],
      },
    },
  ],
} as const satisfies CoreTypeContract;
