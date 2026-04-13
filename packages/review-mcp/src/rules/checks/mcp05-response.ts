/**
 * MCP05: unsanitized-tool-response
 * Tool responses return raw external data that could contain prompt injection.
 * CWE-1427, OWASP MCP05
 */

import type { ReviewFinding } from '@kernlang/review';
import { findToolHandlerRegions } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

export function unsanitizedToolResponseTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');
  if (toolHandlerRegions.length === 0) return findings;

  // External data sources that could contain injection payloads
  const externalDataSources =
    /\b(fetch|axios\.\w+|got\.\w+|db\.query|findOne|findMany|findById|collection\.find|\.findUnique|\.findFirst|readFile|readFileSync|createReadStream)\s*\(/;
  const sanitizeCall = /\bsanitize\w*\s*\(|\bescape\w*\s*\(|\bcleanForPrompt\s*\(|\bstripTags\s*\(/;

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!externalDataSources.test(block)) continue;
    if (sanitizeCall.test(block)) continue; // Has sanitization

    // Find return statements that pass external data
    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];
      if (/\breturn\b/.test(line) || /content:\s*/.test(line)) {
        // Check if the returned value comes from an external source
        const blockAbove = lines.slice(region.start, i + 1).join('\n');
        if (externalDataSources.test(blockAbove) && !sanitizeCall.test(blockAbove)) {
          findings.push(
            finding(
              'mcp-unsanitized-response',
              'warning',
              `MCP tool returns data from external source without sanitization — indirect prompt injection risk`,
              filePath,
              i + 1,
              'Sanitize external data before including in tool responses. External content may contain prompt injection payloads.',
            ),
          );
          break; // One per handler
        }
      }
    }
  }

  return findings;
}

export function unsanitizedToolResponsePython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');
  if (toolHandlerRegions.length === 0) return findings;

  const externalDataSources =
    /\b(requests\.get|requests\.post|httpx\.\w+|aiohttp|cursor\.execute|\.fetchall|\.fetchone|open\s*\()\b/;
  const sanitizeCall = /\bsanitize\w*\s*\(|\bescape\w*\s*\(|\bclean\w*\s*\(/;

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!externalDataSources.test(block)) continue;
    if (sanitizeCall.test(block)) continue;

    for (let i = region.start; i < region.end; i++) {
      if (/\breturn\b/.test(lines[i])) {
        const blockAbove = lines.slice(region.start, i + 1).join('\n');
        if (externalDataSources.test(blockAbove)) {
          findings.push(
            finding(
              'mcp-unsanitized-response',
              'warning',
              `MCP tool returns data from external source without sanitization — indirect prompt injection risk`,
              filePath,
              i + 1,
              'Sanitize external data before returning from tool handlers.',
            ),
          );
          break;
        }
      }
    }
  }

  return findings;
}
