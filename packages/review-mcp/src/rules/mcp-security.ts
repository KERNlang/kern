/**
 * MCP Security Rules — static analysis for Model Context Protocol servers.
 *
 * 9 rules mapped to OWASP MCP Top 10:
 *   MCP01: command-injection-tool-handler  — user params flow to shell commands
 *   MCP02: path-traversal-tool             — file ops with unvalidated paths
 *   MCP03: tool-description-poisoning      — hidden instructions in tool descriptions
 *   MCP04: secrets-in-tool-metadata        — hardcoded keys/tokens in server code
 *   MCP05: unsanitized-tool-response       — raw external data returned to LLM
 *   MCP06: missing-input-validation        — tool params used without validation
 *   MCP07: missing-auth-remote-server      — HTTP/SSE server without auth
 *   MCP08: namespace-typosquatting         — suspicious package name similarity
 *   MCP09: data-level-injection            — hidden instructions in string literals
 *
 * Supports TypeScript and Python MCP servers.
 * CWE-77, CWE-22, CWE-94, CWE-798, CWE-20, CWE-306
 */

import type { ReviewFinding } from '@kernlang/review';

// Re-export public utilities from submodules
export { isCommentLine, createLexicalMask } from './mcp-lexical.js';
export { findToolHandlerRegions, isMCPServer } from './mcp-regions.js';
export type { CodeRegion } from './mcp-regions.js';

// Import individual rule checks
import { commandInjectionTS, commandInjectionPython } from './checks/mcp01-cmd-injection.js';
import { pathTraversalTS, pathTraversalPython } from './checks/mcp02-path-traversal.js';
import { toolDescriptionPoisoningTS, toolDescriptionPoisoningPython } from './checks/mcp03-tool-poisoning.js';
import { secretsInMetadata } from './checks/mcp04-secrets.js';
import { unsanitizedToolResponseTS, unsanitizedToolResponsePython } from './checks/mcp05-response.js';
import { missingInputValidationTS, missingInputValidationPython } from './checks/mcp06-validation.js';
import { missingAuthRemoteTS, missingAuthRemotePython } from './checks/mcp07-auth.js';
import { namespaceTyposquatting } from './checks/mcp08-typosquatting.js';
import { dataLevelInjection } from './checks/mcp09-data-injection.js';

// ── Public API ───────────────────────────────────────────────────────

/**
 * Run all MCP security rules on source code.
 * Auto-detects language from file extension.
 */
export function runMCPSecurityRules(source: string, filePath: string): ReviewFinding[] {
  const isPython = filePath.endsWith('.py');
  const findings: ReviewFinding[] = [];

  if (isPython) {
    findings.push(...commandInjectionPython(source, filePath));
    findings.push(...pathTraversalPython(source, filePath));
    findings.push(...toolDescriptionPoisoningPython(source, filePath));
    findings.push(...secretsInMetadata(source, filePath));
    findings.push(...unsanitizedToolResponsePython(source, filePath));
    findings.push(...missingInputValidationPython(source, filePath));
    findings.push(...missingAuthRemotePython(source, filePath));
  } else {
    findings.push(...commandInjectionTS(source, filePath));
    findings.push(...pathTraversalTS(source, filePath));
    findings.push(...toolDescriptionPoisoningTS(source, filePath));
    findings.push(...secretsInMetadata(source, filePath));
    findings.push(...unsanitizedToolResponseTS(source, filePath));
    findings.push(...missingInputValidationTS(source, filePath));
    findings.push(...missingAuthRemoteTS(source, filePath));
  }

  // Language-agnostic rules
  findings.push(...dataLevelInjection(source, filePath));
  findings.push(...namespaceTyposquatting(source, filePath));

  // Dedup: data-injection should not duplicate tool-poisoning on same line
  const poisoningLines = new Set(
    findings.filter(f => f.ruleId === 'mcp-tool-poisoning').map(f => f.primarySpan.startLine),
  );
  return findings.filter(f =>
    f.ruleId !== 'mcp-data-injection' || !poisoningLines.has(f.primarySpan.startLine),
  );
}

/** All rule IDs exported by this module */
export const MCP_RULE_IDS = [
  'mcp-command-injection',
  'mcp-path-traversal',
  'mcp-tool-poisoning',
  'mcp-secrets-exposure',
  'mcp-unsanitized-response',
  'mcp-missing-validation',
  'mcp-missing-auth',
  'mcp-typosquatting',
  'mcp-data-injection',
] as const;
