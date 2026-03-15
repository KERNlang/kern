#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { parse } from './parser.js';
import { transpile } from './transpiler.js';
import { transpileWeb } from './transpiler-web.js';
import { decompile } from './decompiler.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'web';
const inputFile = args.find(a => !a.startsWith('--'));

if (!inputFile) {
  console.log('Usage: llm-speach <file.ir> [--target=web|native] [--decompile]');
  console.log('');
  console.log('Targets:');
  console.log('  web     React/Next.js component (default)');
  console.log('  native  React Native component');
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

const result = target === 'native' ? transpile(ast) : transpileWeb(ast);

const name = basename(inputFile, '.ir');
const outFile = resolve(dirname(inputFile), `${name}.tsx`);
writeFileSync(outFile, result.code);

console.log(`Transpiled: ${inputFile} → ${outFile}`);
console.log(`Target:     ${target === 'native' ? 'React Native' : 'React/Next.js'}`);
console.log(`IR tokens:  ${result.irTokenCount}`);
console.log(`TS tokens:  ${result.tsTokenCount}`);
console.log(`Reduction:  ${result.tokenReduction}%`);
console.log(`Source map: ${result.sourceMap.length} entries`);
