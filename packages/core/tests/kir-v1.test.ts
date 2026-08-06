import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { encodeKirEvidence } from '../src/kir-evidence/canonical.js';
import { encodeModuleKir } from '../src/kir-structural/module-canonical.js';
import { decodeKirV1, encodeKirV1, KIR_V1_FORMAT, KirV1Error } from '../src/kir-v1/canonical.js';

const limits: CanonicalValueLimits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
  maxStringBytes: 262_144,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const source = 'fn name=main export=true\n  handler lang=ts\n    let name=result value=null\n';
const sources = [{ moduleId: 'main.kern', source }];

function fixture(): { semanticBytes: Uint8Array; evidenceBytes: Uint8Array } {
  const semanticBytes = encodeModuleKir(
    [
      {
        id: 'main.kern',
        roots: [
          {
            type: 'fn',
            props: { export: true, name: 'main' },
            children: [
              {
                type: 'handler',
                props: { lang: 'ts' },
                children: [{ type: 'let', props: { name: 'result', value: { __expr: true, code: 'null' } } }],
              },
            ],
          },
        ],
      },
    ],
    limits,
  );
  const startByte = Buffer.byteLength(source.slice(0, source.indexOf('null')), 'utf8');
  const evidenceBytes = encodeKirEvidence(
    {
      diagnostics: [
        {
          category: 'validator',
          code: 'null-result',
          id: 'null-result-warning',
          message: 'The result is statically null.',
          moduleId: 'main.kern',
          severity: 'warning',
          spanId: 'null-expression',
        },
      ],
      semanticBytes,
      sources,
      spans: [
        {
          content: 'null',
          endByte: startByte + 4,
          id: 'null-expression',
          moduleId: 'main.kern',
          nodePath: [0, 0, 0],
          propertyKey: 'value',
          startByte,
        },
      ],
    },
    { limits },
  );
  return { evidenceBytes, semanticBytes };
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  assert.equal(value.tag, 'record');
  const result = value.value.find((entry) => entry.key === key)?.value;
  assert.ok(result);
  return result;
}

function componentRecords(value: CanonicalValue): CanonicalValue[] {
  const components = recordField(value, 'components');
  assert.equal(components.tag, 'list');
  return components.value as CanonicalValue[];
}

test('KIR v1 encodes both historical constituents and round-trips byte-identically', () => {
  const input = fixture();
  const bytes = encodeKirV1(input, sources, { limits });
  const decoded = decodeKirV1(bytes, sources, { limits });
  assert.equal(decoded.format, KIR_V1_FORMAT);
  assert.deepEqual(decoded.semanticBytes, input.semanticBytes);
  assert.deepEqual(decoded.evidenceBytes, input.evidenceBytes);
  assert.deepEqual(encodeKirV1(decoded, sources, { limits }), bytes);
});

test('bare Alpha artifact is not a KIR v1 envelope', () => {
  const { semanticBytes } = fixture();
  assert.throws(() => decodeKirV1(semanticBytes, sources, { limits }), KirV1Error);
});

test('retained digest after payload mutation rejects', () => {
  const input = fixture();
  const bytes = encodeKirV1(input, sources, { limits });
  const value = decodeCanonicalValue(bytes, limits);
  const [semantic] = componentRecords(value);
  const payload = recordField(semantic as CanonicalValue, 'payload');
  assert.equal(payload.tag, 'text');
  (payload as { value: string }).value = `${payload.value.slice(0, -2)}00`;
  const mutated = encodeCanonicalValue(value, limits);
  assert.throws(() => decodeKirV1(mutated, sources, { limits }), /digest mismatch/u);
});

test('component reordering and duplication reject', () => {
  const input = fixture();
  const bytes = encodeKirV1(input, sources, { limits });
  for (const mutate of [
    (components: CanonicalValue[]) => components.reverse(),
    (components: CanonicalValue[]) => components.splice(1, 1, structuredClone(components[0]) as CanonicalValue),
  ]) {
    const value = decodeCanonicalValue(bytes, limits);
    const components = recordField(value, 'components');
    assert.equal(components.tag, 'list');
    mutate(components.value as CanonicalValue[]);
    assert.throws(() => decodeKirV1(encodeCanonicalValue(value, limits), sources, { limits }), /components/u);
  }
});

test('component digests authenticate exact decoded payload bytes', () => {
  const input = fixture();
  const decoded = decodeKirV1(encodeKirV1(input, sources, { limits }), sources, { limits });
  assert.equal(decoded.semanticSha256, createHash('sha256').update(input.semanticBytes).digest('hex'));
  assert.equal(decoded.evidenceSha256, createHash('sha256').update(input.evidenceBytes).digest('hex'));
});
