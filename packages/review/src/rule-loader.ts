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
 */
function nativeRuleAdapter(ruleNode: IRNode): KernLintRule {
  return (nodes: IRNode[]): ReviewFinding[] => {
    const index = buildRuleIndex(nodes);
    // Pass empty filePath — the review pipeline patches it downstream
    // (same pattern as ground-layer rules in ground-layer.ts:45)
    return evaluateRule(ruleNode, index, '');
  };
}

// ── Loader ──────────────────────────────────────────────────────────────

/**
 * Load native .kern rule files from a directory.
 * Returns KernLintRule adapters for all valid rules found.
 */
export function loadNativeRules(dirs: string[]): KernLintRule[] {
  const rules: KernLintRule[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    // Find .kern files in the directory
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.kern'));

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const source = readFileSync(filePath, 'utf-8');
        const doc = parseDocument(source);

        // Extract all rule nodes from the document
        const ruleNodes = (doc.children || []).filter(n => n.type === 'rule');

        for (const ruleNode of ruleNodes) {
          const errors = validateRule(ruleNode);
          if (errors.length > 0) {
            console.warn(`[kern-native] Skipping invalid rule in ${filePath}: ${errors.join(', ')}`);
            continue;
          }
          rules.push(nativeRuleAdapter(ruleNode));
        }
      } catch (err) {
        console.warn(`[kern-native] Failed to parse ${filePath}: ${(err as Error).message}`);
      }
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
