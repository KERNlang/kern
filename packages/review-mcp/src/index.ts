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

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '@kernlang/review';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { detectMCPServer } from './detect.js';
import { inferMCPNodes, inferMCPNodesPython } from './infer-mcp.js';
import { loadRuleDirectory } from './rule-compiler.js';
import { runCompiledRules } from './rule-runner.js';
import { runMCPSecurityRules } from './rules/mcp-security.js';

export type { ReviewFinding } from '@kernlang/review';
export { generateBadgeMarkdown, generateReportJSON, generateToolTable, updateReadme } from './badge.js';
export type { ConfigIssue, ConfigScanResult, McpServerEntry } from './config-scan.js';
export { scanMcpConfigs } from './config-scan.js';
export { detectMCPServer } from './detect.js';
export { inferMCPNodes, inferMCPNodesPython } from './infer-mcp.js';
export { runPostScan } from './post-scan.js';
export type { CompiledMCPRule } from './rule-compiler.js';
export { compileRuleSource, loadRuleDirectory } from './rule-compiler.js';
export { runCompiledRules } from './rule-runner.js';
export { MCP_RULE_IDS, runMCPSecurityRules } from './rules/mcp-security.js';
export type { McpReviewResult } from './scan-types.js';
export type { Grade, SecurityScore, ToolScore } from './score.js';
// ── CLI / CI engine exports (migrated from kern-sight-mcp) ───────────
export { computeSecurityScore, gradeColor } from './score.js';
// Server inspector — live tool inspection + poisoning detection + pinning
export type {
  InspectedServer,
  InspectionResult,
  InspectOptions,
  LiveLockFile,
  LivePinDrift,
  LiveServerPin,
  LiveToolPin,
  McpToolInfo,
  PoisoningFinding,
} from './server-inspector.js';
export {
  generateLiveLockFile,
  hashTool,
  hashToolList,
  inspectMcpServers,
  verifyLiveLockFile,
} from './server-inspector.js';
export type { LockFile, PinDrift, ToolPin } from './tool-pin.js';
export { generateLockFile, verifyLockFile } from './tool-pin.js';
export { scanWorkspace } from './workspace-scan.js';

// ── Load compiled .kern rules at module init ─────────────────────────
// Guard: import.meta.url is undefined when bundled as CJS (e.g. esbuild for VS Code worker)

let COMPILED_RULES: import('./rule-compiler.js').CompiledMCPRule[] = [];

// Strategy 1: ESM — use import.meta.url to find rules/ directory on disk
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  COMPILED_RULES = loadRuleDirectory(join(__dirname, '..', 'rules'));
} catch {
  // Strategy 2: Pre-compiled JSON — works in CJS bundles where import.meta.url is undefined.
  // esbuild inlines require('../rules-compiled.json') as a static object at build time.
  // Run `node scripts/compile-rules.mjs` to regenerate after changing .kern files.
  try {
    const precompiled = require('../rules-compiled.json');
    if (Array.isArray(precompiled)) {
      COMPILED_RULES = precompiled.map((rule: any) => ({
        ...rule,
        sinks: rule.sinks.map((s: any) => ({
          ...s,
          patterns: s.patterns.map((p: any) => ({
            ...p,
            regex: new RegExp(p.source, (p.flags ?? '').replace(/g/g, '')),
          })),
        })),
        guards: rule.guards.map((g: any) => ({
          ...g,
          patterns: g.patterns.map((p: any) => ({
            ...p,
            regex: new RegExp(p.source, (p.flags ?? '').replace(/g/g, '')),
          })),
        })),
      }));
    }
  } catch {
    // No rules available — regex + IR rules still work
  }
}

/**
 * Review an MCP server source file for security vulnerabilities.
 * Combines regex-based rules, compiled .kern rules, and KERN IR structural analysis.
 */
export function reviewMCPSource(source: string, filePath: string): ReviewFinding[] {
  // Phase 1: Regex-based rules (fast, pattern matching)
  const findings = runMCPSecurityRules(source, filePath);

  // Phase 1.5: Compiled .kern rules (declarative, human-auditable)
  try {
    if (COMPILED_RULES.length > 0) {
      const kernFindings = runCompiledRules(COMPILED_RULES, source, filePath);
      // Dedup: merge .kern findings with legacy regex findings (same ruleId + line)
      // When both exist, prefer higher severity
      const SEVERITY_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };
      const existingByKey = new Map<string, number>(
        findings.map((f, i) => [`${f.ruleId}:${f.primarySpan.startLine}`, i]),
      );
      for (const kf of kernFindings) {
        const key = `${kf.ruleId}:${kf.primarySpan.startLine}`;
        const existingIdx = existingByKey.get(key);
        if (existingIdx === undefined) {
          existingByKey.set(key, findings.length);
          findings.push(kf);
        } else {
          // Replace if .kern finding has higher severity
          const existingSev = SEVERITY_RANK[findings[existingIdx].severity] || 0;
          const kernSev = SEVERITY_RANK[kf.severity] || 0;
          if (kernSev > existingSev) {
            findings[existingIdx] = kf;
          }
        }
      }
    }
  } catch {
    // Best-effort — legacy regex rules always run regardless
  }

  // Phase 2: KERN IR inference — translate to IR and check structure
  let irNodes: IRNode[] = [];
  try {
    const isPython = filePath.endsWith('.py');
    irNodes = isPython ? inferMCPNodesPython(source, filePath) : inferMCPNodes(source, filePath);

    if (irNodes.length > 0) {
      findings.push(...irToFindings(irNodes, filePath));
    }
  } catch {
    // Intentional: IR inference is best-effort — regex rules always run regardless
  }

  // Phase 2.5: IR-guided suppression — remove false positives where IR shows guards exist
  if (irNodes.length > 0) {
    suppressGuardedFindings(findings, irNodes);
  }

  // Phase 3: Post-processing — confidence floor + test file demotion
  const MIN_CONFIDENCE = 0.7;
  const isTestFile = /\.(test|spec)\.[jt]sx?$|__tests__|\/tests\/|\/fixtures\//.test(filePath);

  // Node.js built-in imports are not rug pulls — platform-provided, not supply-chain
  const sourceLines = source.split('\n');

  return findings.filter((f) => {
    // Suppress low-confidence fallback findings (noisy regex-without-handler-region)
    if (f.confidence !== undefined && f.confidence < MIN_CONFIDENCE) return false;

    // Suppress rug-pull for node: built-in imports (not supply-chain risk)
    if (f.ruleId === 'mcp-rug-pull' && f.message?.includes('import()')) {
      const line = sourceLines[f.primarySpan.startLine - 1] || '';
      if (/\bimport\s*\(\s*['"]node:/.test(line)) return false;
    }

    // Demote test file findings to info (don't suppress — tests may intentionally contain patterns)
    if (isTestFile && f.severity !== 'info') {
      f.severity = 'info';
    }

    return true;
  });
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

// ── IR-guided suppression ────────────────────────────────────────────

/** Rule → guard kind mapping: which IR guard suppresses which rule finding */
const RULE_GUARD_MAP: Record<string, string[]> = {
  'mcp-path-traversal': ['path-containment'],
  'mcp-missing-validation': ['validation', 'path-containment'],
  'mcp-command-injection': ['validation'],
  'mcp-unsanitized-response': ['validation'],
};

/** Rules that shouldn't fire on tools with zero effects (no dangerous operations) */
const EFFECT_REQUIRED_RULES = new Set(['mcp-missing-validation', 'mcp-path-traversal', 'mcp-command-injection']);

/**
 * Suppress regex-rule findings where the IR shows the containing tool has
 * the corresponding guard. Mutates the findings array in place (splices out suppressed).
 */
function suppressGuardedFindings(findings: ReviewFinding[], irNodes: IRNode[]): void {
  // Build line-range → guard-kinds map from IR actions
  const actions = irNodes.filter((n) => n.type === 'action');
  if (actions.length === 0) return;

  // Sort actions by line to enable range lookup
  const sorted = actions
    .map((a) => ({
      startLine: a.loc?.line ?? 0,
      guardKinds: new Set(
        (a.children ?? []).filter((c) => c.type === 'guard').map((c) => (c.props?.kind as string) || ''),
      ),
      effectCount: (a.children ?? []).filter((c) => c.type === 'effect').length,
    }))
    .sort((a, b) => a.startLine - b.startLine);

  // Find which action a finding belongs to (largest startLine <= finding line)
  function findAction(findingLine: number) {
    let best = sorted[0];
    for (const a of sorted) {
      if (a.startLine <= findingLine) best = a;
      else break;
    }
    return best;
  }

  // Suppress in reverse to avoid index shifting
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    const requiredGuards = RULE_GUARD_MAP[f.ruleId];
    if (!requiredGuards) continue;

    const action = findAction(f.primarySpan.startLine);
    if (!action) continue;

    const hasGuard = requiredGuards.some((gk) => action.guardKinds.has(gk));
    if (hasGuard) {
      findings.splice(i, 1);
      continue;
    }

    // Suppress effect-dependent rules on tools with no effects (e.g. no-param tools)
    if (EFFECT_REQUIRED_RULES.has(f.ruleId) && action.effectCount === 0) {
      findings.splice(i, 1);
    }
  }
}

// ── IR → Findings conversion ─────────────────────────────────────────

/** Convert KERN IR action nodes to security findings */
function irToFindings(nodes: IRNode[], filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const action of nodes) {
    if (action.type !== 'action') continue;
    const children = action.children ?? [];
    const effects = children.filter((c) => c.type === 'effect');
    const guards = children.filter((c) => c.type === 'guard');
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
          confidence: 0.9,
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
