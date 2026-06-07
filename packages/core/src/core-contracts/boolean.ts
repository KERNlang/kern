import type { CoreTypeContract } from './schema.js';

export const BOOLEAN_CONTRACT = {
  name: 'Boolean',
  kind: 'primitive',
  strict: true,
  operations: [
    {
      id: 'Boolean.not',
      kind: 'method',
      args: ['Boolean'],
      returns: 'Boolean',
      lowers: {
        kern: 'Boolean.not($0)',
        ts: '__kernBooleanNot($0)',
        python: '__kern_boolean_not($0)',
      },
      fixtures: [
        { args: [true], returns: false },
        { args: [false], returns: true },
      ],
      review: {
        summary: 'Strict boolean negation.',
        graph: ['Boolean', 'portable'],
      },
    },
    {
      id: 'Boolean.and',
      kind: 'method',
      args: ['Boolean', 'Boolean'],
      returns: 'Boolean',
      lowers: {
        kern: 'Boolean.and($0, $1)',
        ts: '__kernBooleanAnd($0, $1)',
        python: '__kern_boolean_and($0, $1)',
      },
      fixtures: [
        { args: [true, true], returns: true },
        { args: [true, false], returns: false },
        { args: [false, true], returns: false },
        { args: [true, 'true'], throws: { code: 'strict-type', message: 'Boolean.and expects Boolean, Boolean.' } },
        { args: [true, 1], throws: { code: 'strict-type', message: 'Boolean.and expects Boolean, Boolean.' } },
      ],
      review: {
        summary: 'Strict boolean conjunction; both operands must be Boolean.',
        graph: ['Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Boolean.or',
      kind: 'method',
      args: ['Boolean', 'Boolean'],
      returns: 'Boolean',
      lowers: {
        kern: 'Boolean.or($0, $1)',
        ts: '__kernBooleanOr($0, $1)',
        python: '__kern_boolean_or($0, $1)',
      },
      fixtures: [
        { args: [false, false], returns: false },
        { args: [true, false], returns: true },
        { args: [false, true], returns: true },
        { args: [false, 'false'], throws: { code: 'strict-type', message: 'Boolean.or expects Boolean, Boolean.' } },
      ],
      review: {
        summary: 'Strict boolean disjunction; both operands must be Boolean.',
        graph: ['Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Boolean.equals',
      kind: 'method',
      args: ['Boolean', 'Boolean'],
      returns: 'Boolean',
      lowers: {
        kern: 'Boolean.equals($0, $1)',
        ts: '__kernBooleanEquals($0, $1)',
        python: '__kern_boolean_equals($0, $1)',
      },
      fixtures: [
        { args: [true, true], returns: true },
        { args: [true, false], returns: false },
        { args: [true, 'true'], throws: { code: 'strict-type', message: 'Boolean.equals expects Boolean, Boolean.' } },
        { args: [true, 1], throws: { code: 'strict-type', message: 'Boolean.equals expects Boolean, Boolean.' } },
      ],
      review: {
        summary: 'Strict boolean equality; cross-type equality is a type error in schema v1.',
        graph: ['Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'Boolean.toString',
      kind: 'coercion',
      args: ['Boolean'],
      returns: 'String',
      lowers: {
        kern: 'Boolean.toString($0)',
        ts: '__kernBooleanToString($0)',
        python: '__kern_boolean_to_string($0)',
      },
      fixtures: [
        { args: [true], returns: 'true' },
        { args: [false], returns: 'false' },
      ],
      review: {
        summary: 'Portable Boolean to String coercion using KERN lowercase boolean spelling.',
        graph: ['Boolean', 'String', 'portable'],
      },
    },
  ],
} as const satisfies CoreTypeContract;
