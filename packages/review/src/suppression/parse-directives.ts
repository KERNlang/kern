/**
 * Parse kern-ignore directives from source text.
 *
 * Supported syntax:
 *   // kern-ignore <rule-id>[, <rule-id>...]                            — same or next non-comment line
 *   // kern-ignore <rule-id>[, ...] [reason: false-positive]            — with closed-enum reason
 *   // kern-ignore-file <rule-id>[, <rule-id>...] [reason: wont-fix]    — entire file (first 5 lines)
 *   # kern-ignore <rule-id>[, <rule-id>...] [reason: intentional]       — Python variant
 *
 * Reasons: false-positive | wont-fix | intentional | not-applicable.
 * Anything outside that closed set produces a warning and the directive
 * still suppresses (without a reason). Free text is never honored —
 * parser rejects it to defend against JSON/SARIF injection.
 *
 * Comment lines longer than MAX_DIRECTIVE_LINE_LEN are skipped entirely
 * (ReDoS guard for the directive regex).
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { SUPPRESSION_REASONS, type SuppressionDirective, type SuppressionReason } from './types.js';

/** ReDoS guard — discard absurdly long comment lines before regex matches them. */
const MAX_DIRECTIVE_LINE_LEN = 4096;

/** Known concept rule IDs — these only support file-level suppression */
const CONCEPT_RULE_IDS = new Set([
  'unguarded-effect',
  'unrecovered-effect',
  'ignored-error',
  'boundary-mutation',
  'illegal-dependency',
]);

/**
 * Matches the rule-list portion of a directive — bounded character classes
 * keep the regex linear so a malformed directive can't DoS the parser.
 *
 * Group 1: 'file' if `-file`, else undefined.
 * Group 2: rule IDs (comma-separated word list).
 */
const TS_DIRECTIVE = /\/\/\s*kern-ignore(?:-(file))?\s+([\w-][\w,\-\s]*)/;
const PY_DIRECTIVE = /#\s*kern-ignore(?:-(file))?\s+([\w-][\w,\-\s]*)/;
/**
 * Matches an optional `[reason: <token>]` suffix on a directive line.
 * Token is captured as-is and validated against the closed enum.
 */
const REASON_SUFFIX = /\[\s*reason\s*:\s*([\w-]+)\s*\]/;
/** Matches bare: // kern-ignore (no rule IDs) */
const TS_BARE = /\/\/\s*kern-ignore\s*$/;
const PY_BARE = /#\s*kern-ignore\s*$/;

export function isConceptRule(ruleId: string): boolean {
  return CONCEPT_RULE_IDS.has(ruleId);
}

/**
 * Parse all suppression directives from source text.
 * Returns directives + any warnings (e.g., bare kern-ignore, concept rule on line-level).
 */
export function parseDirectives(
  source: string,
  filePath: string,
): { directives: SuppressionDirective[]; warnings: ReviewFinding[] } {
  const lines = source.split('\n');
  const isPython = filePath.endsWith('.py');
  const directivePattern = isPython ? PY_DIRECTIVE : TS_DIRECTIVE;
  const barePattern = isPython ? PY_BARE : TS_BARE;
  const isCommentLine = isPython
    ? (line: string) => line.trimStart().startsWith('#')
    : (line: string) => line.trimStart().startsWith('//');

  const directives: SuppressionDirective[] = [];
  const warnings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // ReDoS guard: skip absurdly long comment lines before regexes touch them.
    if (line.length > MAX_DIRECTIVE_LINE_LEN) continue;

    // Check for bare kern-ignore (no rule ID) — emit warning
    if (barePattern.test(line)) {
      warnings.push({
        source: 'kern',
        ruleId: 'kern-ignore-bare',
        severity: 'warning',
        category: 'style',
        message: `Bare kern-ignore without rule ID — specify rules: // kern-ignore <rule-id>`,
        primarySpan: { file: filePath, startLine: lineNum, startCol: 1, endLine: lineNum, endCol: line.length },
        fingerprint: createFingerprint('kern-ignore-bare', lineNum, 1),
      });
      continue;
    }

    const match = directivePattern.exec(line);
    if (!match) continue;

    const isFileLevel = match[1] === 'file';
    const ruleIds = match[2]
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    if (ruleIds.length === 0) continue;

    // File-level directives must appear in the first 5 lines
    if (isFileLevel && lineNum > 5) {
      warnings.push({
        source: 'kern',
        ruleId: 'kern-ignore-position',
        severity: 'warning',
        category: 'style',
        message: `kern-ignore-file must appear in the first 5 lines of the file (found at line ${lineNum})`,
        primarySpan: { file: filePath, startLine: lineNum, startCol: 1, endLine: lineNum, endCol: line.length },
        fingerprint: createFingerprint('kern-ignore-position', lineNum, 1),
      });
      continue;
    }

    // Concept rules with line-level suppression — emit warning, suggest file-level
    if (!isFileLevel) {
      const conceptRules = ruleIds.filter(isConceptRule);
      if (conceptRules.length > 0) {
        warnings.push({
          source: 'kern',
          ruleId: 'kern-ignore-concept',
          severity: 'warning',
          category: 'style',
          message: `'${conceptRules.join(', ')}' ${conceptRules.length === 1 ? 'is a' : 'are'} concept rule${conceptRules.length === 1 ? '' : 's'} — use '// kern-ignore-file ${conceptRules.join(', ')}' at the top of the file instead`,
          primarySpan: { file: filePath, startLine: lineNum, startCol: 1, endLine: lineNum, endCol: line.length },
          fingerprint: createFingerprint('kern-ignore-concept', lineNum, 1),
        });
        // Still process non-concept rules on this line
        const nonConcept = ruleIds.filter((r) => !isConceptRule(r));
        if (nonConcept.length === 0) continue;
        // Fall through with non-concept rules only
        ruleIds.length = 0;
        ruleIds.push(...nonConcept);
      }
    }

    // Parse optional `[reason: <enum>]` suffix once, used for either type.
    const reason = parseReasonOrWarn(line, filePath, lineNum, warnings);

    if (isFileLevel) {
      directives.push({
        type: 'file',
        ruleIds,
        file: filePath,
        source: 'inline',
        commentLine: lineNum,
        ...(reason ? { reason } : {}),
      });
    } else {
      // Same-line: check if the directive is on a line with actual code
      // If the line is comment-only, it applies to the next non-comment, non-blank line
      const trimmed = line.trimStart();
      const isCommentOnly = isPython
        ? trimmed.startsWith('#') && !trimmed.replace(/#.*/, '').trim()
        : trimmed.startsWith('//');

      let targetLine: number;
      if (isCommentOnly) {
        // Find next non-comment, non-blank line
        targetLine = lineNum; // fallback
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine === '') continue;
          if (isCommentLine(nextLine)) continue;
          targetLine = j + 1;
          break;
        }
      } else {
        // Inline comment on same line as code — suppress this line
        targetLine = lineNum;
      }

      directives.push({
        type: 'line',
        ruleIds,
        file: filePath,
        line: targetLine,
        source: 'inline',
        commentLine: lineNum,
        ...(reason ? { reason } : {}),
      });
    }
  }

  return { directives, warnings };
}

/**
 * Extract the closed-enum reason from a directive line. If a reason suffix is
 * present but the value is not in SUPPRESSION_REASONS, push a warning and
 * return undefined — the directive still suppresses, but no telemetry credit
 * is awarded for an unknown reason. Defends against free-text values landing
 * in JSON/SARIF output.
 */
function parseReasonOrWarn(
  line: string,
  filePath: string,
  lineNum: number,
  warnings: ReviewFinding[],
): SuppressionReason | undefined {
  const m = REASON_SUFFIX.exec(line);
  if (!m) return undefined;
  const candidate = m[1];
  if ((SUPPRESSION_REASONS as readonly string[]).includes(candidate)) {
    return candidate as SuppressionReason;
  }
  warnings.push({
    source: 'kern',
    ruleId: 'kern-ignore-reason',
    severity: 'warning',
    category: 'style',
    message: `Unknown suppression reason '${candidate}' — must be one of ${SUPPRESSION_REASONS.join(', ')}`,
    primarySpan: { file: filePath, startLine: lineNum, startCol: 1, endLine: lineNum, endCol: line.length },
    fingerprint: createFingerprint('kern-ignore-reason', lineNum, 1),
  });
  return undefined;
}

/**
 * Create config-level suppression directives from disabledRules.
 * These apply to all files (file field is '*').
 */
export function configDirectives(disabledRules: string[]): SuppressionDirective[] {
  if (disabledRules.length === 0) return [];
  return [
    {
      type: 'file',
      ruleIds: disabledRules,
      file: '*',
      source: 'config',
    },
  ];
}
