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
function methodBodyCodePython(method: IRNode): { code: string; imports: Set<string> } {
  const handler = getFirstChild(method, 'handler');
  if (!handler || getProps(handler).lang !== 'kern') {
    return { code: handlerCode(method), imports: new Set() };
  }
  const symbolMap: Record<string, string> = {};
  const claimedSnake = new Set<string>(['self']);
  const recordParam = (rawName: string): void => {
    if (!rawName) return;
    const snake = toSnakeCase(rawName);
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
  const { code, imports } = emitNativeKernBodyPythonWithImports(handler, { symbolMap });
  return { code, imports };
}

/** Slice 4b — flatten a method's body code + per-method imports into the
 *  list of indented body lines. Imports go inline at the top of the method
 *  body (slice 3b convention extended to methods); the function-local
 *  scope absorbs them, and Python caches modules after first import.
 *  Returns the indented lines (4-space prefix) ready to push into the
 *  enclosing class definition. Empty body yields a single `pass`. */
function methodBodyLinesPython(method: IRNode): string[] {
  const { code, imports } = methodBodyCodePython(method);
  const lines: string[] = [];
  for (const mod of [...imports].sort()) {
    lines.push(`        import ${mod} as __k_${mod}`);
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

export function generatePythonModel(node: IRNode): string[] {
  const props = propsOf<'model'>(node);
  const name = emitIdentifier(props.name, 'UnknownModel', node);
  const table = props.table;
  const extendsModel = props.extends;
  const columns = kids(node, 'column');
  const relations = kids(node, 'relation');
  const lines: string[] = [];

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
