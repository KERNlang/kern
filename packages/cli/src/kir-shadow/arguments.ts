import { basename, resolve } from 'node:path';
import type { KirShadowCommand, KirShadowInvocation } from './types.js';
import { KirShadowAdmissionError } from './types.js';

const ENTRY = /^([^#]+\.kern)#([A-Za-z_][A-Za-z0-9_]*)$/u;
const VALUE_OPTIONS = new Set([
  '--allow-net',
  '--capability-timeout-ms',
  '--emit',
  '--facades-dir',
  '--fs-root',
  '--fs-write-root',
  '--iteration-budget',
  '--llm-base-url',
  '--llm-model',
  '--llm-provider',
  '--llm-response',
  '--outdir',
  '--python-model-backend',
  '--target',
]);

export function hasKirShadowOption(args: readonly string[]): boolean {
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg === '--kir-shadow' ||
      arg === '--kir-shadow-entry' ||
      arg.startsWith('--kir-shadow=') ||
      arg.startsWith('--kir-shadow-entry=')
    )
      return true;
    if (VALUE_OPTIONS.has(arg)) index += 1;
  }
  return false;
}

export function parseKirShadowInvocation(command: KirShadowCommand, args: readonly string[]): KirShadowInvocation {
  const values = args.slice(1);
  const files: string[] = [];
  let activation = false;
  let entryText: string | undefined;
  let outDirSeen = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--kir-shadow') {
      if (activation) throw new KirShadowAdmissionError('duplicate --kir-shadow');
      activation = true;
      continue;
    }
    if (value === '--kir-shadow-entry') {
      const next = values[index + 1];
      if (entryText !== undefined || next === undefined || next.startsWith('--')) {
        throw new KirShadowAdmissionError('invalid --kir-shadow-entry');
      }
      entryText = next;
      index += 1;
      continue;
    }
    if (command === 'compile' && (value === '--outdir' || value.startsWith('--outdir='))) {
      if (outDirSeen) throw new KirShadowAdmissionError('duplicate --outdir');
      outDirSeen = true;
      if (value === '--outdir') {
        const next = values[index + 1];
        if (next === undefined || next.startsWith('--')) throw new KirShadowAdmissionError('invalid --outdir');
        index += 1;
      } else if (value.length === '--outdir='.length) {
        throw new KirShadowAdmissionError('invalid --outdir');
      }
      continue;
    }
    if (value.startsWith('--')) throw new KirShadowAdmissionError(`incompatible option ${value.split('=')[0]}`);
    files.push(value);
  }

  if (!activation) throw new KirShadowAdmissionError('--kir-shadow-entry requires --kir-shadow');
  if (entryText === undefined) throw new KirShadowAdmissionError('--kir-shadow-entry is required');
  if (files.length !== 1) throw new KirShadowAdmissionError('--kir-shadow accepts exactly one file');
  const match = ENTRY.exec(entryText);
  if (!match) throw new KirShadowAdmissionError('entry must be <module-id>#<handler>');
  const fileName = basename(files[0]);
  if (!fileName.endsWith('.kern') || match[1] !== fileName) {
    throw new KirShadowAdmissionError('entry module must match the input basename');
  }
  return {
    command,
    entry: { handlerName: match[2], moduleId: match[1] },
    file: resolve(files[0]),
  };
}
