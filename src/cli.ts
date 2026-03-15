#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { parse } from './parser.js';
import { transpile } from './transpiler.js';
import { transpileWeb } from './transpiler-web.js';
import { transpileTailwind } from './transpiler-tailwind.js';
import { transpileNextjs } from './transpiler-nextjs.js';
import { decompile } from './decompiler.js';
import type { IRNode } from './types.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'nextjs';
const inputFile = args.find(a => !a.startsWith('--'));

if (!inputFile) {
  console.log('Usage: kern <file.kern> [--target=nextjs|tailwind|web|native] [options]');
  console.log('');
  console.log('Targets:');
  console.log('  nextjs    Next.js App Router (default)');
  console.log('  tailwind  React + Tailwind CSS');
  console.log('  web       React with inline styles');
  console.log('  native    React Native component');
  console.log('');
  console.log('Options:');
  console.log('  --decompile  Output human-readable pseudocode');
  console.log('  --minify     Output minified single-line Kern (LLM wire format)');
  console.log('  --pretty     Expand minified Kern back to indented format');
  process.exit(1);
}

const irSource = readFileSync(resolve(inputFile), 'utf-8');
const ast = parse(irSource);
const ext = inputFile.endsWith('.kern') ? '.kern' : '.ir';
const name = basename(inputFile, ext);

// ── Minify: indented Kern → single-line wire format ─────────────────────
if (args.includes('--minify')) {
  const minified = minifyKern(ast);
  const outFile = resolve(dirname(inputFile), `${name}.min.kern`);
  writeFileSync(outFile, minified);
  const savings = Math.round((1 - minified.length / irSource.length) * 100);
  console.log(`Minified: ${inputFile} → ${outFile}`);
  console.log(`Chars:    ${irSource.length} → ${minified.length} (${savings}% smaller)`);
  process.exit(0);
}

// ── Pretty: re-indent (useful after minify or messy edits) ──────────────
if (args.includes('--pretty')) {
  const pretty = prettyKern(ast);
  const outFile = resolve(dirname(inputFile), `${name}.kern`);
  writeFileSync(outFile, pretty);
  console.log(`Formatted: ${inputFile} → ${outFile}`);
  process.exit(0);
}

// ── Decompile: Kern → human-readable pseudocode ─────────────────────────
if (args.includes('--decompile')) {
  const result = decompile(ast);
  console.log(result.code);
  process.exit(0);
}

// ── Transpile: Kern → target code ───────────────────────────────────────
const result = target === 'native' ? transpile(ast) : target === 'web' ? transpileWeb(ast) : target === 'tailwind' ? transpileTailwind(ast) : transpileNextjs(ast);

const outFile = resolve(dirname(inputFile), `${name}.tsx`);
writeFileSync(outFile, result.code);

console.log(`Transpiled: ${inputFile} → ${outFile}`);
const targetNames: Record<string, string> = { native: 'React Native', web: 'React (inline)', tailwind: 'React + Tailwind', nextjs: 'Next.js App Router' };
console.log(`Target:     ${targetNames[target] || target}`);
console.log(`IR tokens:  ${result.irTokenCount}`);
console.log(`TS tokens:  ${result.tsTokenCount}`);
console.log(`Reduction:  ${result.tokenReduction}%`);
console.log(`Source map: ${result.sourceMap.length} entries`);

// ── Minify/Pretty implementations ───────────────────────────────────────

function minifyKern(node: IRNode): string {
  const type = node.type;
  const props = node.props || {};
  let head = type;

  // Serialize props (theme name is bare word, not key=value)
  for (const [k, v] of Object.entries(props)) {
    if (['styles', 'pseudoStyles', 'themeRefs'].includes(k)) continue;
    if (type === 'theme' && k === 'name') { head += ` ${v}`; continue; }
    if (typeof v === 'object' && v !== null && '__expr' in v) {
      head += ` ${k}={{ ${(v as unknown as { code: string }).code} }}`;
      continue;
    }
    const val = typeof v === 'string' && v.includes(' ') ? `"${v}"` : String(v);
    head += ` ${k}=${val}`;
  }

  // Serialize styles
  if (props.styles) {
    const pairs = Object.entries(props.styles as Record<string, string>)
      .map(([k, v]) => v.includes(' ') || v.includes(',') ? `"${k}":"${v}"` : `${k}:${v}`);
    head += ` {${pairs.join(',')}}`;
  }

  // Serialize pseudo styles
  if (props.pseudoStyles) {
    const pseudo = props.pseudoStyles as Record<string, Record<string, string>>;
    for (const [state, styles] of Object.entries(pseudo)) {
      for (const [k, v] of Object.entries(styles)) {
        head += ` {:${state}:${k}:${v}}`;
      }
    }
  }

  // Theme refs
  if (props.themeRefs) {
    for (const ref of props.themeRefs as string[]) {
      head += ` $${ref}`;
    }
  }

  // Children → S-expression style
  if (node.children && node.children.length > 0) {
    const kids = node.children.map(c => minifyKern(c)).join(',');
    return `${head}(${kids})`;
  }

  return head;
}

function prettyKern(node: IRNode, indent = ''): string {
  const type = node.type;
  const props = node.props || {};
  let line = `${indent}${type}`;

  for (const [k, v] of Object.entries(props)) {
    if (['styles', 'pseudoStyles', 'themeRefs'].includes(k)) continue;
    if (type === 'theme' && k === 'name') { line += ` ${v}`; continue; }
    if (typeof v === 'object' && v !== null && '__expr' in v) {
      line += ` ${k}={{ ${(v as unknown as { code: string }).code} }}`;
      continue;
    }
    const val = typeof v === 'string' && v.includes(' ') ? `"${v}"` : String(v);
    line += ` ${k}=${val}`;
  }

  if (props.styles) {
    const pairs = Object.entries(props.styles as Record<string, string>)
      .map(([k, v]) => v.includes(' ') || v.includes(',') ? `"${k}":"${v}"` : `${k}:${v}`);
    line += ` {${pairs.join(',')}}`;
  }

  if (props.pseudoStyles) {
    const pseudo = props.pseudoStyles as Record<string, Record<string, string>>;
    for (const [state, styles] of Object.entries(pseudo)) {
      for (const [k, v] of Object.entries(styles)) {
        line += `,${`:${state}:${k}:${v}`}`;
      }
    }
  }

  if (props.themeRefs) {
    for (const ref of props.themeRefs as string[]) {
      line += ` $${ref}`;
    }
  }

  let result = line + '\n';
  if (node.children) {
    for (const child of node.children) {
      result += prettyKern(child, indent + '  ');
    }
  }
  return result;
}
