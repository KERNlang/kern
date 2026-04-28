/**
 * Types for the review suppression system.
 */

import type { ReviewFinding } from '../types.js';

/**
 * Closed enum for why a suppression was added. Free-text would be a JSON/SARIF
 * injection sink (red-team finding) and impossible to aggregate. Anything not
 * in this set is rejected at parse time with a warning.
 */
export type SuppressionReason = 'false-positive' | 'wont-fix' | 'intentional' | 'not-applicable';

export const SUPPRESSION_REASONS: readonly SuppressionReason[] = [
  'false-positive',
  'wont-fix',
  'intentional',
  'not-applicable',
];

/** A parsed suppression directive from source comments or config */
export interface SuppressionDirective {
  /** 'line' = suppress on a specific line, 'file' = suppress entire file */
  type: 'line' | 'file';
  /** Rule IDs to suppress (always explicit — no blanket suppression) */
  ruleIds: string[];
  /** File this directive applies to */
  file: string;
  /** Target line (for 'line' type — the line whose findings are suppressed) */
  line?: number;
  /** Where this directive came from */
  source: 'inline' | 'config';
  /** The raw line number where the comment was found (for unused-directive warnings) */
  commentLine?: number;
  /** Why this rule was suppressed. Closed enum; free text is rejected. */
  reason?: SuppressionReason;
}

/** Result of applying suppression to a set of findings */
export interface SuppressionResult {
  /** Findings that passed (not suppressed) */
  findings: ReviewFinding[];
  /** Findings that were suppressed */
  suppressed: ReviewFinding[];
  /** All parsed directives */
  directives: SuppressionDirective[];
  /** Directives that matched no findings (potential stale comments) */
  unusedDirectives: SuppressionDirective[];
}

/** Strict mode levels for CI */
export type StrictMode = false | 'inline' | 'all';
