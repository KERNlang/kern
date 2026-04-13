import type { IRNode } from '@kernlang/core';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, relative, resolve } from 'path';
import { findKernFiles, parseAndSurface } from '../shared.js';

export async function runConfidence(args: string[]): Promise<void> {
  const confInput = args[1];
  if (!confInput) {
    console.error('Usage: kern confidence <file.kern|dir>');
    console.error('  Builds and displays the confidence graph for .kern file(s).');
    process.exit(1);
  }

  const confPath = resolve(confInput);
  if (!existsSync(confPath)) {
    console.error(`Not found: ${confInput}`);
    process.exit(1);
  }

  const { buildConfidenceGraph, buildMultiFileConfidenceGraph, flattenIR } = await import('@kernlang/review');
  const confStat = statSync(confPath);
  const isDir = confStat.isDirectory();

  const kernFiles = isDir ? findKernFiles(confPath) : [confPath];
  if (kernFiles.length === 0) {
    console.log('  No .kern files found.');
    process.exit(0);
  }

  const fileMap = new Map<string, IRNode[]>();
  for (const file of kernFiles.sort()) {
    const source = readFileSync(file, 'utf-8');
    if (!source.includes('confidence=')) continue;
    const ast = parseAndSurface(source, file);
    fileMap.set(file, flattenIR(ast));
  }

  if (fileMap.size === 0) {
    console.log(`\n  No confidence declarations found in ${isDir ? confInput : basename(confInput)}`);
    process.exit(0);
  }

  const graph =
    fileMap.size === 1 ? buildConfidenceGraph([...fileMap.values()][0]) : buildMultiFileConfidenceGraph(fileMap);

  const isMulti = fileMap.size > 1;

  console.log(
    `\n  Confidence Graph (${graph.nodes.size} nodes, ${graph.topoOrder.length} resolved${isMulti ? `, ${fileMap.size} files` : ''}):\n`,
  );

  if (isMulti) {
    const byFile = new Map<string, typeof graph extends { nodes: Map<string, infer N> } ? N[] : never>();
    for (const cnode of graph.nodes.values()) {
      const file = cnode.sourceFile || 'unknown';
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(cnode);
    }
    for (const [file, nodes] of byFile) {
      const rel = relative(process.cwd(), file) || file;
      console.log(`  ${rel} (${nodes.length} nodes):`);
      for (const cnode of nodes) {
        const resolvedStr = cnode.resolved !== null ? cnode.resolved.toFixed(2) : 'null';
        const specStr =
          cnode.spec.kind === 'literal'
            ? 'declared'
            : `from: ${cnode.spec.sources?.join(', ')}, ${cnode.spec.strategy}`;
        const crossFile = cnode.spec.sources?.some((s: string) => {
          const src = graph.nodes.get(s);
          return src && src.sourceFile !== cnode.sourceFile;
        });
        const crossTag = crossFile ? ' [cross-file]' : '';
        const cycleTag = cnode.inCycle ? ' [CYCLE]' : '';
        console.log(`    ${cnode.name.padEnd(20)} ${resolvedStr.padEnd(8)} (${specStr})${crossTag}${cycleTag}`);
      }
      console.log('');
    }
  } else {
    for (const [name, cnode] of graph.nodes) {
      const resolvedStr = cnode.resolved !== null ? cnode.resolved.toFixed(2) : 'null';
      const specStr =
        cnode.spec.kind === 'literal' ? 'declared' : `from: ${cnode.spec.sources?.join(', ')}, ${cnode.spec.strategy}`;
      const cycleTag = cnode.inCycle ? ' [CYCLE]' : '';
      console.log(`    ${name.padEnd(20)} ${resolvedStr.padEnd(8)} (${specStr})${cycleTag}`);
    }
  }

  const unresolvedNeeds: { name: string; what: string; wouldRaiseTo?: number }[] = [];
  for (const [name, cnode] of graph.nodes) {
    for (const need of cnode.needs) {
      if (!need.resolved) {
        unresolvedNeeds.push({ name, what: need.what, wouldRaiseTo: need.wouldRaiseTo });
      }
    }
  }

  if (unresolvedNeeds.length > 0) {
    console.log(`  Unresolved needs (${unresolvedNeeds.length}):`);
    for (const n of unresolvedNeeds) {
      const raise = n.wouldRaiseTo !== undefined ? ` → would raise to ${n.wouldRaiseTo}` : '';
      console.log(`    ${n.name}: "${n.what}"${raise}`);
    }
  }

  if (graph.cycles.length > 0) {
    console.log(`\n  Cycles (${graph.cycles.length}):`);
    for (const cycle of graph.cycles) {
      console.log(`    ${cycle.join(' → ')}`);
    }
  }

  const dupes =
    'duplicates' in graph ? (graph as { duplicates: Array<{ name: string; files: string[] }> }).duplicates : [];
  if (dupes.length > 0) {
    console.log(`\n  Duplicate names (${dupes.length}):`);
    for (const dup of dupes) {
      console.log(`    ${dup.name}: ${dup.files.map((f: string) => relative(process.cwd(), f) || f).join(', ')}`);
    }
  }

  console.log('');
  process.exit(0);
}
