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
import type { IRNode } from '@kernlang/core';
import { detectMCPServer } from './detect.js';
import { runMCPSecurityRules, MCP_RULE_IDS } from './rules/mcp-security.js';
import { inferMCPNodes, inferMCPNodesPython } from './infer-mcp.js';

export { detectMCPServer } from './detect.js';
export { runMCPSecurityRules, MCP_RULE_IDS } from './rules/mcp-security.js';
export { inferMCPNodes, inferMCPNodesPython } from './infer-mcp.js';
export type { ReviewFinding } from '@kernlang/review';

/**
 * Review an MCP server source file for security vulnerabilities.
 * Combines regex-based rules with KERN IR structural analysis.
 */
export function reviewMCPSource(source: string, filePath: string): ReviewFinding[] {
  // Phase 1: Regex-based rules (fast, pattern matching)
  const findings = runMCPSecurityRules(source, filePath);

  // Phase 2: KERN IR inference — translate to IR and check structure
  try {
    const isPython = filePath.endsWith('.py');
    const irNodes = isPython
      ? inferMCPNodesPython(source, filePath)
      : inferMCPNodes(source, filePath);

    if (irNodes.length > 0) {
      findings.push(...irToFindings(irNodes, filePath));
    }
  } catch {
    // IR inference is best-effort — regex rules always run
  }

  return findings;
}

/**
 * Check if a file is an MCP server and review it if so.
 * Returns null if the file is not an MCP server.
 */
export function reviewIfMCP(source: string, filePath: string): ReviewFinding[] | null {
  const lang = detectMCPServer(source, filePath);
  if (!lang) return null;
  return reviewMCPSource(source, filePath);
}

/**
 * Infer KERN IR nodes from an MCP server file.
 * Returns the IR tree for inspection/display.
 */
export function inferMCP(source: string, filePath: string): IRNode[] {
  const isPython = filePath.endsWith('.py');
  return isPython ? inferMCPNodesPython(source, filePath) : inferMCPNodes(source, filePath);
}

// ── IR → Findings conversion ─────────────────────────────────────────

/** Convert KERN IR action nodes to security findings */
function irToFindings(nodes: IRNode[], filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const action of nodes) {
    if (action.type !== 'action') continue;
    const children = action.children ?? [];
    const effects = children.filter(c => c.type === 'effect');
    const guards = children.filter(c => c.type === 'guard');
    const name = (action.props?.name as string) || 'unknown';
    const confidence = (action.props?.confidence as number) ?? 0.5;

    // Unguarded effects — the core structural vulnerability
    if (effects.length > 0 && guards.length === 0) {
      for (const effect of effects) {
        const kind = (effect.props?.kind as string) || 'unknown';
        const line = effect.loc?.line ?? action.loc?.line ?? 1;
        findings.push({
          source: 'kern',
          ruleId: 'mcp-ir-unguarded-effect',
          severity: kind === 'shell-exec' ? 'error' : 'warning',
          category: 'bug',
          message: `MCP tool "${name}" has ${kind} effect without any guard — KERN IR: action.effect[${kind}] with no action.guard`,
          primarySpan: { file: filePath, startLine: line, startCol: 1, endLine: line, endCol: 1 },
          fingerprint: `mcp-ir-${name}-${kind}-${line}`,
          suggestion: `Add validation/auth guards before ${kind} effects. In KERN: guard precedes effect.`,
          confidence: 0.90,
        });
      }
    }

    // Low confidence action — suspicious
    if (confidence <= 0.3 && effects.length > 0) {
      const line = action.loc?.line ?? 1;
      findings.push({
        source: 'kern',
        ruleId: 'mcp-ir-low-confidence',
        severity: 'warning',
        category: 'bug',
        message: `MCP tool "${name}" has low KERN confidence (${confidence}) — ${effects.length} effects, ${guards.length} guards`,
        primarySpan: { file: filePath, startLine: line, startCol: 1, endLine: line, endCol: 1 },
        fingerprint: `mcp-ir-conf-${name}-${line}`,
        suggestion: `Add guards to increase confidence. Target: guard/effect ratio >= 1.`,
        confidence: 0.75,
      });
    }
  }

  return findings;
}
