/**
 * Apply suppression directives to findings.
 * Runs after sortAndDedup(), before checkEnforcement().
 */

import type { ReviewConfig, ReviewFinding } from '../types.js';
import { configDirectives, parseDirectives } from './parse-directives.js';
import type { StrictMode, SuppressionDirective, SuppressionResult } from './types.js';

function isSuppressed(finding: ReviewFinding, directive: SuppressionDirective): boolean {
  // Rule ID must match
  if (!directive.ruleIds.includes(finding.ruleId)) return false;

  // Config-level directives (file='*') apply to all files
  if (directive.file === '*') return true;

  // File must match
  if (directive.file !== finding.primarySpan.file) return false;

  // File-level: suppress all matching rules in file
  if (directive.type === 'file') return true;

  // Line-level: finding must be on the directive's target line
  return finding.primarySpan.startLine === directive.line;
}

/**
 * Apply all suppression directives to a set of findings.
 *
 * @param findings - Deduplicated, sorted findings from the pipeline
 * @param source - Source text of the file (for parsing inline directives)
 * @param filePath - File path
 * @param config - ReviewConfig (for disabledRules)
 * @param strict - CI strict mode: false = respect all, 'inline' = ignore inline, 'all' = ignore everything
 */
export function applySuppression(
  findings: ReviewFinding[],
  source: string,
  filePath: string,
  config?: ReviewConfig,
  strict: StrictMode = false,
): SuppressionResult {
  // Parse inline directives from source
  const { directives: inlineDirectives, warnings } = parseDirectives(source, filePath);

  // Build config-level directives
  const cfgDirectives = configDirectives(config?.disabledRules ?? []);

  // Determine which directives are active based on strict mode
  let activeDirectives: SuppressionDirective[];
  if (strict === 'all') {
    activeDirectives = [];
  } else if (strict === 'inline') {
    // Only config-level directives are active
    activeDirectives = cfgDirectives;
  } else {
    activeDirectives = [...inlineDirectives, ...cfgDirectives];
  }

  const allDirectives = [...inlineDirectives, ...cfgDirectives];

  // Track which directives matched at least one finding
  const matchedDirectives = new Set<SuppressionDirective>();

  const passed: ReviewFinding[] = [];
  const suppressed: ReviewFinding[] = [];

  for (const finding of findings) {
    const matchingDirective = activeDirectives.find((d) => isSuppressed(finding, d));
    if (matchingDirective) {
      matchedDirectives.add(matchingDirective);
      suppressed.push(finding);
    } else {
      passed.push(finding);
    }
  }

  // Find unused inline directives (config-level ones are intentionally exempt)
  const unusedDirectives = inlineDirectives.filter((d) => !matchedDirectives.has(d));

  // Add warnings from parsing + unused directive warnings
  const allWarnings = [...warnings];
  // Only report unused directives when not in strict mode (in strict, inline directives are intentionally ignored)
  if (!strict) {
    for (const d of unusedDirectives) {
      allWarnings.push({
        source: 'kern',
        ruleId: 'kern-ignore-unused',
        severity: 'warning',
        category: 'style',
        message: `Unused kern-ignore for '${d.ruleIds.join(', ')}' — no matching findings`,
        primarySpan: {
          file: d.file,
          startLine: d.commentLine ?? 1,
          startCol: 1,
          endLine: d.commentLine ?? 1,
          endCol: 1,
        },
        fingerprint: `unused-${d.commentLine}-${d.ruleIds.join(',')}`,
      });
    }
  }

  return {
    findings: [...passed, ...allWarnings],
    suppressed,
    directives: allDirectives,
    unusedDirectives,
  };
}
