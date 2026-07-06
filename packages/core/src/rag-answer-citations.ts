import type { RagAnswerGroundingSpan } from './rag-runtime.js';

export interface RagInlineCitationChunk {
  readonly id: string;
}

export interface RagInlineCitationGroundingOptions {
  readonly errorPrefix?: string;
}

export function inferRagAnswerGroundingSpansFromInlineCitations(
  answer: string,
  chunks: readonly RagInlineCitationChunk[],
  options: RagInlineCitationGroundingOptions = {},
): readonly RagAnswerGroundingSpan[] {
  const inlineCitationMarker = /\[(\d+(?:\s*,\s*\d+)*)\]/gu;
  const errorPrefix = options.errorPrefix ?? 'RAG answer citation';
  const spans: RagAnswerGroundingSpan[] = [];
  let claimStart = 0;
  for (const match of answer.matchAll(inlineCitationMarker)) {
    if (match.index === undefined) {
      throw new Error(`${errorPrefix} match is missing an offset.`);
    }
    const markerStart = match.index;
    const markerEnd = markerStart + match[0].length;
    const chunkIds = inlineCitationChunkIds(match[1] ?? '', markerStart, chunks, errorPrefix);
    if (chunkIds.length === 0) {
      throw new Error(`${errorPrefix} at offset ${markerStart} must reference at least one retrieved chunk.`);
    }
    const previous = spans.at(-1);
    if (previous && isCitationContinuation(answer.slice(claimStart, markerStart))) {
      spans[spans.length - 1] = { ...previous, chunkIds: uniqueChunkIds([...previous.chunkIds, ...chunkIds]) };
      claimStart = markerEnd;
      continue;
    }
    const start = skipCitationClaimPrefix(answer, claimStart, markerStart);
    if (start >= markerStart) {
      throw new Error(`${errorPrefix} at offset ${markerStart} must follow non-empty answer text.`);
    }
    const end = trimCitationClaimEnd(answer, start, markerStart);
    if (end <= start) {
      claimStart = markerEnd;
      continue;
    }
    spans.push({
      start,
      end,
      chunkIds,
      required: true,
    });
    claimStart = markerEnd;
  }
  return spans;
}

function isCitationContinuation(value: string): boolean {
  return /^[ \t.,;:!?]*$/u.test(value);
}

function trimCitationClaimEnd(answer: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/u.test(answer[index - 1] ?? '')) index -= 1;
  return index;
}

function skipCitationClaimPrefix(answer: string, start: number, end: number): number {
  let index = start;
  while (index < end && /[\s.!?]/u.test(answer[index] ?? '')) index += 1;
  return index;
}

function uniqueChunkIds(chunkIds: readonly string[]): readonly string[] {
  return [...new Set(chunkIds)];
}

function inlineCitationChunkIds(
  markerBody: string,
  markerStart: number,
  chunks: readonly RagInlineCitationChunk[],
  errorPrefix: string,
): readonly string[] {
  const chunkIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of markerBody.split(',')) {
    const citationNumber = Number(raw.trim());
    if (!Number.isInteger(citationNumber) || citationNumber < 1 || citationNumber > chunks.length) {
      throw new Error(
        `${errorPrefix} at offset ${markerStart} must reference a retrieved chunk number between 1 and ${chunks.length}.`,
      );
    }
    const chunk = chunks[citationNumber - 1];
    if (chunk && !seen.has(chunk.id)) {
      seen.add(chunk.id);
      chunkIds.push(chunk.id);
    }
  }
  return chunkIds;
}
