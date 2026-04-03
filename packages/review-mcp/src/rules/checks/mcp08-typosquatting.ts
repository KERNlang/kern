/**
 * MCP08: namespace-typosquatting
 * Suspicious package names that look like typosquats of popular MCP packages.
 * OWASP MCP06
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { KNOWN_MCP_PACKAGES } from '../mcp-patterns.js';

export function namespaceTyposquatting(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Collect candidate names from multiple sources
  const candidates: { name: string; source: string }[] = [];

  // Source 1: package.json "name" field
  const packageNameMatch = source.match(/"name"\s*:\s*"([^"]+)"/);
  if (packageNameMatch) {
    candidates.push({ name: packageNameMatch[1], source: 'package.json' });
  }

  // Source 2: TS constructor — new Server({name: "..."}) or new McpServer({name: "..."})
  const tsConstructorMatch = source.match(/new\s+(?:Mcp)?Server\s*\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/);
  if (tsConstructorMatch) {
    candidates.push({ name: tsConstructorMatch[1], source: 'constructor' });
  }

  // Source 3: Python constructor — FastMCP("...") or Server("...")
  const pyConstructorMatch = source.match(/(?:FastMCP|Server)\s*\(\s*['"]([^'"]+)['"]/);
  if (pyConstructorMatch) {
    candidates.push({ name: pyConstructorMatch[1], source: 'constructor' });
  }

  if (candidates.length === 0) return findings;

  for (const candidate of candidates) {
    // Strip scope prefix and parenthetical suffixes like " (typosquatted)"
    const cleanName = candidate.name
      .replace(/^@[^/]+\//, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .trim();

    for (const known of KNOWN_MCP_PACKAGES) {
      if (cleanName === known) continue;
      const distance = levenshtein(cleanName, known);
      const maxLen = Math.max(cleanName.length, known.length);

      if (distance > 0 && distance <= 2 && maxLen > 5) {
        const lineNum = lines.findIndex(l => l.includes(candidate.name)) + 1;
        findings.push(finding(
          'mcp-typosquatting', 'warning',
          `Server name "${cleanName}" is suspiciously similar to known MCP server "${known}" (edit distance: ${distance}) — potential typosquatting`,
          filePath, lineNum || 1,
          `Verify this is the intended name. Known server is "${known}".`,
        ));
        break; // One finding per candidate is enough
      }
    }
  }

  return findings;
}

// ── Levenshtein distance ─────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
