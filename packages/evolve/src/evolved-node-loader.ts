/**
 * Evolved Node Loader — reads .kern/evolved/ at startup, registers types + generators.
 *
 * Called once before any parsing/codegen. Makes graduated nodes available
 * to the parser (via dynamic types + hints) and codegen (via generator map).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { registerEvolvedType, KERN_RESERVED } from '@kernlang/core';
import { loadSandboxedGenerator } from './sandboxed-generator.js';
import type { IRNode } from '@kernlang/core';
import type { EvolvedManifest, EvolvedManifestEntry, EvolvedNodeDefinition, ParserHints } from './evolved-types.js';

// ── Runtime registries (populated at startup) ────────────────────────────

const _evolvedGenerators = new Map<string, (node: IRNode) => string[]>();
const _parserHints = new Map<string, ParserHints>();
let _loaded = false;

/** Get the generator for an evolved node type. */
export function getEvolvedGenerator(type: string): ((node: IRNode) => string[]) | undefined {
  return _evolvedGenerators.get(type);
}

/** Get parser hints for an evolved node type. */
export function getParserHints(type: string): ParserHints | undefined {
  return _parserHints.get(type);
}

/** Check if any evolved nodes are loaded. */
export function hasEvolvedNodes(): boolean {
  return _evolvedGenerators.size > 0;
}

/** Get count of loaded evolved nodes. */
export function evolvedNodeCount(): number {
  return _evolvedGenerators.size;
}

/** Get all evolved keywords. */
export function getEvolvedKeywords(): string[] {
  return Array.from(_evolvedGenerators.keys());
}

/** Clear all loaded evolved nodes (for test isolation). */
export function clearEvolvedNodes(): void {
  _evolvedGenerators.clear();
  _parserHints.clear();
  _loaded = false;
}

// ── Loading ──────────────────────────────────────────────────────────────

export interface LoadResult {
  loaded: number;
  errors: Array<{ keyword: string; error: string }>;
}

/**
 * Load all evolved nodes from .kern/evolved/ directory.
 *
 * Reads the manifest, verifies hashes, loads sandboxed generators,
 * registers types in spec.ts's dynamic set, and stores parser hints.
 *
 * @param baseDir — project root (defaults to cwd)
 * @param verify — check SHA256 hashes (recommended for CI)
 */
export function loadEvolvedNodes(
  baseDir: string = process.cwd(),
  verify = false,
): LoadResult {
  if (_loaded) return { loaded: _evolvedGenerators.size, errors: [] };

  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const manifestPath = join(evolvedDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    _loaded = true;
    return { loaded: 0, errors: [] };
  }

  let manifest: EvolvedManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    _loaded = true;
    return { loaded: 0, errors: [{ keyword: '*', error: 'Failed to parse manifest.json' }] };
  }

  const errors: Array<{ keyword: string; error: string }> = [];
  let loaded = 0;

  for (const [keyword, entry] of Object.entries(manifest.nodes)) {
    try {
      loadSingleNode(evolvedDir, keyword, entry, verify);
      loaded++;
    } catch (err) {
      errors.push({ keyword, error: (err as Error).message });
    }
  }

  _loaded = true;
  return { loaded, errors };
}

function loadSingleNode(
  evolvedDir: string,
  keyword: string,
  entry: EvolvedManifestEntry,
  verify: boolean,
): void {
  // Safety: cannot shadow core types
  if (KERN_RESERVED.has(keyword as any)) {
    throw new Error(`Evolved keyword '${keyword}' conflicts with core KERN type`);
  }

  const nodeDir = join(evolvedDir, keyword);
  const codegenPath = join(nodeDir, 'codegen.js');

  if (!existsSync(codegenPath)) {
    throw new Error(`Missing codegen.js for evolved node '${keyword}'`);
  }

  // Hash verification
  if (verify) {
    const content = readFileSync(codegenPath, 'utf-8');
    const hash = 'sha256:' + createHash('sha256').update(content).digest('hex');
    if (hash !== entry.hash) {
      throw new Error(`Hash mismatch for '${keyword}': expected ${entry.hash}, got ${hash}`);
    }
  }

  // Load sandboxed generator
  const generator = loadSandboxedGenerator(codegenPath);
  _evolvedGenerators.set(keyword, generator);

  // Register type in spec
  registerEvolvedType(keyword);
  for (const child of entry.childTypes || []) {
    registerEvolvedType(child);
  }

  // Store parser hints
  if (entry.parserHints) {
    _parserHints.set(keyword, entry.parserHints);
  }
}

/**
 * Read the manifest without loading generators (for listing/inspection).
 */
export function readManifest(baseDir: string = process.cwd()): EvolvedManifest | null {
  const manifestPath = resolve(baseDir, '.kern', 'evolved', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read a single node's full definition.
 */
export function readNodeDefinition(
  keyword: string,
  baseDir: string = process.cwd(),
): EvolvedNodeDefinition | null {
  const defPath = resolve(baseDir, '.kern', 'evolved', keyword, 'definition.json');
  if (!existsSync(defPath)) return null;
  try {
    return JSON.parse(readFileSync(defPath, 'utf-8'));
  } catch {
    return null;
  }
}
