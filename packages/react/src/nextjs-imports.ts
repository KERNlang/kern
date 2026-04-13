import type { Ctx, JSImportSpec } from './nextjs-types.js';

export function isExpr(v: unknown): v is { __expr: true; code: string } {
  return typeof v === 'object' && v !== null && '__expr' in v;
}

export function addDefaultImport(ctx: Ctx, source: string, name: string): void {
  const spec: JSImportSpec = ctx.imports.get(source) || {
    namedImports: new Set<string>(),
    typeOnlyImports: new Set<string>(),
  };
  spec.defaultImport = name;
  ctx.imports.set(source, spec);
}

export function addNamedImport(ctx: Ctx, source: string, name: string, typeOnly?: boolean): void {
  const spec: JSImportSpec = ctx.imports.get(source) || {
    namedImports: new Set<string>(),
    typeOnlyImports: new Set<string>(),
  };
  if (typeOnly) {
    spec.typeOnlyImports.add(name);
  } else {
    spec.namedImports.add(name);
  }
  ctx.imports.set(source, spec);
}

export function exprCode(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && '__expr' in value) {
    return (value as unknown as { code: string }).code;
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback;
}

export function emitImports(ctx: Ctx): string[] {
  const lines: string[] = [];
  for (const [source, spec] of [...ctx.imports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Separate type-only imports from value imports
    const typeImports = [...spec.typeOnlyImports].filter((n) => !spec.namedImports.has(n));
    const valueImports = [...spec.namedImports];

    // Emit type-only import statement if there are type imports and no value imports sharing the source
    if (typeImports.length > 0 && valueImports.length === 0 && !spec.defaultImport) {
      lines.push(`import type { ${typeImports.sort().join(', ')} } from '${source}';`);
    } else {
      // Emit value import (with default if present)
      const clauses: string[] = [];
      if (spec.defaultImport) clauses.push(spec.defaultImport);
      if (valueImports.length > 0) clauses.push(`{ ${valueImports.sort().join(', ')} }`);
      if (clauses.length > 0) {
        lines.push(`import ${clauses.join(', ')} from '${source}';`);
      }
      // Emit separate type-only import if both type and value imports exist
      if (typeImports.length > 0) {
        lines.push(`import type { ${typeImports.sort().join(', ')} } from '${source}';`);
      }
    }
  }
  return lines;
}
