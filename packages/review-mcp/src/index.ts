/**
 * @kernlang/review-mcp — MCP server security scanner.
 *
 * Static analysis for Model Context Protocol server implementations.
 * Detects 9 vulnerability classes mapped to OWASP MCP Top 10.
 *
 * Supports TypeScript and Python MCP servers.
 *
 * Usage:
 *   import { reviewMCPSource, detectMCPServer } from '@kernlang/review-mcp';
 *
 *   // Auto-detect + scan
 *   if (detectMCPServer(source, filePath)) {
 *     const findings = reviewMCPSource(source, filePath);
 *   }
 *
 *   // Or via CLI: kern review --mcp server.ts
 */

import type { ReviewFinding } from '@kernlang/review';
import { detectMCPServer } from './detect.js';
import { runMCPSecurityRules, MCP_RULE_IDS } from './rules/mcp-security.js';

export { detectMCPServer } from './detect.js';
export { runMCPSecurityRules, MCP_RULE_IDS } from './rules/mcp-security.js';
export type { ReviewFinding } from '@kernlang/review';

/**
 * Review an MCP server source file for security vulnerabilities.
 * Returns findings for all 8 MCP security rules.
 */
export function reviewMCPSource(source: string, filePath: string): ReviewFinding[] {
  return runMCPSecurityRules(source, filePath);
}

/**
 * Check if a file is an MCP server and review it if so.
 * Returns null if the file is not an MCP server.
 */
export function reviewIfMCP(source: string, filePath: string): ReviewFinding[] | null {
  const lang = detectMCPServer(source, filePath);
  if (!lang) return null;
  return runMCPSecurityRules(source, filePath);
}
