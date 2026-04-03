/**
 * MCP12: resource-exhaustion
 * Network/database calls without timeout or AbortController.
 * An unresponsive external service can block the MCP server indefinitely.
 * CWE-400 (Uncontrolled Resource Consumption)
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { isMCPServer, findToolHandlerRegions } from '../mcp-regions.js';

export function resourceExhaustion(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!isMCPServer(source, filePath)) return findings;

  const isPython = filePath.endsWith('.py');
  const lines = source.split('\n');
  const regions = findToolHandlerRegions(lines, isPython ? 'python' : 'typescript');

  for (const region of regions) {
    const code = lines.slice(region.start, region.end).join('\n');
    const startLine = region.start + 1;

    if (isPython) {
      if (/\b(requests\.(get|post|put|delete|patch|head)\s*\(|httpx\.\w+\s*\()/.test(code) && !/timeout\s*=/.test(code)) {
        findings.push(finding(
          'mcp-resource-exhaustion', 'warning',
          'Network request without timeout — can block MCP server indefinitely',
          filePath, startLine,
          'Add timeout= parameter: requests.get(url, timeout=30)',
        ));
      }
      if (/\b(cursor\.(execute|fetchall)|\.execute\s*\()/.test(code) && !/timeout|statement_timeout|connect_timeout/.test(code)) {
        findings.push(finding(
          'mcp-resource-exhaustion', 'info',
          'Database operation without explicit timeout — long queries can stall the server',
          filePath, startLine,
          'Set connection or statement timeout in your database client configuration',
        ));
      }
    } else {
      if (/\bfetch\s*\(/.test(code) && !/AbortController|signal\s*:|timeout/.test(code)) {
        findings.push(finding(
          'mcp-resource-exhaustion', 'warning',
          'fetch() without AbortController or timeout — can block MCP server indefinitely',
          filePath, startLine,
          'Use AbortController with setTimeout: const controller = new AbortController(); setTimeout(() => controller.abort(), 30000);',
        ));
      }
      if (/\bhttps?\.request\s*\(/.test(code) && !/\.setTimeout\s*\(|timeout\s*:/.test(code)) {
        findings.push(finding(
          'mcp-resource-exhaustion', 'warning',
          'HTTP request without timeout — can block MCP server indefinitely',
          filePath, startLine,
          'Add req.setTimeout(30000) or pass timeout in options',
        ));
      }
    }
  }
  return findings;
}
