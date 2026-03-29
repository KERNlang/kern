/**
 * Data Layer Generators — store, config, repository, cache, dependency, model.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { emitIdentifier, emitStringLiteral, emitPath, emitTypeAnnotation } from './emitters.js';
import { getProps, getChildren, getFirstChild, handlerCode, exportPrefix, parseParamList } from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Config ───────────────────────────────────────────────────────────────

export function generateConfig(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'Config', node);
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  // Interface
  lines.push(`${exp}interface ${name} {`);
  for (const field of fields) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const opt = fp.default !== undefined ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)};`);
  }
  lines.push('}');
  lines.push('');

  // Defaults object
  lines.push(`${exp}const DEFAULT_${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}: Required<${name}> = {`);
  for (const field of fields) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const ftype = emitTypeAnnotation(fp.type as string, 'unknown', field);
    let def = fp.default as string;

    if (def === undefined) {
      if (ftype === 'number') def = '0';
      else if (ftype === 'boolean') def = 'false';
      else if (ftype.endsWith('[]')) def = '[]';
      else def = "''";
    } else if (ftype === 'string' || (!['number', 'boolean'].includes(ftype) && !ftype.endsWith('[]') && !def.startsWith("'") && !def.startsWith('"'))) {
      def = emitStringLiteral(def);
    }

    lines.push(`  ${fieldName}: ${def},`);
  }
  lines.push('};');

  return lines;
}

// ── Store ────────────────────────────────────────────────────────────────

export function generateStore(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'Store', node);
  const rawPath = props.path as string || '~/.data';
  const key = emitIdentifier(props.key as string, 'id', node);
  const model = emitIdentifier(props.model as string, 'unknown', node);
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const dirConst = `${name.toUpperCase()}_DIR`;

  // Validate path before interpolation — blocks injection + traversal via storePath
  const resolvedPath = rawPath.startsWith('~/')
    ? `join(homedir(), ${emitPath(rawPath.slice(2), node)})`
    : emitPath(rawPath, node);

  lines.push(`import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';`);
  lines.push(`import { join, resolve } from 'node:path';`);
  lines.push(`import { homedir } from 'node:os';`);
  lines.push('');
  lines.push(`const ${dirConst} = ${resolvedPath};`);
  lines.push('');
  lines.push(`function ensure${name}Dir(): void {`);
  lines.push(`  mkdirSync(${dirConst}, { recursive: true });`);
  lines.push('}');
  lines.push('');
  lines.push(`function safe${name}Path(id: string): string {`);
  lines.push(`  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');`);
  lines.push(`  if (!sanitized) throw new Error(\`Invalid ID: \${id}\`);`);
  lines.push(`  const full = resolve(${dirConst}, \`\${sanitized}.json\`);`);
  lines.push(`  if (!full.startsWith(resolve(${dirConst}))) throw new Error(\`Invalid ID: \${id}\`);`);
  lines.push(`  return full;`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function save${name}(item: ${model}): void {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  writeFileSync(safe${name}Path((item as any).${key}), JSON.stringify(item, null, 2) + '\\n');`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function load${name}(id: string): ${model} | null {`);
  lines.push(`  try { return JSON.parse(readFileSync(safe${name}Path(id), 'utf-8')) as ${model}; }`);
  lines.push(`  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function list${name}s(limit = 20): ${model}[] {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  const files = readdirSync(${dirConst}).filter(f => f.endsWith('.json'));`);
  lines.push(`  const items: ${model}[] = [];`);
  lines.push(`  for (const f of files) {`);
  lines.push(`    try { items.push(JSON.parse(readFileSync(join(${dirConst}, f), 'utf-8')) as ${model}); }`);
  lines.push(`    catch { /* skip corrupt files */ }`);
  lines.push(`  }`);
  lines.push(`  return items.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, limit);`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function delete${name}(id: string): boolean {`);
  lines.push(`  try { unlinkSync(safe${name}Path(id)); return true; }`);
  lines.push(`  catch { return false; }`);
  lines.push('}');

  return lines;
}

// ── Repository ───────────────────────────────────────────────────────────

export function generateRepository(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownRepo', node);
  const model = props.model as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}class ${name} {`);
  if (model) {
    lines.push(`  constructor(private readonly model: typeof ${model}) {}`);
    lines.push('');
  }

  for (const method of kids(node, 'method')) {
    const mp = p(method);
    const mname = emitIdentifier(mp.name as string, 'method', method);
    const mparams = mp.params ? parseParamList(mp.params as string) : '';
    const isAsync = mp.async === 'true' || mp.async === true;
    const asyncKw = isAsync ? 'async ' : '';
    const mreturns = mp.returns ? `: ${emitTypeAnnotation(mp.returns as string, 'unknown', method)}` : '';
    const mcode = handlerCode(method);

    lines.push(`  ${asyncKw}${mname}(${mparams})${mreturns} {`);
    if (mcode) {
      for (const line of mcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
    lines.push('');
  }

  lines.push('}');
  return lines;
}

// ── Cache ────────────────────────────────────────────────────────────────

export function generateCache(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownCache', node);
  const backend = props.backend as string || 'memory';
  const prefix = props.prefix as string || '';
  const ttl = props.ttl as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}const ${name} = {`);
  lines.push(`  prefix: '${prefix}',`);
  if (ttl) lines.push(`  ttl: ${ttl},`);
  lines.push(`  backend: '${backend}',`);
  lines.push('');

  // Entry methods
  for (const entry of kids(node, 'entry')) {
    const ep = p(entry);
    const entryName = emitIdentifier(ep.name as string, 'entry', entry);
    const key = ep.key as string || entryName;
    const strategyNode = firstChild(entry, 'strategy');
    const strategy = strategyNode ? (p(strategyNode).name as string || 'cache-aside') : 'cache-aside';

    lines.push(`  async get${entryName[0].toUpperCase()}${entryName.slice(1)}(id: string) {`);
    lines.push(`    const key = \`${prefix}${key.replace(/\{id\}/g, '${id}')}\`;`);
    if (strategy === 'read-through') {
      lines.push(`    // read-through: check cache, fetch if miss, populate cache`);
    }
    lines.push(`    return ${backend === 'redis' ? `await redis.get(key)` : `cache.get(key)`};`);
    lines.push(`  },`);
    lines.push('');
  }

  // Invalidation methods
  for (const inv of kids(node, 'invalidate')) {
    const ip = p(inv);
    const on = ip.on as string || 'update';
    const tags = ip.tags as string || '';

    lines.push(`  async invalidateOn${on[0].toUpperCase()}${on.slice(1)}(id: string) {`);
    const invalidateKey = tags
      ? `\`${prefix}${tags.replace(/\{id\}/g, '${id}')}\``
      : `\`${prefix}\${id}\``;
    lines.push(`    const key = ${invalidateKey};`);
    lines.push(`    ${backend === 'redis' ? `await redis.del(key)` : `cache.delete(key)`};`);
    lines.push(`  },`);
    lines.push('');
  }

  lines.push('} as const;');
  return lines;
}

// ── Dependency ───────────────────────────────────────────────────────────

export function generateDependency(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownDep', node);
  const scope = props.scope as string || 'transient';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const injects = kids(node, 'inject');
  const returnsNode = firstChild(node, 'returns');
  const returnsType = returnsNode ? (p(returnsNode).name || p(returnsNode).type || 'unknown') as string : 'unknown';

  if (scope === 'singleton') {
    lines.push(`let _${name}Instance: ${returnsType} | null = null;`);
    lines.push('');
  }

  lines.push(`${exp}function create${name[0].toUpperCase()}${name.slice(1)}(): ${returnsType} {`);

  if (scope === 'singleton') {
    lines.push(`  if (_${name}Instance) return _${name}Instance;`);
  }

  for (const inj of injects) {
    const ip = p(inj);
    const injName = emitIdentifier(ip.name as string, 'dep', inj);
    const injType = ip.type as string;
    const injFrom = ip.from as string;
    const injWith = ip.with as string;
    if (injFrom) {
      lines.push(`  const ${injName} = ${injFrom};`);
    } else if (injType && injWith) {
      lines.push(`  const ${injName} = new ${injType}(${injWith});`);
    } else if (injType) {
      lines.push(`  const ${injName} = new ${injType}();`);
    }
  }

  const returnsWith = returnsNode ? p(returnsNode).with as string : undefined;
  if (returnsWith) {
    lines.push(`  const instance = new ${returnsType}(${returnsWith});`);
  } else {
    lines.push(`  const instance = new ${returnsType}();`);
  }

  if (scope === 'singleton') {
    lines.push(`  _${name}Instance = instance;`);
  }

  lines.push(`  return instance;`);
  lines.push('}');

  return lines;
}

// ── Model ────────────────────────────────────────────────────────────────

export function generateModel(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownModel', node);
  const table = props.table as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Generate TypeScript interface
  lines.push(`${exp}interface ${name} {`);
  for (const col of kids(node, 'column')) {
    const cp = p(col);
    const colName = emitIdentifier(cp.name as string, 'column', col);
    const colType = mapColumnType(cp.type as string);
    const opt = cp.optional === 'true' || cp.optional === true ? '?' : '';
    lines.push(`  ${colName}${opt}: ${colType};`);
  }
  for (const rel of kids(node, 'relation')) {
    const rp = p(rel);
    const relName = emitIdentifier(rp.name as string, 'relation', rel);
    const target = rp.target as string;
    const kind = rp.kind as string || 'one-to-many';
    const relType = kind.includes('many') ? `${target}[]` : target;
    lines.push(`  ${relName}?: ${relType};`);
  }
  lines.push('}');

  // Prisma-hint comment
  if (table) {
    lines.push('');
    lines.push(`// Prisma: @@map("${table}")`);
  }

  return lines;
}

function mapColumnType(kernType: string): string {
  const typeMap: Record<string, string> = {
    uuid: 'string', string: 'string', text: 'string',
    int: 'number', integer: 'number', float: 'number', decimal: 'number',
    boolean: 'boolean', bool: 'boolean',
    date: 'Date', datetime: 'Date', timestamp: 'Date',
    json: 'Record<string, unknown>',
  };
  return typeMap[kernType] || kernType;
}
