#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KERN_FORMATTER_COMPOSITION_FORMAT = 'kern.formatter.composition.1';
export const KERN_FORMATTER_RECIPE = 'strip-leading-use-blocks-and-concat.1';
export const KERN_FORMATTER_MEMBERS = Object.freeze([
  'examples/kern-formatter/source-tape-helpers.kern',
  'examples/kern-formatter/source-tape.kern',
  'examples/kern-formatter/formatter.kern',
]);
export const KERN_FORMATTER_COMPOSITE = 'examples/kern-formatter/formatter.composed.kern';
export const KERN_FORMATTER_RECORD = 'scripts/kern-formatter/composition.json';

function fail(detail) {
  throw new TypeError(`KERN formatter composition rejection: ${detail}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function member(path, enforceHandwrittenLineLimit = true) {
  const absolute = resolve(ROOT, path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} must be a regular file`);
  const bytes = readFileSync(absolute);
  if (bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a) fail(`${path} must end in exactly one LF`);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (enforceHandwrittenLineLimit && source.split('\n').length - 1 >= 500) {
    fail(`${path} must remain below 500 lines`);
  }
  return { bytes, path, sha256: digest(bytes), source };
}

function stripLeadingUses(source) {
  const lines = source.split('\n');
  let index = 0;
  while (index < lines.length && lines[index].startsWith('use ')) {
    index += 1;
    while (index < lines.length && /^\s+from\s/u.test(lines[index])) index += 1;
    while (index < lines.length && lines[index] === '') index += 1;
  }
  return `${lines.slice(index).join('\n').replace(/^\n+|\n+$/gu, '')}\n`;
}

function metadata(item) {
  return { bytes: item.bytes.length, path: item.path, sha256: item.sha256 };
}

export function createKernFormatterComposition() {
  const members = KERN_FORMATTER_MEMBERS.map(member);
  const source = members.map((item) => stripLeadingUses(item.source)).join('\n');
  for (const forbidden of ['formatWithBiome', 'biome', 'tokenizeLineInternal', 'parseDocument', 'spawnSync']) {
    if (source.includes(forbidden)) fail(`composed source delegates through ${forbidden}`);
  }
  const compositeBytes = Buffer.from(source);
  const record = {
    composite: { bytes: compositeBytes.length, path: KERN_FORMATTER_COMPOSITE, sha256: digest(compositeBytes) },
    format: KERN_FORMATTER_COMPOSITION_FORMAT,
    members: members.map(metadata),
    recipe: KERN_FORMATTER_RECIPE,
  };
  return { compositeBytes, record };
}

export function verifyKernFormatterComposition() {
  const created = createKernFormatterComposition();
  const composite = member(KERN_FORMATTER_COMPOSITE, false);
  const record = JSON.parse(member(KERN_FORMATTER_RECORD).source);
  if (composite.sha256 !== created.record.composite.sha256 || composite.bytes.length !== created.compositeBytes.length) {
    fail('composite is stale');
  }
  if (JSON.stringify(record) !== JSON.stringify(created.record)) fail('composition record is stale');
  return { ...created, source: composite.source };
}

function write() {
  const created = createKernFormatterComposition();
  writeFileSync(resolve(ROOT, KERN_FORMATTER_COMPOSITE), created.compositeBytes);
  writeFileSync(resolve(ROOT, KERN_FORMATTER_RECORD), `${JSON.stringify(created.record, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) write();
  else {
    const result = verifyKernFormatterComposition();
    process.stdout.write(`KERN formatter composition: ${result.record.composite.bytes} bytes, SHA-256 ${result.record.composite.sha256}\n`);
  }
}
