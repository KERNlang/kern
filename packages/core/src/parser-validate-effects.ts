/** Slice 6 — `effects=pure` validator.
 *
 *  Spec: docs/language/effects-pure-spec.md
 *
 *  Walks every `fn` / `derive` / `memo` node with `effects=pure` and rejects:
 *    1. `effects=...` on any other node type (allowed list is `fn|derive|memo`)
 *    2. `effects=<not-pure>` (slice 6 only accepts the literal `pure`) —
 *       includes empty string and ExprObject `effects={{ ... }}` per spec.
 *    3. `async=true` / `stream=true` combined with `effects=pure` (incompatible)
 *    4. handler / cleanup / expr body containing any of the FORBIDDEN_PATTERNS,
 *       checked AFTER stripping comments and string literals to avoid false
 *       positives on commented-out code or string content.
 *
 *  This is a static walker — same shape as the `batch=true` rejection in
 *  packages/terminal/src/transpiler-ink.ts. Limitations are documented in
 *  the spec doc and are intentional.
 *
 *  Does NOT change codegen — bodies that pass the walker emit unchanged. */

import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import { type IRNode, isExprObject } from './types.js';

const ALLOWED_NODE_TYPES = new Set(['fn', 'derive', 'memo']);

/** Patterns rejected inside an `effects=pure` body.
 *
 *  Each entry is a regex anchored on word boundaries / member-access
 *  punctuation. The walker reports the first match per pattern by name. */
const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  // ── I/O — Web ─────────────────────────────────────────────────────
  { name: 'fetch(', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'console.', pattern: /\bconsole\s*\./ },
  { name: 'process.', pattern: /\bprocess\s*\./ },
  // ── I/O — Filesystem ──────────────────────────────────────────────
  { name: 'readFileSync', pattern: /\breadFileSync\b/ },
  { name: 'writeFileSync', pattern: /\bwriteFileSync\b/ },
  { name: 'readFile(', pattern: /\breadFile\s*\(/ },
  { name: 'writeFile(', pattern: /\bwriteFile\s*\(/ },
  { name: 'fs.', pattern: /\bfs\s*\./ },
  // ── I/O — Browser storage ────────────────────────────────────────
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'document.', pattern: /\bdocument\s*\./ },
  { name: 'window.', pattern: /\bwindow\s*\./ },
  // ── I/O — Named HTTP clients (Codex review fix) ──────────────────
  // Spec lists axios/got/ky/undici explicitly — without these patterns
  // the validator silently accepted `axios.get(...)` etc. as pure.
  { name: 'axios.', pattern: /\baxios\s*[.(]/ },
  { name: 'got(', pattern: /\bgot\s*\(/ },
  { name: 'ky.', pattern: /\bky\s*[.(]/ },
  { name: 'undici.', pattern: /\bundici\s*\./ },
  { name: 'http.', pattern: /\bhttps?\s*\./ },
  // ── Time / randomness ───────────────────────────────────────────────
  { name: 'Math.random', pattern: /\bMath\.random\b/ },
  { name: 'Date.now', pattern: /\bDate\.now\b/ },
  { name: 'new Date()', pattern: /\bnew\s+Date\s*\(\s*\)/ },
  { name: 'crypto.randomUUID', pattern: /\bcrypto\.randomUUID\b/ },
  { name: 'crypto.getRandomValues', pattern: /\bcrypto\.getRandomValues\b/ },
  { name: 'performance.now', pattern: /\bperformance\.now\b/ },
  // ── Async / scheduling ──────────────────────────────────────────────
  { name: 'await', pattern: /\bawait\b/ },
  { name: '.then(', pattern: /\.then\s*\(/ },
  { name: '.catch(', pattern: /\.catch\s*\(/ },
  { name: '.finally(', pattern: /\.finally\s*\(/ },
  { name: 'setTimeout(', pattern: /\bsetTimeout\s*\(/ },
  { name: 'setInterval(', pattern: /\bsetInterval\s*\(/ },
  { name: 'setImmediate(', pattern: /\bsetImmediate\s*\(/ },
  { name: 'queueMicrotask(', pattern: /\bqueueMicrotask\s*\(/ },
  { name: 'requestAnimationFrame(', pattern: /\brequestAnimationFrame\s*\(/ },
  { name: 'requestIdleCallback(', pattern: /\brequestIdleCallback\s*\(/ },
];

/** Strip JS comments and string literals before pattern matching.
 *
 *  Gemini review fix: without this, a comment like `// don't call fetch()` or
 *  a string literal like `"console.log is forbidden"` would falsely match the
 *  forbidden patterns. We replace contents with empty quotes / spaces so
 *  positional source-map info would still survive (we don't emit that here,
 *  but the offset-preserving substitution is the careful default).
 *
 *  Limitations: template literal interpolations (`${...}`) are stripped along
 *  with the rest of the template — a `fetch(...)` inside `${}` will not be
 *  detected. Pure code shouldn't be embedding effectful calls inside template
 *  literals; if it does, declare it impure. */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`)
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => `\`${' '.repeat(Math.max(0, m.length - 2))}\``);
}

/** Extract the body code to scan for a node carrying `effects=pure`.
 *
 *  - `fn` / `memo`: handler child's `code` prop, plus cleanup blocks (Codex
 *    review fix — cleanup emits into the function's `finally` and would
 *    otherwise let `cleanup <<< console.log(...) >>>` bypass the walker).
 *  - `derive`: `expr` prop value.
 *  - Compact `expr={{ ... }}` form on `fn` is also scanned. */
function extractExpr(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isExprObject(value)) return value.code;
  return null;
}

function extractBody(node: IRNode): string {
  const props = node.props || {};
  const parts: string[] = [];

  if (node.type === 'derive' || node.type === 'fn') {
    const expr = extractExpr(props.expr);
    if (expr) parts.push(expr);
  }

  // Code-bearing children: handler (always emitted into the body) and
  // cleanup (emitted into the function's finally block on `fn`).
  for (const child of node.children || []) {
    if (child.type !== 'handler' && child.type !== 'cleanup') continue;
    const code = child.props?.code;
    if (typeof code === 'string') parts.push(code);
  }

  return parts.join('\n');
}

function describeEffectsValue(raw: unknown): string {
  if (typeof raw === 'string') return raw === '' ? '<empty>' : raw;
  if (isExprObject(raw)) return '<expression>';
  return String(raw);
}

function validateNode(state: ParseState, node: IRNode): void {
  const props = node.props || {};

  // Codex review fix: `effects` is "present" if the prop key exists at all,
  // including empty string and ExprObject values. The earlier guard
  // (`effects !== '' && typeof === 'string'`) silently dropped both, which
  // contradicts the spec rule "anything other than `pure` errors".
  const effectsRaw = props.effects;
  const effectsPresent =
    effectsRaw !== undefined &&
    (typeof effectsRaw === 'string' || isExprObject(effectsRaw) || typeof effectsRaw === 'boolean');

  if (effectsPresent) {
    // 1. Reject on disallowed node types — checked before value validity so
    // that `effects=junk` on a `transition` still surfaces the right diagnostic.
    if (!ALLOWED_NODE_TYPES.has(node.type as string)) {
      emitDiagnostic(
        state,
        'INVALID_EFFECTS',
        'error',
        `\`effects=\` is only allowed on \`fn\`, \`derive\`, or \`memo\` (got \`${node.type}\`). See docs/language/effects-pure-spec.md.`,
        node.loc?.line ?? 0,
        node.loc?.col ?? 0,
      );
    } else if (effectsRaw !== 'pure') {
      // 2. Slice 6 only accepts the literal `pure`. Empty string and
      // ExprObject both land here per Codex review.
      emitDiagnostic(
        state,
        'INVALID_EFFECTS',
        'error',
        `\`effects=${describeEffectsValue(effectsRaw)}\` is not yet supported — slice 6 only accepts the literal \`pure\`. See docs/language/effects-pure-spec.md for future extensions.`,
        node.loc?.line ?? 0,
        node.loc?.col ?? 0,
      );
    } else {
      // effects === 'pure' on an allowed node — apply the contract checks.
      // 3. Reject incompatible prop combinations.
      const incompatible: string[] = [];
      if (props.async === 'true' || props.async === true) incompatible.push('async=true');
      if (props.stream === 'true' || props.stream === true) incompatible.push('stream=true');
      if (incompatible.length > 0) {
        emitDiagnostic(
          state,
          'INVALID_EFFECTS',
          'error',
          `\`effects=pure\` is incompatible with ${incompatible.join(' and ')} — drop one.`,
          node.loc?.line ?? 0,
          node.loc?.col ?? 0,
        );
      } else {
        // 4. Body walker — reject any forbidden pattern. Strip comments and
        // string literals first to avoid false positives (Gemini review fix).
        const body = stripCommentsAndStrings(extractBody(node));
        if (body) {
          for (const { name, pattern } of FORBIDDEN_PATTERNS) {
            if (pattern.test(body)) {
              const nameProp = typeof props.name === 'string' ? props.name : node.type;
              emitDiagnostic(
                state,
                'INVALID_EFFECTS',
                'error',
                `\`${node.type} name=${nameProp}\` is marked \`effects=pure\` but its body uses \`${name}\` which is not allowed in a pure function. See docs/language/effects-pure-spec.md for the full forbidden list.`,
                node.loc?.line ?? 0,
                node.loc?.col ?? 0,
              );
              // Report the first match only — a single body usually has one
              // root cause; flooding with every match adds noise.
              break;
            }
          }
        }
      }
    }
  }

  if (node.children) {
    for (const child of node.children) validateNode(state, child);
  }
}

export function validateEffects(state: ParseState, root: IRNode): void {
  validateNode(state, root);
}
