import { CORE_FIXTURE_UNDEFINED, type CoreTypeContract } from './schema.js';

export const RECORD_CONTRACT = {
  name: 'Record',
  kind: 'record',
  strict: true,
  operations: [
    {
      id: 'Record.get',
      kind: 'method',
      args: ['Record', 'String'],
      returns: ['String', 'Boolean', 'Number', 'List', 'Record', 'Function', 'Null', 'Undefined'],
      lowers: {
        kern: 'Record.get($0, $1)',
        ts: '__kernRecordGet($0, $1)',
        python: '__kern_record_get($0, $1)',
      },
      fixtures: [
        { args: [{ x: 1 }, 'x'], returns: 1 },
        { args: [{ x: 1 }, 'y'], returns: CORE_FIXTURE_UNDEFINED },
        { args: [{ x: CORE_FIXTURE_UNDEFINED }, 'x'], returns: CORE_FIXTURE_UNDEFINED },
        { args: [{}, 'toString'], returns: CORE_FIXTURE_UNDEFINED },
        { args: [{}, ''], returns: CORE_FIXTURE_UNDEFINED },
        { args: [{ x: 1 }, 0], throws: { code: 'strict-type', message: 'Record.get expects Record, String.' } },
      ],
      review: {
        summary: 'Strict own-key record lookup; missing keys return Undefined.',
        graph: ['Record', 'String', 'Undefined', 'strict', 'portable'],
      },
    },
  ],
} as const satisfies CoreTypeContract;
