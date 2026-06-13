/**
 * Phase-2 hash helpers.
 *
 * Every Phase-2 manifest/baseline field that must be stable across runs is a
 * sha256 of a CANONICAL byte string. Two flavors:
 *
 *   - `sha256(input)` hashes a string or Buffer/bytes directly. Used for raw
 *     artifact bytes (already canonical).
 *   - `stableHash(value)` hashes the deterministic JSON of a JS value: object
 *     keys sorted recursively, arrays in order, no whitespace. Used for the
 *     route table, corpus, normalizer rule list, etc. — anything whose identity
 *     is "this logical structure", not "these exact bytes".
 *
 * `stableHash` is NOT the runtime canonicalizer (`canonicalize.mjs`). That one
 * preserves NaN/-0/undefined for EXECUTED values; this one is a plain structural
 * digest for CONFIG values (which never contain NaN/-0/sentinels). Keeping them
 * separate avoids accidentally feeding config through the heavier encoder.
 */

import { createHash } from 'node:crypto';

/**
 * sha256 hex of a string or byte buffer.
 * @param {string | Uint8Array} input
 * @returns {string}
 */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic JSON of a JS value: object keys sorted recursively, no
 * whitespace. Throws on non-finite numbers / functions / undefined so a config
 * value can never silently collapse (those are not legal config inputs).
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
  return serialize(value);
}

/**
 * sha256 hex of `stableJson(value)`.
 * @param {unknown} value
 * @returns {string}
 */
export function stableHash(value) {
  return sha256(stableJson(value));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function serialize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`stableJson: non-finite number ${String(value)} is not a legal config value`);
    }
    return JSON.stringify(value);
  }
  if (t === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(/** @type {object} */ (value)).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${serialize(/** @type {Record<string, unknown>} */ (value)[k])}`)
      .join(',')}}`;
  }
  throw new Error(`stableJson: unsupported config value of type ${t}`);
}
