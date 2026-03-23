/**
 * KERN Rule Compiler — parses .kern rule files into runtime checker objects.
 *
 * Uses the existing @kernlang/core parser (zero grammar changes needed).
 * Walks the IRNode tree to extract action→effect/guard/invariant structure.
 */

import { parse } from '@kernlang/core';
import type { IRNode } from '@kernlang/core';
import { isReDoSVulnerable } from '@kernlang/review';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Compiled rule types ──────────────────────────────────────────────

/** A single pattern for a specific language */
export interface CompiledPattern {
  lang: 'ts' | 'py';
  regex: RegExp;
}

/** A compiled sink (effect with patterns) */
export interface CompiledSink {
  name: string;
  kind: string;
  patterns: CompiledPattern[];
}

/** A compiled guard (mitigation pattern) */
export interface CompiledGuard {
  name: string;
  kind: string;
  patterns: CompiledPattern[];
  needs?: string[];
}

/** A compiled flow invariant */
export interface CompiledInvariant {
  name: string;
  from: string;
  to: string;
  guardedBy: string[];
  evidence: string;
  suggestion: string;
}

/** A fully compiled rule, ready to run */
export interface CompiledMCPRule {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  confidence: number;
  category: string;
  cweRef: string;
  sinks: CompiledSink[];
  guards: CompiledGuard[];
  invariants: CompiledInvariant[];
  delegate?: string;
}

// ── Compiler ─────────────────────────────────────────────────────────

/** Compile a .kern rule file source into runtime rule objects */
export function compileRuleSource(source: string): CompiledMCPRule[] {
  const root = parse(source);
  const rules: CompiledMCPRule[] = [];

  // The root is the first top-level node. If it's an action, compile it directly.
  // If it's a document with children, compile each action child.
  const nodes = root.type === 'action' ? [root] : (root.children ?? []).filter(n => n.type === 'action');

  for (const actionNode of nodes) {
    rules.push(compileActionNode(actionNode));
  }

  return rules;
}

/** Compile a single action node into a CompiledMCPRule */
function compileActionNode(node: IRNode): CompiledMCPRule {
  const props = node.props ?? {};
  const children = node.children ?? [];

  // Extract config
  const configNode = children.find(c => c.type === 'config');
  const configProps = configNode?.props ?? {};

  // Extract reason (CWE reference)
  const reasonNode = children.find(c => c.type === 'reason');
  const cweRef = String(reasonNode?.props?.value ?? '');

  // Extract sinks (effect nodes with pattern children)
  const sinks: CompiledSink[] = [];
  for (const child of children.filter(c => c.type === 'effect')) {
    sinks.push(compileEffect(child));
  }

  // Extract guards (guard nodes with pattern children)
  const guards: CompiledGuard[] = [];
  for (const child of children.filter(c => c.type === 'guard')) {
    guards.push(compileGuard(child));
  }

  // Extract invariants
  const invariants: CompiledInvariant[] = [];
  for (const child of children.filter(c => c.type === 'invariant')) {
    invariants.push(compileInvariant(child));
  }

  return {
    ruleId: String(props.name ?? 'unknown'),
    severity: parseSeverity(configProps.severity),
    confidence: parseFloat(String(configProps.confidence ?? '0.80')),
    category: String(configProps.category ?? 'bug'),
    cweRef,
    sinks,
    guards,
    invariants,
    delegate: configProps.delegate ? String(configProps.delegate) : undefined,
  };
}

/** Compile an effect node into a CompiledSink */
function compileEffect(node: IRNode): CompiledSink {
  const props = node.props ?? {};
  const patterns = extractPatterns(node.children ?? []);
  return {
    name: String(props.name ?? 'unknown'),
    kind: String(props.kind ?? 'unknown'),
    patterns,
  };
}

/** Compile a guard node into a CompiledGuard */
function compileGuard(node: IRNode): CompiledGuard {
  const props = node.props ?? {};
  const children = node.children ?? [];
  const patterns = extractPatterns(children);
  // Support both inline prop needs="x,y" and child node: needs guard=x
  let needsStr = String(props.needs ?? '');
  if (!needsStr) {
    const needsChild = children.find(c => c.type === 'needs');
    if (needsChild) needsStr = String(needsChild.props?.guard ?? '');
  }
  return {
    name: String(props.name ?? 'unknown'),
    kind: String(props.kind ?? 'unknown'),
    patterns,
    ...(needsStr ? { needs: needsStr.split(',').map(s => s.trim()) } : {}),
  };
}

/** Compile an invariant node into a CompiledInvariant */
function compileInvariant(node: IRNode): CompiledInvariant {
  const children = node.children ?? [];
  const expectNode = children.find(c => c.type === 'expect');
  const evidenceNode = children.find(c => c.type === 'evidence');
  const suggestionNode = children.find(c => c.type === 'suggestion');

  const expectProps = expectNode?.props ?? {};
  const guardedByStr = String(expectProps['guarded-by'] ?? '');

  return {
    name: String(node.props?.name ?? 'unknown'),
    from: String(expectProps.from ?? 'tool-params'),
    to: String(expectProps.to ?? ''),
    guardedBy: guardedByStr ? guardedByStr.split(',').map(s => s.trim()) : [],
    evidence: String(evidenceNode?.props?.value ?? ''),
    suggestion: String(suggestionNode?.props?.value ?? ''),
  };
}

/** Extract CompiledPattern[] from pattern child nodes */
function extractPatterns(children: IRNode[]): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];
  for (const child of children.filter(c => c.type === 'pattern')) {
    const props = child.props ?? {};
    const lang = String(props.lang ?? 'ts');
    const match = String(props.match ?? '');
    const flags = String(props.flags ?? '');
    if (!match) continue;
    // Reject patterns vulnerable to catastrophic backtracking (ReDoS)
    const redos = isReDoSVulnerable(match);
    if (redos) {
      console.warn(`[kern-rule] Rejecting ReDoS-vulnerable pattern "${match}": ${redos}`);
      continue;
    }
    try {
      patterns.push({ lang: lang as 'ts' | 'py', regex: new RegExp(match, flags) });
    } catch {
      // Skip invalid regex
    }
  }
  return patterns;
}

function parseSeverity(val: unknown): 'error' | 'warning' | 'info' {
  const s = String(val ?? 'warning');
  if (s === 'error' || s === 'warning' || s === 'info') return s;
  return 'warning';
}

// ── File loading ─────────────────────────────────────────────────────

/** Load and compile all .kern rule files from a directory */
export function loadRuleDirectory(dirPath: string): CompiledMCPRule[] {
  const rules: CompiledMCPRule[] = [];
  let files: string[];
  try {
    files = readdirSync(dirPath).filter(f => f.endsWith('.kern')).sort();
  } catch {
    return rules;
  }
  for (const file of files) {
    try {
      const source = readFileSync(join(dirPath, file), 'utf-8');
      rules.push(...compileRuleSource(source));
    } catch {
      // Skip malformed rule files
    }
  }
  return rules;
}
