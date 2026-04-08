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

import { VALID_TARGETS, type KernTarget } from './config.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';
import { KERN_VERSION, NODE_TYPES, STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';
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
  description?: string;
  example?: string;
}

// ── Schema Definitions ──────────────────────────────────────────────────

export const NODE_SCHEMAS: Record<string, NodeSchema> = {
  doc: {
    description: 'JSDoc documentation comment attached to the next declaration. Supports inline (text=) or multiline (<<<>>>)',
    example: 'doc text="Represents a user account"',
    props: {
      text: { kind: 'string' },
      code: { kind: 'rawBlock' },
    },
  },
  type: {
    description: 'TypeScript type alias — union of string literals or alias to another type',
    example: 'type name=Status values="active|inactive|banned"',
    props: {
      name: { required: true, kind: 'identifier' },
      values: { kind: 'string' },
      alias: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
  },
  interface: {
    description: 'TypeScript interface with typed fields',
    example: 'interface name=User export=true\n  field name=id type=string\n  field name=email type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field'],
  },
  union: {
    description: 'Discriminated union type with variants, each having their own fields',
    example: 'union name=Shape discriminant=kind\n  variant name=circle\n    field name=radius type=number',
    props: {
      name: { required: true, kind: 'identifier' },
      discriminant: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['variant'],
  },
  variant: {
    description: 'A case within a discriminated union',
    example: 'variant name=circle\n  field name=radius type=number',
    props: {
      name: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['field'],
  },
  field: {
    description: 'A typed property within an interface, variant, service, config, or error',
    example: 'field name=email type=string optional=true',
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
    description: 'Class-based service with methods and dependency injection',
    example: 'service name=AuthService export=true\n  method name=login params="email:string,password:string" async=true',
    props: {
      name: { required: true, kind: 'identifier' },
      implements: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'method', 'constructor', 'singleton'],
  },
  method: {
    description: 'A method within a service or repository, with handler body',
    example: 'method name=findById params="id:string" returns=User async=true\n  handler <<<\n    return db.users.find(id)\n  >>>',
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
    description: 'Standalone function — the most common code unit in KERN',
    example: 'fn name=calculateTotal params="items:CartItem[]" returns=number export=true\n  handler <<<\n    return items.reduce((sum, i) => sum + i.price, 0)\n  >>>',
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
    description: 'State machine with states and guarded transitions — 12 lines of KERN generates 140+ lines of TypeScript',
    example: 'machine name=OrderStatus export=true\n  state name=pending initial=true\n  state name=confirmed\n  transition name=confirm from=pending to=confirmed',
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['state', 'transition'],
  },
  state: {
    description: 'A state within a machine — one must be marked initial=true',
    example: 'state name=pending initial=true',
    props: {
      name: { required: true, kind: 'identifier' },
      initial: { kind: 'boolean' },
    },
  },
  transition: {
    description: 'A guarded transition between machine states, with optional handler',
    example: 'transition name=confirm from=pending to=confirmed\n  handler <<<\n    await notifyUser()\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      from: { required: true, kind: 'string' },
      to: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['handler'],
  },
  error: {
    description: 'Custom error class extending a base error, with typed fields',
    example: 'error name=ValidationError extends=Error message="Invalid input" export=true\n  field name=field type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { required: true, kind: 'identifier' },
      message: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'handler'],
  },
  config: {
    description: 'Configuration interface with typed fields — generates an interface',
    example: 'config name=AppConfig export=true\n  field name=port type=number default=3000\n  field name=debug type=boolean',
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field'],
  },
  store: {
    description: 'File-based JSON store with typed key and model',
    example: 'store name=UserStore path="data/users" key=id model=User export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      path: { required: true, kind: 'string' },
      key: { required: true, kind: 'identifier' },
      model: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
  },
  test: {
    description: 'Test suite container with describe/it blocks',
    example: 'test name="AuthService"\n  describe name="login"\n    it name="rejects invalid email"',
    props: {
      name: { required: true, kind: 'string' },
    },
    allowedChildren: ['describe', 'it', 'handler'],
  },
  event: {
    description: 'Typed event with payload type children',
    example: 'event name=UserCreated export=true\n  type name=id type=string\n  type name=email type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['type'],
  },
  import: {
    description: 'ES module import — named, default, or type-only',
    example: 'import from="./user.js" names="User,UserRole" types=true',
    props: {
      from: { required: true, kind: 'importPath' },
      names: { kind: 'string' },
      default: { kind: 'identifier' },
      types: { kind: 'boolean' },
    },
  },
  const: {
    description: 'Constant declaration with optional type and value or handler body',
    example: 'const name=MAX_RETRIES type=number value=3 export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      value: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  on: {
    description: 'Event listener — binds a handler to a named event',
    example: 'on event=click handler=handleClick',
    props: {
      event: { required: true, kind: 'string' },
      handler: { kind: 'identifier' },
      key: { kind: 'string' },
      async: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  websocket: {
    description: 'WebSocket server endpoint with event handlers',
    example: 'websocket path="/ws" name=chatSocket export=true\n  on event=message\n    handler <<<\n      broadcast(data)\n    >>>',
    props: {
      path: { kind: 'string' },
      name: { kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['on'],
  },
  derive: {
    description: 'Computed/derived value from an expression',
    example: 'derive name=fullName expr="first + \" \" + last" type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  transform: {
    description: 'Data transformation pipeline — maps target through a via function or handler',
    example: 'transform name=normalized target=rawData via=normalize type=NormalizedData',
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
    description: 'Named side-effecting operation — can be idempotent or reversible',
    example: 'action name=sendEmail params="to:string,body:string" async=true export=true\n  handler <<<\n    await mailer.send(to, body)\n  >>>',
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
    description: 'Runtime assertion — throws or executes else-branch if expr is falsy',
    example: 'guard expr="user !== null" else="throw new Error(\'No user\')"',
    props: {
      name: { kind: 'string' },
      expr: { required: true, kind: 'rawExpr' },
      else: { kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  assume: {
    description: 'Documented assumption with evidence and fallback for when it breaks',
    example: 'assume expr="items.length > 0" evidence="validated upstream" fallback="return []"',
    props: {
      expr: { required: true, kind: 'rawExpr' },
      scope: { kind: 'string' },
      evidence: { required: true, kind: 'string' },
      fallback: { required: true, kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  invariant: {
    description: 'Compile-time documented invariant — runtime assertion with confidence score',
    example: 'invariant name="positive balance" expr="balance >= 0"',
    props: {
      name: { kind: 'string' },
      expr: { required: true, kind: 'rawExpr' },
      confidence: { kind: 'number' },
    },
  },
  each: {
    description: 'Iteration — renders children for each item in a collection (target-agnostic loop)',
    example: 'each name=item in=items index=i',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      index: { kind: 'identifier' },
    },
  },
  collect: {
    description: 'Query/collect from a data source with optional filter, sort, and limit',
    example: 'collect name=activeUsers from=users where="u => u.active" order="u => u.name" limit=10',
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
    description: 'Pattern-match/switch on an expression — contains path children',
    example: 'branch name=route on=path\n  path value="/home"\n  path value="/about"',
    props: {
      name: { required: true, kind: 'identifier' },
      on: { required: true, kind: 'rawExpr' },
    },
    allowedChildren: ['path'],
  },
  model: {
    description: 'Database model/entity with columns and relations (generates Prisma or TypeORM)',
    example: 'model name=User table="users" export=true\n  column name=id type=string\n  column name=email type=string\n  relation name=posts type=Post[]',
    props: {
      name: { required: true, kind: 'identifier' },
      table: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['column', 'relation'],
  },
  repository: {
    description: 'Data access layer class with typed methods for a model',
    example: 'repository name=UserRepo model=User export=true\n  method name=findByEmail params="email:string" returns=User async=true',
    props: {
      name: { required: true, kind: 'identifier' },
      model: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['method'],
  },
  dependency: {
    description: 'Dependency injection container entry with scope and injected services',
    example: 'dependency name=authService scope=singleton export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      scope: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['inject', 'returns'],
  },
  cache: {
    description: 'Cache layer with backend selection, TTL, and entry/invalidation rules',
    example: 'cache name=userCache backend=redis prefix="user:" ttl=3600 export=true',
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
    description: 'Logical module grouping for code organization',
    example: 'module name=auth export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
  },
  provider: {
    description: 'React context provider component with typed value',
    example: 'provider name=AuthProvider type=AuthContext',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { required: true, kind: 'typeAnnotation' },
    },
    allowedChildren: ['prop', 'handler'],
  },
  hook: {
    description: 'React custom hook with lifecycle methods',
    example: 'hook name=useAuth returns=AuthState\n  handler <<<\n    const [user, setUser] = useState(null)\n    return { user }\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
    },
    allowedChildren: ['handler', 'memo', 'callback', 'ref', 'effect'],
  },
  effect: {
    description: 'React useEffect — side effect with dependency tracking',
    example: 'effect deps="userId" once=false\n  handler <<<\n    fetchUser(userId)\n  >>>\n  cleanup <<<\n    controller.abort()\n  >>>',
    props: {
      name: { kind: 'identifier' },
      deps: { kind: 'string' },
      once: { kind: 'boolean' },
    },
    allowedChildren: ['prop', 'handler', 'cleanup'],
  },
  // ── Web / UI node types ──────────────────────────────────────────────
  page: {
    description: 'Page/route component — generates Next.js page or React route component',
    example: 'page name=Dashboard client=true route="/dashboard"',
    props: {
      name: { required: true, kind: 'identifier' },
      client: { kind: 'boolean' },
      async: { kind: 'boolean' },
      route: { kind: 'string' },
      segment: { kind: 'string' },
    },
  },
  layout: {
    description: 'Layout wrapper component (Next.js layout or generic wrapper)',
    example: 'layout lang="en" route="/"',
    props: {
      lang: { kind: 'string' },
      route: { kind: 'string' },
    },
  },
  loading: {
    description: 'Next.js loading.tsx — shown while page content loads',
    example: 'loading\n  spinner',
    props: {},
  },
  metadata: {
    description: 'Page metadata — title, description, og:image for SEO',
    example: 'metadata title="Dashboard" description="Your account overview"',
    props: {
      title: { kind: 'string' },
      description: { kind: 'string' },
      keywords: { kind: 'string' },
      ogImage: { kind: 'string' },
    },
  },
  link: {
    description: 'Navigation link to an internal route',
    example: 'link to="/about"\n  text "About Us"',
    props: {
      to: { required: true, kind: 'string' },
    },
  },
  textarea: {
    description: 'Multi-line text input with optional two-way binding',
    example: 'textarea bind=notes placeholder="Enter notes..."',
    props: {
      bind: { kind: 'identifier' },
      placeholder: { kind: 'string' },
      spellcheck: { kind: 'boolean' },
    },
  },
  slider: {
    description: 'Range slider input with min/max/step',
    example: 'slider bind=volume min=0 max=100 step=5',
    props: {
      bind: { kind: 'identifier' },
      min: { kind: 'number' },
      max: { kind: 'number' },
      step: { kind: 'number' },
    },
  },
  toggle: {
    description: 'Boolean toggle/switch input',
    example: 'toggle bind=darkMode',
    props: {
      bind: { kind: 'identifier' },
    },
  },
  grid: {
    description: 'CSS grid container with column count and gap',
    example: 'grid cols=3 gap=4',
    props: {
      cols: { kind: 'number' },
      gap: { kind: 'number' },
    },
  },
  component: {
    description: 'Reference to an external or dynamic React component',
    example: 'component ref=UserCard props="user,onEdit"',
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
    description: 'Icon component by name',
    example: 'icon name=ArrowRight',
    props: {
      name: { required: true, kind: 'identifier' },
    },
  },
  logic: {
    description: 'Inline TypeScript logic block — embedded code in a component',
    example: 'logic <<<\n  const filtered = items.filter(i => i.active)\n>>>',
    props: {
      code: { kind: 'rawBlock' },
    },
    allowedChildren: ['handler'],
  },
  form: {
    description: 'HTML form element with action and method',
    example: 'form action="/api/submit" method="POST"',
    props: {
      action: { kind: 'string' },
      method: { kind: 'string' },
    },
  },
  svg: {
    description: 'SVG element with viewBox, dimensions, and fill/stroke',
    example: 'svg icon=logo width=24 height=24 viewBox="0 0 24 24"',
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
          const universalChildren = ['handler', 'cleanup', 'reason', 'evidence', 'needs', 'signal', 'doc'];
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

// ── Schema Export (LLM consumption) ─────────────────────────────────────

export interface KernSchemaJSON {
  version: string;
  nodeTypes: readonly string[];
  schemas: Record<string, NodeSchema>;
  unschemaed: string[];
  targets: readonly KernTarget[];
  styleShorthands: Record<string, string>;
  valueShorthands: Record<string, string>;
  multilineBlockTypes: string[];
  propKinds: readonly PropKind[];
  evolvedTypes?: string[];
}

/**
 * Export the full KERN schema as a JSON-serializable object.
 *
 * Designed for LLM consumption — an LLM can call `kern schema --json`
 * and use the output to generate valid `.kern` files.
 *
 * @param runtime - Optional KernRuntime instance (includes evolved types)
 */
export function exportSchemaJSON(runtime?: KernRuntime): KernSchemaJSON {
  const rt = runtime ?? defaultRuntime;
  const schemaedTypes = new Set(Object.keys(NODE_SCHEMAS));
  const unschemaed = (NODE_TYPES as readonly string[]).filter((t) => !schemaedTypes.has(t));
  const evolvedTypes = [...rt.dynamicNodeTypes];

  // Return defensive copies so callers can't mutate process-wide state
  return {
    version: KERN_VERSION,
    nodeTypes: [...NODE_TYPES],
    schemas: JSON.parse(JSON.stringify(NODE_SCHEMAS)) as Record<string, NodeSchema>,
    unschemaed,
    targets: [...VALID_TARGETS],
    styleShorthands: { ...STYLE_SHORTHANDS },
    valueShorthands: { ...VALUE_SHORTHANDS },
    multilineBlockTypes: [...rt.multilineBlockTypes],
    propKinds: ['identifier', 'typeAnnotation', 'importPath', 'rawExpr', 'rawBlock', 'string', 'boolean', 'number'],
    ...(evolvedTypes.length > 0 ? { evolvedTypes } : {}),
  };
}
