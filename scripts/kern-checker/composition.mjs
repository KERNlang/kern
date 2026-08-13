#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KERN_CHECKER_COMPOSITION_FORMAT = 'kern.checker.composition.1';
export const KERN_CHECKER_RECIPE = 'strip-leading-use-blocks-and-concat.1';
export const KERN_CHECKER_MEMBERS = Object.freeze([
  'examples/capstone-checker-subset/checker-while.kern',
  'examples/capstone-checker-subset/checker.kern',
  'examples/capstone-checker-subset/checker-entry.kern',
]);
export const KERN_CHECKER_COMPOSITE = 'examples/capstone-checker-subset/checker.composed.kern';
export const KERN_CHECKER_RECORD = 'scripts/kern-checker/composition.json';
export const FROZEN_CHECKER_SHA256 = '44a7ac9c556c0e876ec65c8a25ebca406c75346ab091ac70e9e8bc46fa56a614';
export const FROZEN_CHECKER_LINES = 613;

function fail(detail) {
  throw new TypeError(`KERN checker composition rejection: ${detail}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function member(path) {
  const absolute = resolve(ROOT, path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} must be a regular file`);
  const bytes = readFileSync(absolute);
  if (bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a) fail(`${path} must end in exactly one LF`);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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

export function createKernCheckerComposition() {
  const members = KERN_CHECKER_MEMBERS.map(member);
  const frozen = members[1];
  const frozenLines = frozen.source.split('\n').length - 1;
  if (frozen.sha256 !== FROZEN_CHECKER_SHA256 || frozenLines !== FROZEN_CHECKER_LINES) {
    fail('checker.kern changed from its frozen source identity');
  }
  for (const item of members) {
    if (item.path !== KERN_CHECKER_MEMBERS[1] && item.source.split('\n').length - 1 >= 500) {
      fail(`${item.path} must remain below 500 lines`);
    }
  }
  const source = members.map((item) => stripLeadingUses(item.source)).join('\n');
  for (const forbidden of ['checkFlatModule', 'flattenKernSource', 'parseDocument', 'parseExpression', 'spawnSync']) {
    if (source.includes(forbidden)) fail(`composed source delegates through ${forbidden}`);
  }
  const compositeBytes = Buffer.from(source);
  const record = {
    composite: { bytes: compositeBytes.length, path: KERN_CHECKER_COMPOSITE, sha256: digest(compositeBytes) },
    format: KERN_CHECKER_COMPOSITION_FORMAT,
    members: members.map(metadata),
    recipe: KERN_CHECKER_RECIPE,
  };
  return { compositeBytes, record };
}

export function verifyKernCheckerComposition() {
  const created = createKernCheckerComposition();
  const composite = member(KERN_CHECKER_COMPOSITE);
  const record = JSON.parse(member(KERN_CHECKER_RECORD).source);
  if (composite.sha256 !== created.record.composite.sha256 || composite.bytes.length !== created.compositeBytes.length) {
    fail('composite is stale');
  }
  if (JSON.stringify(record) !== JSON.stringify(created.record)) fail('composition record is stale');
  return { ...created, source: composite.source };
}

function write() {
  const created = createKernCheckerComposition();
  writeFileSync(resolve(ROOT, KERN_CHECKER_COMPOSITE), created.compositeBytes);
  writeFileSync(resolve(ROOT, KERN_CHECKER_RECORD), `${JSON.stringify(created.record, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) write();
  else {
    const result = verifyKernCheckerComposition();
    process.stdout.write(`KERN checker composition: ${result.record.composite.bytes} bytes, SHA-256 ${result.record.composite.sha256}\n`);
  }
}
