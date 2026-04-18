/**
 * Template loader — lazy-registers built-in KERN templates from @kernlang/core's
 * TEMPLATE_CATALOG so expandTemplateNode can find them.
 *
 * Uses defaultRuntime's template registry. Idempotent: calling ensureTemplate()
 * for the same templateName twice only registers it once.
 */

import { defaultRuntime, type IRNode, parse, registerTemplate, TEMPLATE_CATALOG } from '@kernlang/core';

const registered = new Set<string>();

function findTemplateNode(source: string, templateName: string): IRNode | undefined {
  let ast: IRNode;
  try {
    ast = parse(source);
  } catch {
    // A single catalog template failing to parse must not abort lookup for
    // every other template.
    return undefined;
  }
  if (ast.type === 'template' && ast.props?.name === templateName) return ast;
  for (const child of ast.children || []) {
    if (child.type === 'template' && child.props?.name === templateName) return child;
  }
  return undefined;
}

/**
 * Ensure the named template is registered. Searches TEMPLATE_CATALOG, parses
 * the first matching template source, and registers it with defaultRuntime.
 *
 * Returns true if the template is available (either newly registered or already
 * was), false if it wasn't found in the catalog.
 */
export function ensureTemplate(templateName: string): boolean {
  if (registered.has(templateName)) return true;
  // If someone else already registered it, trust that.
  if (defaultRuntime.templateRegistry.has(templateName)) {
    registered.add(templateName);
    return true;
  }

  for (const entry of TEMPLATE_CATALOG) {
    for (const source of Object.values(entry.templates)) {
      const node = findTemplateNode(source, templateName);
      if (node) {
        registerTemplate(node);
        registered.add(templateName);
        return true;
      }
    }
  }
  return false;
}
