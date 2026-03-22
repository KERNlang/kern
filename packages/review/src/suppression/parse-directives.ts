/**
 * Parse kern-ignore directives from source text.
 *
 * Supported syntax:
 *   // kern-ignore <rule-id>[, <rule-id>...]       — suppress on same or next non-comment line
 *   // kern-ignore-file <rule-id>[, <rule-id>...]   — suppress for entire file (first 5 lines)
 *   # kern-ignore <rule-id>[, <rule-id>...]         — Python variant
 *   # kern-ignore-file <rule-id>[, <rule-id>...]    — Python variant
 */

import type { SuppressionDirective } from './types.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

/** Known concept rule IDs — these only support file-level suppression */
const CONCEPT_RULE_IDS = new Set([
  'unguarded-effect',
  'unrecovered-effect',
  'ignored-error',
  'boundary-mutation',
  'illegal-dependency',
]);

/** Matches: // kern-ignore[-file] rule1, rule2 */
const TS_DIRECTIVE = /\/\/\s*kern-ignore(?:-(file))?\s+([\w-][\w,-\s]*)/;
/** Matches: # kern-ignore[-file] rule1, rule2 */
const PY_DIRECTIVE = /#\s*kern-ignore(?:-(file))?\s+([\w-][\w,-\s]*)/;
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
    const ruleIds = match[2].split(',').map(r => r.trim()).filter(Boolean);

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
        const nonConcept = ruleIds.filter(r => !isConceptRule(r));
        if (nonConcept.length === 0) continue;
        // Fall through with non-concept rules only
        ruleIds.length = 0;
        ruleIds.push(...nonConcept);
      }
    }

    if (isFileLevel) {
      directives.push({
        type: 'file',
        ruleIds,
        file: filePath,
        source: 'inline',
        commentLine: lineNum,
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
      });
    }
  }

  return { directives, warnings };
}

/**
 * Create config-level suppression directives from disabledRules.
 * These apply to all files (file field is '*').
 */
export function configDirectives(disabledRules: string[]): SuppressionDirective[] {
  if (disabledRules.length === 0) return [];
  return [{
    type: 'file',
    ruleIds: disabledRules,
    file: '*',
    source: 'config',
  }];
}
