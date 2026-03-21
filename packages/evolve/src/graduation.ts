/**
 * Graduation — writes approved node proposals to .kern/evolved/.
 *
 * Compiles the codegen TypeScript source to JS, writes all files,
 * updates the manifest, and makes the node available at next compile.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { KERN_VERSION } from '@kernlang/core';
import type { EvolveNodeProposal, EvolvedManifest, EvolvedManifestEntry, EvolvedNodeDefinition } from './evolved-types.js';

/**
 * Graduate an approved proposal: write all files to .kern/evolved/<keyword>/.
 */
export function graduateNode(
  proposal: EvolveNodeProposal,
  compiledJs: string,
  graduatedBy: string = 'user',
  baseDir: string = process.cwd(),
): { success: boolean; error?: string; path?: string } {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const nodeDir = join(evolvedDir, proposal.keyword);

  // Prevent overwriting existing graduated node
  if (existsSync(nodeDir)) {
    return { success: false, error: `Node '${proposal.keyword}' is already graduated. Rollback first.` };
  }

  try {
    mkdirSync(nodeDir, { recursive: true });

    // 1. Write codegen.js (pre-compiled)
    writeFileSync(join(nodeDir, 'codegen.js'), compiledJs);

    // 2. Write codegen.ts (source, for editing/review)
    writeFileSync(join(nodeDir, 'codegen.ts'), proposal.codegenSource);

    // 3. Write template.kern (golden input)
    writeFileSync(join(nodeDir, 'template.kern'), proposal.kernExample);

    // 4. Write expected-output.ts (golden output)
    writeFileSync(join(nodeDir, 'expected-output.ts'), proposal.expectedOutput);

    // 5. Write definition.json
    const hash = 'sha256:' + createHash('sha256').update(compiledJs).digest('hex');
    const definition: EvolvedNodeDefinition = {
      keyword: proposal.keyword,
      displayName: proposal.displayName,
      description: proposal.description,
      props: proposal.props,
      childTypes: proposal.childTypes,
      parserHints: proposal.parserHints,
      reason: proposal.reason,
      hash,
      graduatedBy,
      graduatedAt: new Date().toISOString(),
      evolveRunId: proposal.evolveRunId,
      kernVersion: KERN_VERSION,
    };
    writeFileSync(join(nodeDir, 'definition.json'), JSON.stringify(definition, null, 2));

    // 6. Write target overrides if any
    if (proposal.targetOverrides) {
      const targetsDir = join(nodeDir, 'targets');
      mkdirSync(targetsDir, { recursive: true });
      for (const [target, source] of Object.entries(proposal.targetOverrides)) {
        writeFileSync(join(targetsDir, `${target}.js`), source);
      }
    }

    // 7. Update manifest
    updateManifest(evolvedDir, proposal.keyword, {
      keyword: proposal.keyword,
      displayName: proposal.displayName,
      codegenTier: proposal.codegenTier,
      childTypes: proposal.childTypes,
      parserHints: proposal.parserHints,
      hash,
      graduatedBy,
      graduatedAt: definition.graduatedAt,
      evolveRunId: proposal.evolveRunId,
      kernVersion: KERN_VERSION,
    });

    return { success: true, path: nodeDir };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Compile codegen TypeScript source to JavaScript for the sandbox.
 * Strips types, imports, and converts to CommonJS.
 */
export function compileCodegenToJS(tsSource: string): string {
  let js = tsSource;

  // Strip import statements
  js = js.replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '');
  js = js.replace(/import\s+type\s+.*?from\s+['"].*?['"];?\n?/g, '');

  // Convert export default function → module.exports = function
  js = js.replace(/^export\s+default\s+function/m, 'module.exports = function');
  js = js.replace(/^export\s+function\s+(\w+)/m, 'module.exports = function $1');

  // If no module.exports yet, wrap
  if (!js.includes('module.exports')) {
    // Try to find a standalone function declaration
    const fnMatch = js.match(/^function\s{1,20}\w+/m);
    if (fnMatch) {
      js = js.replace(/^(function\s{1,20}\w+)/m, 'module.exports = $1');
    }
  }

  // Strip TypeScript type annotations from function signatures and variable declarations.
  // Only match annotations that follow an identifier or closing paren — not inside strings.
  // Pattern: (identifier|))\s*:\s*Type → strip the `: Type` part
  js = js.replace(/(\w|\))\s*:\s*IRNode\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*string\[\]/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*string\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*number\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*boolean\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*void\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*any\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*CodegenHelpers\b/g, '$1');
  js = js.replace(/(\w|\))\s*:\s*Record<[^>]+>/g, '$1');
  js = js.replace(/<[A-Z]\w*(?:,\s?[A-Z]\w*){0,10}>/g, '');
  js = js.replace(/\bas\s{1,20}\w+/g, '');

  return js;
}

// ── Manifest management ──────────────────────────────────────────────────

function readManifest(evolvedDir: string): EvolvedManifest {
  const manifestPath = join(evolvedDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { version: 1, nodes: {} };
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return { version: 1, nodes: {} };
  }
}

function writeManifest(evolvedDir: string, manifest: EvolvedManifest): void {
  mkdirSync(evolvedDir, { recursive: true });
  writeFileSync(join(evolvedDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function updateManifest(
  evolvedDir: string,
  keyword: string,
  entry: EvolvedManifestEntry,
): void {
  const manifest = readManifest(evolvedDir);
  manifest.nodes[keyword] = entry;
  writeManifest(evolvedDir, manifest);
}

/**
 * Promote a graduated evolved node → core.
 *
 * Reads the node from .kern/evolved/<keyword>/, returns all the data
 * needed to add it to the core package. Does NOT write to core files
 * (that's the CLI's job — it knows the file paths).
 */
export function promoteNode(
  keyword: string,
  baseDir: string = process.cwd(),
): {
  success: boolean;
  error?: string;
  codegenTs?: string;
  goldenKern?: string;
  goldenOutput?: string;
  definition?: EvolvedNodeDefinition;
} {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const nodeDir = join(evolvedDir, keyword);

  if (!existsSync(nodeDir)) {
    return { success: false, error: `Node '${keyword}' is not graduated` };
  }

  const codegenTsPath = join(nodeDir, 'codegen.ts');
  const templateKernPath = join(nodeDir, 'template.kern');
  const expectedOutputPath = join(nodeDir, 'expected-output.ts');
  const defPath = join(nodeDir, 'definition.json');

  if (!existsSync(codegenTsPath)) {
    return { success: false, error: `Missing codegen.ts for '${keyword}'` };
  }
  if (!existsSync(defPath)) {
    return { success: false, error: `Missing definition.json for '${keyword}'` };
  }

  try {
    const codegenTs = readFileSync(codegenTsPath, 'utf-8');
    const goldenKern = existsSync(templateKernPath) ? readFileSync(templateKernPath, 'utf-8') : undefined;
    const goldenOutput = existsSync(expectedOutputPath) ? readFileSync(expectedOutputPath, 'utf-8') : undefined;
    const definition: EvolvedNodeDefinition = JSON.parse(readFileSync(defPath, 'utf-8'));

    return { success: true, codegenTs, goldenKern, goldenOutput, definition };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function removeFromManifest(evolvedDir: string, keyword: string): boolean {
  const manifest = readManifest(evolvedDir);
  if (!manifest.nodes[keyword]) return false;
  delete manifest.nodes[keyword];
  writeManifest(evolvedDir, manifest);
  return true;
}
