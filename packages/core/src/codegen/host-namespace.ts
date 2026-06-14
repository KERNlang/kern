/** Shared fail-closed host-namespace contract for TS/Python parity.
 *
 * Host roots in this file name target/runtime namespaces whose member reads or
 * calls do not yet have portable KERN lowerings. The KERN stdlib registry owns
 * portable namespaces such as Math/Array/Object/JSON, so those roots are
 * excluded here by construction. RegExp is intentionally exempt for Milestone B
 * until KERN's own regex surface lands in Milestone C.
 */
import { KERN_STDLIB_MODULES } from './kern-stdlib.js';

export const HOST_NAMESPACE_EXEMPT_ROOTS: ReadonlySet<string> = new Set([
  // RegExp stays usable as a host escape hatch in Milestone B. Milestone C
  // will move regex onto KERN's own portable regex surface, then remove this
  // exemption so regex behavior is fail-closed and cross-target owned.
  'RegExp',
]);

const RAW_HOST_NAMESPACE_ROOTS: ReadonlySet<string> = new Set([
  'Math',
  'JSON',
  'Object',
  'Array',
  'Date',
  'RegExp',
  'Promise',
  'Reflect',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'BigInt',
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
