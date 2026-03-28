/**
 * Kern Template Engine — dynamic pattern support
 *
 * Users define reusable code patterns in .kern files with typed slots.
 * Templates are registered at config/CLI time, then expanded during codegen.
 */

import type { IRNode, TemplateDefinition, TemplateSlot, TemplateImport, TemplateSlotType } from './types.js';
import { generateCoreNode, emitIdentifier, emitTemplateSafe } from './codegen-core.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';

// ── Registry — now delegates to defaultRuntime ──────────────────────────

const MAX_EXPANSION_DEPTH = 10;

// ── Errors ──────────────────────────────────────────────────────────────

export class KernTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernTemplateError';
  }
}

// ── Slot Validation ─────────────────────────────────────────────────────

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateSlotValue(name: string, value: string, slotType: TemplateSlotType): void {
  switch (slotType) {
    case 'identifier':
      if (!IDENTIFIER_RE.test(value)) {
        throw new KernTemplateError(
          `Slot '${name}' requires a valid identifier, got '${value}'`
        );
      }
      break;
    case 'type':
    case 'expr':
      if (!value || value.trim().length === 0) {
        throw new KernTemplateError(
          `Slot '${name}' (${slotType}) must be non-empty`
        );
      }
      break;
    case 'block':
      // blocks are always valid (can be empty)
      break;
  }
}

// ── Registration ────────────────────────────────────────────────────────

function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

/**
 * Register a template from a parsed 'template' IRNode.
 * Extracts slot definitions, import declarations, and body from children.
 */
export function registerTemplate(node: IRNode, sourceFile?: string): void {
  const props = p(node);
  const name = props.name as string;

  if (!name) {
    throw new KernTemplateError('Template must have a name= prop');
  }

  // Parse slots from children
  const slots: TemplateSlot[] = [];
  for (const child of kids(node, 'slot')) {
    const cp = p(child);
    const slotName = cp.name as string;
    if (!slotName) {
      throw new KernTemplateError(`Template '${name}': slot must have a name= prop`);
    }
    const slotType = (cp.type as TemplateSlotType) || 'expr';
    const optional = cp.optional === 'true' || cp.optional === true;
    const defaultValue = cp.default as string | undefined;
    slots.push({ name: slotName, slotType, optional, defaultValue });
  }

  // Parse imports from children
  const imports: TemplateImport[] = [];
  for (const child of kids(node, 'import')) {
    const cp = p(child);
    const from = cp.from as string;
    const names = cp.names as string;
    if (from && names) {
      imports.push({ from, names });
    }
  }

  // Extract body from body child
  const bodyNode = kids(node, 'body')[0];
  if (!bodyNode) {
    throw new KernTemplateError(`Template '${name}': must have a body <<< >>> block`);
  }
  const body = (p(bodyNode).code as string) || '';

  defaultRuntime.registerTemplate(name, { name, slots, imports, body, sourceFile });
}

/** Check if a node type matches a registered template. */
export function isTemplateNode(type: string, runtime?: KernRuntime): boolean {
  const rt = runtime ?? defaultRuntime;
  return rt.isTemplateNode(type);
}

/** Clear all registered templates (for test isolation). */
export function clearTemplates(): void {
  defaultRuntime.clearTemplates();
}

/** Get a registered template definition by name. */
export function getTemplate(name: string): TemplateDefinition | undefined {
  return defaultRuntime.getTemplate(name);
}

/** Get count of registered templates. */
export function templateCount(): number {
  return defaultRuntime.templateCount();
}

// ── Expansion ───────────────────────────────────────────────────────────

/** Strip common leading whitespace from multiline body text. */
function dedentBody(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
  return lines.map(l => l.slice(min)).join('\n');
}

/**
 * Expand a template instance node into TypeScript lines.
 *
 * 1. Look up template definition
 * 2. Validate required slots against node.props
 * 3. Replace {{slotName}} placeholders in body
 * 4. Handle {{CHILDREN}}: iterate child nodes through codegen
 * 5. Prepend import lines
 */
export function expandTemplateNode(node: IRNode, _depth = 0, runtime?: KernRuntime): string[] {
  const rt = runtime ?? defaultRuntime;
  if (_depth > MAX_EXPANSION_DEPTH) {
    throw new KernTemplateError(
      `Template expansion depth exceeded ${MAX_EXPANSION_DEPTH} — possible recursion in template '${node.type}'`
    );
  }

  const template = rt.templateRegistry.get(node.type);
  if (!template) {
    throw new KernTemplateError(`No template registered for type '${node.type}'`);
  }

  const nodeProps = p(node);
  const slotValues = new Map<string, string>();

  // Resolve slot values from node props
  for (const slot of template.slots) {
    const rawValue = nodeProps[slot.name];

    if (rawValue !== undefined && rawValue !== null) {
      const value = String(rawValue);
      validateSlotValue(slot.name, value, slot.slotType);
      // Sanitize based on slot type — identifiers are validated, strings are escaped
      const safeValue = slot.slotType === 'identifier' ? emitIdentifier(value, value) : value;
      slotValues.set(slot.name, safeValue);
    } else if (slot.optional) {
      slotValues.set(slot.name, slot.defaultValue ?? '');
    } else {
      throw new KernTemplateError(
        `Template '${template.name}': required slot '${slot.name}' not provided`
      );
    }
  }

  // Build CHILDREN output
  const childrenLines: string[] = [];
  const nodeChildren = node.children || [];
  for (const child of nodeChildren) {
    // handler <<< >>> blocks become inline code
    if (child.type === 'handler') {
      const code = (p(child).code as string) || '';
      const dedented = dedentBody(code);
      for (const line of dedented.split('\n')) {
        childrenLines.push(line);
      }
    } else {
      // Other children go through codegen (supports nested templates)
      const expanded = isTemplateNode(child.type, rt)
        ? expandTemplateNode(child, _depth + 1, rt)
        : generateCoreNode(child, undefined, rt);
      childrenLines.push(...expanded);
    }
  }

  // Interpolate body
  let body = dedentBody(template.body);

  // Replace {{CHILDREN}} with children output
  if (body.includes('{{CHILDREN}}')) {
    // Preserve indentation: find indent before {{CHILDREN}} and apply to each child line
    body = body.replace(/^([ \t]*)(\{\{CHILDREN\}\})/gm, (_match, indent: string) => {
      if (childrenLines.length === 0) return '';
      return childrenLines.map(l => indent + l).join('\n');
    });
  }

  // Replace {{slotName}} placeholders — escape slot names for safe RegExp
  for (const [name, value] of slotValues) {
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\{\\{${safeName}\\}\\}`, 'g');
    body = body.replace(re, value);
  }

  const lines = body.split('\n');

  // Prepend imports
  if (template.imports.length > 0) {
    const importLines: string[] = [];
    for (const imp of template.imports) {
      const nameList = imp.names.split(',').map(s => s.trim()).join(', ');
      const safeFrom = emitTemplateSafe(imp.from);
      importLines.push(`import { ${nameList} } from '${safeFrom}';`);
    }
    importLines.push('');
    lines.unshift(...importLines);
  }

  return lines;
}
