import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '@kernlang/review';
import type { SecurityScore } from './score.js';

export interface McpReviewResult {
  fileName: string;
  filePath: string;
  findings: ReviewFinding[];
  irNodes: IRNode[];
  lang: 'typescript' | 'python' | null;
  score?: SecurityScore;
}
