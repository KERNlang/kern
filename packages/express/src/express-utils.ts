import type { IRNode } from '@kernlang/core';
import { camelKey, getProps } from '@kernlang/core';
import type { KeyTypeInfo } from './express-types.js';

// ── Portable respond node → Express ──────────────────────────────────────

export function generateRespondExpress(respondNode: IRNode, indent: string): string[] {
  const p = getProps(respondNode);
  const status = typeof p.status === 'number' ? p.status : undefined;
  const json = p.json as string | undefined;
  const error = p.error as string | undefined;
  const text = p.text as string | undefined;
  const redirect = p.redirect as string | undefined;

  if (redirect) {
    return [`${indent}res.redirect('${escapeSingleQuotes(String(redirect))}');`];
  }
  if (error) {
    return [`${indent}res.status(${status || 500}).json({ error: '${escapeSingleQuotes(String(error))}' });`];
  }
  if (json) {
    if (!status || status === 200) {
      return [`${indent}res.json(${json});`];
    }
    return [`${indent}res.status(${status}).json(${json});`];
  }
  if (text) {
    if (!status || status === 200) {
      return [`${indent}res.send(${text});`];
    }
    return [`${indent}res.status(${status}).send(${text});`];
  }
  if (status === 204) {
    return [`${indent}res.status(204).send();`];
  }
  if (status) {
    return [`${indent}res.status(${status}).send();`];
  }
  return [`${indent}res.status(200).send();`];
}

export function pascalCase(value: string): string {
  const camel = camelKey(value);
  return camel ? camel.charAt(0).toUpperCase() + camel.slice(1) : 'Generated';
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'generated'
  );
}

export function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function indentBlock(code: string, indent: string): string[] {
  return code.split('\n').map((line) => `${indent}${line}`);
}

export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inQuote = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' && value[i - 1] !== '\\') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth--;
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
      if (ch === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Map TS/KERN schema types to JS typeof categories for runtime validation. */
export function toTypeofCategory(tsType: string): string | undefined {
  const t = tsType
    .trim()
    .replace(/\s*\|\s*undefined$/, '')
    .replace(/\s*\|\s*null$/, '');
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'int' || t === 'float') return 'number';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  return undefined; // complex types — skip typeof check
}

export function extractRequiredKeys(schemaType: string): string[] {
  return extractRequiredKeyTypes(schemaType).map((k) => k.key);
}

export function extractRequiredKeyTypes(schemaType: string): KeyTypeInfo[] {
  const trimmed = schemaType.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

  const keys: KeyTypeInfo[] = [];
  const inner = trimmed.slice(1, -1);
  for (const part of splitTopLevel(inner)) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = part.slice(0, colonIdx).trim();
    if (!rawKey || rawKey.endsWith('?')) continue;
    const rawType = part.slice(colonIdx + 1).trim();
    const typeofCat = toTypeofCategory(rawType);
    keys.push({
      key: rawKey.replace(/^['"]|['"]$/g, ''),
      type: typeofCat || 'any',
    });
  }
  return keys;
}

export function derivePathParams(path: string): string[] {
  const matches = path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...matches].map((match) => match[1]);
}

export function buildPathParamsType(path: string): string | undefined {
  const params = derivePathParams(path);
  if (params.length === 0) return undefined;
  return `{ ${params.map((param) => `${param}: string`).join('; ')} }`;
}

/**
 * Rewrite a relative import path so that it still resolves from a file one
 * directory deeper than the server output (i.e. a route file in `./routes/`).
 * Non-relative specifiers (package names, `node:` imports) are returned
 * unchanged because they don't move when the containing file moves.
 */
export function rewriteRelativeImportForRoute(importPath: string): string {
  if (importPath.startsWith('./')) return `.${importPath}`;
  if (importPath.startsWith('../')) return `../${importPath}`;
  if (importPath === '.') return '..';
  if (importPath === '..') return '../..';
  return importPath;
}

/**
 * Render a KERN `import` IRNode into a TS import statement. When
 * `pathRewrite` is provided the `from=` value is transformed before emission
 * (used for propagating server-level imports into nested route files).
 */
export function renderImportNode(node: IRNode, pathRewrite?: (from: string) => string): string | undefined {
  const props = getProps(node);
  const from = typeof props.from === 'string' ? props.from : undefined;
  if (!from) return undefined;

  const namesRaw = typeof props.names === 'string' ? props.names : undefined;
  const defaultImport = typeof props.default === 'string' ? props.default : undefined;
  const isTypeOnly = props.types === 'true' || props.types === true;
  const rewrittenFrom = pathRewrite ? pathRewrite(from) : from;
  const typeKw = isTypeOnly ? 'type ' : '';
  const namedList = namesRaw
    ? namesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ')
    : '';

  if (defaultImport && namedList) {
    return `import ${typeKw}${defaultImport}, { ${namedList} } from '${escapeSingleQuotes(rewrittenFrom)}';`;
  }
  if (defaultImport) {
    return `import ${typeKw}${defaultImport} from '${escapeSingleQuotes(rewrittenFrom)}';`;
  }
  if (namedList) {
    return `import ${typeKw}{ ${namedList} } from '${escapeSingleQuotes(rewrittenFrom)}';`;
  }
  return `import '${escapeSingleQuotes(rewrittenFrom)}';`;
}

export function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

export function routeFileBase(method: string, path: string, index: number): string {
  const base = slugify(`${method}-${path.replace(/[:/]/g, '-')}`);
  return base === 'generated' ? `route-${index}` : base;
}

export function routeRegisterName(method: string, path: string): string {
  return `register${pascalCase(`${method} ${path}`)}Route`;
}

export function middlewareExportName(node: IRNode): string {
  const props = getProps(node);
  const handlerName = typeof props.handler === 'string' ? props.handler : undefined;
  if (handlerName) return handlerName;

  const name = typeof props.name === 'string' ? props.name : 'middleware';
  return camelKey(name) || 'middlewareHandler';
}
