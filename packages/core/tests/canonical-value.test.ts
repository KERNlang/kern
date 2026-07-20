import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import {
  CANONICAL_VALUE_FORMAT,
  type CanonicalValue,
  CanonicalValueDecodeError,
  type CanonicalValueLimits,
} from '../src/canonical-value/types.js';

const encoder = new TextEncoder();
const limits: CanonicalValueLimits = {
  maxBytes: 16_384,
  maxDepth: 32,
  maxNodes: 128,
  maxStringBytes: 1_024,
  maxCollectionLength: 32,
  maxRecordFields: 32,
  maxMapEntries: 32,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};

function wire(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify({ format: CANONICAL_VALUE_FORMAT, value })}\n`);
}

function withLimit(name: keyof CanonicalValueLimits, value: number): CanonicalValueLimits {
  return { ...limits, [name]: value };
}

function expectCode(action: () => unknown, code: CanonicalValueDecodeError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalValueDecodeError);
    expect((error as CanonicalValueDecodeError).code).toBe(code);
  }
}

describe('internal bounded canonical value reader', () => {
  const values: readonly CanonicalValue[] = [
    { tag: 'null' },
    { tag: 'bool', value: true },
    { tag: 'text', value: 'é😀' },
    { tag: 'int', value: '90071992547409931234567890' },
    { tag: 'decimal', value: '-12345678901234567890.500' },
    { tag: 'list', value: [{ tag: 'null' }, { tag: 'text', value: 'x' }] },
    {
      tag: 'record',
      value: [
        { key: 'a', value: { tag: 'int', value: '1' } },
        { key: '😀', value: { tag: 'bool', value: false } },
      ],
    },
    {
      tag: 'map',
      value: [
        { key: { tag: 'bool', value: false }, value: { tag: 'text', value: 'b' } },
        { key: { tag: 'int', value: '1' }, value: { tag: 'text', value: 'i' } },
        { key: { tag: 'null' }, value: { tag: 'text', value: 'n' } },
        { key: { tag: 'text', value: 'a' }, value: { tag: 'text', value: 't' } },
      ],
    },
    {
      tag: 'error',
      value: {
        code: 'E_TEST',
        message: 'portable failure',
        details: { tag: 'record', value: [{ key: 'retry', value: { tag: 'bool', value: false } }] },
      },
    },
  ];

  test.each(values)('round-trips canonical tag $tag byte-identically', (value) => {
    const bytes = encodeCanonicalValue(value, limits);
    expect(decodeCanonicalValue(bytes, limits)).toEqual(value);
    expect(encodeCanonicalValue(decodeCanonicalValue(bytes, limits), limits)).toEqual(bytes);
  });

  test('rejects malformed UTF-8, BOM, and terminal-newline violations', () => {
    expectCode(() => decodeCanonicalValue(Uint8Array.of(0xc0, 0xaf, 0x0a), limits), 'invalid-utf8');
    expectCode(() => decodeCanonicalValue(Uint8Array.of(0xe2, 0x82, 0x0a), limits), 'invalid-utf8');
    expectCode(() => decodeCanonicalValue(Uint8Array.of(0xe2, 0x28, 0xa1, 0x0a), limits), 'invalid-utf8');
    expectCode(() => decodeCanonicalValue(Uint8Array.of(0xed, 0xa0, 0x80, 0x0a), limits), 'invalid-utf8');
    expectCode(() => decodeCanonicalValue(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a), limits), 'invalid-utf8');
    expectCode(() => decodeCanonicalValue(encoder.encode('{}'), limits), 'invalid-json');
    expectCode(() => decodeCanonicalValue(encoder.encode('{}\n\n'), limits), 'invalid-json');
    expectCode(() => decodeCanonicalValue(encoder.encode(']}\n'), limits), 'invalid-json');
  });

  test('rejects unknown versions, fields, tags, JSON numbers, and host-shaped values', () => {
    expectCode(
      () => decodeCanonicalValue(encoder.encode('{"format":"other","value":{"tag":"null"}}\n'), limits),
      'unsupported-version',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          encoder.encode(`{"extra":true,"format":"${CANONICAL_VALUE_FORMAT}","value":{"tag":"null"}}\n`),
          limits,
        ),
      'invalid-shape',
    );
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'regex', value: { pattern: 'a', flags: '' } }), limits),
      'invalid-value',
    );
    expectCode(() => decodeCanonicalValue(wire({ tag: 'expression', value: {} }), limits), 'invalid-value');
    expectCode(() => decodeCanonicalValue(wire({ tag: 'int', value: 1 }), limits), 'invalid-value');
    expectCode(() => decodeCanonicalValue(wire({ tag: 'negative-zero' }), limits), 'invalid-shape');
  });

  test('rejects noncanonical JSON bytes and duplicate object fields', () => {
    expectCode(
      () =>
        decodeCanonicalValue(
          encoder.encode(`{ "format":"${CANONICAL_VALUE_FORMAT}","value":{"tag":"null"}}\n`),
          limits,
        ),
      'noncanonical',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          encoder.encode(`{"format":"${CANONICAL_VALUE_FORMAT}","value":{"tag":"null","tag":"null"}}\n`),
          limits,
        ),
      'noncanonical',
    );
    expectCode(
      () =>
        decodeCanonicalValue(encoder.encode(`{"value":{"tag":"null"},"format":"${CANONICAL_VALUE_FORMAT}"}\n`), limits),
      'noncanonical',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          encoder.encode(`{"format":"${CANONICAL_VALUE_FORMAT}","value":{"tag":"text","value":"\\u0061"}}\n`),
          limits,
        ),
      'noncanonical',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          encoder.encode(`{"format":"${CANONICAL_VALUE_FORMAT}","value":{"tag":"text","value":"\\/"}}\n`),
          limits,
        ),
      'noncanonical',
    );
  });

  test('integer and decimal text are exact and never host-number bounded', () => {
    expect(decodeCanonicalValue(wire({ tag: 'int', value: '9'.repeat(200) }), limits)).toEqual({
      tag: 'int',
      value: '9'.repeat(200),
    });
    for (const value of ['-0', '01', '+1', '1.0', '1e3']) {
      expectCode(() => decodeCanonicalValue(wire({ tag: 'int', value }), limits), 'invalid-value');
    }
    for (const value of ['1', '01.0', '1.', '.1', '1e0', '-0e0', '-0.0', '-0.00']) {
      expectCode(() => decodeCanonicalValue(wire({ tag: 'decimal', value }), limits), 'invalid-value');
    }
    expect(decodeCanonicalValue(wire({ tag: 'decimal', value: '1.0' }), limits)).not.toEqual(
      decodeCanonicalValue(wire({ tag: 'decimal', value: '1.00' }), limits),
    );
  });

  test('rejects escaped lone surrogates after JSON decoding', () => {
    expectCode(() => decodeCanonicalValue(wire({ tag: 'text', value: '\ud800' }), limits), 'invalid-value');
    expectCode(() => decodeCanonicalValue(wire({ tag: 'text', value: '\udc00' }), limits), 'invalid-value');
  });

  test('record and map keys reject duplicates, wrong order, and non-scalar map keys', () => {
    const textValue = { tag: 'text', value: 'x' } as const;
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({
            tag: 'record',
            value: [
              { key: 'b', value: textValue },
              { key: 'a', value: textValue },
            ],
          }),
          limits,
        ),
      'invalid-order',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({
            tag: 'record',
            value: [
              { key: 'a', value: textValue },
              { key: 'a', value: textValue },
            ],
          }),
          limits,
        ),
      'duplicate-key',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({
            tag: 'map',
            value: [
              { key: { tag: 'text', value: 'a' }, value: textValue },
              { key: { tag: 'bool', value: false }, value: textValue },
            ],
          }),
          limits,
        ),
      'invalid-order',
    );
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({ tag: 'map', value: [{ key: { tag: 'list', value: [] }, value: textValue }] }),
          limits,
        ),
      'invalid-value',
    );
  });

  test('requires a complete positive-safe-integer limit object', () => {
    expectCode(() => decodeCanonicalValue(wire({ tag: 'null' }), { ...limits, maxNodes: 0 }), 'invalid-limits');
    const partial = { ...limits } as Record<string, number>;
    delete partial.maxBytes;
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'null' }), partial as unknown as CanonicalValueLimits),
      'invalid-shape',
    );

    const getTrap = new Proxy(limits, {
      get: () => {
        throw new Error('host get trap');
      },
    });
    expect(decodeCanonicalValue(wire({ tag: 'null' }), getTrap)).toEqual({ tag: 'null' });

    const descriptorTrap = new Proxy(limits, {
      getOwnPropertyDescriptor: () => {
        throw new Error('host descriptor trap');
      },
    });
    expectCode(() => decodeCanonicalValue(wire({ tag: 'null' }), descriptorTrap), 'invalid-shape');

    expectCode(
      () => decodeCanonicalValue('not-bytes' as unknown as Uint8Array, {} as CanonicalValueLimits),
      'invalid-input',
    );
  });

  test('encoder accepts only inspectable plain data', () => {
    class HostValue {
      tag = 'null' as const;
    }
    expectCode(() => encodeCanonicalValue(new HostValue(), limits), 'invalid-shape');

    const getter = Object.defineProperty({}, 'tag', { enumerable: true, get: () => 'null' });
    expectCode(() => encodeCanonicalValue(getter as CanonicalValue, limits), 'invalid-shape');

    const hidden = Object.defineProperty({ tag: 'null' as const }, 'extra', { value: true });
    expectCode(() => encodeCanonicalValue(hidden, limits), 'invalid-shape');

    const sparse = Array<CanonicalValue>(1);
    expectCode(() => encodeCanonicalValue({ tag: 'list', value: sparse }, limits), 'invalid-shape');

    const hugeSparse = Array<CanonicalValue>(4_294_967_295);
    expectCode(
      () =>
        encodeCanonicalValue(
          { tag: 'list', value: hugeSparse },
          { ...limits, maxCollectionLength: Number.MAX_SAFE_INTEGER },
        ),
      'invalid-shape',
    );

    const extended = [{ tag: 'null' } as const] as CanonicalValue[] & { extra?: boolean };
    extended.extra = true;
    expectCode(() => encodeCanonicalValue({ tag: 'list', value: extended }, limits), 'invalid-shape');

    const symbolic = { tag: 'null' } as CanonicalValue & { [key: symbol]: boolean };
    symbolic[Symbol('hidden')] = true;
    expectCode(() => encodeCanonicalValue(symbolic, limits), 'invalid-shape');

    const hostile = new Proxy(
      { tag: 'null' as const },
      {
        ownKeys: () => {
          throw new Error('host trap');
        },
      },
    );
    expectCode(() => encodeCanonicalValue(hostile, limits), 'invalid-shape');

    const arrayGetTrap = new Proxy([{ tag: 'null' } as const], {
      get: () => {
        throw new Error('host array get trap');
      },
    });
    expect(decodeCanonicalValue(encodeCanonicalValue({ tag: 'list', value: arrayGetTrap }, limits), limits)).toEqual({
      tag: 'list',
      value: [{ tag: 'null' }],
    });
  });

  test('deep host values fail with a typed error rather than RangeError', () => {
    let value: CanonicalValue = { tag: 'null' };
    for (let depth = 0; depth < 20_000; depth += 1) value = { tag: 'list', value: [value] };
    expectCode(() => encodeCanonicalValue(value, { ...limits, maxDepth: 30_000, maxNodes: 30_000 }), 'limit-depth');
  });

  test('map ordering uses standalone tagged scalar bytes and preserves scalar type identity', () => {
    const value = { tag: 'null' } as const;
    const map: CanonicalValue = {
      tag: 'map',
      value: [
        { key: { tag: 'decimal', value: '1.0' }, value },
        { key: { tag: 'int', value: '1' }, value },
        { key: { tag: 'null' }, value },
        { key: { tag: 'text', value: '1' }, value },
      ],
    };
    expect(decodeCanonicalValue(encodeCanonicalValue(map, limits), limits)).toEqual(map);
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'map', value: [...map.value].reverse() }), limits),
      'invalid-order',
    );
  });

  test('enforces every configured resource ceiling before return', () => {
    const nullBytes = wire({ tag: 'null' });
    expect(decodeCanonicalValue(nullBytes, withLimit('maxBytes', nullBytes.byteLength))).toEqual({ tag: 'null' });
    expectCode(() => decodeCanonicalValue(nullBytes, withLimit('maxBytes', nullBytes.byteLength - 1)), 'limit-bytes');
    expect(decodeCanonicalValue(nullBytes, withLimit('maxDepth', 2))).toEqual({ tag: 'null' });
    expectCode(() => decodeCanonicalValue(nullBytes, withLimit('maxDepth', 1)), 'limit-depth');
    expectCode(() => encodeCanonicalValue({ tag: 'null' }, withLimit('maxDepth', 1)), 'limit-depth');
    expect(decodeCanonicalValue(nullBytes, withLimit('maxNodes', 1))).toEqual({ tag: 'null' });
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'list', value: [{ tag: 'null' }] }), withLimit('maxNodes', 1)),
      'limit-nodes',
    );
    const formatBytes = encoder.encode(CANONICAL_VALUE_FORMAT).byteLength;
    expect(
      decodeCanonicalValue(
        wire({ tag: 'text', value: 'x'.repeat(formatBytes) }),
        withLimit('maxStringBytes', formatBytes),
      ),
    ).toEqual({ tag: 'text', value: 'x'.repeat(formatBytes) });
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({ tag: 'text', value: 'x'.repeat(formatBytes + 1) }),
          withLimit('maxStringBytes', formatBytes),
        ),
      'limit-string',
    );
    expect(decodeCanonicalValue(wire({ tag: 'text', value: '😀' }), withLimit('maxStringBytes', formatBytes))).toEqual({
      tag: 'text',
      value: '😀',
    });
    expect(
      decodeCanonicalValue(wire({ tag: 'list', value: [{ tag: 'null' }] }), withLimit('maxCollectionLength', 1)),
    ).toEqual({ tag: 'list', value: [{ tag: 'null' }] });
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({ tag: 'list', value: [{ tag: 'null' }, { tag: 'null' }] }),
          withLimit('maxCollectionLength', 1),
        ),
      'limit-collection',
    );
    expect(
      decodeCanonicalValue(
        wire({ tag: 'record', value: [{ key: 'a', value: { tag: 'null' } }] }),
        withLimit('maxRecordFields', 1),
      ),
    ).toEqual({ tag: 'record', value: [{ key: 'a', value: { tag: 'null' } }] });
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({
            tag: 'record',
            value: [
              { key: 'a', value: { tag: 'null' } },
              { key: 'b', value: { tag: 'null' } },
            ],
          }),
          withLimit('maxRecordFields', 1),
        ),
      'limit-record',
    );
    expect(
      decodeCanonicalValue(
        wire({ tag: 'map', value: [{ key: { tag: 'null' }, value: { tag: 'null' } }] }),
        withLimit('maxMapEntries', 1),
      ),
    ).toEqual({ tag: 'map', value: [{ key: { tag: 'null' }, value: { tag: 'null' } }] });
    expectCode(
      () =>
        decodeCanonicalValue(
          wire({
            tag: 'map',
            value: [
              { key: { tag: 'bool', value: false }, value: { tag: 'null' } },
              { key: { tag: 'null' }, value: { tag: 'null' } },
            ],
          }),
          withLimit('maxMapEntries', 1),
        ),
      'limit-map',
    );
    expect(decodeCanonicalValue(wire({ tag: 'int', value: '9' }), withLimit('maxIntegerDigits', 1))).toEqual({
      tag: 'int',
      value: '9',
    });
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'int', value: '10' }), withLimit('maxIntegerDigits', 1)),
      'limit-integer',
    );
    expect(decodeCanonicalValue(wire({ tag: 'decimal', value: '1.0' }), withLimit('maxFractionDigits', 1))).toEqual({
      tag: 'decimal',
      value: '1.0',
    });
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'decimal', value: '1.00' }), withLimit('maxFractionDigits', 1)),
      'limit-decimal',
    );
    expect(decodeCanonicalValue(wire({ tag: 'decimal', value: '1.0' }), withLimit('maxDecimalChars', 3))).toEqual({
      tag: 'decimal',
      value: '1.0',
    });
    expectCode(
      () => decodeCanonicalValue(wire({ tag: 'decimal', value: '10.0' }), withLimit('maxDecimalChars', 3)),
      'limit-decimal',
    );
  });
});
