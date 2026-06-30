import { type RetrievedChunk, synthesizeRagAnswer } from '../src/index.js';

const chunks: readonly RetrievedChunk[] = [
  {
    id: 'refunds',
    text: 'Refunds are available within thirty days',
    score: 0.98,
    source: 'corpus/refunds.md',
    citation: { uri: 'corpus/refunds.md' },
  },
];

describe('synthesizeRagAnswer', () => {
  test('generates a prompt, infers inline citations, and returns a grounded answer report', async () => {
    const prompts: string[] = [];

    const result = await synthesizeRagAnswer({
      query: 'refund policy',
      chunks,
      requireCitations: true,
      minCitedChunks: 1,
      minGroundingCoverage: 0.85,
      complete(prompt) {
        prompts.push(prompt);
        return 'Refunds are available within thirty days [1]';
      },
    });

    expect(prompts[0]).toContain('Question: refund policy');
    expect(prompts[0]).toContain('Refunds are available within thirty days');
    expect(result).toEqual(
      expect.objectContaining({
        answer: 'Refunds are available within thirty days [1]',
        passed: true,
        status: 'grounded',
        citedChunkIds: ['refunds'],
        sources: ['corpus/refunds.md'],
      }),
    );
    expect(result.groundingSpans).toEqual([{ start: 0, end: 40, chunkIds: ['refunds'], required: true }]);
  });

  test('returns failed grounding diagnostics for unsupported generated answers', async () => {
    const result = await synthesizeRagAnswer({
      query: 'refund policy',
      chunks,
      requireCitations: true,
      minCitedChunks: 1,
      minGroundingCoverage: 0.85,
      complete() {
        return 'Unsupported refund details [1]';
      },
    });

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SPAN_TEXT_UNSUPPORTED' })]),
    );
  });

  test('checks grounding against prompt-visible truncated chunk text', async () => {
    const hiddenTailChunks: readonly RetrievedChunk[] = [
      {
        ...chunks[0],
        text: `Refunds are available.\n${'padding '.repeat(40)}Manager approval is required.`,
      },
    ];

    const result = await synthesizeRagAnswer({
      query: 'refund policy',
      chunks: hiddenTailChunks,
      maxContextChars: 120,
      requireCitations: true,
      minCitedChunks: 1,
      minGroundingCoverage: 0.85,
      complete() {
        return 'Manager approval is required [1]';
      },
    });

    expect(result.context.truncated).toBe(true);
    expect(result.context.text).not.toContain('Manager approval is required');
    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SPAN_TEXT_UNSUPPORTED' })]),
    );
  });

  test('infers inline citations even when grounding thresholds are omitted', async () => {
    const result = await synthesizeRagAnswer({
      query: 'refund policy',
      chunks,
      complete() {
        return 'Refunds are available within thirty days [1]';
      },
    });

    expect(result).toEqual(expect.objectContaining({ passed: true, status: 'grounded', citedChunkIds: ['refunds'] }));
  });

  test('fails closed for empty generated answers and malformed retrieval input', async () => {
    await expect(
      synthesizeRagAnswer({
        query: 'refund policy',
        chunks,
        complete() {
          return ' ';
        },
      }),
    ).rejects.toThrow(/completion must be a non-empty string/u);

    await expect(
      synthesizeRagAnswer({
        query: 'refund policy',
        chunks: [],
        complete() {
          return 'answer';
        },
      }),
    ).rejects.toThrow(/at least one retrieved chunk/u);

    await expect(
      synthesizeRagAnswer({
        query: 'refund policy',
        chunks: [{ id: 'bad' } as unknown as RetrievedChunk],
        complete() {
          return 'answer';
        },
      }),
    ).rejects.toThrow(/RetrievedChunk|non-empty/u);
  });
});
