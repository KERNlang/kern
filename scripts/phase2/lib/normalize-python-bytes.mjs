/**
 * Phase-2 Python byte normalizer — ALLOWLIST ONLY.
 *
 * Gate-EXT snapshots PRODUCTION Python bytes. Before comparison we strip only
 * universal byte noise that is not part of the emitted-code contract:
 *
 *   1. `lf`                  — CRLF / lone CR -> LF
 *   2. `strip-trailing-space`— trailing spaces/tabs on each line removed
 *   3. `final-newline`       — exactly one trailing newline
 *
 * It MUST NOT sort keys, reorder imports, fold/dedupe helpers, canonicalize
 * literals, reformat code, or drop comments — production does none of those, so
 * doing them here would hide real drift. The rule list is hashed
 * (`normalizerSha256`) and written into the manifest; if the rule set ever
 * changes, the gate fails `EXT_NORMALIZER_DRIFT`. The gate ALSO re-derives the
 * effective rule set from this module at run time and refuses to proceed if it
 * is not exactly these three (a tamper guard — see `gate-meta.test.ts`).
 */

import { sha256 } from './hash.mjs';

/** The frozen, ordered allowlist. Any change here changes `normalizerSha256`. */
export const NORMALIZER_RULES = Object.freeze(['lf', 'strip-trailing-space', 'final-newline']);

/**
 * Normalize emitted Python bytes per the allowlist.
 * @param {string} input
 * @returns {string}
 */
export function normalizePythonBytes(input) {
  if (typeof input !== 'string') {
    throw new Error('normalizePythonBytes: input must be a string');
  }
  // 1. LF line endings.
  const lf = input.replace(/\r\n?/g, '\n');
  // 2. Strip trailing whitespace per line.
  const stripped = lf
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
  // 3. Exactly one final newline.
  const final = `${stripped.replace(/\n+$/, '')}\n`;
  return final;
}

/**
 * sha256 of the canonical rule list. Embedded in manifests; a mismatch fails
 * `EXT_NORMALIZER_DRIFT`.
 * @returns {string}
 */
export function normalizerSha256() {
  return sha256(JSON.stringify(NORMALIZER_RULES));
}
