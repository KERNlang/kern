/**
 * AST Schema Validation — validates IRNode shape after parsing, before codegen.
 *
 * Defines required/optional props and allowed child types per node type.
 * Catches malformed ASTs (missing required props, wrong children) at the
 * parse boundary instead of scattering validation across 76 codegen functions.
 *
 * Props are classified by kind:
 *   - 'identifier'     → validated by emitIdentifier
 *   - 'typeAnnotation' → validated by emitTypeAnnotation
 *   - 'importPath'     → validated by emitImportSpecifier
 *   - 'rawExpr'        → intentional escape hatch (handler code, expressions)
 *   - 'rawBlock'       → intentional escape hatch (<<<...>>> blocks)
 *   - 'string'         → free-form string value
 *   - 'boolean'        → 'true'/'false'
 *   - 'number'         → numeric value
 */

import type { IRNode } from './types.js';

export type PropKind =
  | 'identifier'
  | 'typeAnnotation'
  | 'importPath'
  | 'rawExpr'
  | 'rawBlock'
  | 'string'
  | 'boolean'
  | 'number';

export interface PropSchema {
  required?: boolean;
  kind: PropKind;
}

export interface NodeSchema {
  props: Record<string, PropSchema>;
  allowedChildren?: string[];
}

// ── Schema Definitions ──────────────────────────────────────────────────

export const NODE_SCHEMAS: Record<string, NodeSchema> = {
  type: {
    props: {
      name: { required: true, kind: 'identifier' },
      values: { kind: 'string' },
      alias: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
  },
  interface: {
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field'],
  },
  union: {
    props: {
      name: { required: true, kind: 'identifier' },
      discriminant: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['variant'],
  },
  variant: {
    props: {
      name: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['field'],
  },
  field: {
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      optional: { kind: 'boolean' },
      default: { kind: 'rawExpr' },
      private: { kind: 'boolean' },
      readonly: { kind: 'boolean' },
    },
  },
  service: {
    props: {
      name: { required: true, kind: 'identifier' },
      implements: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'method', 'constructor', 'singleton'],
  },
  method: {
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      async: { kind: 'boolean' },
      stream: { kind: 'boolean' },
      private: { kind: 'boolean' },
      static: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  fn: {
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      async: { kind: 'boolean' },
      stream: { kind: 'boolean' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler', 'signal', 'cleanup'],
  },
  machine: {
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['state', 'transition'],
  },
  state: {
    props: {
      name: { required: true, kind: 'identifier' },
      initial: { kind: 'boolean' },
    },
  },
  transition: {
    props: {
      name: { required: true, kind: 'identifier' },
      from: { required: true, kind: 'string' },
      to: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['handler'],
  },
  error: {
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { required: true, kind: 'identifier' },
      message: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'handler'],
  },
  config: {
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field'],
  },
  store: {
    props: {
      name: { required: true, kind: 'identifier' },
      path: { required: true, kind: 'string' },
      key: { required: true, kind: 'identifier' },
      model: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
  },
  test: {
    props: {
      name: { required: true, kind: 'string' },
    },
    allowedChildren: ['describe', 'it', 'handler'],
  },
  event: {
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['type'],
  },
  import: {
    props: {
      from: { required: true, kind: 'importPath' },
      names: { kind: 'string' },
      default: { kind: 'identifier' },
      types: { kind: 'boolean' },
    },
  },
  const: {
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      value: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  on: {
    props: {
      event: { required: true, kind: 'string' },
      handler: { kind: 'identifier' },
      key: { kind: 'string' },
      async: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  websocket: {
    props: {
      path: { kind: 'string' },
      name: { kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['on'],
  },
  derive: {
    props: {
      name: { required: true, kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  transform: {
    props: {
      name: { required: true, kind: 'identifier' },
      target: { kind: 'rawExpr' },
      via: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  action: {
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      idempotent: { kind: 'boolean' },
      reversible: { kind: 'boolean' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  guard: {
    props: {
      name: { kind: 'string' },
      expr: { required: true, kind: 'rawExpr' },
      else: { kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  assume: {
    props: {
      expr: { required: true, kind: 'rawExpr' },
      scope: { kind: 'string' },
      evidence: { required: true, kind: 'string' },
      fallback: { required: true, kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  invariant: {
    props: {
      name: { kind: 'string' },
      expr: { required: true, kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  each: {
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      index: { kind: 'identifier' },
    },
  },
  collect: {
    props: {
      name: { required: true, kind: 'identifier' },
      from: { required: true, kind: 'rawExpr' },
      where: { kind: 'rawExpr' },
      order: { kind: 'rawExpr' },
      limit: { kind: 'number' },
      export: { kind: 'boolean' },
    },
  },
  branch: {
    props: {
      name: { required: true, kind: 'identifier' },
      on: { required: true, kind: 'rawExpr' },
    },
    allowedChildren: ['path'],
  },
  model: {
    props: {
      name: { required: true, kind: 'identifier' },
      table: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['column', 'relation'],
  },
  repository: {
    props: {
      name: { required: true, kind: 'identifier' },
      model: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['method'],
  },
  dependency: {
    props: {
      name: { required: true, kind: 'identifier' },
      scope: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['inject', 'returns'],
  },
  cache: {
    props: {
      name: { required: true, kind: 'identifier' },
      backend: { kind: 'string' },
      prefix: { kind: 'string' },
      ttl: { kind: 'number' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['entry', 'invalidate'],
  },
  module: {
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
  },
  provider: {
    props: {
      name: { required: true, kind: 'identifier' },
      type: { required: true, kind: 'typeAnnotation' },
    },
    allowedChildren: ['prop', 'handler'],
  },
  hook: {
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
    },
    allowedChildren: ['handler', 'memo', 'callback', 'ref', 'effect'],
  },
  effect: {
    props: {
      name: { kind: 'identifier' },
      deps: { kind: 'string' },
      once: { kind: 'boolean' },
    },
    allowedChildren: ['prop', 'handler', 'cleanup'],
  },
  // ── Web / UI node types ──────────────────────────────────────────────
  page: {
    props: {
      name: { required: true, kind: 'identifier' },
      client: { kind: 'boolean' },
      async: { kind: 'boolean' },
      route: { kind: 'string' },
      segment: { kind: 'string' },
    },
  },
  layout: {
    props: {
      lang: { kind: 'string' },
      route: { kind: 'string' },
    },
  },
  loading: {
    props: {},
  },
  metadata: {
    props: {
      title: { kind: 'string' },
      description: { kind: 'string' },
      keywords: { kind: 'string' },
      ogImage: { kind: 'string' },
    },
  },
  link: {
    props: {
      to: { required: true, kind: 'string' },
    },
  },
  textarea: {
    props: {
      bind: { kind: 'identifier' },
      placeholder: { kind: 'string' },
      spellcheck: { kind: 'boolean' },
    },
  },
  slider: {
    props: {
      bind: { kind: 'identifier' },
      min: { kind: 'number' },
      max: { kind: 'number' },
      step: { kind: 'number' },
    },
  },
  toggle: {
    props: {
      bind: { kind: 'identifier' },
    },
  },
  grid: {
    props: {
      cols: { kind: 'number' },
      gap: { kind: 'number' },
    },
  },
  component: {
    props: {
      ref: { kind: 'identifier' },
      name: { kind: 'identifier' },
      bind: { kind: 'identifier' },
      onChange: { kind: 'rawExpr' },
      props: { kind: 'string' },
      disabled: { kind: 'rawExpr' },
    },
  },
  icon: {
    props: {
      name: { required: true, kind: 'identifier' },
    },
  },
  logic: {
    props: {
      code: { kind: 'rawBlock' },
    },
    allowedChildren: ['handler'],
  },
  form: {
    props: {
      action: { kind: 'string' },
      method: { kind: 'string' },
    },
  },
  svg: {
    props: {
      icon: { kind: 'string' },
      size: { kind: 'number' },
      viewBox: { kind: 'string' },
      width: { kind: 'number' },
      height: { kind: 'number' },
      content: { kind: 'string' },
      fill: { kind: 'string' },
      stroke: { kind: 'string' },
    },
  },
};

// ── Validation ──────────────────────────────────────────────────────────

export interface SchemaViolation {
  nodeType: string;
  message: string;
  line?: number;
  col?: number;
}

/**
 * Validate an IR tree against the schema definitions (required props, allowed children, cross-prop rules).
 *
 * Walks the full tree recursively. Returns an empty array when the tree is valid.
 * Node types without a registered schema are silently accepted.
 *
 * @param root - The root IRNode to validate
 * @returns Array of {@link SchemaViolation} — empty means valid
 */
export function validateSchema(root: IRNode): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  validateNode(root, violations);
  return violations;
}

function validateNode(node: IRNode, violations: SchemaViolation[]): void {
  const schema = Object.hasOwn(NODE_SCHEMAS, node.type) ? NODE_SCHEMAS[node.type] : undefined;

  if (schema) {
    const props = node.props || {};

    // Check required props
    for (const [propName, propSchema] of Object.entries(schema.props)) {
      if (propSchema.required && !(propName in props)) {
        violations.push({
          nodeType: node.type,
          message: `'${node.type}' requires prop '${propName}'`,
          line: node.loc?.line,
          col: node.loc?.col,
        });
      }
    }

    // Cross-prop validation: component needs ref or name
    if (node.type === 'component' && !('ref' in props) && !('name' in props)) {
      violations.push({
        nodeType: 'component',
        message: "'component' requires either 'ref' or 'name' prop",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }

    // Check allowed children
    if (schema.allowedChildren && node.children) {
      for (const child of node.children) {
        if (!schema.allowedChildren.includes(child.type)) {
          // Don't flag structural children that are consumed by parents
          // (handler, reason, evidence, needs, etc.)
          const universalChildren = ['handler', 'cleanup', 'reason', 'evidence', 'needs', 'signal'];
          if (!universalChildren.includes(child.type)) {
            violations.push({
              nodeType: node.type,
              message: `'${node.type}' does not allow child type '${child.type}' (allowed: ${schema.allowedChildren.join(', ')})`,
              line: child.loc?.line,
              col: child.loc?.col,
            });
          }
        }
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      validateNode(child, violations);
    }
  }
}
