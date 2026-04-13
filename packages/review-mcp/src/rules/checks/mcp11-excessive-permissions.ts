/**
 * MCP11: excessive-permissions
 * Tools that perform 3+ different dangerous effect types without enough guards.
 * Signals an overly-broad tool that should be split.
 * CWE-250 (Execution with Unnecessary Privileges)
 */

import type { ReviewFinding } from '@kernlang/review';
import { findToolHandlerRegions, isMCPServer } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

export function excessivePermissions(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!isMCPServer(source, filePath)) return findings;

  const isPython = filePath.endsWith('.py');
  const lines = source.split('\n');
  const regions = findToolHandlerRegions(lines, isPython ? 'python' : 'typescript');

  const fsPatterns = isPython
    ? /\b(open\s*\(|os\.(remove|unlink|rename|mkdir|listdir)|shutil\.|pathlib\.)/
    : /\b(readFile|writeFile|mkdir|unlink|readdir|createReadStream|createWriteStream)/;
  const shellPatterns = isPython
    ? /\b(subprocess|os\.system|os\.popen)/
    : /\b(execSync|execFile|spawn|spawnSync|child_process)/;
  const netPatterns = isPython
    ? /\b(requests\.|httpx\.|aiohttp\.|urllib\.request)/
    : /\b(fetch\s*\(|http\.request|https\.request|axios)/;
  const dbPatterns = isPython
    ? /\b(cursor\.(execute|fetchall)|\.query\s*\(|\.execute\s*\()/
    : /\b(\.query\s*\(|\.execute\s*\(|\.run\s*\()/;

  for (const region of regions) {
    const code = lines.slice(region.start, region.end).join('\n');
    const effectCount = [fsPatterns, shellPatterns, netPatterns, dbPatterns].filter((p) => p.test(code)).length;

    if (effectCount >= 3) {
      findings.push(
        finding(
          'mcp-excessive-permissions',
          'warning',
          `Tool handler has ${effectCount} different effect types (file, shell, network, database) — consider splitting into smaller, focused tools`,
          filePath,
          region.start + 1,
          'Each tool should have a single responsibility. Split broad tools into focused ones with appropriate guards for each.',
        ),
      );
    }
  }
  return findings;
}
