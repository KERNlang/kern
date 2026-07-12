import { decodeKirReaderCandidate, encodeKirReaderCandidate } from '../src/kir-reader-candidate/canonical.js';
import { KIR_READER_CANDIDATE_FORMAT } from '../src/kir-reader-candidate/types.js';

const envelope = {
  format: KIR_READER_CANDIDATE_FORMAT,
  modules: [
    {
      id: 'main.kern',
      imports: [],
      exports: [{ name: 'main', kind: 'fn', source: null }],
      nodes: [
        {
          kind: 'fn',
          location: { start: { line: 1, column: 1 }, end: { line: 3, column: 1 } },
          properties: [{ key: 'name', value: { tag: 'text', value: 'main' } }],
          children: [
            {
              kind: 'handler',
              location: { start: { line: 2, column: 3 }, end: { line: 3, column: 1 } },
              properties: [{ key: 'lang', value: { tag: 'text', value: 'kern' } }],
              children: [],
            },
          ],
        },
      ],
    },
  ],
  diagnostics: [],
} as const;

describe('internal KIR reader candidate', () => {
  test('round-trips canonical bytes without mutating caller data', () => {
    const before = structuredClone(envelope);
    const bytes = encodeKirReaderCandidate(envelope);
    expect(decodeKirReaderCandidate(bytes)).toEqual(envelope);
    expect(envelope).toEqual(before);
    expect(bytes.endsWith('\n')).toBe(true);
  });

  test('fails closed on unknown versions, fields, and unprobed node kinds', () => {
    expect(() => encodeKirReaderCandidate({ ...envelope, format: 'kern.semantic-kir.v1' })).toThrow(
      /unsupported format/u,
    );
    expect(() => encodeKirReaderCandidate({ ...envelope, surprise: true })).toThrow(/expected fields/u);
    const unknownNode = structuredClone(envelope) as unknown as Record<string, unknown>;
    const modules = unknownNode.modules as Array<{ nodes: Array<{ kind: string }> }>;
    modules[0].nodes[0].kind = 'class';
    expect(() => encodeKirReaderCandidate(unknownNode)).toThrow(/unknown probe node kind/u);
  });
});
