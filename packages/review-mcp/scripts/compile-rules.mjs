#!/usr/bin/env node
/**
 * Pre-compile .kern rules to JSON for CJS bundle compatibility.
 *
 * Run: node scripts/compile-rules.mjs
 * Output: rules-compiled.json (checked into git, bundled by esbuild)
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(__dirname, '..', 'rules');
const outPath = join(__dirname, '..', 'rules-compiled.json');

// Dynamic import of compiled module
const { loadRuleDirectory } = await import('../dist/rule-compiler.js');

const rules = loadRuleDirectory(rulesDir);

// Serialize: convert RegExp to { source, flags } for JSON
const serialized = rules.map(rule => ({
  ...rule,
  sinks: rule.sinks.map(s => ({
    ...s,
    patterns: s.patterns.map(p => ({
      lang: p.lang,
      source: p.regex.source,
      flags: p.regex.flags,
    })),
  })),
  guards: rule.guards.map(g => ({
    ...g,
    patterns: g.patterns.map(p => ({
      lang: p.lang,
      source: p.regex.source,
      flags: p.regex.flags,
    })),
  })),
}));

writeFileSync(outPath, JSON.stringify(serialized, null, 2) + '\n');
console.log(`Compiled ${rules.length} rules → ${outPath}`);
