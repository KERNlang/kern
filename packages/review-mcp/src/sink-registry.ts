/**
 * MCP Sink Registry — aggregates sinks and guards from compiled .kern rules.
 *
 * Provides a unified lookup for all declared sinks and guards across
 * all compiled rules. Used by the rule runner for cross-rule pattern reuse.
 */

import type { CompiledMCPRule, CompiledPattern } from './rule-compiler.js';

/** A registry entry for a sink */
export interface SinkEntry {
  name: string;
  kind: string;
  patterns: Map<string, RegExp[]>; // language -> compiled regexes
  declaredBy: string[]; // ruleIds that declare this sink
}

/** A registry entry for a guard */
export interface GuardEntry {
  name: string;
  kind: string;
  patterns: Map<string, RegExp[]>;
  needs?: string[];
  declaredBy: string[];
}

/** The aggregated sink/guard registry */
export interface MCPSinkRegistry {
  sinks: Map<string, SinkEntry>;
  guards: Map<string, GuardEntry>;
}

/** Build a registry from compiled rules */
export function buildRegistry(rules: CompiledMCPRule[]): MCPSinkRegistry {
  const sinks = new Map<string, SinkEntry>();
  const guards = new Map<string, GuardEntry>();

  for (const rule of rules) {
    for (const sink of rule.sinks) {
      const existing = sinks.get(sink.name);
      if (existing) {
        mergePatterns(existing.patterns, sink.patterns);
        if (!existing.declaredBy.includes(rule.ruleId)) {
          existing.declaredBy.push(rule.ruleId);
        }
      } else {
        sinks.set(sink.name, {
          name: sink.name,
          kind: sink.kind,
          patterns: patternsToMap(sink.patterns),
          declaredBy: [rule.ruleId],
        });
      }
    }

    for (const guard of rule.guards) {
      const existing = guards.get(guard.name);
      if (existing) {
        mergePatterns(existing.patterns, guard.patterns);
        if (!existing.declaredBy.includes(rule.ruleId)) {
          existing.declaredBy.push(rule.ruleId);
        }
      } else {
        guards.set(guard.name, {
          name: guard.name,
          kind: guard.kind,
          patterns: patternsToMap(guard.patterns),
          needs: guard.needs,
          declaredBy: [rule.ruleId],
        });
      }
    }
  }

  return { sinks, guards };
}

function patternsToMap(patterns: CompiledPattern[]): Map<string, RegExp[]> {
  const map = new Map<string, RegExp[]>();
  for (const p of patterns) {
    const existing = map.get(p.lang) ?? [];
    existing.push(p.regex);
    map.set(p.lang, existing);
  }
  return map;
}

function mergePatterns(target: Map<string, RegExp[]>, source: CompiledPattern[]): void {
  for (const p of source) {
    const existing = target.get(p.lang) ?? [];
    existing.push(p.regex);
    target.set(p.lang, existing);
  }
}
