/**
 * Adapter registry — keyed by TemplateMatch.templateName.
 *
 * Adapters are registered up-front (see adapters/index.ts). A future public
 * API could expose `register()` for external adapters; for MVP the set is
 * fixed and shipped with the package.
 */

import type { TemplateAdapter } from './types.js';

const registry = new Map<string, TemplateAdapter>();

export function registerAdapter(adapter: TemplateAdapter): void {
  registry.set(adapter.templateName, adapter);
}

export function getAdapter(templateName: string): TemplateAdapter | undefined {
  return registry.get(templateName);
}

export function listAdapters(): TemplateAdapter[] {
  return Array.from(registry.values());
}

export function hasAdapter(templateName: string): boolean {
  return registry.has(templateName);
}
