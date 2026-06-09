/**
 * Data layer generators — Python generation for KERN's data nodes:
 * model, repository, cache, dependency, service, union
 */

import type { IRNode } from '@kernlang/core';
import { emitIdentifier, getFirstChild, getProps, handlerCode, mapSemanticType, propsOf } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../codegen-body-python.js';
import { buildPythonParamList, firstChild, kids, p, parseLegacyParamParts } from '../codegen-helpers.js';
import { mapTsTypeToPython, toSnakeCase } from '../type-map.js';

/** Slice 4b — native KERN method body dispatch (Python target).
 *
 *  Returns `{ code, imports }` for a method's handler. When the handler
 *  opts in via `lang=kern`, walks the structured statements via
 *  `emitNativeKernBodyPythonWithImports` with a snake_case symbol map
 *  built from the method's `param` children (or legacy `params="..."`
 *  string). Methods use `propagateStyle: 'value'` (default) — they're
 *  application-layer code, and the caller (typically a route) translates
 *  Result.err to HTTP. Slice 4a's collision-detection rule is applied
 *  here too: if two params snake-case to the same Python name, throw.
 *
 *  When the handler is legacy raw, returns `{ code: handlerCode(method),
 *  imports: empty }`. */
function methodBodyCodePython(
  method: IRNode,
  opts?: { classBody?: boolean; isConstructor?: boolean; staticReceiver?: boolean },
): { code: string; imports: Set<string>; helpers: Set<string> } {
  const handler = getFirstChild(method, 'handler');
  if (!handler || getProps(handler).lang !== 'kern') {
    return { code: handlerCode(method), imports: new Set(), helpers: new Set() };
  }
  const symbolMap: Record<string, string> = {};
  // The implicit receiver occupies the first parameter slot: `self` for an
  // instance member, `cls` for a static accessor (metaclass property). A user
  // parameter that snake-cases to the receiver name would emit invalid Python
  // (e.g. `def label(cls, cls):`), so reserve it and fail codegen early with a
  // clear message rather than generate a SyntaxError.
  const receiver = opts?.staticReceiver ? 'cls' : 'self';
  const claimedSnake = new Set<string>([receiver]);
  const recordParam = (rawName: string): void => {
    if (!rawName) return;
    const snake = toSnakeCase(rawName);
    if (snake === receiver) {
      throw new Error(
        `KERN-Python codegen: parameter '${rawName}' snake-cases to '${snake}', the implicit ` +
          `${opts?.staticReceiver ? 'static-accessor receiver (cls)' : 'method receiver (self)'}. ` +
          'Rename the parameter to avoid shadowing the receiver.',
      );
    }
    if (claimedSnake.has(snake)) {
      throw new Error(
        `KERN-Python codegen: method param '${rawName}' snake-cases to '${snake}', which collides with another param on this method. ` +
          'Rename one of the parameters to disambiguate.',
      );
    }
    claimedSnake.add(snake);
    if (snake !== rawName) symbolMap[rawName] = snake;
  };
  const paramChildren = (method.children ?? []).filter((c) => c.type === 'param');
  if (paramChildren.length > 0) {
    for (const param of paramChildren) {
      const hasDestructure = (param.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
      if (hasDestructure) continue;
      recordParam((getProps(param).name as string) || '');
    }
  } else {
    const rawParams = (getProps(method).params as string) || '';
    if (rawParams) {
      for (const part of parseLegacyParamParts(rawParams)) recordParam(part.name);
    }
  }
  // Class member bodies: `this` resolves to `self`, and `super(...)`/`super.x`
  // lower to `super().__init__(...)`/`super().x` via the inClassBody flag.
  // In a static accessor (metaclass property) body `this` is the class -> `cls`.
  if (opts?.classBody) symbolMap.this = opts?.staticReceiver ? 'cls' : 'self';
  const { code, imports, helpers } = emitNativeKernBodyPythonWithImports(handler, {
    symbolMap,
    inClassBody: opts?.classBody ?? false,
    inConstructor: opts?.isConstructor ?? false,
  });
  return { code, imports, helpers };
}

/** Slice 4b — flatten a method's body code + per-method imports into the
 *  list of indented body lines. Imports go inline at the top of the method
 *  body (slice 3b convention extended to methods); the function-local
 *  scope absorbs them, and Python caches modules after first import.
 *  Returns the indented lines (4-space prefix) ready to push into the
 *  enclosing class definition. Empty body yields a single `pass`. */
function methodBodyLinesPython(
  method: IRNode,
  opts?: { classBody?: boolean; isConstructor?: boolean; staticReceiver?: boolean },
): string[] {
  const { code, imports, helpers } = methodBodyCodePython(method, opts);
  const lines: string[] = [];
  for (const mod of [...imports].sort()) {
    lines.push(`        import ${mod} as __k_${mod}`);
  }
  // PR-4 — runtime helpers (e.g. `_kern_pairs`) emitted as method-local defs
  // with the method's 8-space indent. Each entry is multi-line; we split
  // and indent every line so the embedded function body stays at the right
  // depth inside the enclosing class. Function-local emission keeps the
  // refactor contained — module-level emission would require touching the
  // class-file scaffolding.
  for (const helper of [...helpers]) {
    for (const helperLine of helper.split('\n')) {
      lines.push(`        ${helperLine}`);
    }
  }
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`        ${line}`);
    }
  } else if (lines.length === 0) {
    lines.push('        pass');
  }
  return lines;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Convert a KERN default value to valid Python syntax. */
export function formatPythonDefault(value: string, kernType: string): string {
  const trimmed = value.trim();
  if (trimmed === 'true') return 'True';
  if (trimmed === 'false') return 'False';
  if (trimmed === 'null' || trimmed === 'undefined') return 'None';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(["']).*\1$/.test(trimmed)) return trimmed;
  if (/^[A-Za-z_]\w*\([^)]*\)$/.test(trimmed)) return trimmed;
  // String types get quoted
  if (['string', 'text', 'Email', 'URL', 'PhoneNumber', 'PersonName', 'uuid'].includes(kernType)) {
    return `"${trimmed}"`;
  }
  return trimmed;
}

/** Lower a field's default to a Python expression, or undefined when none.
 *  A `value={{ <expr> }}` block parses to `{ __expr: true, code: '<expr>' }`;
 *  a bare `default=...` is a raw string. `new X(...)` -> `X(...)`; literals go
 *  through formatPythonDefault (true/false/null/number/string handling). */
function fieldDefaultPython(field: IRNode): string | undefined {
  const fp = p(field);
  const v = fp.value as unknown;
  let code: string | undefined;
  if (v && typeof v === 'object' && (v as { __expr?: boolean }).__expr) {
    code = (v as { code?: string }).code;
  } else if (typeof v === 'string') {
    code = v;
  } else if (typeof fp.default === 'string') {
    code = fp.default as string;
  }
  if (code === undefined) return undefined;
  return formatPythonDefault(code.replace(/\bnew\s+/g, ''), (fp.type as string) || '');
}

// SQLModel column override: pydantic validator types -> plain DB types for column declarations
const SQLMODEL_COLUMN_OVERRIDE: Record<string, string> = {
  Email: 'str',
  URL: 'str',
  PhoneNumber: 'str',
};

/** Map KERN type to Python/SQLModel column type. Uses shared semantic type map + SQLModel overrides. */
export function mapColumnToPython(kernType: string): string {
  return SQLMODEL_COLUMN_OVERRIDE[kernType] ?? mapSemanticType(kernType, 'pydantic');
}

// ── Model (SQLModel) ────────────────────────────────────────────────────
// model name=User table=users
//   column name=id type=uuid primary=true
//   column name=email type=Email unique=true
//   relation name=posts target=Post kind=one-to-many
// -> class User(SQLModel, table=True): ...

export function generatePythonModel(
  node: IRNode,
  options?: { pythonModelBackend?: 'pydantic' | 'sqlmodel' | 'auto' },
): string[] {
  const props = propsOf<'model'>(node);
  const name = emitIdentifier(props.name, 'UnknownModel', node);
  const table = props.table;
  const extendsModel = props.extends;
  const columns = kids(node, 'column');
  const relations = kids(node, 'relation');
  const lines: string[] = [];

  const backend = options?.pythonModelBackend || 'auto';
  if (backend === 'pydantic') {
    const baseClass = extendsModel || 'BaseModel';
    lines.push(`class ${name}(${baseClass}):`);
    if (columns.length === 0) {
      lines.push('    pass');
      return lines;
    }
    for (const col of columns) {
      const cp = propsOf<'column'>(col);
      const colName = toSnakeCase(cp.name || 'column');
      const colType = mapColumnToPython(cp.type || 'str');
      const isNullable = cp.nullable === 'true' || cp.nullable === true;
      const defaultVal = cp.default;

      const typeStr = isNullable ? `${colType} | None` : colType;
      if (defaultVal !== undefined) {
        lines.push(`    ${colName}: ${typeStr} = ${formatPythonDefault(defaultVal, cp.type || '')}`);
      } else if (isNullable) {
        lines.push(`    ${colName}: ${typeStr} = None`);
      } else {
        lines.push(`    ${colName}: ${typeStr}`);
      }
    }
    return lines;
  }

  const baseClass = extendsModel || 'SQLModel';
  lines.push(`class ${name}(${baseClass}, table=True):`);
  if (table) {
    lines.push(`    __tablename__ = "${table}"`);
    lines.push('');
  }

  if (columns.length === 0 && relations.length === 0) {
    lines.push('    pass');
    return lines;
  }

  for (const col of columns) {
    const cp = propsOf<'column'>(col);
    const colName = toSnakeCase(cp.name || 'column');
    const colType = mapColumnToPython(cp.type || 'str');
    const isPrimary = cp.primary === 'true' || cp.primary === true;
    const isUnique = cp.unique === 'true' || cp.unique === true;
    const isNullable = cp.nullable === 'true' || cp.nullable === true;
    const defaultVal = cp.default;

    // Build Field() args
    const fieldArgs: string[] = [];
    if (isPrimary) fieldArgs.push('primary_key=True');
    if (isUnique) fieldArgs.push('unique=True');
    if (defaultVal !== undefined) fieldArgs.push(`default=${formatPythonDefault(defaultVal, cp.type || '')}`);
    else if (isNullable) fieldArgs.push('default=None');

    const typeStr = isNullable ? `${colType} | None` : colType;

    if (fieldArgs.length > 0) {
      lines.push(`    ${colName}: ${typeStr} = Field(${fieldArgs.join(', ')})`);
    } else {
      lines.push(`    ${colName}: ${typeStr}`);
    }
  }

  if (relations.length > 0 && columns.length > 0) {
    lines.push('');
  }

  for (const rel of relations) {
    const rp = propsOf<'relation'>(rel);
    const relName = toSnakeCase(rp.name || 'relation');
    const target = rp.target || rp.model || 'Any';
    const kind = rp.kind || 'one-to-many';
    const backPop = toSnakeCase(name);

    if (kind === 'one-to-many' || kind === 'many-to-many') {
      lines.push(`    ${relName}: list["${target}"] = Relationship(back_populates="${backPop}")`);
    } else {
      lines.push(`    ${relName}: "${target}" | None = Relationship(back_populates="${backPop}")`);
    }
  }

  return lines;
}

// ── Repository ──────────────────────────────────────────────────────────
// repository name=UserRepository model=User
//   method name=findByEmail params="email:string" returns="User | null" async=true
// -> class UserRepository: ...

export function generatePythonRepository(node: IRNode): string[] {
  const props = propsOf<'repository'>(node);
  const name = emitIdentifier(props.name, 'UnknownRepo', node);
  const model = props.model;
  const lines: string[] = [];

  lines.push(`class ${name}:`);
  if (model) {
    lines.push(`    def __init__(self, session: AsyncSession):`);
    lines.push(`        self.session = session`);
    lines.push('');
  }

  const methods = kids(node, 'method');
  if (methods.length === 0 && !model) {
    lines.push('    pass');
    return lines;
  }

  for (const method of methods) {
    const mp = p(method);
    const mname = toSnakeCase((mp.name as string) || 'method');
    const isAsync = mp.async === 'true' || mp.async === true;
    const asyncKw = isAsync ? 'async ' : '';
    // Slice 3c P2 follow-up: target-neutral helper reads structured `param`
    // children when present, falls back to legacy `params="..."` otherwise.
    const params = buildPythonParamList(method, { selfPrefix: true });
    const returns = mp.returns ? ` -> ${mapTsTypeToPython(mp.returns as string)}` : '';

    lines.push(`    ${asyncKw}def ${mname}(${params})${returns}:`);
    // Slice 4b — methodBodyLinesPython dispatches lang=kern, builds symbol
    // map, injects required imports inline, and falls back to raw handler
    // code for legacy bodies. Empty bodies yield `pass`.
    const bodyLines = methodBodyLinesPython(method);
    if (bodyLines.length === 0) {
      lines.push('        pass');
    } else {
      for (const bl of bodyLines) lines.push(bl);
    }
    lines.push('');
  }

  return lines;
}

// ── Cache ───────────────────────────────────────────────────────────────
// cache name=userCache backend=redis prefix="user:" ttl=3600
//   entry name=profile key="user:{id}"
//   invalidate on=userUpdate tags="user:{id}"

export function generatePythonCache(node: IRNode): string[] {
  const props = propsOf<'cache'>(node);
  const name = emitIdentifier(props.name, 'unknown_cache', node);
  const className = name[0].toUpperCase() + name.slice(1);
  const backend = props.backend || 'memory';
  const prefix = props.prefix || '';
  const ttl = props.ttl;
  const lines: string[] = [];

  lines.push(`class ${className}:`);
  lines.push(`    prefix = "${prefix}"`);
  if (ttl) lines.push(`    ttl = ${ttl}`);
  lines.push(`    backend = "${backend}"`);
  lines.push('');

  // Entry methods
  for (const entry of kids(node, 'entry')) {
    const ep = p(entry);
    const entryName = toSnakeCase((ep.name as string) || 'entry');
    const key = (ep.key as string) || entryName;
    // If key already contains the prefix pattern, use it as-is; otherwise prepend prefix
    const keyExpr = key.includes(prefix)
      ? key.replace(/\{id\}/g, '{id}')
      : `${prefix}${key.replace(/\{id\}/g, '{id}')}`;

    lines.push(`    async def get_${entryName}(self, id: str):`);
    lines.push(`        key = f"${keyExpr}"`);
    lines.push(`        return ${backend === 'redis' ? 'await redis.get(key)' : 'self._cache.get(key)'}`);
    lines.push('');
  }

  // Invalidation methods
  for (const inv of kids(node, 'invalidate')) {
    const ip = p(inv);
    const on = toSnakeCase((ip.on as string) || 'update');
    const tags = (ip.tags as string) || '';
    const rawInvKey = tags ? tags.replace(/\{id\}/g, '{id}') : `{id}`;
    const invKey = rawInvKey.includes(prefix) ? rawInvKey : `${prefix}${rawInvKey}`;

    lines.push(`    async def invalidate_on_${on}(self, id: str):`);
    lines.push(`        key = f"${invKey}"`);
    lines.push(`        ${backend === 'redis' ? 'await redis.delete(key)' : 'self._cache.pop(key, None)'}`);
    lines.push('');
  }

  if (kids(node, 'entry').length === 0 && kids(node, 'invalidate').length === 0) {
    lines.push('    pass');
  }

  return lines;
}

// ── Dependency ──────────────────────────────────────────────────────────
// dependency name=authService scope=singleton
//   inject db from=database
//   inject userRepo type=UserRepository with=(db)
//   returns AuthService with=(userRepo)

export function generatePythonDependency(node: IRNode): string[] {
  const props = propsOf<'dependency'>(node);
  const name = toSnakeCase(emitIdentifier(props.name, 'unknown_dep', node));
  const scope = props.scope || 'transient';
  const lines: string[] = [];

  const injects = kids(node, 'inject');
  const returnsNode = firstChild(node, 'returns');
  const returnsType = returnsNode ? ((p(returnsNode).name || p(returnsNode).type || 'Any') as string) : 'Any';

  if (scope === 'singleton') {
    lines.push(`_${name}_instance = None`);
    lines.push('');
  }

  lines.push(`def create_${name}() -> ${returnsType}:`);

  if (scope === 'singleton') {
    lines.push(`    global _${name}_instance`);
    lines.push(`    if _${name}_instance:`);
    lines.push(`        return _${name}_instance`);
  }

  for (const inj of injects) {
    const ip = p(inj);
    const injName = toSnakeCase((ip.name as string) || 'dep');
    const injType = ip.type as string;
    const injFrom = ip.from as string;
    const injWith = ip.with as string;
    if (injFrom) {
      lines.push(`    ${injName} = ${injFrom}`);
    } else if (injType && injWith) {
      lines.push(`    ${injName} = ${injType}(${injWith})`);
    } else if (injType) {
      lines.push(`    ${injName} = ${injType}()`);
    }
  }

  const returnsWith = returnsNode ? (p(returnsNode).with as string) : undefined;
  if (returnsWith) {
    lines.push(`    instance = ${returnsType}(${returnsWith})`);
  } else {
    lines.push(`    instance = ${returnsType}()`);
  }

  if (scope === 'singleton') {
    lines.push(`    _${name}_instance = instance`);
  }

  lines.push(`    return instance`);
  return lines;
}

// ── Service ─────────────────────────────────────────────────────────────
// service name=AuthService
//   field name=repo type=UserRepository private=true
//   method name=findByEmail params="email:string" returns="User | null" async=true

export function generatePythonService(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownService', node);
  const lines: string[] = [];

  const fields = kids(node, 'field');
  const methods = kids(node, 'method');

  lines.push(`class ${name}:`);

  // Constructor from fields
  if (fields.length > 0) {
    const ctorParams = fields
      .map((f) => {
        const fp = p(f);
        const fname = toSnakeCase((fp.name as string) || 'field');
        const ftype = fp.type ? mapTsTypeToPython(fp.type as string) : 'Any';
        return `${fname}: ${ftype}`;
      })
      .join(', ');
    lines.push(`    def __init__(self, ${ctorParams}):`);
    for (const f of fields) {
      const fp = p(f);
      const fname = toSnakeCase((fp.name as string) || 'field');
      const vis = fp.private === 'true' || fp.private === true ? '_' : '';
      lines.push(`        self.${vis}${fname} = ${fname}`);
    }
    lines.push('');
  }

  if (methods.length === 0 && fields.length === 0) {
    lines.push('    pass');
    return lines;
  }

  for (const method of methods) {
    const mp = p(method);
    const mname = toSnakeCase((mp.name as string) || 'method');
    const isAsync = mp.async === 'true' || mp.async === true;
    const asyncKw = isAsync ? 'async ' : '';
    // Slice 3c P2 follow-up: target-neutral helper reads structured `param`
    // children when present, falls back to legacy `params="..."` otherwise.
    const params = buildPythonParamList(method, { selfPrefix: true });
    const returns = mp.returns ? ` -> ${mapTsTypeToPython(mp.returns as string)}` : '';

    lines.push(`    ${asyncKw}def ${mname}(${params})${returns}:`);
    // Slice 4b — same method dispatch as repository, sharing the helper.
    const bodyLines = methodBodyLinesPython(method);
    if (bodyLines.length === 0) {
      lines.push('        pass');
    } else {
      for (const bl of bodyLines) lines.push(bl);
    }
    lines.push('');
  }

  return lines;
}

// ── Class (single-source class slice, Python target) ────────────────────
// Phase 1: structural shell parity with the TS `emitClassBody`. Emits the
// class header + `extends` base, static fields as class attributes, the
// constructor as `__init__`, instance/static methods, and getters/setters via
// `@property`. Method/ctor bodies route through the shared
// `methodBodyLinesPython`; full class-body symbol translation
// (`this`->`self`, `super.m()`->`super().m()`, `new X()`->`X()`) is the next
// sub-problem the differential class fixtures will drive.
export function generatePythonClass(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownClass', node);
  const baseRaw = typeof props.extends === 'string' ? (props.extends as string) : '';
  const base = baseRaw ? emitIdentifier(baseRaw, 'object', node) : '';

  const isStatic = (n: IRNode): boolean => {
    const np = p(n);
    return np.static === 'true' || np.static === true;
  };

  // `abstract` is ERASED at codegen on both targets (a plain, instantiable
  // class — matching TS, where `abstract` is compile-time-only and gone from
  // emitted JS). An abstract member is a handler-less method/getter/setter under
  // an abstract class; it lowers to a fail-fast `raise`, so an un-overridden
  // abstract member fails identically on TS (throw) and Python (raise) — parity
  // by construction. `implements` is likewise erased (the semantic validator
  // owns conformance); only a human-readable marker comment is emitted.
  const isAbstractClass = props.abstract === 'true' || props.abstract === true;
  const implementsRaw = typeof props.implements === 'string' ? (props.implements as string) : '';
  const isAbstractMember = (m: IRNode): boolean => isAbstractClass && firstChild(m, 'handler') === undefined;
  const abstractRaise = (kind: string, memberName: string): string =>
    `        raise NotImplementedError("abstract ${kind} ${name}.${memberName} not implemented")`;

  const fields = kids(node, 'field');
  const staticFields = fields.filter(isStatic);
  const methods = kids(node, 'method');
  const getters = kids(node, 'getter');
  const setters = kids(node, 'setter');
  const ctor = firstChild(node, 'constructor');

  // Static accessors (static get/set) lower to a per-class metaclass: both
  // `Box.label` reads and `Box.label = x` writes dispatch through the metaclass
  // @property/.setter (a plain descriptor would be shadowed on assignment). The
  // static backing field stays a class attribute. The metaclass extends
  // `type(<base>)` so that when the base ALSO has static accessors the derived
  // metaclass subclasses the base metaclass (no `metaclass conflict`, and the
  // base's static accessors are inherited); when the base has none, `type(<base>)`
  // is just `type`.
  const staticGetters = getters.filter(isStatic);
  const staticSetters = setters.filter(isStatic);
  const metaName = `_${name}Meta`;
  const metaLines: string[] = [];
  if (staticGetters.length + staticSetters.length > 0) {
    metaLines.push(`class ${metaName}(${base ? `type(${base})` : 'type'}):`);
    const metaGetterNames = new Set<string>();
    for (const g of staticGetters) {
      const gp = p(g);
      const gname = toSnakeCase((gp.name as string) || 'prop');
      const returns = gp.returns ? ` -> ${mapTsTypeToPython(gp.returns as string)}` : '';
      metaGetterNames.add(gname);
      metaLines.push('    @property');
      metaLines.push(`    def ${gname}(cls)${returns}:`);
      // Abstract static accessors fail-fast like instance ones, so an
      // un-overridden abstract static getter raises on Python the same way it
      // throws on TS (was silently `pass` -> None before).
      if (isAbstractMember(g)) {
        metaLines.push(abstractRaise('getter', gname));
      } else {
        metaLines.push(...methodBodyLinesPython(g, { classBody: true, staticReceiver: true }));
      }
      metaLines.push('');
    }
    for (const s of staticSetters) {
      const sname = toSnakeCase((p(s).name as string) || 'prop');
      if (!metaGetterNames.has(sname)) {
        metaLines.push('    @property');
        metaLines.push(`    def ${sname}(cls):  # write-only static property`);
        metaLines.push('        return None');
        metaLines.push('');
        metaGetterNames.add(sname);
      }
      metaLines.push(`    @${sname}.setter`);
      metaLines.push(`    def ${sname}(cls, ${buildPythonParamList(s, { selfPrefix: false })}):`);
      if (isAbstractMember(s)) {
        metaLines.push(abstractRaise('setter', sname));
      } else {
        metaLines.push(...methodBodyLinesPython(s, { classBody: true, staticReceiver: true }));
      }
      metaLines.push('');
    }
  }
  const baseParts = [base, metaLines.length > 0 ? `metaclass=${metaName}` : ''].filter(Boolean);
  const header = baseParts.length > 0 ? `class ${name}(${baseParts.join(', ')}):` : `class ${name}:`;

  const body: string[] = [];

  // Static fields -> class-level attributes (shared across instances, like TS statics).
  for (const f of staticFields) {
    const fp = p(f);
    const fname = toSnakeCase((fp.name as string) || 'field');
    const ftype = fp.type ? mapTsTypeToPython(fp.type as string) : 'Any';
    body.push(`    ${fname}: ${ftype} = ${fieldDefaultPython(f) ?? 'None'}`);
  }
  if (staticFields.length > 0) body.push('');

  // Constructor -> __init__. Instance-field defaults are emitted INSIDE __init__
  // (never as class-level attributes) so each instance gets a fresh value —
  // matching TS per-instance field initialization and avoiding Python's
  // shared-mutable-default trap (a class-level `items = []` would be shared by
  // every instance). Defaults precede the constructor body, which may reassign
  // them (TS field-init-then-constructor order).
  const instanceDefaults = fields.filter((f) => !isStatic(f) && fieldDefaultPython(f) !== undefined);
  const defaultLines = instanceDefaults.map(
    (f) => `        self.${toSnakeCase((p(f).name as string) || 'field')} = ${fieldDefaultPython(f)}`,
  );
  if (ctor) {
    body.push(`    def __init__(${buildPythonParamList(ctor, { selfPrefix: true })}):`);
    const ctorLines = methodBodyLinesPython(ctor, { classBody: true, isConstructor: true });
    // Field initializers run AFTER super().__init__() (TS field-init-after-super
    // order), so inject defaults right after the super call when present, else at
    // the top of the constructor body.
    const superIdx = ctorLines.findIndex((line) => line.includes('super().__init__'));
    if (superIdx >= 0) {
      body.push(...ctorLines.slice(0, superIdx + 1), ...defaultLines, ...ctorLines.slice(superIdx + 1));
    } else {
      body.push(...defaultLines, ...ctorLines);
    }
    body.push('');
  } else if (instanceDefaults.length > 0) {
    // No explicit constructor. A derived class still forwards to its base
    // initializer (TS subclasses without a constructor auto-forward args), then
    // applies its own field defaults.
    if (base) {
      body.push('    def __init__(self, *args, **kwargs):');
      body.push('        super().__init__(*args, **kwargs)');
    } else {
      body.push('    def __init__(self):');
    }
    body.push(...defaultLines);
    body.push('');
  }

  // Methods (instance + static).
  for (const m of methods) {
    const mp = p(m);
    const mname = toSnakeCase((mp.name as string) || 'method');
    const asyncKw = mp.async === 'true' || mp.async === true ? 'async ' : '';
    const returns = mp.returns ? ` -> ${mapTsTypeToPython(mp.returns as string)}` : '';
    if (isStatic(m)) {
      body.push('    @staticmethod');
      body.push(`    ${asyncKw}def ${mname}(${buildPythonParamList(m, { selfPrefix: false })})${returns}:`);
    } else {
      body.push(`    ${asyncKw}def ${mname}(${buildPythonParamList(m, { selfPrefix: true })})${returns}:`);
    }
    if (isAbstractMember(m)) {
      body.push(abstractRaise('method', mname));
    } else {
      body.push(...methodBodyLinesPython(m, { classBody: !isStatic(m) }));
    }
    body.push('');
  }

  // Getters -> @property. Static getters were already emitted on the metaclass.
  const instanceGetterNames = new Set<string>();
  for (const g of getters) {
    if (isStatic(g)) continue;
    const gp = p(g);
    const gname = toSnakeCase((gp.name as string) || 'prop');
    instanceGetterNames.add(gname);
    const returns = gp.returns ? ` -> ${mapTsTypeToPython(gp.returns as string)}` : '';
    body.push('    @property');
    body.push(`    def ${gname}(self)${returns}:`);
    if (isAbstractMember(g)) {
      body.push(abstractRaise('getter', gname));
    } else {
      body.push(...methodBodyLinesPython(g, { classBody: true }));
    }
    body.push('');
  }
  // Setters -> @<name>.setter. Python requires a property to exist before its
  // `.setter`; KERN allows setter-only properties, so synthesize a getter when
  // none was declared (write-only -> returns None, matching a TS getter-less read).
  for (const s of setters) {
    if (isStatic(s)) continue; // static setters were already emitted on the metaclass
    const sp = p(s);
    const sname = toSnakeCase((sp.name as string) || 'prop');
    if (!instanceGetterNames.has(sname)) {
      body.push('    @property');
      body.push(`    def ${sname}(self):  # write-only property (no getter declared in KERN)`);
      body.push('        return None');
      body.push('');
      instanceGetterNames.add(sname);
    }
    body.push(`    @${sname}.setter`);
    body.push(`    def ${sname}(${buildPythonParamList(s, { selfPrefix: true })}):`);
    if (isAbstractMember(s)) {
      body.push(abstractRaise('setter', sname));
    } else {
      body.push(...methodBodyLinesPython(s, { classBody: true }));
    }
    body.push('');
  }

  if (body.length === 0) body.push('    pass');

  // `implements` is erased at codegen (the validator owns conformance); emit a
  // human-readable marker so the relationship survives in the generated source.
  const headerLines = implementsRaw ? [`# implements: ${implementsRaw}`, header] : [header];
  // Metaclass (if any) must be defined before the class that references it.
  return metaLines.length > 0 ? [...metaLines, ...headerLines, ...body] : [...headerLines, ...body];
}

// ── Union (Pydantic Discriminated Union) ────────────────────────────────
// union name=ContentSegment discriminant=type
//   variant name=prose
//     field name=text type=string
//   variant name=code
//     field name=language type=string
// -> class ProseContentSegment(BaseModel): ...
//   ContentSegment = Union[ProseContentSegment, CodeContentSegment]

export function generatePythonUnion(node: IRNode): string[] {
  const props = propsOf<'union'>(node);
  const name = emitIdentifier(props.name, 'UnknownUnion', node);
  const discriminant = props.discriminant || 'type';
  const variants = kids(node, 'variant');
  const lines: string[] = [];

  if (variants.length === 0) {
    lines.push(`${name} = None  # empty union`);
    return lines;
  }

  const variantClassNames: string[] = [];

  for (const variant of variants) {
    const vp = p(variant);
    const vname = emitIdentifier(vp.name as string, 'variant', variant);
    const className = `${vname[0].toUpperCase()}${vname.slice(1)}${name}`;
    variantClassNames.push(className);
    const fields = kids(variant, 'field');

    lines.push(`class ${className}(BaseModel):`);
    lines.push(`    ${toSnakeCase(discriminant)}: Literal["${vname}"] = "${vname}"`);
    for (const field of fields) {
      const fp = p(field);
      const fname = toSnakeCase((fp.name as string) || 'field');
      const ftype = mapTsTypeToPython((fp.type as string) || 'Any');
      const isOptional = fp.optional === 'true' || fp.optional === true;
      if (isOptional) {
        lines.push(`    ${fname}: ${ftype} | None = None`);
      } else {
        lines.push(`    ${fname}: ${ftype}`);
      }
    }
    if (fields.length === 0) {
      lines.push('    pass');
    }
    lines.push('');
  }

  lines.push(`${name} = Union[${variantClassNames.join(', ')}]`);
  return lines;
}
