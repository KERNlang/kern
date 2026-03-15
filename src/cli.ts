#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { parse } from './parser.js';
import { transpile } from './transpiler.js';
import { transpileWeb } from './transpiler-web.js';
import { transpileTailwind } from './transpiler-tailwind.js';
import { transpileNextjs } from './transpiler-nextjs.js';
import { decompile } from './decompiler.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'nextjs';
const inputFile = args.find(a => !a.startsWith('--'));

if (!inputFile) {
  console.log('Usage: llm-speach <file.ir> [--target=nextjs|tailwind|web|native] [--decompile]');
  console.log('');
  console.log('Targets:');
  console.log('  nextjs    Next.js App Router (default)');
  console.log('  tailwind  React + Tailwind CSS');
  console.log('  web       React with inline styles');
  console.log('  native    React Native component');
  console.log('');
  console.log('Options:');
  console.log('  --decompile  Output human-readable pseudocode instead');
  process.exit(1);
}

const irSource = readFileSync(resolve(inputFile), 'utf-8');
const ast = parse(irSource);

if (args.includes('--decompile')) {
  const result = decompile(ast);
  console.log(result.code);
  process.exit(0);
}

const result = target === 'native' ? transpile(ast) : target === 'web' ? transpileWeb(ast) : target === 'tailwind' ? transpileTailwind(ast) : transpileNextjs(ast);

const name = basename(inputFile, '.ir');
const outFile = resolve(dirname(inputFile), `${name}.tsx`);
writeFileSync(outFile, result.code);

console.log(`Transpiled: ${inputFile} → ${outFile}`);
const targetNames: Record<string, string> = { native: 'React Native', web: 'React (inline)', tailwind: 'React + Tailwind', nextjs: 'Next.js App Router' };
console.log(`Target:     ${targetNames[target] || target}`);
console.log(`IR tokens:  ${result.irTokenCount}`);
console.log(`TS tokens:  ${result.tsTokenCount}`);
console.log(`Reduction:  ${result.tokenReduction}%`);
console.log(`Source map: ${result.sourceMap.length} entries`);
