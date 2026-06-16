// One-off generator for the FROZEN regex /i fold table (Milestone C, Slice-/i).
//
// Reads the vendored probe seed `regex-fold-table.seed.json` (the empirical
// /i fold partition produced on node v22.22.0 / Unicode 16.0 and validated
// cross-engine against python3 3.12.7 / unicodedata 15.0.0) and emits
// `packages/core/src/codegen/regex-fold-table.ts` as PURE COMMITTED DATA.
//
// Run MANUALLY only:  node packages/core/scripts/gen-regex-fold-table.mjs
//
// This is DELIBERATELY NOT wired into `pnpm build`. The table must be a frozen
// embedded artifact, never recomputed from the host Unicode DB at build time:
// node Unicode 16.0 and python unicodedata 15.0.0 disagree on 42 fold classes,
// so a host-regenerated table would emit a class on one host while reasoning
// about a different class on the other. The committed .ts is the source of
// truth; this generator + the seed are provenance only.
//
// Set(A) (class-expandable) = the seed's 1050 size-2 pairs + the seed's 23
// size-3/4 entries (which the probe's compare_sizeN_expansion.py proved are
// recovered byte-identically — they are NOT the true fail-close residue; the
// seed file's "setB" key is a probe-internal label for "class-size>2"). Every
// member char maps to its full fold-class string in CODEPOINT-ASCENDING order
// (a deterministic, total, review-stable order; member order inside a `[...]`
// class is match-irrelevant so this choice is purely for reproducibility).
//
// Set(B) (true fail-close) = the length-changing / declined folds that have NO
// single-codepoint /i partner and so cannot be written as a character class
// (ß→SS, ligatures→FI/FF/…, titlecase ǰ/ŉ, ΐ/ΰ→multi-cp). Verified complete for
// U+0080..U+FFFF: every non-ASCII BMP letter that /i-folds to a *different*
// single codepoint is in Set(A); the only letters that fold non-trivially but
// are NOT class-expandable are exactly this residue. Astral (cp>0xFFFF) is a
// separate slice and intentionally NOT handled here.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, 'regex-fold-table.seed.json'), 'utf8'));

// --- Build full Set(A): char -> codepoint-ascending class string. ---
/** @type {Array<number[]>} each entry = the codepoints of one fold class */
const classes = [];
for (const e of seed.setA) classes.push([e.c, e.p]); // size-2 pairs
for (const e of seed.setB) classes.push([...e.members]); // size-3/4 recovered classes

/** @type {Map<string,string>} member char -> class string (cp-ascending) */
const setAMembers = new Map();
for (const cps of classes) {
  const asc = [...cps].sort((a, b) => a - b);
  const classStr = asc.map((cp) => String.fromCodePoint(cp)).join('');
  for (const cp of cps) {
    const ch = String.fromCodePoint(cp);
    // Sanity: a char must not belong to two different classes.
    if (setAMembers.has(ch) && setAMembers.get(ch) !== classStr) {
      throw new Error(`fold-table conflict for ${JSON.stringify(ch)}: ${setAMembers.get(ch)} vs ${classStr}`);
    }
    setAMembers.set(ch, classStr);
  }
}

// --- True fail-close Set(B): length-changing / declined non-`u` /i folds with
// no single-codepoint partner. Frozen, empirically validated (oracle setA-mini
// + i-fold-partition-RESULTS.md). ---
const setBChars = ['ß', 'ﬀ', 'ﬁ', 'ﬂ', 'ﬃ', 'ﬄ', 'ǰ', 'ŉ', 'ΐ', 'ΰ', 'ẞ'];

// Defensive: Set(A) and Set(B) must be disjoint.
for (const ch of setBChars) {
  if (setAMembers.has(ch)) throw new Error(`Set(B) char ${JSON.stringify(ch)} is also in Set(A)`);
}

// --- Emit the .ts. ---
const u = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
// Single-quoted string literal (matches the project's biome quote style, so a
// re-run of this generator reproduces the committed file byte-for-byte).
const sq = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const memberEntries = [...setAMembers.entries()].sort((a, b) => a[0].codePointAt(0) - b[0].codePointAt(0));

const lines = [];
lines.push('// AUTO-GENERATED — FROZEN DATA. DO NOT EDIT BY HAND, DO NOT AUTO-REGENERATE IN BUILD.');
lines.push('//');
lines.push('// Milestone C, Slice-/i: the frozen Unicode case-fold table for portable');
lines.push('// case-insensitive regex lowering. Generated ONCE by');
lines.push('// `packages/core/scripts/gen-regex-fold-table.mjs` from the vendored probe seed');
lines.push('// `regex-fold-table.seed.json` (empirical /i fold partition, node v22.22.0 /');
lines.push('// Unicode 16.0, cross-validated against python3 3.12.7 / unicodedata 15.0.0).');
lines.push('//');
lines.push('// FROZEN ON PURPOSE — never recompute from a host Unicode DB at build/lowering');
lines.push('// time: node (U16.0) and python (U15.0.0) disagree on 42 fold classes, so a');
lines.push('// host-regenerated table would diverge between a node-host and a python-host');
lines.push('// build. The explicit class expansion this table feeds is matched by pure');
lines.push('// codepoint membership (no host fold DB at match time), so it is');
lines.push('// version-DB-independent precisely BECAUSE the table is frozen.');
lines.push('//');
lines.push('// SET_A_MEMBERS: every class-expandable non-ASCII letter -> its full fold-class');
lines.push('// string (codepoint-ascending; member order is match-irrelevant). Under /i a');
lines.push('// Set(A) letter `é` is rewritten to the explicit class `[' + (setAMembers.get('é') ?? '') + ']`.');
lines.push('// SET_B: the true fail-close residue — length-changing / declined folds (ß→SS,');
lines.push('// ligatures, titlecase) with no single-codepoint partner; KERN refuses /i over');
lines.push('// these rather than silently drop the intended fold.');
lines.push('//');
lines.push(`// Set(A): ${classes.length} fold classes, ${memberEntries.length} member chars.`);
lines.push(`// Set(B): ${setBChars.length} fail-close chars.`);
lines.push('');
lines.push('export const SET_A_MEMBERS: ReadonlyMap<string, string> = new Map([');
for (const [ch, cls] of memberEntries) {
  lines.push(`  [${sq(ch)}, ${sq(cls)}], // ${u(ch.codePointAt(0))}`);
}
lines.push(']);');
lines.push('');
lines.push('export const SET_B: ReadonlySet<string> = new Set([');
for (const ch of setBChars) {
  lines.push(`  ${sq(ch)}, // ${u(ch.codePointAt(0))}`);
}
lines.push(']);');
lines.push('');

const out = join(here, '..', 'src', 'codegen', 'regex-fold-table.ts');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote ${out}`);
console.log(`Set(A): ${classes.length} classes / ${memberEntries.length} member chars; Set(B): ${setBChars.length} chars`);
