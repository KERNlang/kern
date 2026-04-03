/**
 * MCP09: data-level-injection
 * Hidden instructions embedded in string literals (not just tool descriptions).
 * Catches indirect prompt injection via document/response data.
 * CWE-1427, OWASP MCP02
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { DATA_INJECTION_PATTERNS } from '../mcp-patterns.js';
import { isMCPServer } from '../mcp-regions.js';

export function dataLevelInjection(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (!isMCPServer(source, filePath)) return findings;

  const lines = source.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track block comments (TS: /* */, Python: """ """)
    if (/^\s*\/\*/.test(line) && !/\*\//.test(line)) { inBlockComment = true; continue; }
    if (/\*\//.test(line)) { inBlockComment = false; continue; }
    if (inBlockComment) continue;

    // Skip single-line comments
    if (/^\s*(\/\/|#|\*)/.test(trimmed)) continue;

    // Skip import/require lines
    if (/^\s*(import|from|require)\b/.test(trimmed)) continue;

    for (const { pattern, label } of DATA_INJECTION_PATTERNS) {
      if (pattern.test(line)) {
        findings.push(finding(
          'mcp-data-injection', 'warning',
          `String literal contains injection marker "${label}" — possible data-level prompt injection`,
          filePath, i + 1,
          'Remove injection markers from data. If this is test code, use kern-ignore to suppress.',
        ));
        break; // One finding per line
      }
    }
  }

  return findings;
}
