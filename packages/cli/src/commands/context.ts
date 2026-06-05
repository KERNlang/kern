/**
 * `kern context` — emit the Project Context Graph (kern-context.json).
 *
 * The native, KERN-IR-accurate analogue of a code knowledge graph: a compact,
 * versioned map of the project's files, symbols, and — crucially — WHERE each
 * symbol is used. Any LLM/agent (codegen, Sight chat, an MCP server, an external
 * tool) can load it for instant whole-project context instead of grepping raw
 * files. It is the same artifact the reviewer injects as a per-batch spine, just
 * materialized to disk for general consumption.
 *
 * Usage:
 *   kern context [paths...]        # default: walk the current directory
 *   kern context src/ --out map.json
 *   kern context src/ --stdout     # print JSON to stdout instead of a file
 *   kern context src/ --max-depth 12
 *   kern context src/ --spine --stdout            # compact <kern-map> for a prompt
 *   kern context src/ --spine --spine-budget 3000 # cap the spine at 3000 tokens
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  buildCallGraph,
  buildContextArtifact,
  buildSpine,
  type CallGraph,
  type ProjectContextGraph,
  resolveImportGraph,
} from '@kernlang/review';
import { hasFlag, parseFlagOrNext } from '../shared.js';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'generated',
]);
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts'];

/** Flags that consume the following token as their value (so it isn't a path). */
const VALUE_FLAGS = new Set(['--out', '--max-depth', '--base', '--spine-budget']);

/** Recursively collect source files under the given paths (files pass through). */
export function collectSourceFiles(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (p: string): void => {
    const abs = resolve(p);
    if (seen.has(abs) || !existsSync(abs)) return;
    seen.add(abs);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(basename(abs))) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
    } else if (SOURCE_EXTS.some((ext) => abs.endsWith(ext)) && !abs.endsWith('.d.ts')) {
      out.push(abs);
    }
  };
  for (const p of paths) visit(p);
  return out;
}

const EMPTY_CALL_GRAPH: CallGraph = {
  functions: new Map(),
  deadExports: [],
  orphanFunctions: [],
  unresolvedCallCount: 0,
  defaultExportNames: new Map(),
};

export interface ContextOptions {
  maxDepth?: number;
  /**
   * Rewrite every artifact path relative to this directory so the emitted
   * kern-context.json is portable (committable, comparable across machines).
   * When unset, paths stay absolute.
   */
  base?: string;
}

/**
 * Build the context artifact for a set of entry paths. Pure over the filesystem
 * it reads — returned for direct use and so the CLI wrapper stays a thin shell.
 */
export function buildContextJson(paths: string[], opts: ContextOptions = {}): ProjectContextGraph {
  const entries = collectSourceFiles(paths.length ? paths : ['.']);
  const graph = resolveImportGraph(entries, { maxDepth: opts.maxDepth ?? 8 });
  const callGraph = graph.project ? buildCallGraph(graph, graph.project) : EMPTY_CALL_GRAPH;
  const artifact = buildContextArtifact(graph, callGraph);
  return opts.base ? relativizeArtifact(artifact, opts.base) : artifact;
}

/**
 * Build the compact, prompt-ready `<kern-map>` spine for a set of entry paths —
 * the whole-project context an LLM/agent drops straight into a prompt. Scopes to
 * every file in the artifact (the whole project) and fits `spineBudget` tokens
 * (default {@link DEFAULT_SPINE_TOKENS}), degrading through tiers when the
 * project is large. Returns '' when there are no exported symbols to surface.
 */
export function buildContextSpine(paths: string[], opts: ContextOptions & { spineBudget?: number } = {}): string {
  const artifact = buildContextJson(paths, opts);
  return buildSpine(artifact, {
    batchFiles: artifact.files.map((f) => f.path),
    tokenBudget: opts.spineBudget,
  });
}

/** Rewrite all paths (files, imports, use-sites) relative to `base`. */
function relativizeArtifact(a: ProjectContextGraph, base: string): ProjectContextGraph {
  const rel = (p: string): string => relative(base, p) || '.';
  return {
    ...a,
    files: a.files.map((f) => ({
      ...f,
      path: rel(f.path),
      imports: f.imports?.map((imp) => ({ ...imp, path: rel(imp.path) })),
    })),
    usage: Object.fromEntries(
      Object.entries(a.usage).map(([id, u]) => [
        id,
        { ...u, callers: u.callers.map((c) => ({ ...c, path: rel(c.path) })) },
      ]),
    ),
  };
}

export function runContext(args: string[]): void {
  // args[0] is the "context" subcommand; the rest are paths + flags.
  const rest = args.slice(1);
  const paths: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) i++; // skip the flag's value
      continue;
    }
    paths.push(a);
  }

  const maxDepth = Number(parseFlagOrNext(rest, '--max-depth') ?? 8);
  // Portable (relative) paths by default; --absolute keeps machine paths.
  const base = hasFlag(rest, '--absolute') ? undefined : (parseFlagOrNext(rest, '--base') ?? process.cwd());
  const ctxOpts: ContextOptions = { maxDepth: Number.isFinite(maxDepth) ? maxDepth : 8, base };

  // --spine: emit the compact, prompt-ready <kern-map> spine instead of the JSON
  // artifact — the form an LLM/agent drops straight into a prompt. --spine-budget
  // caps it (tokens); default DEFAULT_SPINE_TOKENS, degrading through tiers.
  if (hasFlag(rest, '--spine')) {
    const budgetArg = parseFlagOrNext(rest, '--spine-budget');
    const spineBudget = budgetArg !== undefined && Number.isFinite(Number(budgetArg)) ? Number(budgetArg) : undefined;
    const spine = buildContextSpine(paths, { ...ctxOpts, spineBudget });
    if (hasFlag(rest, '--stdout')) {
      console.log(spine);
      return;
    }
    const spineOut = parseFlagOrNext(rest, '--out') ?? 'kern-context.spine.txt';
    writeFileSync(spineOut, spine);
    console.log(`kern context: <kern-map> spine (${spine.length} chars) → ${spineOut}`);
    return;
  }

  const artifact = buildContextJson(paths, ctxOpts);
  const json = JSON.stringify(artifact, null, 2);

  if (hasFlag(rest, '--stdout')) {
    console.log(json);
    return;
  }
  const out = parseFlagOrNext(rest, '--out') ?? 'kern-context.json';
  writeFileSync(out, json);
  const usedSymbols = Object.values(artifact.usage).filter((u) => u.totalCount > 0).length;
  console.log(
    `kern context: ${artifact.files.length} files, ${artifact.symbols.length} symbols ` +
      `(${usedSymbols} with known callers) → ${out}`,
  );
}
