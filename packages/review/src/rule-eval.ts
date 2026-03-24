/**
 * KERN Native Rule Evaluation Engine
 *
 * Evaluates .kern rule definitions against IR node trees.
 * Rules use pattern/guard/expect/message nodes (all existing KERN types)
 * under a `rule` root node.
 */

import type { IRNode } from '@kernlang/core';
import type { ConceptMap, ConceptNode, ConceptNodePayload } from '@kernlang/core';
import type { ReviewFinding, FixAction } from './types.js';
import { createFingerprint } from './types.js';

// ── Concept → IR Wrapper ────────────────────────────────────────────────

/** Flatten a ConceptNodePayload into plain props (skip 'kind' — it becomes node type). */
function flattenPayload(payload: ConceptNodePayload): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'kind') continue;
    flat[k] = v;
  }
  return flat;
}

/** Convert a ConceptNode to an IRNode-shaped wrapper for the pattern matcher. */
export function conceptNodeToIR(concept: ConceptNode): IRNode {
  const props: Record<string, unknown> = {
    ...flattenPayload(concept.payload),
    // Metadata after payload — metadata always wins on collision
    _concept: true,
    evidence: concept.evidence,
    confidence: concept.confidence,
    language: concept.language,
  };
  if (concept.containerId) props.containerId = concept.containerId;

  return {
    type: concept.kind,
    loc: {
      line: concept.primarySpan.startLine,
      col: concept.primarySpan.startCol,
      endLine: concept.primarySpan.endLine,
      endCol: concept.primarySpan.endCol,
    },
    props,
    children: [],
  };
}

// ── Rule Index ──────────────────────────────────────────────────────────

/** Pre-computed index for efficient rule evaluation. */
export interface RuleIndex {
  /** All nodes grouped by type for O(1) lookup. */
  nodesByType: Map<string, IRNode[]>;
  /** Parent map for scope traversal. */
  parentMap: Map<IRNode, IRNode | undefined>;
  /** All flattened nodes. */
  allNodes: IRNode[];
}

/** Build a rule index from a list of IR nodes, optionally including concept nodes. */
export function buildRuleIndex(nodes: IRNode[], concepts?: ConceptMap): RuleIndex {
  const nodesByType = new Map<string, IRNode[]>();
  const parentMap = new Map<IRNode, IRNode | undefined>();
  const allNodes: IRNode[] = [];

  function walk(node: IRNode, parent?: IRNode): void {
    allNodes.push(node);
    parentMap.set(node, parent);

    const list = nodesByType.get(node.type);
    if (list) list.push(node);
    else nodesByType.set(node.type, [node]);

    for (const child of node.children || []) {
      walk(child, node);
    }
  }

  for (const node of nodes) walk(node);

  // Add concept nodes as flat IRNode wrappers (no parent, no children)
  if (concepts) {
    for (const cn of concepts.nodes) {
      walk(conceptNodeToIR(cn));
    }
  }

  return { nodesByType, parentMap, allNodes };
}

// ── Pattern Matching ────────────────────────────────────────────────────

/** Result of a pattern match attempt. */
export interface MatchResult {
  matched: boolean;
  bindings: Map<string, unknown>;
}

const NO_MATCH: MatchResult = { matched: false, bindings: new Map() };

/** Get props from a node safely. */
function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

/** Get children of a specific type. */
function childrenOf(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

/**
 * Match a pattern node against a target node.
 *
 * Pattern props:
 * - type=X: target must have this type
 * - prop=X: target must have this prop defined
 * - Any other prop: target must have matching prop value
 *
 * Pattern children:
 * - guard: evaluated as a guard clause
 * - expect: evaluated as a quantifier
 * - Nested pattern: matched recursively against target's children
 */
export function matchPattern(pattern: IRNode, target: IRNode, index: RuleIndex): MatchResult {
  const pp = p(pattern);
  const tp = p(target);
  const bindings = new Map<string, unknown>();

  // Subject filtering — concept nodes isolated from IR nodes
  // subject=concept → only concept nodes; anything else → only IR nodes
  const subject = pp.subject as string | undefined;
  const isConcept = tp._concept === true;
  if (subject === 'concept' && !isConcept) return NO_MATCH;
  if (subject !== 'concept' && isConcept) return NO_MATCH;

  // Type check
  if (pp.type && pp.type !== target.type) return NO_MATCH;

  // Prop existence check (prop=X means "target must have prop X")
  if (pp.prop) {
    const propName = pp.prop as string;
    if (tp[propName] === undefined) return NO_MATCH;
  }

  // Direct prop value matching (name=value checks target.props.name === value)
  for (const [key, val] of Object.entries(pp)) {
    if (['type', 'prop', 'subject', 'not'].includes(key)) continue;
    if (tp[key] !== undefined && String(tp[key]) !== String(val)) return NO_MATCH;
  }

  // Capture all target props as bindings for message interpolation
  for (const [key, val] of Object.entries(tp)) {
    bindings.set(key, val);
  }
  bindings.set('type', target.type);

  // Evaluate child guard nodes
  for (const guard of childrenOf(pattern, 'guard')) {
    if (!evaluateGuard(guard, target, index)) return NO_MATCH;
  }

  // Evaluate child expect nodes
  for (const expect of childrenOf(pattern, 'expect')) {
    if (!evaluateExpect(expect, target)) return NO_MATCH;
  }

  // Evaluate nested pattern children (match against target's children)
  for (const subPattern of childrenOf(pattern, 'pattern')) {
    const subPp = p(subPattern);
    const matchType = subPp.type as string | undefined;
    const targetChildren = matchType
      ? childrenOf(target, matchType)
      : (target.children || []);

    let anyMatch = false;
    for (const child of targetChildren) {
      const result = matchPattern(subPattern, child, index);
      if (result.matched) {
        anyMatch = true;
        for (const [k, v] of result.bindings) bindings.set(k, v);
        break;
      }
    }
    if (!anyMatch) return NO_MATCH;
  }

  return { matched: true, bindings };
}

// ── Guard Evaluation ────────────────────────────────────────────────────

/**
 * Evaluate a guard clause against a target node.
 *
 * Guard props:
 * - not=true: negate the result
 * - prop=X: check if target has prop X (negated: check target does NOT have prop X)
 * - scope=X: check if any ancestor has type X
 *
 * Guard children:
 * - pattern: must match against target (negated: must NOT match)
 */
export function evaluateGuard(guard: IRNode, target: IRNode, index: RuleIndex): boolean {
  const gp = p(guard);
  const isNegated = gp.not === 'true' || gp.not === true;

  let result = true;

  // Prop existence check
  if (gp.prop) {
    const propName = gp.prop as string;
    const tp = p(target);
    if (tp[propName] === undefined) result = false;
  }

  // Scope check — walk ancestor chain (AND-combined with prop check)
  if (result && gp.scope) {
    const scopeType = gp.scope as string;
    let current = index.parentMap.get(target);
    let found = false;
    while (current) {
      if (current.type === scopeType) { found = true; break; }
      current = index.parentMap.get(current);
    }
    if (!found) result = false;
  }

  // Child pattern matching
  for (const subPattern of childrenOf(guard, 'pattern')) {
    const subResult = matchPattern(subPattern, target, index);
    if (!subResult.matched) { result = false; break; }
  }

  return isNegated ? !result : result;
}

// ── Expect Evaluation ───────────────────────────────────────────────────

/**
 * Evaluate a quantifier (expect node) against a target node.
 *
 * Expect props:
 * - child-type=X: count children of type X
 * - min=N: require at least N matching children
 * - max=N: require at most N matching children
 * - exact=N: require exactly N matching children
 */
export function evaluateExpect(expect: IRNode, target: IRNode): boolean {
  const ep = p(expect);
  const childType = ep['child-type'] as string | undefined;
  const matching = childType ? childrenOf(target, childType) : (target.children || []);
  const count = matching.length;

  const min = ep.min !== undefined ? Number(ep.min) : undefined;
  const max = ep.max !== undefined ? Number(ep.max) : undefined;
  const exact = ep.exact !== undefined ? Number(ep.exact) : undefined;

  if (min !== undefined && !Number.isNaN(min) && count < min) return false;
  if (max !== undefined && !Number.isNaN(max) && count > max) return false;
  if (exact !== undefined && !Number.isNaN(exact) && count !== exact) return false;

  return true;
}

// ── Message Interpolation ───────────────────────────────────────────────

/**
 * Interpolate {{prop}} placeholders in a message template.
 */
export function interpolateMessage(template: string, bindings: Map<string, unknown>): string {
  return template.replace(/\{\{([\w-]+)\}\}/g, (_match, key: string) => {
    const val = bindings.get(key);
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ── Fix Action Construction ─────────────────────────────────────────────

/**
 * Build a FixAction from a fix node (body child with multiline code).
 */
function buildFixAction(fixNode: IRNode, target: IRNode, bindings: Map<string, unknown>): FixAction | undefined {
  const fp = p(fixNode);
  const op = (fp.op as string) || 'insert-after';
  const bodyNode = childrenOf(fixNode, 'body')[0];
  const code = bodyNode ? (p(bodyNode).code as string || '') : '';

  if (!code) return undefined;

  const replacement = interpolateMessage(code, bindings);
  const span = {
    file: '',
    startLine: target.loc?.line ?? 0,
    startCol: target.loc?.col ?? 0,
    endLine: target.loc?.endLine ?? target.loc?.line ?? 0,
    endCol: target.loc?.endCol ?? target.loc?.col ?? 0,
  };

  return {
    type: op as FixAction['type'],
    span,
    replacement,
    description: (fp.description as string) || `Apply ${op} fix`,
  };
}

// ── Rule Evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate a single native KERN rule against an indexed IR tree.
 * Returns findings for all matched nodes.
 * When concepts are provided, concept nodes are included in the index
 * and accessible via `subject=concept` in pattern nodes.
 */
export function evaluateRule(rule: IRNode, index: RuleIndex, filePath: string): ReviewFinding[] {
  const rp = p(rule);
  const ruleId = (rp.id as string) || 'unnamed-rule';
  const severity = (rp.severity as ReviewFinding['severity']) || 'warning';
  const category = (rp.category as ReviewFinding['category']) || 'pattern';
  const confidence = rp.confidence !== undefined ? Number(rp.confidence) : undefined;

  // Get the pattern node
  const patternNode = childrenOf(rule, 'pattern')[0];
  if (!patternNode) return [];

  // Get the message template
  const messageNode = childrenOf(rule, 'message')[0];
  const template = messageNode ? (p(messageNode).template as string) || '' : ruleId;

  // Get optional fix node
  const fixNode = childrenOf(rule, 'fix')[0];

  // Determine which nodes to check based on pattern type
  const patternType = p(patternNode).type as string | undefined;
  const candidates = patternType
    ? (index.nodesByType.get(patternType) || [])
    : index.allNodes;

  const findings: ReviewFinding[] = [];

  for (const target of candidates) {
    const result = matchPattern(patternNode, target, index);
    if (!result.matched) continue;

    const message = interpolateMessage(template, result.bindings);
    const line = target.loc?.line ?? 0;
    const col = target.loc?.col ?? 1;

    const finding: ReviewFinding = {
      source: 'kern-native',
      ruleId,
      severity,
      category,
      message,
      primarySpan: {
        file: filePath,
        startLine: line,
        startCol: col,
        endLine: target.loc?.endLine ?? line,
        endCol: target.loc?.endCol ?? col,
      },
      fingerprint: createFingerprint(ruleId, line, col),
    };

    if (confidence !== undefined) finding.confidence = confidence;

    // Build autofix if fix node exists
    if (fixNode) {
      const action = buildFixAction(fixNode, target, result.bindings);
      if (action) {
        action.span.file = filePath;
        finding.autofix = action;
      }
    }

    findings.push(finding);
  }

  return findings;
}
