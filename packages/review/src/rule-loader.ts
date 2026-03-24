/**
 * KERN Native Rule Loader
 *
 * Discovers .kern rule files, parses them, validates structure,
 * and wraps each rule in a KernLintRule adapter for the existing pipeline.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseDocument } from '@kernlang/core';
import type { IRNode } from '@kernlang/core';
import type { ConceptMap } from '@kernlang/core';
import type { KernLintRule } from './kern-lint.js';
import type { ReviewFinding } from './types.js';
import { buildRuleIndex, evaluateRule } from './rule-eval.js';

// ── Validation ──────────────────────────────────────────────────────────

/** Validate that a rule node has the required structure. */
function validateRule(rule: IRNode): string[] {
  const errors: string[] = [];
  const rp = rule.props || {};
  const children = rule.children || [];

  if (!rp.id) errors.push('Rule missing id prop');

  const hasPattern = children.some(c => c.type === 'pattern');
  if (!hasPattern) errors.push('Rule missing pattern child');

  const hasMessage = children.some(c => c.type === 'message');
  if (!hasMessage) errors.push('Rule missing message child');

  // Validate severity if present
  if (rp.severity && !['error', 'warning', 'info'].includes(rp.severity as string)) {
    errors.push(`Invalid severity: ${rp.severity}`);
  }

  // Validate category if present
  if (rp.category && !['bug', 'type', 'pattern', 'style', 'structure'].includes(rp.category as string)) {
    errors.push(`Invalid category: ${rp.category}`);
  }

  return errors;
}

// ── Rule Adapter ────────────────────────────────────────────────────────

/**
 * Wrap a parsed rule IRNode into a KernLintRule function.
 * The adapter builds a RuleIndex from the target nodes and evaluates the rule.
 * When concepts are provided, concept nodes are included in the index.
 */
function nativeRuleAdapter(ruleNode: IRNode): KernLintRule {
  return (nodes: IRNode[], concepts?: ConceptMap): ReviewFinding[] => {
    const index = buildRuleIndex(nodes, concepts);
    // Pass empty filePath — the review pipeline patches it downstream
    // (same pattern as ground-layer rules in ground-layer.ts:45)
    return evaluateRule(ruleNode, index, '');
  };
}

// ── Loader ──────────────────────────────────────────────────────────────

/**
 * Load rules from a single .kern file, resolving imports recursively.
 * The visited set guards against circular imports.
 */
function loadRulesFromFile(filePath: string, rules: KernLintRule[], visited: Set<string>): void {
  const absPath = resolve(filePath);
  if (visited.has(absPath)) return;
  visited.add(absPath);

  if (!existsSync(absPath)) {
    console.warn(`[kern-native] Import not found: ${absPath}`);
    return;
  }

  try {
    const source = readFileSync(absPath, 'utf-8');
    const doc = parseDocument(source);
    const children = doc.children || [];

    // Resolve imports first (relative to importing file)
    for (const node of children) {
      if (node.type !== 'import') continue;
      const from = (node.props?.from as string) || '';
      if (!from || !from.endsWith('.kern')) continue;
      const importPath = resolve(dirname(absPath), from);
      loadRulesFromFile(importPath, rules, visited);
    }

    // Extract and validate rule nodes
    for (const ruleNode of children.filter(n => n.type === 'rule')) {
      const errors = validateRule(ruleNode);
      if (errors.length > 0) {
        console.warn(`[kern-native] Skipping invalid rule in ${absPath}: ${errors.join(', ')}`);
        continue;
      }
      rules.push(nativeRuleAdapter(ruleNode));
    }
  } catch (err) {
    console.warn(`[kern-native] Failed to parse ${absPath}: ${(err as Error).message}`);
  }
}

/**
 * Load native .kern rule files from a directory.
 * Returns KernLintRule adapters for all valid rules found.
 * Supports `import from="other.kern"` for rule composition.
 */
export function loadNativeRules(dirs: string[]): KernLintRule[] {
  const rules: KernLintRule[] = [];
  const visited = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.kern'));
    for (const file of files) {
      loadRulesFromFile(join(dir, file), rules, visited);
    }
  }

  return rules;
}

/**
 * Load native rules from the built-in rules directory.
 */
export function loadBuiltinNativeRules(): KernLintRule[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const builtinDir = resolve(__dirname, 'rules', 'native');
  return loadNativeRules([builtinDir]);
}
