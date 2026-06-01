/**
 * `.env` analyzer — duplicate variables, malformed assignments, and a
 * conservative committed-secret heuristic. Parallel to json.ts and
 * markdown.ts: a non-ts-morph path that participates in the same
 * ReviewFinding pipeline so kern-sight and kern-guard consume findings
 * without API changes. No parser dep — the format is line-oriented and
 * regex-tractable.
 *
 * Format conventions (dotenv-style, conservative subset):
 *
 *   • One assignment per line: `KEY=VALUE` or `KEY="quoted value"`.
 *   • Comments start with `#`. Inline comments (`KEY=val # note`) are
 *     accepted; the comment is stripped before secret-likeness checks.
 *   • Blank lines and pure-comment lines are ignored.
 *   • `export KEY=VALUE` is accepted (bash-style).
 *   • Continuation across lines is NOT supported. Multi-line values
 *     inside quotes are NOT supported (rare in real env files; out of
 *     scope for a hygiene scanner).
 *
 * Rules:
 *
 *   • `env/duplicate-key` — same KEY assigned more than once in the file.
 *     The second value wins on `process.env` parse. Fingerprint by key
 *     name (NOT line) so kern-guard dedup is stable; 3rd+ occurrences
 *     append `#N`.
 *   • `env/malformed` — a non-blank, non-comment line that does not
 *     match the assignment shape. Fingerprint by line content hash so
 *     formatting fixes upstream don't perturb downstream findings.
 *   • `env/possible-secret` — KEY matches `SECRET|TOKEN|API_KEY|PASSWORD|
 *     PRIVATE|ACCESS_KEY` AND value is non-empty AND is not an obvious
 *     placeholder (`changeme`, `example`, `<…>`, `${…}`, `your_…_here`,
 *     pure `*` masks, etc.). Warning severity — conservative on purpose;
 *     this should not fire on placeholders in `.env.example`.
 *
 * Files routed here are: `.env`, `.env.local`, `.env.development`,
 * `.env.production`, `.env.test`, `.env.<anything>`. Files named
 * `.env.example`, `.env.sample`, `.env.template`, `.env.defaults` are
 * scanned but the secret-likeness rule is SUPPRESSED — those are by
 * convention for committed placeholders.
 */

import { basename } from 'node:path';
import type { ReviewFinding, SourceSpan } from '../types.js';

// Matches `KEY=value`, `export KEY=value`, with optional spaces around `=`
// (dotenv accepts both `KEY=value` and `KEY = value` — discouraged but
// common). Captures:
//   [1] = key
//   [2] = value (everything after `=`, before any trailing comment)
const ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

// Keys that suggest a secret. Case-insensitive. Conservative set.
const SECRET_KEY_RE =
  /(?:^|_)(?:SECRET|TOKEN|API[_]?KEY|PASSWORD|PRIVATE[_]?KEY|ACCESS[_]?KEY|AUTH[_]?KEY|CLIENT[_]?SECRET)(?:$|_)/i;

// Placeholder shapes — if the value is one of these, do NOT fire the
// secret-likeness rule. The list is intentionally generous because the
// cost of a false positive on .env.example is much higher than missing
// one real secret (kern-guard would post the warning every PR).
const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /^(changeme|change-me|change_me|example|sample|placeholder|todo|tbd|xxx+|none|null|undefined|fill[_-]?me[_-]?in)\s*$/i,
  /^your[_-]?.+[_-]?here$/i, // `your_api_key_here`
  /^<[^>]+>$/, // `<your-token>`
  /^\$\{[^}]+\}$/, // `${VAR}`
  /^\*+$/, // pure asterisk mask
  /^[*x]+(?:[-_][*x]+)*$/i, // `xxx-xxx-xxx`
];

/** Strip surrounding single/double quotes if balanced. */
function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Produce the "value for secret-likeness check" from a raw post-`=` slice.
 *  Order matters: a quoted value with a trailing inline comment looks like
 *  `"changeme" # production`. Stripping the inline comment FIRST without
 *  quote-awareness would either bail (old behavior — bug) or chop a `#`
 *  inside the quotes. Walking forward through the string, tracking the
 *  initial quote char if any, gives the right answer in one pass:
 *
 *    1. trim
 *    2. if starts with `"` or `'`, find the matching closing quote and
 *       drop everything from the FIRST whitespace+`#` AFTER it
 *    3. otherwise, drop everything from the first whitespace+`#`
 *    4. unquote whatever remains
 *
 *  Used only for the secret-likeness check; duplicate detection compares
 *  full raw values to keep error spans precise. */
function valueForSecretCheck(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  let body = trimmed;
  const first = trimmed.charAt(0);
  if (first === '"' || first === "'") {
    // Find the matching unescaped closing quote.
    let endIdx = -1;
    for (let i = 1; i < trimmed.length; i++) {
      const c = trimmed.charAt(i);
      if (c === '\\') {
        i++; // skip the escaped char
        continue;
      }
      if (c === first) {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== -1) {
      // Everything past the closing quote, after optional whitespace, may
      // be an inline `# comment`. Take only the quoted portion (inclusive
      // of the quotes — `unquote` strips them next).
      body = trimmed.slice(0, endIdx + 1);
    }
    // If no closing quote was found, fall through and let the # stripper
    // handle the malformed input.
  } else {
    // Unquoted value — strip a `# comment` preceded by whitespace.
    const hashIdx = trimmed.indexOf(' #');
    if (hashIdx !== -1) body = trimmed.slice(0, hashIdx);
  }

  return unquote(body.trim());
}

function isPlaceholder(value: string): boolean {
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(value)) return true;
  }
  return false;
}

/** Treat files named `.env.example`, `.env.sample`, `.env.template`,
 *  `.env.defaults`, `.env.dist` as committed-placeholder files where the
 *  secret-likeness rule is suppressed. */
function isPlaceholderFile(filePath: string): boolean {
  const base = basename(filePath).toLowerCase();
  return /^\.env\.(example|sample|template|defaults|dist)$/.test(base);
}

/** Files this analyzer claims. Routed by basename, not extension: `.env`
 *  has no extension in the usual sense. */
export function isEnvFile(filePath: string): boolean {
  const base = basename(filePath);
  return base === '.env' || base.startsWith('.env.');
}

/** Fast non-cryptographic hash for malformed-line fingerprints. djb2. */
function hashShort(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function makeSpan(filePath: string, line: number, startCol: number, endCol: number): SourceSpan {
  return { file: filePath, startLine: line, startCol, endLine: line, endCol };
}

export function reviewEnvFile(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const suppressSecretRule = isPlaceholderFile(filePath);

  // Track first-occurrence + dup count per key for fingerprint stability.
  const seen = new Map<string, { firstLine: number; dupCount: number }>();

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;

    const m = raw.match(ASSIGNMENT_RE);
    if (!m) {
      // Malformed line — non-blank, non-comment, not parseable.
      const ruleId = 'env/malformed';
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'style',
        message: 'Line does not look like a `KEY=VALUE` assignment. dotenv parsers may skip or misread this line.',
        primarySpan: makeSpan(filePath, i + 1, 1, raw.length + 1),
        confidence: 85,
        // Fingerprint by content shape — same broken line on a different
        // line number stays the same finding. Different broken lines get
        // distinct fingerprints.
        fingerprint: `${ruleId}:${hashShort(trimmed)}`,
      });
      continue;
    }

    const key = m[1]!;
    const rawValue = m[2] ?? '';

    // ── Duplicate key ──────────────────────────────────────────────────
    const prior = seen.get(key);
    if (prior) {
      prior.dupCount += 1;
      const ruleId = 'env/duplicate-key';
      const suffix = prior.dupCount === 1 ? '' : `#${prior.dupCount}`;
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'bug',
        message: `Duplicate variable "${key}". The last assignment wins; earlier lines are silently overridden when dotenv loads the file.`,
        primarySpan: makeSpan(filePath, i + 1, 1, raw.length + 1),
        relatedSpans: [makeSpan(filePath, prior.firstLine, 1, 1)],
        confidence: 100,
        fingerprint: `${ruleId}:${key}${suffix}`,
      });
    } else {
      seen.set(key, { firstLine: i + 1, dupCount: 0 });
    }

    // ── Possible committed secret ──────────────────────────────────────
    if (!suppressSecretRule && SECRET_KEY_RE.test(key)) {
      const valueUnquoted = valueForSecretCheck(rawValue);
      if (valueUnquoted.length > 0 && !isPlaceholder(valueUnquoted)) {
        const ruleId = 'env/possible-secret';
        findings.push({
          source: 'kern',
          ruleId,
          severity: 'warning',
          category: 'bug',
          message: `"${key}" looks like a secret with a real-looking value committed. If this is a placeholder, rename the file to \`.env.example\` (or similar) or use \`<placeholder>\` / \`\${VAR}\` syntax.`,
          primarySpan: makeSpan(filePath, i + 1, 1, raw.length + 1),
          confidence: 70,
          // Fingerprint by key only — same key flagged across edits stays
          // the same finding. We do NOT include the value (changes are
          // exactly the signal we want to NOT suppress).
          fingerprint: `${ruleId}:${key}`,
        });
      }
    }
  }

  return findings;
}
