/**
 * Rule: insecure-transport
 *
 * Fires when a `network` effect concept calls a literal `http://` URL whose
 * host is publicly resolvable. KERN surfaces this where most generic scanners
 * stay silent — we already extract `host` and `target` on the network effect
 * during concept extraction, so the rule is a thin host-classification gate.
 *
 * Hard-excluded hosts (intentional `http://` is overwhelmingly local /
 * service-mesh / load-balancer-terminated traffic):
 *   - localhost variants:  localhost, 127.0.0.0/8, ::1, 0.0.0.0
 *   - RFC1918 private:     10/8, 172.16/12, 192.168/16, 169.254/16 (link-local)
 *   - Special TLDs:        .local, .internal, .test, .svc, .cluster.local
 *   - Unresolved targets:  template-interpolated, env-var-only, missing host
 *
 * Per Codex plan-review: a standalone "auth-route called over http" rule was
 * deferred — it adds noise without proving the transport actually crosses an
 * untrusted boundary. The narrower public-host-only check below is the
 * defensible default; future audit-mode can extend.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { ConceptRuleContext } from './index.js';

// `127.\d+(\.\d+){0,2}` covers short-form IPv4 like `127.1` and `127.0.1`,
// which resolve to 127.0.0.1 in libc but bypass strict dotted-quad regex.
// The port suffix is `(?::[^/?#\s]*)?` (not `:\d+`) because a loopback/private
// host stays loopback regardless of the port FORM — including a template-
// interpolated port that the concept mapper renders non-numerically, e.g.
// `http://127.0.0.1:${port}` → host `127.0.0.1::port`. Only the port is
// loosened; the host prefix still must match an exempt class, so a public host
// like `127.0.0.1.evil.com` (no leading `:` after the IP) is NOT exempted.
const LOCALHOST_RE = /^(localhost|127\.\d+(?:\.\d+){0,2}|0\.0\.0\.0|::1|\[::1\])(?::[^/?#\s]*)?$/i;
const RFC1918_RE =
  /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(?::[^/?#\s]*)?$/;
// Anchored at end of host: `auth.internal$` exempt, `internal.com$` not.
// Single-label hosts like `http://svc/` (Docker/k8s service DNS) are
// exempted via the `(?:^|\.)` alternative — `svc$` matches with empty `^`.
const SPECIAL_TLD_RE = /(?:^|\.)(?:local|internal|test|svc)(?::[^/?#\s]*)?$/i;
const CLUSTER_LOCAL_RE = /\.cluster\.local(?::[^/?#\s]*)?$/i;

export function insecureTransport(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'effect') continue;
    if (node.payload.kind !== 'effect') continue;
    if (node.payload.subtype !== 'network') continue;

    const target = node.payload.target;
    if (!target || typeof target !== 'string') continue;
    // URL schemes are case-insensitive per RFC 3986 — `HTTP://` is still
    // plain HTTP. Codex impl-review #3 caught this FN.
    if (!/^http:\/\//i.test(target)) continue;

    // Prefer the mapper-resolved `host` (already lowercased and stripped of
    // path/query). Fall back to a quick parse of `target`. If neither
    // produces a host string, the URL must be templated or otherwise
    // unresolved — stay silent rather than guess.
    const host = node.payload.host ?? extractHostFromTarget(target);
    if (!host) continue;
    if (isExemptHost(host)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'insecure-transport',
      severity: 'warning',
      category: 'bug',
      message: `Network call uses http:// to public host '${host}' — credentials and payload travel unencrypted`,
      primarySpan: node.primarySpan,
      suggestion: `Switch the URL scheme to https:// (or, if the target genuinely lacks TLS, route through a TLS-terminating proxy you control)`,
      fingerprint: createFingerprint('insecure-transport', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: 90,
    });
  }

  return findings;
}

function extractHostFromTarget(target: string): string | undefined {
  // Parse minimally — `new URL` would throw on the very inputs we want to
  // skip (template-literal residue like `http://${HOST}/x`).
  // Strip optional `user:pass@` userinfo so authenticated URLs to localhost
  // (`http://admin:secret@localhost`) classify against the real host.
  const match = target.match(/^http:\/\/(?:[^@\s/?#]+@)?([^/?#\s]+)/i);
  return match?.[1].toLowerCase();
}

function isExemptHost(host: string): boolean {
  if (LOCALHOST_RE.test(host)) return true;
  if (RFC1918_RE.test(host)) return true;
  if (CLUSTER_LOCAL_RE.test(host)) return true;
  if (SPECIAL_TLD_RE.test(host)) return true;
  // Hostnames that look unresolved: contain `${`, `<`, or backticks (a
  // template fragment slipped through the mapper) → treat as unresolved.
  if (/[${}`<>]/.test(host)) return true;
  return false;
}
