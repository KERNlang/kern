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

import { type KernTarget, VALID_TARGETS } from './config.js';
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
  | 'number'
  | 'expression'
  | 'regex';

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
    description:
      'JSDoc documentation comment attached to the next declaration. Supports inline (text=) or multiline (<<<>>>)',
    example: 'doc text="Represents a user account"',
    props: {
      text: { kind: 'string' },
      code: { kind: 'rawBlock' },
    },
  },
  type: {
    description:
      'TypeScript type alias — union of string literals, or alias to another type (including tuple types like [string, number]). Use generics="<T>" for parameterised aliases.',
    example: 'type name=Status values="active|inactive|banned"',
    props: {
      name: { required: true, kind: 'identifier' },
      values: { kind: 'string' },
      alias: { kind: 'rawExpr' },
      generics: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
  },
  interface: {
    description: 'TypeScript interface with typed fields. Use generics="<T>" for parameterised interfaces.',
    example: 'interface name=User export=true\n  field name=id type=string\n  field name=email type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { kind: 'typeAnnotation' },
      generics: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'indexer'],
  },
  indexer: {
    description: 'Index signature for an interface — [keyName: keyType]: type',
    example: 'indexer keyName=key keyType=string type=Value',
    props: {
      keyName: { kind: 'identifier' },
      keyType: { required: true, kind: 'typeAnnotation' },
      type: { required: true, kind: 'typeAnnotation' },
      readonly: { kind: 'boolean' },
    },
  },
  overload: {
    description:
      'Function overload signature — declared as a child of fn. Each overload emits a TS overload declaration before the implementation signature.',
    example: 'overload params="a:number,b:number" returns=number',
    props: {
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      generics: { kind: 'rawExpr' },
    },
    allowedChildren: ['param'],
  },
  union: {
    description: 'Discriminated union type with variants, each having their own fields',
    example: 'union name=Shape discriminant=kind\n  variant name=circle\n    field name=radius type=number',
    props: {
      name: { required: true, kind: 'identifier' },
      discriminant: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
      // Slice 4 — `kind=result|option` opts the union into the Result/Option
      // shape (see docs/language/result-option-spec.md). Default (unspecified)
      // is a regular discriminated union, identical to the slice 3 behaviour.
      // Validated by parser-validate-union-kind.ts.
      kind: { kind: 'string' },
    },
    allowedChildren: ['variant'],
  },
  enum: {
    description:
      'TypeScript enum — numeric (auto-incremented) via values="A|B|C", or string-valued via member children',
    example: 'enum name=Status values="Pending|Active|Done"',
    props: {
      name: { required: true, kind: 'identifier' },
      values: { kind: 'string' },
      const: { kind: 'boolean' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['member'],
  },
  member: {
    description: 'Enum member with explicit value (for string-valued or computed enums)',
    example: 'member name=Up value="UP"',
    props: {
      name: { required: true, kind: 'identifier' },
      value: { kind: 'expression' },
    },
  },
  variant: {
    description:
      'A case within a discriminated union. Use name= for inline variants with fields, or type= to reference an existing interface.',
    example: 'variant name=circle\n  field name=radius type=number',
    props: {
      name: { required: false, kind: 'identifier' },
      type: { required: false, kind: 'typeAnnotation' },
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
      // Slice 3b — `value` is the native ValueIR-canonicalised initializer;
      // `default` remains as the rawExpr passthrough escape hatch. `value`
      // takes precedence when both are set. Either marks the field as having
      // an initializer (which makes the interface-side property optional in
      // config emit).
      value: { kind: 'expression' },
      default: { kind: 'rawExpr' },
      private: { kind: 'boolean' },
      readonly: { kind: 'boolean' },
      static: { kind: 'boolean' },
    },
  },
  service: {
    description: 'Class-based service with methods and dependency injection',
    example:
      'service name=AuthService export=true\n  method name=login params="email:string,password:string" async=true',
    props: {
      name: { required: true, kind: 'identifier' },
      implements: { kind: 'typeAnnotation' },
      generics: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'method', 'constructor', 'singleton', 'getter', 'setter'],
  },
  class: {
    description: 'Stateful class — owned instance with fields, constructor, methods, getters',
    example:
      'class name=AudioRecorder export=true\n  field name=fd type="number | null" visibility=private value={{ null }}\n  constructor params="sessionKey:string"\n    handler <<<\n      this.sessionKey = sessionKey;\n    >>>\n  method name=close returns=void\n    handler <<<\n      closeSync(this.fd!);\n    >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      extends: { kind: 'typeAnnotation' },
      implements: { kind: 'typeAnnotation' },
      abstract: { kind: 'boolean' },
      generics: { kind: 'rawExpr' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['field', 'method', 'constructor', 'singleton', 'getter', 'setter'],
  },
  method: {
    description: 'A method within a service or repository, with handler body',
    example:
      'method name=findById params="id:string" returns=User async=true\n  handler <<<\n    return db.users.find(id)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      async: { kind: 'boolean' },
      stream: { kind: 'boolean' },
      private: { kind: 'boolean' },
      static: { kind: 'boolean' },
      generics: { kind: 'rawExpr' },
    },
    allowedChildren: ['handler', 'param'],
  },
  getter: {
    description: 'A getter accessor within a class or service — emits `get name(): T { body }`.',
    example: 'getter name=state returns=string\n  handler <<<\n    return this._state\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      returns: { kind: 'typeAnnotation' },
      private: { kind: 'boolean' },
      static: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  setter: {
    description: 'A setter accessor within a class or service — emits `set name(v: T) { body }`.',
    example: 'setter name=state params="value:string"\n  handler <<<\n    this._state = value\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      private: { kind: 'boolean' },
      static: { kind: 'boolean' },
    },
    allowedChildren: ['handler', 'param'],
  },
  fn: {
    description: 'Standalone function — the most common code unit in KERN',
    example:
      'fn name=calculateTotal params="items:CartItem[]" returns=number export=true\n  handler <<<\n    return items.reduce((sum, i) => sum + i.price, 0)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      async: { kind: 'boolean' },
      stream: { kind: 'boolean' },
      export: { kind: 'boolean' },
      expr: { kind: 'rawExpr' },
      generics: { kind: 'rawExpr' },
      // Slice 6 — effects=pure declares the body has no observable side effects.
      // Validated by parser-validate-effects.ts; see docs/language/effects-pure-spec.md.
      effects: { kind: 'string' },
    },
    allowedChildren: ['handler', 'signal', 'cleanup', 'overload', 'param'],
  },
  machine: {
    description:
      'State machine with states and guarded transitions — 12 lines of KERN generates 140+ lines of TypeScript',
    example:
      'machine name=OrderStatus export=true\n  state name=pending initial=true\n  state name=confirmed\n  transition name=confirm from=pending to=confirmed',
    props: {
      name: { required: true, kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['state', 'transition'],
  },
  state: {
    description: 'State — machine state (initial=true/false) or React component state (initial=expression, type=Type)',
    example: 'state name=pending initial=true\nstate name=count initial=0 type=number',
    props: {
      name: { required: true, kind: 'identifier' },
      initial: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      safe: { kind: 'boolean' },
      throttle: { kind: 'number' },
      debounce: { kind: 'number' },
    },
  },
  animation: {
    description: 'Interval-driven state update — generates useEffect with setInterval and auto-cleanup',
    example: 'animation name=frame interval=100 update="(prev) => (prev + 1) % 4"',
    props: {
      name: { required: true, kind: 'identifier' },
      interval: { required: true, kind: 'number' },
      update: { required: true, kind: 'rawExpr' },
      active: { kind: 'rawExpr' },
    },
  },
  transition: {
    description:
      'A guarded transition between machine states, with optional typed payload and/or guard predicate. `params` uses the same comma-separated typed list shape as `fn` (e.g. "prompt:string,chatId:string") — those parameters enter the emitted transition function signature and are in scope inside the handler and the guard. `guard` is a raw JS boolean expression evaluated AFTER the from-state check; when falsy the transition throws `<Machine>GuardError(\'<transition>\', entity.state)`.',
    example:
      'transition name=submit from=idle to=running params="prompt:string,chatId:string" guard="entity.turnsLeft > 0"\n  handler <<<\n    await notifyUser(prompt)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      from: { required: true, kind: 'string' },
      to: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      guard: { kind: 'rawExpr' },
    },
    allowedChildren: ['handler', 'param'],
  },
  error: {
    description: 'Custom error class extending a base error, with typed fields',
    example:
      'error name=ValidationError extends=Error message="Invalid input" export=true\n  field name=field type=string',
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
    example:
      'config name=AppConfig export=true\n  field name=port type=number default=3000\n  field name=debug type=boolean',
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
      target: { kind: 'string' },
    },
    allowedChildren: ['describe', 'it', 'expect', 'fixture', 'mock', 'handler'],
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
  use: {
    description:
      'Cross-`.kern` symbol resolution. Parent of `from` children — one per imported binding. Compositional shape mirrors enum/member, class/method.',
    example: 'use path="./helper.kern"\n  from name=foo\n  from name=bar as=baz',
    props: {
      path: { required: true, kind: 'importPath' },
    },
    allowedChildren: ['from'],
  },
  from: {
    description: 'Single binding in a `use` block. `as=` aliases the local name; `export=true` re-exports.',
    example: 'from name=foo as=bar export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      as: { kind: 'identifier' },
      export: { kind: 'boolean' },
    },
  },
  const: {
    description: 'Constant declaration with optional type and value or handler body',
    example: 'const name=MAX_RETRIES type=number value=3 export=true',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      value: { kind: 'expression' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler'],
  },
  destructure: {
    description:
      'Native destructuring statement — emits `const {a,b} = expr;` (object pattern with `binding` children) or `const [x,y] = expr;` (array pattern with `element` children). For complex patterns (rest `...`, defaults `=v`, nested `{a:{b}}`), use the `expr={{...}}` escape hatch which carries the raw TS statement verbatim. Slice 3d.',
    example: 'destructure kind=const source=user\n  binding name=id\n  binding name=email key=mail',
    props: {
      kind: { kind: 'string' },
      source: { kind: 'expression' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
      expr: { kind: 'rawExpr' },
    },
    allowedChildren: ['binding', 'element'],
  },
  binding: {
    description:
      'Object-destructuring binding inside a `destructure` parent. `name` is the local binding; `key` is the optional property key when renaming, e.g. `{a: foo}` → `binding name=foo key=a`. Slice 3d.',
    example: 'binding name=foo key=a',
    props: {
      name: { required: true, kind: 'identifier' },
      key: { kind: 'identifier' },
    },
  },
  element: {
    description:
      'Array-destructuring element inside a `destructure` parent. `index` is the ordered position (zero-based). Slice 3d.',
    example: 'element name=first index=0',
    props: {
      name: { required: true, kind: 'identifier' },
      index: { kind: 'string' },
    },
  },
  mapLit: {
    description:
      'Native Map<K,V> literal — emits `const name: Type = new Map([[k1, v1], [k2, v2]]);` from `mapEntry` children. For complex shapes (computed keys, conditional entries, spread), use the `expr={{...}}` escape hatch which carries the raw TS statement verbatim. Slice 3e.',
    example: 'mapLit name=cache type="Map<string, number>"\n  mapEntry key="foo" value=1\n  mapEntry key="bar" value=2',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      kind: { kind: 'string' },
      export: { kind: 'boolean' },
      expr: { kind: 'rawExpr' },
    },
    allowedChildren: ['mapEntry'],
  },
  mapEntry: {
    description:
      'Map-literal entry inside a `mapLit` parent. `key` and `value` are both expression-typed and ValueIR-canonicalised. Slice 3e.',
    example: 'mapEntry key="foo" value=1',
    props: {
      key: { required: true, kind: 'expression' },
      value: { required: true, kind: 'expression' },
    },
  },
  setLit: {
    description:
      'Native Set<T> literal — emits `const name: Type = new Set([v1, v2]);` from `setItem` children. For complex shapes (conditional members, spread), use the `expr={{...}}` escape hatch which carries the raw TS statement verbatim. Slice 3e.',
    example: 'setLit name=allowed type="Set<string>"\n  setItem value="admin"\n  setItem value="user"',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      kind: { kind: 'string' },
      export: { kind: 'boolean' },
      expr: { kind: 'rawExpr' },
    },
    allowedChildren: ['setItem'],
  },
  setItem: {
    description:
      'Set-literal item inside a `setLit` parent. `value` is expression-typed and ValueIR-canonicalised. Slice 3e.',
    example: 'setItem value="admin"',
    props: {
      value: { required: true, kind: 'expression' },
    },
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
    allowedChildren: ['handler', 'set'],
  },
  websocket: {
    description: 'WebSocket server endpoint with event handlers',
    example:
      'websocket path="/ws" name=chatSocket export=true\n  on event=message\n    handler <<<\n      broadcast(data)\n    >>>',
    props: {
      path: { kind: 'string' },
      name: { kind: 'identifier' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['on'],
  },
  derive: {
    description: 'Computed/derived value from an expression',
    example: 'derive name=fullName expr="first + " " + last" type=string',
    props: {
      name: { required: true, kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
      // Slice 6 — see fn schema above.
      effects: { kind: 'string' },
    },
  },
  fmt: {
    description:
      'Formatted string — declarative template literal. The `template` body is emitted verbatim between backticks, so `${expr}` placeholders interpolate normally. Three positional modes: (1) binding form `fmt name=X template=...` emits `const X = \\`...\\`;` at the current scope; (2) return form `fmt return=true template=...` emits `return \\`...\\`;` inside a `fn` body (name must be omitted); (3) inline-JSX form `fmt template=...` (no name, no return=true) appears as a direct child of `render`/`group` and emits `{\\`...\\`}` as a JSX expression — use this to replace handler-wrapped `{\\`${x} files\\`}` text inside composed renders.',
    example: 'fmt name=label template="${count} files over ${totalMb.toFixed(1)} MB"',
    props: {
      name: { required: false, kind: 'identifier' },
      template: { required: true, kind: 'string' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
      return: { kind: 'boolean' },
    },
  },
  set: {
    description:
      'Declarative state update — inside an `on` event block, `set name=count to="count + 1"` lowers to `setCount(count + 1);`. The setter name follows React useState convention (`set` + capitalized state name). Lets authors skip a handler block when all they need is to mutate a piece of state.',
    example: 'on event=click\n  set name=count to="count + 1"',
    props: {
      name: { required: true, kind: 'identifier' },
      to: { required: true, kind: 'rawExpr' },
    },
  },
  async: {
    description:
      'Declarative async block — a named async unit that runs its `handler` body once, optionally wrapped by a `recover` child that delegates to the existing `recover`/`strategy` machinery. Reuses `generateRecover` verbatim, so fallback/retry semantics match the rest of the ground layer. The emitted code is a statement (IIFE when no recover, wrapped call when recover is present) so it can be spliced inside any statement context.',
    example:
      'async name=loadUser\n  handler <<<\n    const res = await fetch(`/api/users/${id}`);\n    setUser(await res.json());\n  >>>\n  recover\n    strategy name=fallback\n      handler <<<\n        setUser(null);\n      >>>',
    props: {
      name: { kind: 'identifier' },
    },
    allowedChildren: ['handler', 'recover'],
  },
  try: {
    description:
      'Declarative async orchestration — a sequential try/catch where each `step name=X await="expr"` child lowers to `const X = await (expr);`. Step bindings are in scope for later steps and the optional `handler` body (post-steps), but NOT inside the `catch` block — JS `const` declared inside a `try` block is not visible to `catch` (use closure-scoped `derive`/`local` if the catch needs to reference earlier values). Use this instead of a raw handler to express the "fetch → parse → store, fall back on error" shape declaratively.',
    example:
      'try name=loadUser\n  step name=res await="fetch(`/api/users/${id}`)"\n  step name=body await="res.json()"\n  handler <<<\n    setUser(body);\n  >>>\n  catch name=err\n    handler <<<\n      setUser(null);\n    >>>',
    props: {
      name: { kind: 'identifier' },
    },
    allowedChildren: ['step', 'handler', 'catch'],
  },
  step: {
    description:
      'Sequential awaited step inside a `try` block — `step name=X await="expr"` emits `const X = await (expr);` in order with its siblings. Must be a direct child of `try`. Earlier step names are in scope for later ones.',
    example: 'step name=res await="fetch(url)"',
    props: {
      name: { required: true, kind: 'identifier' },
      await: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
    },
  },
  catch: {
    description:
      'Catch clause of a `try` block — binds the thrown value to `name` (default `e`) and runs its `handler` body. Must be a direct child of `try`. Without a `catch`, a `try` still surrounds its steps + handler but any rejection propagates unchanged.',
    example: 'catch name=err\n  handler <<<\n    setError(err);\n  >>>',
    props: {
      name: { kind: 'identifier' },
    },
    allowedChildren: ['handler'],
  },
  filter: {
    description:
      'Declarative `.filter` binding — `filter name=active in=items where="item.active"` lowers to `const active = items.filter(item => item.active);`. Use `item=x` to rename the per-item binding.',
    example: 'filter name=active in=items where="item.active"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  find: {
    description:
      "Declarative `.find` binding — `find name=admin in=users where=\"item.role === 'admin'\"` lowers to `const admin = users.find(item => item.role === 'admin');`. Use `item=x` to rename the per-item binding.",
    example: 'find name=admin in=users item=u where="u.role === \'admin\'"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  some: {
    description:
      'Declarative `.some` binding — `some name=hasError in=results where="!item.ok"` lowers to `const hasError = results.some(item => !item.ok);`.',
    example: 'some name=hasError in=results where="!item.ok"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  every: {
    description:
      'Declarative `.every` binding — `every name=allDone in=tasks where="item.done"` lowers to `const allDone = tasks.every(item => item.done);`.',
    example: 'every name=allDone in=tasks where="item.done"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  reduce: {
    description:
      'Declarative `.reduce` binding — two bound names (accumulator + item). `reduce name=total in=items initial="0" expr="acc + item.value"` lowers to `const total = items.reduce((acc, item) => acc + item.value, 0);`. Override the binding names with `acc=` and `item=`.',
    example: 'reduce name=total in=items initial="0" expr="acc + item.value"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      acc: { kind: 'identifier' },
      item: { kind: 'identifier' },
      initial: { required: true, kind: 'rawExpr' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  flatMap: {
    description:
      'Declarative `.flatMap` binding — `flatMap name=tags in=posts expr="item.tags"` lowers to `const tags = posts.flatMap(item => item.tags);`. Use `item=` to rename the per-item binding. `expr` is the arrow body (an array or iterable), not a predicate.',
    example: 'flatMap name=tags in=posts expr="item.tags"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  slice: {
    description:
      'Declarative `.slice` binding — `slice name=first5 in=items start=0 end=5` lowers to `const first5 = items.slice(0, 5);`. `start` and `end` default to undefined (JS semantics: a bare `.slice()` copies the whole array).',
    example: 'slice name=first5 in=items start=0 end=5',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      start: { kind: 'rawExpr' },
      end: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  map: {
    description:
      'Declarative `.map` binding — `map name=names in=users expr="item.name"` lowers to `const names = users.map(item => item.name);`. Sibling to `each` (JSX iteration form); use `map` for data-transformation bindings. `expr` is the arrow body.',
    example: 'map name=names in=users expr="item.name"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  findIndex: {
    description:
      'Declarative `.findIndex` binding — `findIndex name=pos in=users where="item.active"` lowers to `const pos = users.findIndex(item => item.active);`. Returns a number; add `type=number` when the binding is exported.',
    example: 'findIndex name=pos in=users where="item.active"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  flat: {
    description:
      'Declarative `.flat` binding — `flat name=flattened in=nested depth=2` lowers to `const flattened = nested.flat(2);`. Omit `depth` for the default depth of 1.',
    example: 'flat name=flattened in=nested depth=2',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      depth: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  at: {
    description:
      'Declarative `.at` binding — `at name=last in=items index=-1` lowers to `const last = items.at(-1);`. Supports negative indices for tail access.',
    example: 'at name=last in=items index=-1',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      index: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  sort: {
    description:
      'Declarative immutable sort — `sort name=sorted in=items compare="a.age - b.age"` lowers to `const sorted = [...items].sort((a, b) => a.age - b.age);`. Source collection is never mutated. Omit `compare` for lexicographic sort. Rename bindings with `a=` / `b=`.',
    example: 'sort name=sorted in=items compare="a.age - b.age"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      a: { kind: 'identifier' },
      b: { kind: 'identifier' },
      compare: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  reverse: {
    description:
      'Declarative immutable reverse — `reverse name=reversed in=items` lowers to `const reversed = [...items].reverse();`. Source collection is never mutated.',
    example: 'reverse name=reversed in=items',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  join: {
    description:
      'Declarative `.join` binding — `join name=csv in=fields separator=","` lowers to `const csv = fields.join(\',\');`. Omit `separator` for the default (`,`). The separator is emitted as a quoted string literal unless wrapped as `{{ expr }}`.',
    example: 'join name=csv in=fields separator=","',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      separator: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  includes: {
    description:
      "Declarative `.includes` binding — `includes name=hasError in=errors value=\"'fatal'\"` lowers to `const hasError = errors.includes('fatal');`. `value` is a raw expression — quote string literals inside it.",
    example: 'includes name=hasError in=errors value="\'fatal\'"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      value: { required: true, kind: 'rawExpr' },
      from: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  indexOf: {
    description:
      'Declarative `.indexOf` binding — `indexOf name=pos in=items value=target` lowers to `const pos = items.indexOf(target);`. `value` is a raw expression.',
    example: 'indexOf name=pos in=items value=target',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      value: { required: true, kind: 'rawExpr' },
      from: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  lastIndexOf: {
    description:
      'Declarative `.lastIndexOf` binding — `lastIndexOf name=pos in=items value=target` lowers to `const pos = items.lastIndexOf(target);`. `value` is a raw expression.',
    example: 'lastIndexOf name=pos in=items value=target',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      value: { required: true, kind: 'rawExpr' },
      from: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  concat: {
    description:
      'Declarative `.concat` binding — `concat name=all in=items with="a, b"` lowers to `const all = items.concat(a, b);`. `with` is a raw expression injected directly — supports a single arg or comma-separated spread.',
    example: 'concat name=all in=items with=other',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      with: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  forEach: {
    description:
      'Declarative `.forEach` statement — `forEach in=items` with a `handler <<<>>>` child lowers to `items.forEach((item) => { handler-body });`. No binding (no `name`, no `const`). Distinct from `each` (JSX composition) and `map` (value binding). Use `item=` / `index=` to rename the parameters.',
    example: 'forEach in=items\n  handler <<<\n    doSomething(item);\n  >>>',
    props: {
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      index: { kind: 'identifier' },
    },
    allowedChildren: ['handler'],
  },
  compact: {
    description:
      'Declarative `.filter(Boolean)` binding — `compact name=truthy in=items` lowers to `const truthy = items.filter(Boolean);`. Named primitive for the common "drop falsy values" pattern (36 sites in agon).',
    example: 'compact name=truthy in=items',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  pluck: {
    description:
      'Declarative property-extraction map — `pluck name=names in=users prop=name` lowers to `const names = users.map(item => item.name);`. `prop=` is a raw identifier path (e.g. `prop=user.profile.name` emits `item.user.profile.name`). Use `map` when the projection is not a property access.',
    example: 'pluck name=names in=users prop=name',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      prop: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  unique: {
    description:
      'Declarative dedupe — `unique name=distinct in=items` lowers to `const distinct = [...new Set(items)];`. Uses JS `Set` identity (triple-equals on primitives, reference equality on objects). For key-based dedup of object arrays, use `uniqueBy`.',
    example: 'unique name=distinct in=items',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  uniqueBy: {
    description:
      'Key-based dedup (first-wins, matches Lodash uniqBy) — `uniqueBy name=distinct in=users by="item.id"` emits a Set+filter form.',
    example: 'uniqueBy name=distinct in=users by="item.id"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  groupBy: {
    description:
      'Partition an array into buckets by a key selector. Emits a reduce-based form (compatible with ES2022) — does not depend on `Object.groupBy` (ES2024).',
    example: 'groupBy name=byType in=items by="item.type"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  partition: {
    description:
      'Split an array into two by a predicate — single-pass reduce. Emits `const [pass, fail] = ...`. Both `pass` and `fail` prop names are required.',
    example: 'partition pass=active fail=inactive in=users where="item.active"',
    props: {
      name: { kind: 'identifier' },
      pass: { required: true, kind: 'identifier' },
      fail: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  indexBy: {
    description:
      'Array → keyed record via selector. `indexBy name=byId in=users by="item.id"` lowers to `Object.fromEntries(users.map(...))`. Collisions are last-write-wins.',
    example: 'indexBy name=byId in=users by="item.id"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  countBy: {
    description:
      'Count occurrences by key. `countBy name=counts in=items by="item.type"` lowers to a reduce with `Object.create(null)` accumulator (prototype-pollution safe).',
    example: 'countBy name=counts in=items by="item.type"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  chunk: {
    description: 'Split into fixed-size chunks. `chunk name=batches in=items size=10`.',
    example: 'chunk name=batches in=items size=10',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      size: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  zip: {
    description:
      'Pair two arrays element-wise. `zip name=pairs in=items with=other`. Short-side wins — extra right-hand elements are dropped.',
    example: 'zip name=pairs in=items with=other',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      with: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      index: { kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  range: {
    description:
      'Generate a numeric range. `range name=nums end=10` → `[0..9]`. `range name=nums start=5 end=10` → `[5..9]`. No `step` in v1.',
    example: 'range name=nums end=10',
    props: {
      name: { required: true, kind: 'identifier' },
      start: { kind: 'rawExpr' },
      end: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  take: {
    description: 'First N elements. Alias for `slice(0, n)` but named for intent clarity.',
    example: 'take name=first5 in=items n=5',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      n: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  drop: {
    description: 'Drop first N elements. Alias for `slice(n)` but named for intent clarity.',
    example: 'drop name=tail in=items n=5',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      n: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  min: {
    description:
      'Scalar min on a number array. Returns `undefined` on empty. Reduce-based — no stack-overflow risk on huge arrays.',
    example: 'min name=lowest in=values',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  max: {
    description:
      'Scalar max on a number array. Returns `undefined` on empty. Reduce-based — no stack-overflow risk on huge arrays.',
    example: 'max name=highest in=values',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  minBy: {
    description:
      'Find the element with the minimum key. `minBy name=youngest in=users by="item.age"`. Returns `undefined` on empty.',
    example: 'minBy name=youngest in=users by="item.age"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  maxBy: {
    description:
      'Find the element with the maximum key. `maxBy name=oldest in=users by="item.age"`. Returns `undefined` on empty.',
    example: 'maxBy name=oldest in=users by="item.age"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  sum: {
    description: 'Sum of a number array. Returns `0` on empty (additive identity).',
    example: 'sum name=total in=prices',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  sumBy: {
    description: 'Sum via key selector. `sumBy name=totalCost in=items by="item.price * item.qty"`.',
    example: 'sumBy name=totalCost in=items by="item.price * item.qty"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      by: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  avg: {
    description: 'Mean of a number array. Returns `NaN` on empty (Lodash parity — preserves the "no data" signal).',
    example: 'avg name=mean in=prices',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  intersect: {
    description: 'Set intersection of two arrays. `intersect name=shared in=a with=b`. O(N+M) via a Set.',
    example: 'intersect name=shared in=a with=b',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      with: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  findLast: {
    description:
      'ES2023 counterpart to `find` — iterate from the end. `findLast name=lastActive in=users where="item.active"`.',
    example: 'findLast name=lastActive in=users where="item.active"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
      export: { kind: 'boolean' },
    },
  },
  findLastIndex: {
    description:
      'ES2023 counterpart to `findIndex` — iterate from the end. `findLastIndex name=pos in=users where="item.active"`.',
    example: 'findLastIndex name=pos in=users where="item.active"',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      item: { kind: 'identifier' },
      where: { required: true, kind: 'rawExpr' },
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
    example:
      'action name=sendEmail params="to:string,body:string" async=true export=true\n  handler <<<\n    await mailer.send(to, body)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      key: { kind: 'string' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
      async: { kind: 'boolean' },
      idempotent: { kind: 'boolean' },
      reversible: { kind: 'boolean' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['handler', 'param'],
  },
  actionRegistry: {
    description:
      'Calls an imported registration function with a map of string-keyed async action handlers. Emits `target({ key: async (...) => body, ... })` directly — no IIFE wrapper.',
    example:
      'actionRegistry target=registerActions\n  action key=share\n    handler <<<\n      await broadcastToRenderer("bridge:share-requested");\n    >>>\n  action key=create params="req:URL"\n    handler <<<\n      await persist(req);\n    >>>',
    props: {
      target: { required: true, kind: 'rawExpr' },
    },
    allowedChildren: ['action'],
  },
  guard: {
    description:
      'Guard — runtime assertion (expr-based) or MCP security guard (kind-based: sanitize, pathContainment, validate, auth, rateLimit, sizeLimit, sanitizeOutput)',
    example:
      'guard expr="user !== null" else="throw new Error(\'No user\')"\nguard type=sanitize param=query\nguard type=pathContainment param=filePath allowlist=/data,/home',
    props: {
      name: { kind: 'string' },
      expr: { kind: 'rawExpr' },
      else: { kind: 'rawExpr' },
      confidence: { kind: 'number' },
      kind: { kind: 'identifier' },
      type: { kind: 'identifier' },
      covers: { kind: 'string' },
      over: { kind: 'identifier' },
      union: { kind: 'identifier' },
      param: { kind: 'identifier' },
      field: { kind: 'identifier' },
      target: { kind: 'identifier' },
      pattern: { kind: 'string' },
      replacement: { kind: 'string' },
      regex: { kind: 'string' },
      min: { kind: 'number' },
      max: { kind: 'number' },
      allowlist: { kind: 'string' },
      allow: { kind: 'string' },
      roots: { kind: 'string' },
      baseDir: { kind: 'string' },
      base: { kind: 'string' },
      root: { kind: 'string' },
      envVar: { kind: 'string' },
      env: { kind: 'string' },
      header: { kind: 'string' },
      windowMs: { kind: 'number' },
      window: { kind: 'number' },
      maxRequests: { kind: 'number' },
      requests: { kind: 'number' },
      maxBytes: { kind: 'number' },
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
    description:
      'Iteration — renders children for each item in a collection. Inside a render block emits `items.map(...)` with auto-key; elsewhere emits `for...of`. `let` children become iteration-scoped `const` bindings inside the callback (hook-safe, unlike `derive`).',
    example:
      'each name=f in=files index=i key="f.path"\n  let name=isSel expr="focused && i === selIdx"\n  handler <<<\n    <Text bold={isSel}>{f.path}</Text>\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      in: { required: true, kind: 'rawExpr' },
      index: { kind: 'identifier' },
      key: { kind: 'rawExpr' },
    },
    // Intentionally unrestricted — statement-form `each` composes with `derive`,
    // `transform`, etc. in fn/handler contexts. The `let` node is constrained
    // separately via the `let-must-be-inside-each` semantic rule.
  },
  let: {
    description:
      'Iteration-scoped binding — emits a plain `const` inside the containing `each` callback. Use for values that depend on the iteration variable or index. Unlike `derive` (which compiles to `useMemo` and violates Rules of Hooks inside `.map`), `let` is hook-safe by construction. Provide either `value=` (native expression form, ValueIR-canonicalised — slice 3a) or `expr=` (raw passthrough escape hatch).',
    example: 'let name=idx value=i+1',
    props: {
      name: { required: true, kind: 'identifier' },
      value: { kind: 'expression' },
      expr: { kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
    },
  },
  local: {
    description:
      'Render-scope binding — emits `const name = expr;` at the top of the enclosing screen function, before its JSX return. Use for shared pre-compute that multiple sibling `each`/`conditional`/`handler` nodes inside the same `render` block read. Expression-only (no handler body) — drop to an explicit `derive` / `memo` above the render if a hook or imperative body is needed. Direct child of `render` only.',
    example:
      'render wrapper="<Box paddingX={1}>"\n  local name=visible expr="items.slice(start, start + pageSize)"\n  each name=item in=visible\n    handler <<< <Text>{item.label}</Text> >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      expr: { required: true, kind: 'rawExpr' },
      type: { kind: 'typeAnnotation' },
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
    example:
      'model name=User table="users" export=true\n  column name=id type=string\n  column name=email type=string\n  relation name=posts type=Post[]',
    props: {
      name: { required: true, kind: 'identifier' },
      table: { kind: 'string' },
      export: { kind: 'boolean' },
    },
    allowedChildren: ['column', 'relation'],
  },
  repository: {
    description: 'Data access layer class with typed methods for a model',
    example:
      'repository name=UserRepo model=User export=true\n  method name=findByEmail params="email:string" returns=User async=true',
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
    example:
      'hook name=useAuth returns=AuthState\n  handler <<<\n    const [user, setUser] = useState(null)\n    return { user }\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      returns: { kind: 'typeAnnotation' },
    },
    allowedChildren: ['handler', 'memo', 'callback', 'ref', 'effect', 'param'],
  },
  effect: {
    description: 'React useEffect — side effect with dependency tracking',
    example:
      'effect deps="userId" once=false\n  handler <<<\n    fetchUser(userId)\n  >>>\n  cleanup <<<\n    controller.abort()\n  >>>',
    props: {
      name: { kind: 'identifier' },
      deps: { kind: 'string' },
      once: { kind: 'boolean' },
    },
    allowedChildren: ['prop', 'handler', 'cleanup', 'trigger', 'recover'],
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

  // ── Cross-target nodes ────────────────────────────────────────────────

  handler: {
    description:
      'Code block — the body of a function, method, route, tool, or event handler. Use <<<...>>> for multiline code.',
    example: 'handler <<<\n  const result = await doWork();\n  return result;\n>>>',
    props: {
      code: { kind: 'rawBlock' },
      lang: { kind: 'string' },
    },
  },
  conditional: {
    description:
      'Conditional rendering — shows the `then` branch when if-expression is truthy. Inside a `render` block the branch JSX goes in a `handler <<<>>>` child; optional `elseif` / `else` children provide alternative branches.',
    example:
      'conditional if="loading"\n  handler <<<\n    <Spinner />\n  >>>\n  elseif expr="error"\n    handler <<<\n      <Error msg={error} />\n    >>>\n  else\n    handler <<<\n      <Content />\n    >>>',
    props: {
      if: { required: true, kind: 'rawExpr' },
    },
    // No allowedChildren: conditional must remain permissive because
    // `generateConditional` also wraps arbitrary core nodes when used outside
    // a render block (e.g. `conditional if=isAdmin` with `type`/`config` kids).
  },
  elseif: {
    description:
      'Alternative branch inside a `conditional` — matched when the preceding branches are falsy and `expr` is truthy.',
    example: 'elseif expr="error"\n  handler <<<\n    <Error msg={error} />\n  >>>',
    props: {
      expr: { required: true, kind: 'rawExpr' },
    },
  },
  else: {
    description: 'Fallback branch inside a `conditional` — rendered when no preceding branch matched.',
    example: 'else\n  handler <<<\n    <Content />\n  >>>',
    props: {},
  },

  // ── Express / Backend nodes ───────────────────────────────────────────

  server: {
    description: 'Express server entry point with name and port',
    example:
      'server name=MyAPI port=3000\n  route path="/api/users" method=get\n    handler <<<\n      res.json(users)\n    >>>',
    props: {
      name: { kind: 'identifier' },
      port: { kind: 'number' },
    },
    allowedChildren: ['route', 'middleware', 'websocket', 'model', 'dependency', 'job', 'storage', 'email'],
  },
  route: {
    description: 'HTTP route — defines an endpoint with method, path, and handler',
    example: 'route path="/api/users" method=get\n  handler <<<\n    res.json(users)\n  >>>',
    props: {
      path: { required: true, kind: 'string' },
      method: { kind: 'identifier' },
    },
    allowedChildren: [
      'handler',
      'middleware',
      'schema',
      'auth',
      'validate',
      'params',
      'respond',
      'error',
      'guard',
      'derive',
      'fmt',
      'branch',
      'each',
      'collect',
      'effect',
    ],
  },
  middleware: {
    description: 'Express middleware — named built-in (json, cors, rateLimit) or custom with handler',
    example:
      'middleware name=cors\nmiddleware name=auth\n  handler <<<\n    if (!req.user) return res.status(401).json({ error: "Unauthorized" });\n    next();\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      names: { kind: 'string' },
    },
    allowedChildren: ['handler'],
  },
  params: {
    description: 'Query/path parameter definitions for a route — items is an array of {name, type, default?}',
    example: 'params items="[{name:page,type:number,default:1},{name:limit,type:number,default:20}]"',
    props: {
      items: { kind: 'rawExpr' },
    },
  },
  auth: {
    description: 'Authentication requirement on a route — required or optional',
    example: 'auth mode=required',
    props: {
      mode: { kind: 'identifier' },
    },
  },
  validate: {
    description: 'Request validation schema reference for a route',
    example: 'validate schema=CreateUserSchema',
    props: {
      schema: { kind: 'identifier' },
    },
  },
  respond: {
    description: 'Declarative HTTP response — status, body, redirect, or error',
    example: 'respond status=200 json="{ success: true }"',
    props: {
      status: { kind: 'number' },
      json: { kind: 'rawExpr' },
      text: { kind: 'string' },
      error: { kind: 'string' },
      redirect: { kind: 'string' },
      type: { kind: 'string' },
      headers: { kind: 'rawExpr' },
    },
  },
  schema: {
    description: 'Request schema — TypeScript types for body, params, query, and response validation',
    example: 'schema body=CreateUserInput params="{id: string}" response=UserResponse',
    props: {
      body: { kind: 'typeAnnotation' },
      params: { kind: 'typeAnnotation' },
      query: { kind: 'typeAnnotation' },
      response: { kind: 'typeAnnotation' },
    },
  },

  // ── MCP (Model Context Protocol) nodes ────────────────────────────────

  mcp: {
    description:
      'MCP server definition — compiles to a full Model Context Protocol server with tools, resources, and prompts',
    example:
      'mcp name=FileTools version=1.0 transport=stdio\n  tool name=readFile\n    param name=path type=string required=true\n    handler <<<\n      return { content: [{ type: "text", text: await fs.readFile(path) }] };\n    >>>',
    props: {
      name: { kind: 'identifier' },
      version: { kind: 'string' },
      transport: { kind: 'identifier' },
      port: { kind: 'number' },
      allowlist: { kind: 'string' },
      allowedPaths: { kind: 'string' },
      baseDir: { kind: 'string' },
    },
    allowedChildren: ['import', 'const', 'fn', 'tool', 'resource', 'prompt'],
  },
  tool: {
    description: 'MCP tool definition — a callable function exposed to AI agents with typed params and security guards',
    example:
      'tool name=searchFiles\n  description text="Search for files"\n  param name=query type=string required=true\n  guard type=sanitize param=query\n  handler <<<\n    return { content: [{ type: "text", text: results }] };\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['param', 'handler', 'description', 'guard', 'sampling', 'elicitation'],
  },
  resource: {
    description: 'MCP resource — a data source exposed to AI agents via URI. Use {variables} for templated URIs.',
    example:
      'resource name=config uri="config://app"\n  description text="Application configuration"\n  handler <<<\n    return { contents: [{ uri: uri.href, text: JSON.stringify(config) }] };\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      uri: { required: true, kind: 'string' },
    },
    allowedChildren: ['param', 'handler', 'description', 'guard'],
  },
  param: {
    description:
      'Parameter definition. Used in two contexts: (a) MCP tool/resource/prompt params (description/required/min/max apply); (b) fn/method/constructor/etc. parameter defaults via slice 3c — value flows through ValueIR canonicalisation (mirrors slice 1j const.value, 3a let.value, 3b field.value).',
    example: 'param name=query type=string required=true description="Search query"',
    props: {
      // Slice 3c-extension #3: `name` is required UNLESS the param carries
      // `binding`/`element` destructure children — destructured params encode
      // the LHS pattern in the children, not in `name`. The required-OR-children
      // invariant lives in `checkCrossProps` so `validateSchema` accepts both
      // forms. Keeping the schema-level `required: true` here would reject the
      // canonical destructured form emitted by the importer.
      name: { kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      value: { kind: 'expression' },
      required: { kind: 'boolean' },
      // Slice 3c-extension: TS-style optional `?` on the LHS, distinct from MCP
      // `required`. When `optional=true`, codegen emits `name?: type` (with the
      // `?` inside the parameter list) so callers may omit the argument.
      optional: { kind: 'boolean' },
      // Slice 3c-extension: TS-style variadic `...rest`. When `variadic=true`,
      // codegen prepends `...` to the parameter name; the type should be an
      // array (e.g. `string[]`). Variadic params can't have defaults — that's
      // user error and TS will surface it at the call site.
      variadic: { kind: 'boolean' },
      default: { kind: 'rawExpr' },
      description: { kind: 'string' },
      min: { kind: 'number' },
      max: { kind: 'number' },
    },
    // Slice 3c-extension #3: TS-style destructured params via slice 3d's
    // `binding` (object pattern) / `element` (array pattern) children. When
    // present, codegen uses the pattern as the LHS instead of `name`, e.g.
    //   param type="Point"
    //     binding name=x
    //     binding name=y
    // → `{x, y}: Point`. Same node types as slice 3d destructure — no new
    // node types needed. `name=` is omitted on destructured params.
    allowedChildren: ['guard', 'description', 'binding', 'element'],
  },
  prompt: {
    description: 'MCP prompt template — a reusable system prompt exposed to AI agents',
    example:
      'prompt name=analyzeFile\n  param name=filePath type=string required=true\n  handler <<<\n    return { messages: [{ role: "user", content: { type: "text", text: `Analyze ${filePath}` } }] };\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['param', 'handler', 'description'],
  },
  description: {
    description: 'Documentation text for a tool, resource, or prompt',
    example: 'description text="Read a file within allowed directories"',
    props: {
      text: { kind: 'string' },
      value: { kind: 'string' },
    },
  },
  sampling: {
    description: 'MCP sampling configuration — requests LLM completion within a tool handler',
    example: 'sampling maxTokens=500',
    props: {
      maxTokens: { kind: 'number' },
    },
  },
  elicitation: {
    description: 'MCP elicitation — requests user input during tool execution',
    example: 'elicitation message="Confirm deletion?"',
    props: {
      message: { kind: 'string' },
      text: { kind: 'string' },
    },
  },

  // ── React / UI element nodes ──────────────────────────────────────────

  screen: {
    description: 'Full-screen container component (minHeight: 100vh flex column)',
    example: 'screen name=Dashboard export=default memo=true\n  row\n    text value="Welcome"',
    props: {
      name: { kind: 'identifier' },
      export: { kind: 'string' },
      memo: { kind: 'rawExpr' },
    },
  },
  row: {
    description: 'Flexbox row container — horizontal layout',
    example: 'row\n  col\n    text value="Left"\n  col\n    text value="Right"',
    props: {},
  },
  col: {
    description: 'Flexbox column container — vertical layout',
    example: 'col\n  text value="Stacked content"',
    props: {},
  },
  card: {
    description: 'Card component — rounded container with shadow',
    example: 'card\n  text value="Card title"\n  text value="Card body"',
    props: {},
  },
  text: {
    description: 'Text element — renders a paragraph or span with content',
    example: 'text value="Hello, world!"',
    props: {
      value: { kind: 'string' },
    },
  },
  button: {
    description: 'Button element with label text and optional navigation',
    example: 'button text="Submit"\nbutton text="Go Home" to="/home"',
    props: {
      text: { kind: 'string' },
      to: { kind: 'string' },
    },
  },
  input: {
    description: 'Form input — text, number, email, etc. with optional state binding',
    example: 'input bind=email type=email placeholder="Enter email"',
    props: {
      bind: { kind: 'identifier' },
      type: { kind: 'identifier' },
      placeholder: { kind: 'string' },
    },
  },
  image: {
    description: 'Image element with source and alt text',
    example: 'image src="/logo.png" alt="Company logo"',
    props: {
      src: { required: true, kind: 'string' },
      alt: { kind: 'string' },
    },
  },
  modal: {
    description: 'Modal dialog overlay — renders a centered popup',
    example: 'modal\n  text value="Are you sure?"\n  button text="Confirm"\n  button text="Cancel"',
    props: {},
  },
  table: {
    description: 'Table container for tabular data display',
    example: 'table\n  header\n    text value="Name"\n    text value="Email"',
    props: {},
  },
  header: {
    description: 'Header/heading element or table header row',
    example: 'header\n  text value="Page Title"',
    props: {},
  },
  tabs: {
    description: 'Tabbed navigation container',
    example:
      'tabs\n  tab label="Profile"\n    text value="Profile content"\n  tab label="Settings"\n    text value="Settings content"',
    props: {},
  },
  theme: {
    description: 'Theme/styling definitions — CSS custom properties and style objects applied to descendant nodes',
    example: 'theme styles="{ background: #1a1a2e, color: #e0e0e0, fontFamily: system-ui }"',
    props: {
      name: { kind: 'identifier' },
      styles: { kind: 'rawExpr' },
    },
  },

  // ── Backend: Stream / Spawn / Timer ───────────────────────────────────

  stream: {
    description:
      'Async stream — SSE route (backend), or AsyncGenerator → state with cleanup (Ink). mode=channel for dispatch bridging.',
    example: 'stream name=messages source=session.messages mode=channel dispatch=handleChunk',
    props: {
      name: { kind: 'identifier' },
      source: { kind: 'rawExpr' },
      append: { kind: 'boolean' },
      mode: { kind: 'string' },
      dispatch: { kind: 'rawExpr' },
    },
    allowedChildren: ['spawn', 'handler', 'on', 'timer'],
  },
  spawn: {
    description:
      'Child process — spawns a binary with shell:false safety, SIGTERM/SIGKILL escalation, and abort-on-disconnect',
    example: "spawn binary=ffmpeg args=\"['-i',input,'-f','mp3','pipe:1']\" timeout=30",
    props: {
      binary: { required: true, kind: 'string' },
      args: { kind: 'rawExpr' },
      timeout: { kind: 'number' },
      stdin: { kind: 'rawExpr' },
    },
    allowedChildren: ['on', 'env', 'handler'],
  },
  timer: {
    description: 'Request timeout — wraps handler in a deadline with AbortController and configurable timeout handler',
    example:
      'timer timeout=15\n  handler <<<\n    const result = await longRunningTask();\n    res.json(result);\n  >>>',
    props: {
      timeout: { kind: 'number' },
      name: { kind: 'identifier' },
    },
    allowedChildren: ['handler', 'on'],
  },
  env: {
    description: 'Environment variable — declares a required or optional env var, used in spawn or server config',
    example: 'env name=DATABASE_URL required=true',
    props: {
      name: { required: true, kind: 'identifier' },
      value: { kind: 'rawExpr' },
      required: { kind: 'boolean' },
    },
  },
  trigger: {
    description: 'Event trigger — fires an action on a named event from a source',
    example: 'trigger kind=webhook on=push from=github',
    props: {
      kind: { kind: 'identifier' },
      on: { kind: 'string' },
      from: { kind: 'string' },
      expr: { kind: 'rawExpr' },
      query: { kind: 'string' },
      url: { kind: 'string' },
      call: { kind: 'rawExpr' },
    },
    allowedChildren: ['handler'],
  },

  // ── Next.js production patterns ───────────────────────────────────────

  fetch: {
    description: 'Server-side data fetch — generates an async fetch call in a Next.js server component',
    example: 'fetch name=posts url="/api/posts" options="{ next: { revalidate: 60 } }"',
    props: {
      name: { required: true, kind: 'identifier' },
      // When a `handler <<<>>>` child is provided the handler body is the loader,
      // so `url` becomes irrelevant and is no longer required.
      url: { kind: 'rawExpr' },
      options: { kind: 'rawExpr' },
    },
    allowedChildren: ['handler'],
  },
  generateMetadata: {
    description: 'Next.js generateMetadata export — async function for dynamic page metadata',
    example: 'generateMetadata params="slug:string"',
    props: {
      params: { kind: 'string' },
    },
    allowedChildren: ['handler'],
  },
  notFound: {
    description: 'Next.js notFound() call — triggers 404 page',
    example: 'notFound',
    props: {},
  },
  redirect: {
    description: 'Next.js redirect() call — server-side redirect to another route',
    example: 'redirect to="/login"',
    props: {
      to: { required: true, kind: 'string' },
    },
  },

  // ── CLI nodes ─────────────────────────────────────────────────────────

  cli: {
    description: 'CLI application root — defines a command-line tool with commands, flags, and imports',
    example:
      'cli name=myapp version=1.0.0 description="My CLI tool"\n  command name=init description="Initialize project"\n    handler <<<\n      console.log("Initializing...")\n    >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      version: { kind: 'string' },
      description: { kind: 'string' },
    },
    allowedChildren: ['command', 'flag', 'import'],
  },
  command: {
    description: 'CLI subcommand with arguments, flags, and handler',
    example:
      'command name=deploy description="Deploy to production" alias=d\n  arg name=target type=string required=true\n  flag name=dry-run alias=n type=boolean\n  handler <<<\n    deploy(target, { dryRun })\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      description: { kind: 'string' },
      alias: { kind: 'string' },
    },
    allowedChildren: ['arg', 'flag', 'handler', 'import'],
  },
  arg: {
    description: 'CLI positional argument — required args must come before optional ones',
    example: 'arg name=target type=string required=true description="Deploy target"',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'identifier' },
      required: { kind: 'boolean' },
      description: { kind: 'string' },
      default: { kind: 'rawExpr' },
    },
  },
  flag: {
    description: 'CLI flag/option — named with optional short alias',
    example: 'flag name=verbose alias=v type=boolean description="Enable verbose output"',
    props: {
      name: { required: true, kind: 'identifier' },
      alias: { kind: 'string' },
      type: { kind: 'identifier' },
      required: { kind: 'boolean' },
      description: { kind: 'string' },
      default: { kind: 'rawExpr' },
    },
  },

  // ── React lifecycle hooks (Batch 2) ───────────────────────────────────

  memo: {
    description: 'React useMemo — memoized computation with dependency tracking',
    example: 'memo name=filtered deps="items,filter"\n  handler <<<\n    return items.filter(i => i.active)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      deps: { kind: 'string' },
      // Slice 6 — see fn schema above.
      effects: { kind: 'string' },
    },
    allowedChildren: ['handler'],
  },
  callback: {
    description: 'React useCallback — memoized function reference with dependency tracking',
    example:
      'callback name=handleSubmit deps="formData" async=true\n  handler <<<\n    await api.submit(formData)\n  >>>',
    props: {
      name: { required: true, kind: 'identifier' },
      params: { kind: 'string' },
      deps: { kind: 'string' },
      async: { kind: 'boolean' },
    },
    allowedChildren: ['handler', 'param'],
  },
  ref: {
    description: 'React useRef — mutable ref object that persists across renders',
    example: 'ref name=inputRef type=HTMLInputElement initial=null',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      initial: { kind: 'rawExpr' },
    },
  },
  context: {
    description: 'React useContext — consume a React context by name',
    example: 'context name=theme source=ThemeContext',
    props: {
      name: { required: true, kind: 'identifier' },
      source: { required: true, kind: 'identifier' },
    },
  },
  prop: {
    description: 'Component prop declaration — name, type, optionality, and default value',
    example: 'prop name=title type=string\nprop name=count type=number optional=true default=0',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      optional: { kind: 'boolean' },
      default: { kind: 'rawExpr' },
    },
  },
  returns: {
    description: 'Return type declaration or return statement for a hook/function',
    example: 'returns type=AuthState with="{ user, login, logout }"',
    props: {
      name: { kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      with: { kind: 'rawExpr' },
    },
  },
  render: {
    description:
      'Render function — JSX output block for a component or hook. Accepts a raw `handler` block OR declarative KERN children (`each`, `conditional`, `local`, `group`) that compose into a JSX tree. Optional `wrapper="<Tag attrs>"` prop emits that tag as the outer element around the composed children (replaces the default `<>...</>` Fragment). `local` children emit `const name = expr;` bindings at the enclosing screen-function scope before the return — use them for shared pre-compute that multiple sibling `each`/`conditional`/`handler` nodes read. Use `group wrapper="<Tag>"` children to wrap a subset of JSX pieces in an inner tag (nested structural composition).',
    example:
      'render wrapper="<Box paddingX={1}>"\n  local name=visible expr="items.slice(start, start + pageSize)"\n  each name=item in=visible\n    handler <<< <Text>{item.label}</Text> >>>',
    props: {
      wrapper: { kind: 'string' },
    },
    allowedChildren: ['handler', 'each', 'conditional', 'local', 'group', 'fmt'],
  },
  group: {
    description:
      'Nested JSX wrapper — emits an inner tag around a subset of a `render` block\'s children. `group` carries its own `wrapper="<Tag attrs>"` prop (required) and may hold `each`, `conditional`, `handler`, or further nested `group` children. Use it to build multi-level JSX trees (e.g. `<Box><Header /><Box paddingLeft>…</Box></Box>`) without dropping into a raw handler. Must appear as a direct or transitive child of `render`.',
    example:
      'render wrapper="<Box flexDirection=\\"column\\">"\n  handler <<< <Header /> >>>\n  group wrapper="<Box paddingLeft={2}>"\n    each name=item in=items\n      handler <<< <Text>{item.label}</Text> >>>',
    props: {
      wrapper: { required: true, kind: 'string' },
    },
    allowedChildren: ['handler', 'each', 'conditional', 'group', 'fmt'],
  },
  template: {
    description: 'Reusable template with named slots — defines a composable layout pattern',
    example: 'template name=PageLayout\n  slot name=header\n  slot name=content\n  slot name=footer optional=true',
    props: {
      name: { required: true, kind: 'identifier' },
    },
    allowedChildren: ['slot', 'body', 'handler'],
  },

  // ── Data layer (Batch 3) ──────────────────────────────────────────────

  column: {
    description: 'Database column definition within a model — type, constraints, and default value',
    example: 'column name=email type=string unique=true\ncolumn name=age type=number optional=true',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      optional: { kind: 'boolean' },
      primary: { kind: 'boolean' },
      unique: { kind: 'boolean' },
      default: { kind: 'rawExpr' },
    },
  },
  relation: {
    description: 'Database relation — defines a foreign key relationship between models',
    example: 'relation name=author target=User kind=many-to-one',
    props: {
      name: { required: true, kind: 'identifier' },
      target: { required: true, kind: 'identifier' },
      kind: { kind: 'string' },
    },
  },
  inject: {
    description: 'Dependency injection — inject a service or value into the current scope',
    example: 'inject name=db type=Database from="./database.js"',
    props: {
      name: { required: true, kind: 'identifier' },
      type: { kind: 'typeAnnotation' },
      from: { kind: 'rawExpr' },
      with: { kind: 'rawExpr' },
    },
  },
  entry: {
    description: 'Cache entry — defines a cached value with key and optional strategy',
    example: 'entry name=userProfile key="user:{id}"\n  strategy name=stale-while-revalidate max=60',
    props: {
      name: { required: true, kind: 'identifier' },
      key: { kind: 'string' },
    },
    allowedChildren: ['strategy', 'handler'],
  },
  invalidate: {
    description: 'Cache invalidation rule — trigger cache clearing on an event',
    example: 'invalidate on=userUpdate tags="user,profile"',
    props: {
      on: { required: true, kind: 'string' },
      tags: { kind: 'string' },
    },
  },
  signal: {
    description: 'Reactive signal — named state that triggers updates on change (used in hooks/components)',
    example: 'signal name=isLoading',
    props: {
      name: { required: true, kind: 'identifier' },
    },
  },

  // ── Structural + UI controls (Batch 4) ────────────────────────────────

  section: {
    description: 'Semantic section container — groups related content with optional title',
    example: 'section title="User Settings"',
    props: {
      title: { kind: 'string' },
    },
  },
  list: {
    description: 'List container — renders child items as an ordered or unordered list',
    example: 'list\n  item value="First"\n  item value="Second"',
    props: {},
    allowedChildren: ['item'],
  },
  item: {
    description: 'List item — single entry within a list container',
    example: 'item value="Buy groceries"',
    props: {
      value: { kind: 'string' },
    },
  },
  option: {
    description: 'Select option — a selectable choice within a select dropdown',
    example: 'option value=admin label="Administrator"',
    props: {
      value: { required: true, kind: 'string' },
      label: { kind: 'string' },
    },
  },
  select: {
    description: 'Select dropdown — bound to state with child options',
    example: 'select bind=role\n  option value=admin label="Admin"\n  option value=user label="User"',
    props: {
      bind: { kind: 'identifier' },
    },
    allowedChildren: ['option'],
  },
  slot: {
    description: 'Template slot — named insertion point within a template',
    example: 'slot name=header optional=true default="Default Header"',
    props: {
      name: { required: true, kind: 'identifier' },
      slotType: { kind: 'string' },
      optional: { kind: 'boolean' },
      default: { kind: 'rawExpr' },
    },
  },
  body: {
    description: 'Body block — raw code content for templates or structural containers',
    example: 'body <<<\n  <main>{children}</main>\n>>>',
    props: {
      code: { kind: 'rawBlock' },
    },
  },

  // ── Phase 3: Remaining node schemas (100% coverage) ───────────────────

  // Terminal / Ink UI
  scroll: { description: 'Scrollable container', example: 'scroll', props: {} },
  progress: {
    description: 'Progress bar — shows completion status',
    example: 'progress value=75 max=100 label="Loading"',
    props: { value: { kind: 'number' }, max: { kind: 'number' }, label: { kind: 'string' } },
  },
  divider: { description: 'Visual divider / horizontal rule', example: 'divider', props: {} },
  codeblock: {
    description: 'Code block with syntax highlighting',
    example: 'codeblock lang=typescript <<<\n  const x = 1;\n>>>',
    props: { lang: { kind: 'string' }, code: { kind: 'rawBlock' } },
  },
  tab: {
    description: 'Single tab within a tabs container',
    example: 'tab label="Settings"\n  text value="Settings content"',
    props: { label: { kind: 'string' } },
  },
  separator: { description: 'Ink horizontal rule / separator', example: 'separator', props: {} },
  thead: { description: 'Table head section', example: 'thead', props: {} },
  tbody: { description: 'Table body section', example: 'tbody', props: {} },
  tr: { description: 'Table row', example: 'tr', props: {} },
  th: { description: 'Table header cell', example: 'th value="Name"', props: { value: { kind: 'string' } } },
  td: { description: 'Table data cell', example: 'td value="John"', props: { value: { kind: 'string' } } },
  scoreboard: {
    description: 'Dashboard scoreboard — container for metric widgets',
    example: 'scoreboard\n  metric label="Users" value=1234',
    props: {},
    allowedChildren: ['metric'],
  },
  metric: {
    description: 'Single metric display — label + value pair',
    example: 'metric label="Active Users" value={{users.length}}',
    props: { label: { required: true, kind: 'string' }, value: { required: true, kind: 'rawExpr' } },
  },
  spinner: {
    description: 'Loading spinner with optional text',
    example: 'spinner text="Loading..."',
    props: { text: { kind: 'string' } },
  },
  box: {
    description: 'Ink box container with border styling',
    example: 'box borderStyle=round borderColor=green',
    props: { borderStyle: { kind: 'string' }, borderColor: { kind: 'string' } },
  },
  gradient: {
    description: 'Gradient text effect (Ink)',
    example: 'gradient text="Hello" colors="red,blue"',
    props: { text: { kind: 'string' }, colors: { kind: 'string' } },
  },

  // Ink-specific input nodes
  'input-area': { description: 'Ink text input area', example: 'input-area', props: {} },
  'output-area': { description: 'Ink text output area', example: 'output-area', props: {} },
  'text-input': {
    description: 'Ink text input with binding',
    example: 'text-input value={{query}} onChange={{setQuery}} placeholder="Search..."',
    props: { value: { kind: 'rawExpr' }, onChange: { kind: 'rawExpr' }, placeholder: { kind: 'string' } },
  },
  'select-input': {
    description: 'Ink select input — choose from a list',
    example: 'select-input items={{options}} onSelect={{handleSelect}}',
    props: { items: { kind: 'rawExpr' }, onSelect: { kind: 'rawExpr' } },
  },
  'multi-select': {
    description: 'Ink multi-select — choose multiple options from a list',
    example: 'multi-select options={{items}} onChange={{handleChange}}',
    props: { options: { kind: 'rawExpr' }, onChange: { kind: 'rawExpr' }, defaultValue: { kind: 'rawExpr' } },
  },
  'confirm-input': {
    description: 'Ink confirmation prompt — yes/no input',
    example: 'confirm-input onConfirm={{handleConfirm}} onCancel={{handleCancel}}',
    props: {
      onConfirm: { kind: 'rawExpr' },
      onCancel: { kind: 'rawExpr' },
      defaultChoice: { kind: 'string' },
      submitOnEnter: { kind: 'boolean' },
    },
  },
  'password-input': {
    description: 'Ink password input — masked text entry',
    example: 'password-input bind=password placeholder="Enter password..."',
    props: { bind: { kind: 'identifier' }, placeholder: { kind: 'string' }, onChange: { kind: 'rawExpr' } },
  },
  'status-message': {
    description: 'Ink status message — success/error/warning indicator',
    example: 'status-message variant="success"\n  text value="Done!"',
    props: { variant: { kind: 'string' } },
  },
  alert: {
    description: 'Ink alert — prominent notification box',
    example: 'alert variant="warning" title="Caution"\n  text value="This cannot be undone."',
    props: { variant: { kind: 'string' }, title: { kind: 'string' } },
  },
  'ordered-list': {
    description: 'Ink ordered list — numbered items',
    example: 'ordered-list\n  text value="First"\n  text value="Second"',
    props: {},
  },
  'unordered-list': {
    description: 'Ink unordered list — bulleted items',
    example: 'unordered-list\n  text value="Item A"\n  text value="Item B"',
    props: {},
  },
  focus: {
    description: 'Ink focus management — useFocus hook',
    example: 'focus name=emailFocus autoFocus=true',
    props: { name: { required: true, kind: 'identifier' }, autoFocus: { kind: 'boolean' }, id: { kind: 'string' } },
  },
  'app-exit': {
    description: 'Ink app exit — useApp().exit() triggered by condition',
    example: 'app-exit on={{complete}}',
    props: { on: { required: true, kind: 'rawExpr' } },
  },
  'static-log': {
    description: 'Ink Static component — log-style output above dynamic content',
    example: 'static-log items={{logs}}\n  text value={{item.message}}',
    props: { items: { required: true, kind: 'rawExpr' } },
  },
  newline: {
    description: 'Ink Newline component — insert line breaks',
    example: 'newline count=2',
    props: { count: { kind: 'number' } },
  },
  'layout-row': {
    description: 'Ink horizontal layout — Box with flexDirection=row',
    example: 'layout-row gap=2\n  text value="Left"\n  text value="Right"',
    props: { gap: { kind: 'number' }, padding: { kind: 'number' } },
  },
  'layout-col': {
    description: 'Ink vertical column — Box with flexDirection=column and flex grow',
    example: 'layout-col flex=1\n  text value="Content"',
    props: { flex: { kind: 'number' }, width: { kind: 'number' } },
  },
  'layout-stack': {
    description: 'Ink vertical stack — Box with flexDirection=column (most common layout)',
    example: 'layout-stack padding=1\n  text value="Header"\n  text value="Body"',
    props: { padding: { kind: 'number' }, gap: { kind: 'number' } },
  },
  spacer: {
    description: 'Ink spacer — empty Box with flexGrow=1 for filling space',
    example: 'spacer',
    props: {},
  },
  'screen-embed': {
    description: 'Embed another screen component inline with typed props. Use from= for cross-file imports.',
    example: 'screen-embed screen=Header title="Dashboard"\nscreen-embed screen=SpinnerBlock from="./status.kern"',
    props: { screen: { required: true, kind: 'identifier' }, from: { kind: 'string' } },
  },

  // Control flow / structural
  repl: {
    description: 'Read-eval-print loop — interactive terminal command loop',
    example: 'repl name=shell prompt=">"',
    props: { name: { kind: 'identifier' }, prompt: { kind: 'string' } },
    allowedChildren: ['on', 'handler'],
  },
  parallel: {
    description: 'Parallel execution — run children concurrently',
    example: 'parallel\n  dispatch to=worker1\n  dispatch to=worker2',
    props: { name: { kind: 'identifier' } },
  },
  dispatch: {
    description: 'Dispatch an action or message to a target',
    example: 'dispatch to=worker payload={{data}}',
    props: { to: { required: true, kind: 'string' }, payload: { kind: 'rawExpr' } },
  },
  // biome-ignore lint/suspicious/noThenProperty: `then` is a valid KERN node type, not a Promise thenable
  then: {
    description: 'Sequential continuation — runs after parent completes',
    example: 'then\n  handler <<<\n    console.log("done")\n  >>>',
    props: {},
    allowedChildren: ['handler'],
  },

  // Lifecycle / structural children
  singleton: {
    description: 'Singleton marker — service is instantiated once',
    example: 'singleton name=cache',
    props: { name: { kind: 'identifier' } },
  },
  constructor: {
    description: 'Constructor for a service — runs on instantiation',
    example: 'constructor params="size:number"\n  handler <<<\n    this.data = new Map();\n  >>>',
    props: {
      params: { kind: 'string' as PropKind },
      generics: { kind: 'rawExpr' as PropKind },
    },
    allowedChildren: ['handler', 'param'],
  },
  cleanup: {
    description: 'Cleanup handler — runs on teardown (useEffect return, signal dispose)',
    example: 'cleanup <<<\n  controller.abort();\n>>>',
    props: { code: { kind: 'rawBlock' } },
  },
  export: {
    description: 'Re-export statement — export names from another module',
    example: 'export from="./utils.js" names="add,subtract"',
    props: {
      from: { kind: 'importPath' },
      names: { kind: 'string' },
      types: { kind: 'string' },
      star: { kind: 'boolean' },
      default: { kind: 'identifier' },
    },
  },
  describe: {
    description: 'Test suite — groups related test cases',
    example:
      'describe name="UserService"\n  it name="creates a user"\n    handler <<<\n      expect(createUser()).toBeDefined();\n    >>>',
    props: { name: { required: true, kind: 'string' } },
    allowedChildren: ['it', 'describe', 'expect', 'fixture', 'mock', 'handler'],
  },
  it: {
    description: 'Test case — single test assertion',
    example: 'it name="returns 200 on success"\n  handler <<<\n    expect(res.status).toBe(200);\n  >>>',
    props: { name: { required: true, kind: 'string' } },
    allowedChildren: ['expect', 'fixture', 'mock', 'handler'],
  },

  // Ground layer — semantic reasoning
  path: {
    description: 'Decision path — a named branch in a resolve/branch tree',
    example: 'path value="/api/users"',
    props: { value: { required: true, kind: 'string' } },
  },
  resolve: {
    description: 'Resolution node — selects among candidates using a discriminator',
    example: 'resolve name=bestRoute\n  candidate name=fast\n  candidate name=reliable',
    props: { name: { kind: 'identifier' } },
    allowedChildren: ['candidate', 'discriminator', 'handler'],
  },
  candidate: {
    description: 'Candidate option within a resolve block',
    example: 'candidate name=primary\n  handler <<<\n    return fastPath();\n  >>>',
    props: { name: { required: true, kind: 'identifier' } },
    allowedChildren: ['handler'],
  },
  discriminator: {
    description: 'Selection strategy for choosing among candidates',
    example: 'discriminator method=latency metric=p99',
    props: { method: { kind: 'identifier' }, metric: { kind: 'string' } },
    allowedChildren: ['handler'],
  },
  pattern: {
    description: 'Pattern match — structural matching on values',
    example: 'pattern name=classify on={{input.type}}',
    props: { name: { kind: 'identifier' }, on: { kind: 'rawExpr' } },
    allowedChildren: ['path', 'handler'],
  },
  apply: {
    description: 'Apply a transform or function to data',
    example: 'apply fn=normalize to={{rawData}}',
    props: { fn: { kind: 'identifier' }, to: { kind: 'rawExpr' } },
  },
  expect: {
    description: 'Assertion — declare an expected runtime condition or KERN structural invariant',
    example:
      'expect expr={{items.length > 0}} message="Items must not be empty"\nexpect route="GET /api/users" with={{({ query: { role: "admin" } })}} returns={{adminUsers}}\nexpect machine=Order reaches=paid via=confirm,capture\nexpect machine=Order transition=capture from=confirmed to=paid\nexpect node=interface name=User child=field count=3\nexpect no=deriveCycles',
    props: {
      expr: { kind: 'rawExpr' },
      fn: { kind: 'identifier' },
      derive: { kind: 'identifier' },
      route: { kind: 'string' },
      effect: { kind: 'identifier' },
      args: { kind: 'rawExpr' },
      with: { kind: 'rawExpr' },
      input: { kind: 'rawExpr' },
      equals: { kind: 'rawExpr' },
      returns: { kind: 'rawExpr' },
      recovers: { kind: 'boolean' },
      fallback: { kind: 'rawExpr' },
      matches: { kind: 'string' },
      throws: { kind: 'string' },
      message: { kind: 'string' },
      preset: { kind: 'identifier' },
      severity: { kind: 'identifier' },
      node: { kind: 'identifier' },
      name: { kind: 'string' },
      within: { kind: 'string' },
      child: { kind: 'identifier' },
      childName: { kind: 'string' },
      prop: { kind: 'identifier' },
      is: { kind: 'string' },
      count: { kind: 'number' },
      machine: { kind: 'identifier' },
      transition: { kind: 'identifier' },
      from: { kind: 'identifier' },
      to: { kind: 'identifier' },
      guarded: { kind: 'boolean' },
      reaches: { kind: 'identifier' },
      through: { kind: 'string' },
      avoid: { kind: 'string' },
      avoids: { kind: 'string' },
      maxSteps: { kind: 'number' },
      via: { kind: 'string' },
      no: { kind: 'identifier' },
      guard: { kind: 'identifier' },
      exhaustive: { kind: 'boolean' },
      over: { kind: 'identifier' },
      union: { kind: 'identifier' },
      covers: { kind: 'string' },
    },
  },
  fixture: {
    description: 'Native test fixture — named runtime data available to scoped expect assertions',
    example: 'fixture name=paidOrder value={{({ id: "ord_1", status: "paid" })}}',
    props: {
      name: { required: true, kind: 'identifier' },
      value: { kind: 'rawExpr' },
      expr: { kind: 'rawExpr' },
    },
  },
  mock: {
    description: 'Native test mock — replaces a scoped KERN effect with deterministic runtime data',
    example: 'mock effect=fetchUsers returns={{users}}',
    props: {
      effect: { required: true, kind: 'identifier' },
      returns: { required: true, kind: 'rawExpr' },
    },
  },
  recover: {
    description: 'Recovery handler — runs when a parent node fails',
    example: 'recover\n  handler <<<\n    return fallbackValue;\n  >>>',
    props: {
      retry: { kind: 'number' },
      fallback: { kind: 'rawExpr' },
    },
    allowedChildren: ['handler'],
  },
  strategy: {
    description: 'Retry/fallback strategy configuration',
    example: 'strategy name=exponential-backoff max=3 delay=1000',
    props: { name: { required: true, kind: 'identifier' }, max: { kind: 'number' }, delay: { kind: 'number' } },
    allowedChildren: ['handler'],
  },

  // Reason layer — metadata children
  reason: {
    description: 'Reason annotation — explains why a decision was made',
    example: 'reason text="Using cache to avoid repeated API calls"',
    props: { text: { kind: 'string' } },
  },
  evidence: {
    description: 'Evidence annotation — links to supporting data for a decision',
    example: 'evidence text="Benchmarks show 3x speedup" source="perf-report.md"',
    props: { text: { kind: 'string' }, source: { kind: 'string' } },
  },
  needs: {
    description: 'Confidence gap — declares what evidence is missing',
    example: 'needs text="Integration test for concurrent writes"',
    props: { text: { kind: 'string' } },
  },

  // Rule layer — native .kern lint rules
  rule: {
    description: 'Custom lint rule definition — matches patterns and emits findings',
    example: 'rule id=no-console severity=warning category=style\n  message template="Avoid console.log in production"',
    props: {
      id: { required: true, kind: 'identifier' },
      severity: { kind: 'string' },
      category: { kind: 'string' },
      confidence: { kind: 'number' },
    },
    allowedChildren: ['message', 'handler'],
  },
  message: {
    description: 'Rule message template — the text shown when a lint rule matches',
    example: 'message template="Found {count} unused imports"',
    props: { template: { kind: 'string' } },
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

const UNIVERSAL_CHILDREN = new Set(['handler', 'cleanup', 'reason', 'evidence', 'needs', 'signal', 'doc']);

function checkRequiredProps(node: IRNode, schema: NodeSchema, violations: SchemaViolation[]): void {
  const props = node.props || {};
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
}

function checkCrossProps(node: IRNode, violations: SchemaViolation[]): void {
  const props = node.props || {};
  if (node.type === 'component' && !('ref' in props) && !('name' in props)) {
    violations.push({
      nodeType: 'component',
      message: "'component' requires either 'ref' or 'name' prop",
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }
  if (node.type === 'guard' && !('expr' in props) && !('kind' in props) && !('type' in props)) {
    violations.push({
      nodeType: 'guard',
      message: "'guard' requires either 'expr' (assertion) or 'kind'/'type' (security guard)",
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }
  if (node.type === 'param') {
    // Slice 3c-extension #3: `param` requires `name=` UNLESS it carries
    // `binding`/`element` destructure children — destructured params encode
    // the LHS pattern in the children. Replaces the old prop-level
    // `required: true` constraint which rejected the canonical destructured
    // form emitted by importer/decompiler.
    const hasName = 'name' in props;
    const hasDestructure = (node.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
    if (!hasName && !hasDestructure) {
      violations.push({
        nodeType: 'param',
        message: "'param' requires either 'name' or destructure children ('binding'/'element')",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }
  if (node.type === 'expect') {
    const hasRuntimeAssertion = 'expr' in props;
    const hasRuntimeBehavior = 'fn' in props || 'derive' in props;
    const hasRuntimeWorkflow = 'route' in props || 'effect' in props;
    const hasPreset = 'preset' in props;
    const hasNodeShape = 'node' in props;
    const hasNegativeInvariant = 'no' in props;
    const hasGuardExhaustiveness = 'guard' in props;
    const hasMachineTransition = 'transition' in props;
    const hasMachineReachability =
      'reaches' in props || ('machine' in props && !hasNegativeInvariant && !hasMachineTransition);
    if (
      !hasRuntimeAssertion &&
      !hasRuntimeBehavior &&
      !hasRuntimeWorkflow &&
      !hasPreset &&
      !hasNodeShape &&
      !hasMachineTransition &&
      !hasMachineReachability &&
      !hasNegativeInvariant &&
      !hasGuardExhaustiveness
    ) {
      violations.push({
        nodeType: 'expect',
        message:
          "'expect' requires 'expr', 'fn', 'derive', 'route', 'effect', 'preset', 'node', 'machine' reachability, machine transition, 'no', or 'guard'",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (Number('fn' in props) + Number('derive' in props) + Number('route' in props) + Number('effect' in props) > 1) {
      violations.push({
        nodeType: 'expect',
        message: "'expect' cannot combine fn=<name>, derive=<name>, route=<spec>, and effect=<name>",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if ((hasRuntimeBehavior || hasRuntimeWorkflow) && hasRuntimeAssertion) {
      violations.push({
        nodeType: 'expect',
        message: "'expect' cannot combine fn/derive/route behavioral assertions with expr={{...}}",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (hasMachineTransition && !('machine' in props)) {
      violations.push({
        nodeType: 'expect',
        message: "'expect' machine transition assertions require machine=<name>",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (hasMachineTransition && 'reaches' in props) {
      violations.push({
        nodeType: 'expect',
        message: "'expect' cannot combine machine transition assertions with reaches=<state>",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (hasMachineReachability && (!('machine' in props) || !('reaches' in props))) {
      violations.push({
        nodeType: 'expect',
        message: "'expect' machine reachability requires both 'machine' and 'reaches'",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (hasGuardExhaustiveness && props.exhaustive !== true && props.exhaustive !== 'true') {
      violations.push({
        nodeType: 'expect',
        message: "'expect' guard assertions require exhaustive=true",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }
  if (node.type === 'fixture') {
    const hasValue = 'value' in props;
    const hasExpr = 'expr' in props;
    if (!hasValue && !hasExpr) {
      violations.push({
        nodeType: 'fixture',
        message: "'fixture' requires either value={{...}} or expr={{...}}",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    if (hasValue && hasExpr) {
      violations.push({
        nodeType: 'fixture',
        message: "'fixture' must not combine value={{...}} and expr={{...}}",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }
  if (node.type === 'fmt') {
    const returnMode = isTruthyProp(props.return);
    if (returnMode && 'name' in props) {
      violations.push({
        nodeType: 'fmt',
        message: "'fmt' with return=true must not carry a 'name' prop (return-position emits `return \\`...\\`;`)",
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
    // Neither `name` nor `return=true` selects the inline-JSX form; that form
    // is only valid inside `render`/`group` — the positional check lives in
    // the semantic validator, which has ancestry context.
  }
}

function isTruthyProp(raw: unknown): boolean {
  return raw === true || raw === 'true';
}

function checkAllowedChildren(node: IRNode, schema: NodeSchema, violations: SchemaViolation[]): void {
  if (!schema.allowedChildren || !node.children) return;
  for (const child of node.children) {
    if (!schema.allowedChildren.includes(child.type) && !UNIVERSAL_CHILDREN.has(child.type)) {
      violations.push({
        nodeType: node.type,
        message: `'${node.type}' does not allow child type '${child.type}' (allowed: ${schema.allowedChildren.join(', ')})`,
        line: child.loc?.line,
        col: child.loc?.col,
      });
    }
  }
}

function validateNode(node: IRNode, violations: SchemaViolation[]): void {
  const schema = Object.hasOwn(NODE_SCHEMAS, node.type) ? NODE_SCHEMAS[node.type] : undefined;
  if (schema) {
    checkRequiredProps(node, schema, violations);
    checkCrossProps(node, violations);
    checkAllowedChildren(node, schema, violations);
  }
  if (node.children) {
    for (const child of node.children) validateNode(child, violations);
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
    propKinds: [
      'identifier',
      'typeAnnotation',
      'importPath',
      'rawExpr',
      'rawBlock',
      'string',
      'boolean',
      'number',
      'expression',
      'regex',
    ],
    ...(evolvedTypes.length > 0 ? { evolvedTypes } : {}),
  };
}
