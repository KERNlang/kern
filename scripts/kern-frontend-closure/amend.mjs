import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PINS, checkLedger, checkStructure, fail } from './amend-record.mjs';

const FLAG = process.argv.indexOf('--root');
const ROOT = resolve(process.env.KERN_AMEND_ROOT
  ?? (FLAG >= 0 ? process.argv[FLAG + 1] : fileURLToPath(new URL('../../', import.meta.url))));
const HERE = 'scripts/kern-frontend-closure';
const LEDGER = `${HERE}/closure-ledger.json`;
const ANCHOR = `${HERE}/amendments/chain-anchor.json`;

const digest = (path) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
const load = (path) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

function walk(path, edges, genesis) {
  let cursor = genesis;
  const visited = new Set();
  let pending;
  for (;;) {
    const matches = edges.filter((edge) => edge.parentDigest === cursor && !visited.has(edge));
    if (matches.length === 0) break;
    if (matches.length > 1) fail(`${path} chain forks at ${cursor}`);
    visited.add(matches[0]);
    if (matches[0].resultDigest === undefined) { pending = matches[0]; break; }
    cursor = matches[0].resultDigest;
  }
  if (visited.size !== edges.length) fail(`${path} carries an orphaned amendment edge`);
  return { cursor, pending };
}

export function plan() {
  const ledger = load(LEDGER);
  const anchor = existsSync(resolve(ROOT, ANCHOR)) ? load(ANCHOR) : {};
  const dir = `${HERE}/amendments`;
  const seen = new Set();
  const byPath = new Map();
  for (const name of readdirSync(resolve(ROOT, dir)).sort()) {
    if (!name.endsWith('.json') || name === 'chain-anchor.json') continue;
    const record = load(`${dir}/${name}`);
    checkStructure(record, ledger, seen);
    for (const entry of record.repin) {
      byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), { ...entry, file: `${dir}/${name}`, record }]);
    }
  }
  const actions = [];
  for (const [pin, section] of Object.entries(PINS)) {
    for (const { path, sha256 } of load(pin)[section]) {
      const edges = (byPath.get(path) ?? []).filter((edge) => edge.pin === pin);
      const actual = digest(path);
      if (!Object.hasOwn(anchor, path)) {
        if (edges.length > 0) fail(`${path} carries an unanchored amendment edge`);
        if (actual !== sha256) fail(`${path} drifted with no amendment naming it`);
        continue;
      }
      const { cursor, pending } = walk(path, edges, anchor[path]);
      if (cursor !== sha256) fail(`${path} chain does not reach the current pin`);
      if (pending === undefined && actual !== sha256) fail(`${path} drifted with no amendment naming it`);
      if (pending !== undefined && actual !== sha256) {
        checkLedger(pending.record, ledger, digest(LEDGER));
        actions.push({ actual, edge: pending, pin });
      }
    }
  }
  return actions;
}

function substitute(file, find, replace) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  if (text.split(find).length !== 2) fail(`${file} is not uniquely rewritable`);
  writeFileSync(resolve(ROOT, file), text.replace(find, replace));
}

function main() {
  const actions = plan();
  if (!process.argv.includes('--write')) {
    console.log(`KERN frontend closure amendment: chain verified, ${actions.length} pending re-pin(s).`);
    return;
  }
  for (const { actual, edge, pin } of actions) {
    const anchored = `"parentDigest": "${edge.parentDigest}"`;
    const indent = readFileSync(resolve(ROOT, edge.file), 'utf8').match(new RegExp(`([ \\t]*)${anchored}`, 'u'))?.[1];
    if (indent === undefined) fail(`${edge.record.id} parent digest is not rewritable`);
    substitute(pin, `"${edge.parentDigest}"`, `"${actual}"`);
    substitute(edge.file, anchored, `${anchored},\n${indent}"resultDigest": "${actual}"`);
  }
  console.log(`KERN frontend closure amendment: re-pinned ${actions.length} entr(ies).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
