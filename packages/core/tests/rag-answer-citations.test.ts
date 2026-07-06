import { inferRagAnswerGroundingSpansFromInlineCitations } from '../src/index.js';

const chunks = [{ id: 'chunk-a' }, { id: 'chunk-b' }, { id: 'chunk-c' }] as const;

describe('inferRagAnswerGroundingSpansFromInlineCitations', () => {
  test('returns no spans for empty answers or answers without citation markers', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('', chunks)).toEqual([]);
    expect(inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt.', chunks)).toEqual([]);
  });

  test('converts inline citation markers into required grounding spans', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [1]', chunks)).toEqual([
      { start: 0, end: 26, chunkIds: ['chunk-a'], required: true },
    ]);
  });

  test('keeps combined citations unique and ordered by marker body', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [2, 1, 2]', chunks)).toEqual([
      { start: 0, end: 26, chunkIds: ['chunk-b', 'chunk-a'], required: true },
    ]);
  });

  test('deduplicates repeated chunk ids in one marker', () => {
    const duplicateIdChunks = [{ id: 'same' }, { id: 'same' }] as const;

    expect(
      inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [1, 2]', duplicateIdChunks),
    ).toEqual([{ start: 0, end: 26, chunkIds: ['same'], required: true }]);
  });

  test('creates separate spans for separate cited claims', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('First [1]. Second [2]', chunks)).toEqual([
      { start: 0, end: 5, chunkIds: ['chunk-a'], required: true },
      { start: 11, end: 17, chunkIds: ['chunk-b'], required: true },
    ]);
  });

  test('merges adjacent citation markers into the previous claim', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [1], [2]', chunks)).toEqual([
      { start: 0, end: 26, chunkIds: ['chunk-a', 'chunk-b'], required: true },
    ]);
  });

  test('does not merge newline-separated cited claims', () => {
    expect(inferRagAnswerGroundingSpansFromInlineCitations('First claim [1]\nSecond claim [2]', chunks)).toEqual([
      { start: 0, end: 11, chunkIds: ['chunk-a'], required: true },
      { start: 16, end: 28, chunkIds: ['chunk-b'], required: true },
    ]);
  });

  test('rejects citations without preceding claim text', () => {
    expect(() => inferRagAnswerGroundingSpansFromInlineCitations('[1] Refunds require a receipt.', chunks)).toThrow(
      /must follow non-empty answer text/u,
    );
  });

  test('rejects citations outside the retrieved chunk range', () => {
    expect(() => inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [4]', chunks)).toThrow(
      /between 1 and 3/u,
    );
  });

  test('uses the caller error prefix for invalid citation numbers', () => {
    expect(() =>
      inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [0]', chunks, {
        errorPrefix: 'Custom citation',
      }),
    ).toThrow(/Custom citation at offset 27/u);
  });

  test('rejects citation markers when no retrieved chunks are available', () => {
    expect(() => inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [1]', [])).toThrow(
      /between 1 and 0/u,
    );
  });

  test('supports multi-digit citation numbers', () => {
    const manyChunks = Array.from({ length: 10 }, (_, index) => ({ id: `chunk-${index + 1}` }));

    expect(inferRagAnswerGroundingSpansFromInlineCitations('Refunds require a receipt. [10]', manyChunks)).toEqual([
      { start: 0, end: 26, chunkIds: ['chunk-10'], required: true },
    ]);
  });
});
