/** Shared fail-closed host-namespace contract for TS/Python parity.
 *
 * Host roots in this file name target/runtime namespaces whose member reads or
 * calls do not yet have portable KERN lowerings. The KERN stdlib registry owns
 * portable namespaces such as Math/Array/Object/JSON, so those roots are
 * excluded here by construction.
 *
 * Milestone C, Slice 2 — host `RegExp` is no longer exempt. KERN's certified
 * portable regex surface is the LITERAL `/…/` form (Slices 1/3/4/5); the host
 * `RegExp` constructor/global has no portable cross-target lowering (string-
 * pattern construction bypasses the literal escape pipeline; the runtime
 * SyntaxError/flag model diverges), so it is now RESERVED and fails-closed in
 * every position. The construction/value/`.source`-`.flags` screens that the
 * generic `Module.member` machinery does not cover live next to the regex
 * lowerings (see `REGEX_HOST_REGEXP_FAILCLOSE` in regex-normalize.ts).
 */
import { KERN_STDLIB_MODULES } from './kern-stdlib.js';

export const HOST_NAMESPACE_EXEMPT_ROOTS: ReadonlySet<string> = new Set<string>([
  // (empty) — every host root that is not a KERN stdlib module is reserved and
  // fails-closed. `RegExp` was the last exemption; Slice 2 removed it.
]);

const RAW_HOST_NAMESPACE_ROOTS: ReadonlySet<string> = new Set([
  'Math',
  'JSON',
  'Object',
  'Array',
  'Map',
  'Set',
  'Date',
  'RegExp',
  'Promise',
  'Reflect',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'BigInt',
  'Error',
  'Number',
  'String',
  'Boolean',
  'Function',
  'console',
  'process',
  'globalThis',
  'crypto',
  'Intl',
  'URL',
]);

const RESERVED_HOST_NAMESPACE_ROOTS: ReadonlySet<string> = new Set(
  [...RAW_HOST_NAMESPACE_ROOTS].filter(
    (name) => !KERN_STDLIB_MODULES.has(name) && !HOST_NAMESPACE_EXEMPT_ROOTS.has(name),
  ),
);

export function isHostNamespaceRoot(name: string): boolean {
  return RESERVED_HOST_NAMESPACE_ROOTS.has(name);
}

export function unmappedHostNamespaceMessage(targetLabel: string, root: string, member: string): string {
  return (
    `Unsupported host namespace in ${targetLabel} expression: ${root}.${member} is not registered for portable lowering in this context. ` +
    `Use a KERN stdlib call such as Number.floor/Json.parse when available, or bind a target-specific value explicitly. ` +
    `(If you meant a user value, bind or rename '${root}' in scope; this host API awaits the KERN stdlib registry - ` +
    `extend KERN_STDLIB_MODULES to add a portable lowering.)`
  );
}
