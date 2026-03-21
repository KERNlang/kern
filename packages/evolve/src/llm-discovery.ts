/**
 * LLM Discovery — universal pattern recognition for KERN Evolve v4.
 *
 * No hardcoded detectors. The LLM reads TypeScript source files and
 * identifies repeating patterns that KERN can't yet express.
 *
 * Offline-safe: this module only constructs prompts and parses responses.
 * The actual LLM call is handled by llm-provider.ts.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join, relative, dirname, basename, extname } from 'path';
import { NODE_TYPES } from '@kernlang/core';
import type { EvolveNodeProposal, EvolvedNodeProp } from './evolved-types.js';

// ── File Selection ───────────────────────────────────────────────────────

/**
 * Select representative TypeScript files, clustered by directory.
 * Returns batches of 3-5 files suitable for LLM context.
 *
 * @param filePaths — all .ts/.tsx files in the project
 * @param maxPerCluster — max files to sample per directory (default: 3)
 * @param maxBatchSize — max files per LLM batch (default: 5)
 */
export function selectRepresentativeFiles(
  filePaths: string[],
  maxPerCluster = 3,
  maxBatchSize = 5,
): string[][] {
  // Cluster by parent directory
  const clusters = new Map<string, string[]>();
  for (const fp of filePaths) {
    const dir = dirname(fp);
    const cluster = clusters.get(dir) || [];
    cluster.push(fp);
    clusters.set(dir, cluster);
  }

  // Sample from each cluster: pick diverse files (by size variance)
  const sampled: string[] = [];
  for (const [dir, files] of clusters) {
    // Sort by file size (descending) to get diverse samples
    const sorted = [...files].sort((a, b) => {
      try {
        return statSync(b).size - statSync(a).size;
      } catch {
        return 0;
      }
    });

    // Take up to maxPerCluster, spread across the size range
    const take = Math.min(sorted.length, maxPerCluster);
    if (take <= 2) {
      sampled.push(...sorted.slice(0, take));
    } else {
      // First, middle, last for diversity
      const step = Math.floor((sorted.length - 1) / (take - 1));
      for (let i = 0; i < take; i++) {
        const idx = Math.min(i * step, sorted.length - 1);
        sampled.push(sorted[idx]);
      }
    }
  }

  // Group into batches
  const batches: string[][] = [];
  for (let i = 0; i < sampled.length; i += maxBatchSize) {
    batches.push(sampled.slice(i, i + maxBatchSize));
  }

  return batches;
}

/**
 * Collect all TypeScript files from a directory (recursive).
 * Skips node_modules, dist, .files, test files, and .d.ts files.
 */
export function collectTsFiles(dir: string, recursive = true): string[] {
  const files: string[] = [];

  function walk(d: string): void {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(d, entry.name);
        if (entry.isDirectory() && recursive) {
          walk(full);
        } else if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.d.ts') &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          files.push(full);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(resolve(dir));
  return files;
}

// ── Prompt Construction ──────────────────────────────────────────────────

/**
 * Build the LLM discovery prompt for a batch of files.
 */
export function buildDiscoveryPrompt(
  files: Array<{ path: string; content: string }>,
  nodeTypes: readonly string[],
  evolvedKeywords: string[] = [],
): string {
  const fileBlocks = files.map(f =>
    `### ${f.path}\n\`\`\`typescript\n${truncate(f.content, 3000)}\n\`\`\``
  ).join('\n\n');

  const existingNodes = [...nodeTypes, ...evolvedKeywords].join(', ');

  return `You are analyzing TypeScript source files to find repeating structural patterns that a language called KERN cannot yet express.

KERN is an indent-based IR language that compiles to TypeScript. It has these existing node types:
${existingNodes}

## Source Files to Analyze

${fileBlocks}

## Your Task

Identify **repeating structural patterns** in these files that:
1. Appear 2+ times (across these files or clearly would across a larger codebase)
2. Cannot be expressed by any existing KERN node type listed above
3. Have a clear structural template (not just random code)
4. Would benefit from a first-class language construct (saves boilerplate, enforces consistency)

## Response Format

Respond with a JSON array. Each element represents one proposed node:

\`\`\`json
[
  {
    "keyword": "lowercase-with-hyphens",
    "displayName": "Human Readable Name",
    "description": "What this node represents",
    "props": [
      { "name": "propName", "type": "string", "required": true, "description": "What this prop does" }
    ],
    "childTypes": ["child-type-if-any"],
    "kernExample": "keyword prop1=value1 prop2=value2\\n  child-type prop=value",
    "expectedOutput": "export const example = { /* generated TS */ };",
    "codegenSource": "module.exports = function(node, helpers) {\\n  var name = helpers.p(node).name;\\n  return ['export const ' + name + ' = {};'];\\n};",
    "reason": {
      "observation": "Found N instances of this pattern in the analyzed files",
      "inefficiency": "Each instance requires M lines of boilerplate",
      "kernBenefit": "Reduces to K lines of KERN, ensures consistency"
    }
  }
]
\`\`\`

## Critical Rules

1. **codegenSource MUST be valid CommonJS JavaScript** (not TypeScript). Use \`module.exports = function(node, helpers) { ... }\`. The function receives an AST node and helpers object.
2. **Available helpers:** \`helpers.p(node)\` returns props, \`helpers.kids(node, 'type')\` returns children of type, \`helpers.firstChild(node, 'type')\`, \`helpers.capitalize(str)\`, \`helpers.parseParamList(str)\`, \`helpers.dedent(str)\`, \`helpers.handlerCode(node)\`, \`helpers.exportPrefix(node)\`.
3. **The function must return string[]** — an array of lines of TypeScript code.
4. **kernExample must parse** with KERN's indent-based parser (2-space indents, key=value props, no special syntax).
5. **expectedOutput must be the TypeScript** that codegenSource would produce for kernExample.
6. **keyword must be lowercase with hyphens**, not colliding with existing node types.
7. **Return an empty array []** if no valid patterns are found. Do not hallucinate patterns.
8. **Only return the JSON array.** No markdown, no explanation, no preamble.`;
}

// ── Response Parsing ─────────────────────────────────────────────────────

/**
 * Parse the LLM response into EvolveNodeProposal[].
 * Handles common LLM quirks: markdown fences, preamble, trailing text.
 */
export function parseDiscoveryResponse(
  response: string,
  evolveRunId: string = `run-${Date.now()}`,
): EvolveNodeProposal[] {
  // Strip markdown fences
  let json = response.trim();
  const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1].trim();
  }

  // Try to find JSON array boundaries
  const arrayStart = json.indexOf('[');
  const arrayEnd = json.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    return [];
  }
  json = json.slice(arrayStart, arrayEnd + 1);

  let parsed: unknown[];
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const proposals: EvolveNodeProposal[] = [];
  for (const item of parsed) {
    try {
      const p = normalizeProposal(item as Record<string, unknown>, evolveRunId);
      if (p) proposals.push(p);
    } catch {
      // Skip malformed entries
    }
  }

  return proposals;
}

function normalizeProposal(
  raw: Record<string, unknown>,
  evolveRunId: string,
): EvolveNodeProposal | null {
  const keyword = raw.keyword as string;
  if (!keyword || typeof keyword !== 'string') return null;

  // Normalize keyword to lowercase with hyphens
  const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalizedKeyword) return null;

  const reason = raw.reason as Record<string, unknown> || {};

  return {
    id: `proposal-${normalizedKeyword}-${Date.now()}`,
    keyword: normalizedKeyword,
    displayName: (raw.displayName as string) || normalizedKeyword,
    description: (raw.description as string) || '',
    props: normalizeProps(raw.props as unknown[]),
    childTypes: Array.isArray(raw.childTypes) ? raw.childTypes.filter((c): c is string => typeof c === 'string') : [],
    kernExample: (raw.kernExample as string) || '',
    expectedOutput: (raw.expectedOutput as string) || '',
    codegenSource: (raw.codegenSource as string) || '',
    parserHints: undefined,
    targetOverrides: undefined,
    reason: {
      observation: (reason.observation as string) || '',
      inefficiency: (reason.inefficiency as string) || '',
      kernBenefit: (reason.kernBenefit as string) || '',
      frequency: (reason.frequency as number) || 0,
      avgLines: (reason.avgLines as number) || 0,
      instances: Array.isArray(reason.instances) ? reason.instances : [],
    },
    codegenTier: 1,
    proposedAt: new Date().toISOString(),
    evolveRunId,
  };
}

function normalizeProps(raw: unknown[]): EvolvedNodeProp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map(p => ({
      name: (p.name as string) || 'unknown',
      type: (['string', 'boolean', 'number', 'expression'].includes(p.type as string) ? p.type : 'string') as EvolvedNodeProp['type'],
      required: p.required === true,
      description: (p.description as string) || '',
    }));
}

// ── Utility ──────────────────────────────────────────────────────────────

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n// ... truncated ...';
}

/**
 * Estimate token count for a string (rough: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Retry Prompt ──────────────────────────────────────────────────────────

/**
 * Build a prompt asking the LLM to fix a failed proposal.
 * Feeds back the validation errors so the LLM can correct its output.
 */
export function buildRetryPrompt(
  proposal: EvolveNodeProposal,
  errors: string[],
): string {
  return `Your previous KERN node proposal "${proposal.keyword}" failed validation. Fix the issues and return the corrected proposal.

## Previous Proposal

keyword: ${proposal.keyword}
kernExample: ${proposal.kernExample}
expectedOutput: ${proposal.expectedOutput}
codegenSource:
${proposal.codegenSource}

## Validation Errors

${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

## Rules

1. **codegenSource MUST be valid CommonJS JavaScript** (not TypeScript). Use \`module.exports = function(node, helpers) { ... }\`.
2. **Available helpers:** \`helpers.p(node)\` returns props, \`helpers.kids(node, 'type')\`, \`helpers.firstChild(node, 'type')\`, \`helpers.capitalize(str)\`, \`helpers.parseParamList(str)\`, \`helpers.dedent(str)\`, \`helpers.handlerCode(node)\`, \`helpers.exportPrefix(node)\`.
3. **The function must return string[]** — an array of lines of TypeScript code.
4. **kernExample must parse** with KERN's indent-based parser (2-space indents, key=value props).
5. **expectedOutput must match** what codegenSource produces for kernExample.

## Response Format

Return ONLY the corrected JSON object (same schema as before):

\`\`\`json
{
  "keyword": "${proposal.keyword}",
  "displayName": "${proposal.displayName}",
  "description": "${proposal.description}",
  "props": ${JSON.stringify(proposal.props)},
  "childTypes": ${JSON.stringify(proposal.childTypes)},
  "kernExample": "...",
  "expectedOutput": "...",
  "codegenSource": "module.exports = function(node, helpers) { ... }",
  "reason": ${JSON.stringify(proposal.reason)}
}
\`\`\`

No markdown outside the JSON block. No explanation.`;
}

// ── Backfill Prompt ───────────────────────────────────────────────────────

/**
 * Build a prompt for LLM to generate a target-specific codegen for an evolved node.
 */
export function buildBackfillPrompt(
  keyword: string,
  definition: {
    props: EvolvedNodeProp[];
    childTypes: string[];
    kernExample: string;
    codegenSource: string;
    expectedOutput: string;
  },
  target: string,
): string {
  return `You are generating a target-specific code generator for a KERN evolved node.

## Node: ${keyword}
Target: ${target}

## Props
${definition.props.map(p => `- ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`).join('\n')}

## Child Types
${definition.childTypes.join(', ') || '(none)'}

## KERN Example Input
\`\`\`kern
${definition.kernExample}
\`\`\`

## Default Codegen (TypeScript target)
\`\`\`javascript
${definition.codegenSource}
\`\`\`

## Default Output (TypeScript)
\`\`\`typescript
${definition.expectedOutput}
\`\`\`

## Your Task

Write a **CommonJS JavaScript** function that generates **${target}**-specific output for this node. The function receives \`(node, helpers)\` and must return \`string[]\` (lines of code).

Available helpers: \`helpers.p(node)\` (props), \`helpers.kids(node, 'type')\` (children), \`helpers.firstChild(node, 'type')\`, \`helpers.capitalize(str)\`, \`helpers.parseParamList(str)\`, \`helpers.dedent(str)\`, \`helpers.handlerCode(node)\`, \`helpers.exportPrefix(node)\`.

## Response Format

Return ONLY a JSON object:
\`\`\`json
{
  "codegenSource": "module.exports = function(node, helpers) { ... }",
  "expectedOutput": "// expected output for the kern example above"
}
\`\`\`

No markdown, no explanation, just the JSON object.`;
}
