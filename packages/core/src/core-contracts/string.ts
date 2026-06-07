import { CORE_FIXTURE_UNDEFINED, type CoreTypeContract } from './schema.js';

export const STRING_CONTRACT = {
  name: 'String',
  kind: 'primitive',
  strict: true,
  operations: [
    {
      id: 'String.length',
      kind: 'property',
      args: ['String'],
      returns: 'Number',
      lowers: {
        kern: 'String.length($0)',
        ts: '__kernStringLength($0)',
        python: '__kern_string_length($0)',
      },
      fixtures: [
        { args: [''], returns: 0 },
        { args: ['kern'], returns: 4 },
        { args: ['𐐷'], returns: 1 },
        { args: ['e\u0301'], returns: 2 },
      ],
      review: {
        summary: 'KERN string length counts Unicode code points with no normalization.',
        graph: ['String', 'Number', 'portable', 'unicode-code-point'],
      },
    },
    {
      id: 'String.index',
      kind: 'method',
      args: ['String', 'Number'],
      returns: ['String', 'Undefined'],
      lowers: {
        kern: 'String.index($0, $1)',
        ts: '__kernStringIndex($0, $1)',
        python: '__kern_string_index($0, $1)',
      },
      fixtures: [
        { args: ['abc', 1], returns: 'b' },
        { args: ['a𐐷b', 1], returns: '𐐷' },
        { args: ['abc', 4], returns: CORE_FIXTURE_UNDEFINED },
        { args: ['abc', -1], returns: CORE_FIXTURE_UNDEFINED },
        { args: ['abc', 1.2], returns: CORE_FIXTURE_UNDEFINED },
        { args: ['abc', '1'], throws: { code: 'strict-type', message: 'String.index expects String, Number.' } },
      ],
      review: {
        summary:
          'Strict string indexing over Unicode code-point offsets; negative, fractional, and out-of-range misses return Undefined.',
        graph: ['String', 'Undefined', 'strict', 'portable', 'unicode-code-point'],
      },
    },
    {
      id: 'String.includes',
      kind: 'method',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.includes($0, $1)',
        ts: '__kernStringIncludes($0, $1)',
        python: '__kern_string_includes($0, $1)',
      },
      fixtures: [
        { args: ['abc', 'b'], returns: true },
        { args: ['abc', 'x'], returns: false },
      ],
      review: {
        summary: 'Strict string containment.',
        graph: ['String', 'Boolean', 'portable'],
      },
    },
    {
      id: 'String.startsWith',
      kind: 'method',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.startsWith($0, $1)',
        ts: '__kernStringStartsWith($0, $1)',
        python: '__kern_string_starts_with($0, $1)',
      },
      fixtures: [
        { args: ['kern', 'ke'], returns: true },
        { args: ['kern', 'rn'], returns: false },
      ],
      review: {
        summary: 'Strict string prefix test.',
        graph: ['String', 'Boolean', 'portable'],
      },
    },
    {
      id: 'String.endsWith',
      kind: 'method',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.endsWith($0, $1)',
        ts: '__kernStringEndsWith($0, $1)',
        python: '__kern_string_ends_with($0, $1)',
      },
      fixtures: [
        { args: ['kern', 'rn'], returns: true },
        { args: ['kern', 'ke'], returns: false },
      ],
      review: {
        summary: 'Strict string suffix test.',
        graph: ['String', 'Boolean', 'portable'],
      },
    },
    {
      id: 'String.slice',
      kind: 'method',
      args: ['String', 'Number', 'Number'],
      returns: 'String',
      lowers: {
        kern: 'String.slice($0, $1, $2)',
        ts: '__kernStringSlice($0, $1, $2)',
        python: '__kern_string_slice($0, $1, $2)',
      },
      fixtures: [
        { args: ['abcdef', 1, 4], returns: 'bcd' },
        { args: ['abcdef', 1.9, 4.2], returns: 'bcd' },
        { args: ['abc', 0, 2], returns: 'ab' },
        { args: ['abcdef', -3, -1], returns: 'de' },
        { args: ['abcdef', -20, 2], returns: 'ab' },
        { args: ['abcdef', 4, 2], returns: '' },
        { args: ['a𐐷b', 1, 2], returns: '𐐷' },
        { args: ['e\u0301x', 0, 2], returns: 'e\u0301' },
        {
          args: ['abc', '0', 2],
          throws: { code: 'strict-type', message: 'String.slice expects String, Number, Number.' },
        },
        {
          args: ['abc', 1],
          throws: { code: 'strict-type', message: 'String.slice expects String, Number, Number.' },
        },
      ],
      review: {
        summary:
          'Strict string slice over Unicode code-point offsets with explicit start and end offsets; negative offsets count from the end.',
        graph: ['String', 'Number', 'strict', 'portable', 'unicode-code-point'],
      },
    },
    {
      id: 'String.trim',
      kind: 'method',
      args: ['String'],
      returns: 'String',
      lowers: {
        kern: 'String.trim($0)',
        ts: '__kernStringTrim($0)',
        python: '__kern_string_trim($0)',
      },
      fixtures: [
        { args: ['  kern  '], returns: 'kern' },
        { args: ['\ncore\t'], returns: 'core' },
      ],
      review: {
        summary: 'Portable surrounding whitespace trim.',
        graph: ['String', 'portable'],
      },
    },
    {
      id: 'String.lower',
      kind: 'method',
      args: ['String'],
      returns: 'String',
      lowers: {
        kern: 'String.lower($0)',
        ts: '__kernStringLower($0)',
        python: '__kern_string_lower($0)',
      },
      fixtures: [
        { args: ['KERN'], returns: 'kern' },
        { args: ['Core'], returns: 'core' },
      ],
      review: {
        summary: 'Portable lowercase conversion.',
        graph: ['String', 'portable'],
      },
    },
    {
      id: 'String.upper',
      kind: 'method',
      args: ['String'],
      returns: 'String',
      lowers: {
        kern: 'String.upper($0)',
        ts: '__kernStringUpper($0)',
        python: '__kern_string_upper($0)',
      },
      fixtures: [
        { args: ['kern'], returns: 'KERN' },
        { args: ['Core'], returns: 'CORE' },
      ],
      review: {
        summary: 'Portable uppercase conversion.',
        graph: ['String', 'portable'],
      },
    },
    {
      id: 'String.concat',
      kind: 'method',
      args: ['String', 'String'],
      returns: 'String',
      lowers: {
        kern: 'String.concat($0, $1)',
        ts: '__kernStringConcat($0, $1)',
        python: '__kern_string_concat($0, $1)',
      },
      fixtures: [
        { args: ['kern', 'lang'], returns: 'kernlang' },
        { args: ['count:', 2], throws: { code: 'strict-type', message: 'String.concat expects String, String.' } },
      ],
      review: {
        summary: 'Strict string concatenation; both operands must be String.',
        graph: ['String', 'strict', 'portable'],
      },
    },
    {
      id: 'String.equals',
      kind: 'method',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.equals($0, $1)',
        ts: '__kernStringEquals($0, $1)',
        python: '__kern_string_equals($0, $1)',
      },
      fixtures: [
        { args: ['kern', 'kern'], returns: true },
        { args: ['kern', 'core'], returns: false },
        { args: ['kern', true], throws: { code: 'strict-type', message: 'String.equals expects String, String.' } },
      ],
      review: {
        summary: 'Strict string equality; cross-type equality is a type error in schema v1.',
        graph: ['String', 'Boolean', 'strict', 'portable'],
      },
    },
    {
      id: 'String.lessThan',
      kind: 'operator',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.lessThan($0, $1)',
        ts: '__kernStringLessThan($0, $1)',
        python: '__kern_string_less_than($0, $1)',
      },
      fixtures: [
        { args: ['abc', 'abd'], returns: true },
        { args: ['abc', 'abc'], returns: false },
        { args: ['abc', true], throws: { code: 'strict-type', message: 'String.lessThan expects String, String.' } },
      ],
      review: {
        summary: 'Strict string less-than comparison using KERN portable code-point ordering.',
        graph: ['String', 'Boolean', 'strict', 'portable', 'unicode-code-point-order'],
      },
    },
    {
      id: 'String.lessThanOrEqual',
      kind: 'operator',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.lessThanOrEqual($0, $1)',
        ts: '__kernStringLessThanOrEqual($0, $1)',
        python: '__kern_string_less_than_or_equal($0, $1)',
      },
      fixtures: [
        { args: ['abc', 'abc'], returns: true },
        { args: ['abd', 'abc'], returns: false },
      ],
      review: {
        summary: 'Strict string less-than-or-equal comparison using KERN portable code-point ordering.',
        graph: ['String', 'Boolean', 'strict', 'portable', 'unicode-code-point-order'],
      },
    },
    {
      id: 'String.greaterThan',
      kind: 'operator',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.greaterThan($0, $1)',
        ts: '__kernStringGreaterThan($0, $1)',
        python: '__kern_string_greater_than($0, $1)',
      },
      fixtures: [
        { args: ['abd', 'abc'], returns: true },
        { args: ['abc', 'abc'], returns: false },
      ],
      review: {
        summary: 'Strict string greater-than comparison using KERN portable code-point ordering.',
        graph: ['String', 'Boolean', 'strict', 'portable', 'unicode-code-point-order'],
      },
    },
    {
      id: 'String.greaterThanOrEqual',
      kind: 'operator',
      args: ['String', 'String'],
      returns: 'Boolean',
      lowers: {
        kern: 'String.greaterThanOrEqual($0, $1)',
        ts: '__kernStringGreaterThanOrEqual($0, $1)',
        python: '__kern_string_greater_than_or_equal($0, $1)',
      },
      fixtures: [
        { args: ['abc', 'abc'], returns: true },
        { args: ['abc', 'abd'], returns: false },
      ],
      review: {
        summary: 'Strict string greater-than-or-equal comparison using KERN portable code-point ordering.',
        graph: ['String', 'Boolean', 'strict', 'portable', 'unicode-code-point-order'],
      },
    },
    {
      id: 'String.toString',
      kind: 'coercion',
      args: ['String'],
      returns: 'String',
      lowers: {
        kern: 'String.toString($0)',
        ts: '__kernStringToString($0)',
        python: '__kern_string_to_string($0)',
      },
      fixtures: [
        { args: ['kern'], returns: 'kern' },
        { args: [''], returns: '' },
      ],
      review: {
        summary: 'String identity coercion.',
        graph: ['String', 'portable'],
      },
    },
  ],
} as const satisfies CoreTypeContract;
