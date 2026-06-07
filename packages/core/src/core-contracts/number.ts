import type { CoreTypeContract } from './schema.js';

export const NUMBER_CONTRACT = {
  name: 'Number',
  kind: 'primitive',
  strict: true,
  operations: [
    {
      id: 'Number.negate',
      kind: 'method',
      args: ['Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.negate($0)',
        ts: '__kernNumberNegate($0)',
        python: '__kern_number_negate($0)',
      },
      fixtures: [
        { args: [3], returns: -3 },
        { args: [-3], returns: 3 },
        { args: ['3'], throws: { code: 'strict-type', message: 'Number.negate expects Number.' } },
      ],
      review: {
        summary: 'Strict numeric negation over finite KERN Numbers.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.add',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.add($0, $1)',
        ts: '__kernNumberAdd($0, $1)',
        python: '__kern_number_add($0, $1)',
      },
      fixtures: [
        { args: [2, 3], returns: 5 },
        { args: [-2, 3], returns: 1 },
        { args: [2, '3'], throws: { code: 'strict-type', message: 'Number.add expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric addition over finite KERN Numbers.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.subtract',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.subtract($0, $1)',
        ts: '__kernNumberSubtract($0, $1)',
        python: '__kern_number_subtract($0, $1)',
      },
      fixtures: [
        { args: [5, 3], returns: 2 },
        { args: [3, 5], returns: -2 },
        { args: [5, false], throws: { code: 'strict-type', message: 'Number.subtract expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric subtraction over finite KERN Numbers.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.multiply',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.multiply($0, $1)',
        ts: '__kernNumberMultiply($0, $1)',
        python: '__kern_number_multiply($0, $1)',
      },
      fixtures: [
        { args: [3, 4], returns: 12 },
        { args: [-3, 4], returns: -12 },
        { args: [3, null], throws: { code: 'strict-type', message: 'Number.multiply expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric multiplication over finite KERN Numbers.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.divide',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.divide($0, $1)',
        ts: '__kernNumberDivide($0, $1)',
        python: '__kern_number_divide($0, $1)',
      },
      fixtures: [
        { args: [6, 2], returns: 3 },
        { args: [5, 2], returns: 2.5 },
        { args: [1, 0], throws: { code: 'division-by-zero', message: 'Number.divide division by zero.' } },
        { args: [6, '2'], throws: { code: 'strict-type', message: 'Number.divide expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric division over finite KERN Numbers; zero divisor is a contract error.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.remainder',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Number',
      lowers: {
        kern: 'Number.remainder($0, $1)',
        ts: '__kernNumberRemainder($0, $1)',
        python: '__kern_number_remainder($0, $1)',
      },
      fixtures: [
        { args: [5, 2], returns: 1 },
        { args: [-5, 2], returns: -1 },
        { args: [5, -2], returns: 1 },
        { args: [1, 0], throws: { code: 'division-by-zero', message: 'Number.remainder division by zero.' } },
        { args: [5, '2'], throws: { code: 'strict-type', message: 'Number.remainder expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric remainder using KERN dividend-sign semantics; zero divisor is a contract error.',
        graph: ['Number', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.lessThan',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Boolean',
      lowers: {
        kern: 'Number.lessThan($0, $1)',
        ts: '__kernNumberLessThan($0, $1)',
        python: '__kern_number_less_than($0, $1)',
      },
      fixtures: [
        { args: [2, 3], returns: true },
        { args: [3, 2], returns: false },
        { args: [2, '3'], throws: { code: 'strict-type', message: 'Number.lessThan expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric less-than comparison.',
        graph: ['Number', 'Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.lessThanOrEqual',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Boolean',
      lowers: {
        kern: 'Number.lessThanOrEqual($0, $1)',
        ts: '__kernNumberLessThanOrEqual($0, $1)',
        python: '__kern_number_less_than_or_equal($0, $1)',
      },
      fixtures: [
        { args: [2, 2], returns: true },
        { args: [3, 2], returns: false },
        { args: [2, null], throws: { code: 'strict-type', message: 'Number.lessThanOrEqual expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric less-than-or-equal comparison.',
        graph: ['Number', 'Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.greaterThan',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Boolean',
      lowers: {
        kern: 'Number.greaterThan($0, $1)',
        ts: '__kernNumberGreaterThan($0, $1)',
        python: '__kern_number_greater_than($0, $1)',
      },
      fixtures: [
        { args: [3, 2], returns: true },
        { args: [2, 3], returns: false },
        { args: [3, true], throws: { code: 'strict-type', message: 'Number.greaterThan expects Number, Number.' } },
      ],
      review: {
        summary: 'Strict numeric greater-than comparison.',
        graph: ['Number', 'Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Number.greaterThanOrEqual',
      kind: 'method',
      args: ['Number', 'Number'],
      returns: 'Boolean',
      lowers: {
        kern: 'Number.greaterThanOrEqual($0, $1)',
        ts: '__kernNumberGreaterThanOrEqual($0, $1)',
        python: '__kern_number_greater_than_or_equal($0, $1)',
      },
      fixtures: [
        { args: [3, 3], returns: true },
        { args: [2, 3], returns: false },
        {
          args: [3, '3'],
          throws: { code: 'strict-type', message: 'Number.greaterThanOrEqual expects Number, Number.' },
        },
      ],
      review: {
        summary: 'Strict numeric greater-than-or-equal comparison.',
        graph: ['Number', 'Boolean', 'strict', 'portable'],
      },
    },
  ],
} as const satisfies CoreTypeContract;
