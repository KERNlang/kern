/**
 * Rule: mixed-host-same-endpoint
 *
 * Cross-file rule (single source — runs against the reviewed repo, no
 * cross-stack partner needed). Fires when the same `(method, path)` is
 * fetched against two or more *different* non-dev hosts in the codebase.
 *
 * Concrete example:
 *
 *   // src/lib/users.ts
 *   await fetch(`https://api.example.com/api/users/${id}`);
 *
 *   // src/admin/legacy.ts
 *   await fetch(`https://beta-api.example.com/api/users/${id}`);
 *
 * Same path+method, different production hosts. Almost always a stale
 * base-URL — someone copy-pasted across a host migration or hardcoded
 * the old URL. The rule fires on every call-site that participates in
 * the divergence and lives in the file currently under review.
 *
 * This rule is built on top of the +41pp `host` data unlocked by
 * phase-1.5 (env-fallback const resolution). Without populated `host`,
 * the rule has nothing to compare and stays silent.
 *
 * FP gates:
 *   - Both/all hosts must be populated and absolute (relative URLs are
 *     intentionally same-origin; can't be inconsistent).
 *   - Dev-shaped hosts (localhost, 127.0.0.1, 0.0.0.0, *.local, *.test,
 *     and explicit ports on loopback) are skipped — `localhost` vs
 *     `api.prod.com` is normal env-aware code, not a bug.
 *   - Path must look internal (`/api/…`) so that random third-party SDK
 *     calls don't produce noise.
 *   - At least 2 different non-dev hosts must agree on path + method.
 *     Doesn't fire on single-call endpoints.
 *
 * Confidence: CROSS_STACK_HEURISTIC_CONFIDENCE (0.7). The match is
 * structural (same path + method, different host) but the intent
 * (migration vs intentional cross-region routing) needs human review.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { API_PATH_RE, CROSS_STACK_HEURISTIC_CONFIDENCE, normalizeClientUrl } from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';
import { apiCallRootCause } from './root-cause.js';

// Hosts we exclude from the divergence check. These are normal in
// dev/test code and not signs of a stale base URL.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)(:\d+)?$/i;
const DEV_TLD_RE = /\.(local|test|localhost)(:\d+)?$/i;

interface HostCall {
  node: ConceptNode;
  host: string;
  method: string;
  path: string;
}

function isDevHost(host: string): boolean {
  return DEV_HOST_RE.test(host) || DEV_TLD_RE.test(host);
}

export function mixedHostSameEndpoint(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  // Group every populated-host network call by `<METHOD> <path>`.
  const byEndpoint = new Map<string, HostCall[]>();
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect') continue;
      if (node.payload.kind !== 'effect') continue;
      if (node.payload.subtype !== 'network') continue;
      const host = node.payload.host;
      if (!host) continue;
      if (isDevHost(host)) continue;
      const method = node.payload.method;
      if (!method) continue;
      const target = node.payload.target;
      if (!target) continue;
      const path = normalizeClientUrl(target);
      if (!path) continue;
      if (!API_PATH_RE.test(path)) continue;

      const key = `${method.toUpperCase()} ${path}`;
      const arr = byEndpoint.get(key);
      if (arr) arr.push({ node, host, method, path });
      else byEndpoint.set(key, [{ node, host, method, path }]);
    }
  }

  const findings: ReviewFinding[] = [];
  for (const [endpoint, calls] of byEndpoint) {
    const distinctHosts = new Set(calls.map((c) => c.host));
    if (distinctHosts.size < 2) continue;

    // Fire on the calls that live in the file currently being reviewed.
    // A repo-wide rule still routes findings through the per-file context.
    for (const call of calls) {
      if (call.node.primarySpan.file !== ctx.filePath) continue;
      const otherHosts = [...distinctHosts].filter((h) => h !== call.host).sort();
      const allHosts = [...distinctHosts].sort();
      findings.push({
        source: 'kern',
        ruleId: 'mixed-host-same-endpoint',
        severity: 'warning',
        category: 'bug',
        message:
          `\`${endpoint}\` is fetched against multiple hosts in this codebase: [${allHosts.join(', ')}]. ` +
          `This call uses \`${call.host}\`; ${otherHosts.length === 1 ? 'another call uses' : 'other calls use'} ` +
          `\`${otherHosts.join(', ')}\`. ` +
          `Likely a stale base URL — confirm both hosts are intentional or unify them behind a single config const.`,
        primarySpan: call.node.primarySpan,
        fingerprint: createFingerprint(
          'mixed-host-same-endpoint',
          call.node.primarySpan.startLine,
          call.node.primarySpan.startCol,
        ),
        confidence: call.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
        rootCause: apiCallRootCause(call.node, call.path, call.method),
      });
    }
  }
  return findings;
}
