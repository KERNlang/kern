/**
 * MCP02: path-traversal-tool
 * File system operations with unvalidated paths from tool parameters.
 * CWE-22, OWASP MCP03
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { findLines, getSurroundingBlock } from '../mcp-lexical.js';
import { TS_FS_OPS, PY_FS_OPS, TS_PATH_SANITIZE, PY_PATH_SANITIZE } from '../mcp-patterns.js';
import { findToolHandlerRegions, isMCPServerTS } from '../mcp-regions.js';

export function pathTraversalTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!TS_FS_OPS.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!TS_FS_OPS.test(block)) continue;

    // Check if path sanitization is present in the handler
    const hasSanitize = TS_PATH_SANITIZE.test(block);
    // Check for containment validation (startsWith check after resolve — with or without path. prefix)
    const hasContainment = /\.startsWith\s*\(/.test(block) && /\b(path\.)?resolve\s*\(/.test(block);

    if (!hasContainment) {
      for (let i = region.start; i < region.end; i++) {
        if (TS_FS_OPS.test(lines[i])) {
          findings.push(finding(
            'mcp-path-traversal', hasSanitize ? 'warning' : 'error',
            `File system operation in MCP tool handler without path containment check — path traversal risk`,
            filePath, i + 1,
            'Resolve the path with path.resolve() then verify it startsWith() the allowed base directory. Reject paths containing "..".',
          ));
        }
      }
    }
  }

  // Fallback: check in general MCP server context
  if (toolHandlerRegions.length === 0 && isMCPServerTS(source)) {
    for (const lineNum of findLines(source, TS_FS_OPS)) {
      const block = getSurroundingBlock(lines, lineNum - 1);
      const hasContainment = /\.startsWith\s*\(/.test(block) && /path\.resolve/.test(block);
      if (!hasContainment) {
        findings.push(finding(
          'mcp-path-traversal', 'warning',
          `File system operation in MCP server without path containment validation`,
          filePath, lineNum,
          'Use path.resolve() + startsWith() to ensure paths stay within the allowed directory.',
        ));
      }
    }
  }

  return findings;
}

export function pathTraversalPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!PY_FS_OPS.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!PY_FS_OPS.test(block)) continue;

    const hasSanitize = PY_PATH_SANITIZE.test(block);
    const hasContainment = /\.startswith\s*\(/.test(block) && /(os\.path\.realpath|\.resolve\(\))/.test(block);

    if (!hasContainment) {
      for (let i = region.start; i < region.end; i++) {
        if (PY_FS_OPS.test(lines[i])) {
          findings.push(finding(
            'mcp-path-traversal', hasSanitize ? 'warning' : 'error',
            `File system operation in MCP tool handler without path containment check — path traversal risk`,
            filePath, i + 1,
            'Use os.path.realpath() then verify the path startswith() the allowed base directory.',
          ));
        }
      }
    }
  }

  return findings;
}
