/**
 * Core Language Codegen — shared TypeScript generation for KERN's type system
 *
 * Handles: type, interface, fn, machine, error, module, config, store, test, event
 * These are target-agnostic — they compile to TypeScript regardless of target.
 *
 * Machine nodes are KERN's killer feature: 12 lines of KERN → 140+ lines of TS.
 */

import type { IRNode } from './types.js';
import { isTemplateNode, expandTemplateNode } from './template-engine.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

function firstChild(node: IRNode, type: string): IRNode | undefined {
  return kids(node, type)[0];
}

/** Strip common leading whitespace from multiline handler code. */
function dedent(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
  return lines.map(l => l.slice(min)).join('\n');
}

function handlerCode(node: IRNode): string {
  const handler = firstChild(node, 'handler');
  if (!handler) return '';
  const raw = p(handler).code as string || '';
  return dedent(raw);
}

function exportPrefix(node: IRNode): string {
  return p(node).export === 'false' ? '' : 'export ';
}

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const { name, values, alias } = p(node) as Record<string, string>;
  const exp = exportPrefix(node);

  if (values) {
    const members = values.split('|').map(v => `'${v.trim()}'`).join(' | ');
    return [`${exp}type ${name} = ${members};`];
  }
  if (alias) {
    return [`${exp}type ${name} = ${alias};`];
  }
  return [`${exp}type ${name} = unknown;`];
}

// ── Interface ────────────────────────────────────────────────────────────
// interface name=Plan extends=Base
//   field name=id type=string
//   field name=state type=PlanState
//   field name=steps type="PlanStep[]"
//   field name=engineId type=string optional=true

export function generateInterface(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const ext = props.extends ? ` extends ${props.extends}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}interface ${name}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fp.name}${opt}: ${fp.type};`);
  }
  lines.push('}');
  return lines;
}

// ── Function ─────────────────────────────────────────────────────────────
// fn name=createPlan params="action:PlanAction,ws:WorkspaceSnapshot" returns=Plan
//   handler <<<
//     return { ... };
//   >>>

export function generateFunction(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const params = props.params as string || '';
  const returns = props.returns as string;
  const isAsync = props.async === 'true' || props.async === true;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Parse params: "action:PlanAction,ws:WorkspaceSnapshot" → "action: PlanAction, ws: WorkspaceSnapshot"
  const paramList = params
    ? params.split(',').map(s => {
        const [pname, ...ptype] = s.split(':').map(t => t.trim());
        return ptype.length > 0 ? `${pname}: ${ptype.join(':')}` : pname;
      }).join(', ')
    : '';

  const retClause = returns ? `: ${returns}` : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = handlerCode(node);

  lines.push(`${exp}${asyncKw}function ${name}(${paramList})${retClause} {`);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('}');
  return lines;
}

// ── Error Class ──────────────────────────────────────────────────────────
// error name=AgonError extends=Error
// error name=PlanStateError extends=AgonError
//   field name=expected type="string | string[]"
//   field name=actual type=string
//   message "Invalid plan state: expected ${expected}, got ${actual}"

export function generateError(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const ext = props.extends as string || 'Error';
  const message = props.message as string;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  lines.push(`${exp}class ${name} extends ${ext} {`);

  const code = handlerCode(node);

  if (fields.length > 0) {
    lines.push(`  constructor(`);
    // Check if first field is 'message' — special case: pass to super
    const hasMessageParam = (p(fields[0]).name as string) === 'message';
    for (const field of fields) {
      const fp = p(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      const isMessage = (fp.name as string) === 'message';
      // 'message' param is not readonly — it's passed to super
      if (isMessage) {
        lines.push(`    ${fp.name}${opt}: ${fp.type},`);
      } else {
        lines.push(`    public readonly ${fp.name}${opt}: ${fp.type},`);
      }
    }
    lines.push(`  ) {`);
    if (code) {
      // Custom handler body — replaces auto-generated constructor logic
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    } else if (message) {
      // Check if message references array fields that need formatting
      const arrayFields = fields.filter(f => {
        const ft = p(f).type as string;
        return ft.includes('[]') || ft.includes('string |') || ft.includes('| string');
      });
      for (const f of arrayFields) {
        const fn = p(f).name as string;
        lines.push(`    const ${fn}Str = Array.isArray(${fn}) ? ${fn}.join(' | ') : ${fn};`);
      }
      lines.push(`    super(\`${message}\`);`);
      lines.push(`    this.name = '${name}';`);
    } else if (hasMessageParam) {
      lines.push(`    super(message);`);
      lines.push(`    this.name = '${name}';`);
    } else {
      lines.push(`    super();`);
      lines.push(`    this.name = '${name}';`);
    }
    lines.push(`  }`);
  } else {
    lines.push(`  constructor(message: string) {`);
    lines.push(`    super(message);`);
    lines.push(`    this.name = '${name}';`);
    lines.push(`  }`);
  }

  lines.push('}');
  return lines;
}

// ── State Machine ────────────────────────────────────────────────────────
// KERN's killer feature. 12 lines of KERN → 140+ lines of TypeScript.
//
// machine name=Plan
//   state name=draft initial=true
//   state name=approved
//   state name=running
//   state name=paused
//   state name=completed
//   state name=failed
//   state name=cancelled
//   transition name=approve from=draft to=approved
//   transition name=start from=approved to=running
//   transition name=cancel from="draft|approved|running|paused|failed" to=cancelled
//   transition name=fail from="running|paused" to=failed
//
// Generates:
//   - PlanState type
//   - PlanStateError class
//   - approvePlan(), startPlan(), cancelPlan(), failPlan() functions

export function generateMachine(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Collect states
  const states = kids(node, 'state');
  const stateNames = states.map(s => {
    const sp = p(s);
    return (sp.name || sp.value) as string;
  });

  // State type
  const stateType = `${name}State`;
  lines.push(`${exp}type ${stateType} = ${stateNames.map(s => `'${s}'`).join(' | ')};`);
  lines.push('');

  // Error class
  const errorName = `${name}StateError`;
  lines.push(`${exp}class ${errorName} extends Error {`);
  lines.push(`  constructor(`);
  lines.push(`    public readonly expected: string | string[],`);
  lines.push(`    public readonly actual: string,`);
  lines.push(`  ) {`);
  lines.push(`    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;`);
  lines.push(`    super(\`Invalid ${name.toLowerCase()} state: expected \${expectedStr}, got \${actual}\`);`);
  lines.push(`    this.name = '${errorName}';`);
  lines.push(`  }`);
  lines.push('}');
  lines.push('');

  // Transition functions
  const transitions = kids(node, 'transition');
  for (const t of transitions) {
    const tp = p(t);
    const tname = tp.name as string;
    const from = tp.from as string;
    const to = tp.to as string;

    const fromStates = from.split('|').map(s => s.trim());
    const isMultiFrom = fromStates.length > 1;
    const fnName = `${tname}${name}`;
    const code = handlerCode(t);

    lines.push(`/** ${from} → ${to} */`);
    lines.push(`${exp}function ${fnName}<T extends { state: ${stateType} }>(entity: T): T {`);

    if (isMultiFrom) {
      lines.push(`  const validStates: ${stateType}[] = [${fromStates.map(s => `'${s}'`).join(', ')}];`);
      lines.push(`  if (!validStates.includes(entity.state)) {`);
      lines.push(`    throw new ${errorName}(validStates, entity.state);`);
      lines.push(`  }`);
    } else {
      lines.push(`  if (entity.state !== '${fromStates[0]}') {`);
      lines.push(`    throw new ${errorName}('${fromStates[0]}', entity.state);`);
      lines.push(`  }`);
    }

    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`  return { ...entity, state: '${to}' as ${stateType} };`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines;
}

// ── Config ───────────────────────────────────────────────────────────────
// config name=AgonConfig
//   field name=timeout type=number default=120
//   field name=approvalLevel type=ApprovalLevel default="plan"

export function generateConfig(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  // Interface
  lines.push(`${exp}interface ${name} {`);
  for (const field of fields) {
    const fp = p(field);
    const opt = fp.default !== undefined ? '?' : '';
    lines.push(`  ${fp.name}${opt}: ${fp.type};`);
  }
  lines.push('}');
  lines.push('');

  // Defaults object
  lines.push(`${exp}const DEFAULT_${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}: Required<${name}> = {`);
  for (const field of fields) {
    const fp = p(field);
    const ftype = fp.type as string;
    let def = fp.default as string;

    if (def === undefined) {
      if (ftype === 'number') def = '0';
      else if (ftype === 'boolean') def = 'false';
      else if (ftype.endsWith('[]')) def = '[]';
      else def = "''";
    } else if (ftype === 'string' || (!['number', 'boolean'].includes(ftype) && !ftype.endsWith('[]') && !def.startsWith("'") && !def.startsWith('"'))) {
      def = `'${def}'`;
    }

    lines.push(`  ${fp.name}: ${def},`);
  }
  lines.push('};');

  return lines;
}

// ── Store ────────────────────────────────────────────────────────────────
// store name=Plan path="~/.agon/plans" key=id
//   model Plan

export function generateStore(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const storePath = props.path as string || '~/.data';
  const key = props.key as string || 'id';
  const model = props.model as string || 'unknown';
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const dirConst = `${name.toUpperCase()}_DIR`;

  const resolvedPath = storePath.startsWith('~/')
    ? `join(homedir(), '${storePath.slice(2)}')`
    : `'${storePath}'`;

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
  lines.push(`  catch { return null; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function list${name}s(limit = 20): ${model}[] {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  try {`);
  lines.push(`    return readdirSync(${dirConst}).filter(f => f.endsWith('.json'))`);
  lines.push(`      .map(f => JSON.parse(readFileSync(join(${dirConst}, f), 'utf-8')) as ${model})`);
  lines.push(`      .sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))`);
  lines.push(`      .slice(0, limit);`);
  lines.push(`  } catch { return []; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function delete${name}(id: string): boolean {`);
  lines.push(`  try { unlinkSync(safe${name}Path(id)); return true; }`);
  lines.push(`  catch { return false; }`);
  lines.push('}');

  return lines;
}

// ── Test ─────────────────────────────────────────────────────────────────
// test name="Plan Transitions"
//   describe name=approvePlan
//     it name="transitions draft → approved"
//       handler <<<
//         expect(approvePlan(makePlan('draft')).state).toBe('approved');
//       >>>

export function generateTest(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push('');

  // Top-level setup handler
  const setup = handlerCode(node);
  if (setup) {
    for (const line of setup.split('\n')) lines.push(line);
    lines.push('');
  }

  lines.push(`describe('${name}', () => {`);

  for (const desc of kids(node, 'describe')) {
    const dname = p(desc).name as string;
    lines.push(`  describe('${dname}', () => {`);

    for (const test of kids(desc, 'it')) {
      const tname = p(test).name as string;
      const code = handlerCode(test);
      lines.push(`    it('${tname}', () => {`);
      if (code) {
        for (const line of code.split('\n')) lines.push(`      ${line}`);
      }
      lines.push(`    });`);
    }

    lines.push(`  });`);
  }

  // Top-level it blocks
  for (const test of kids(node, 'it')) {
    const tname = p(test).name as string;
    const code = handlerCode(test);
    lines.push(`  it('${tname}', () => {`);
    if (code) {
      for (const line of code.split('\n')) lines.push(`    ${line}`);
    }
    lines.push(`  });`);
  }

  lines.push('});');
  return lines;
}

// ── Event ────────────────────────────────────────────────────────────────
// event name=ForgeEvent
//   type name="baseline:start"
//   type name="baseline:done" data="{ passes: boolean }"
//   type name="winner:determined" data="{ winner: string, bestScore: number }"

export function generateEvent(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const types = kids(node, 'type');
  const lines: string[] = [];

  // Event type union
  lines.push(`${exp}type ${name}Type = ${types.map(t => `'${(p(t).name || p(t).value) as string}'`).join(' | ')};`);
  lines.push('');

  // Event interface
  lines.push(`${exp}interface ${name} {`);
  lines.push(`  type: ${name}Type;`);
  lines.push(`  engineId?: string;`);
  lines.push(`  data?: Record<string, unknown>;`);
  lines.push('}');
  lines.push('');

  // Typed event map
  lines.push(`${exp}interface ${name}Map {`);
  for (const t of types) {
    const tp = p(t);
    const tname = (tp.name || tp.value) as string;
    const data = tp.data as string || 'Record<string, unknown>';
    lines.push(`  '${tname}': ${data};`);
  }
  lines.push('}');
  lines.push('');

  // Callback type
  lines.push(`${exp}type ${name}Callback = (event: ${name}) => void;`);

  return lines;
}

// ── Module ───────────────────────────────────────────────────────────────
// module name=@agon/core
//   export from="./plan.js" names="createPlan,advanceStep"

export function generateModule(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const lines: string[] = [];

  lines.push(`// ── Module: ${name} ──`);
  lines.push('');

  for (const exp of kids(node, 'export')) {
    const ep = p(exp);
    const from = ep.from as string;
    const names = ep.names as string;
    const typeNames = ep.types as string;
    const star = ep.star === 'true' || ep.star === true;

    if (from && !names && !typeNames && star) {
      lines.push(`export * from '${from}';`);
    }
    if (from && names) {
      lines.push(`export { ${names.split(',').map(s => s.trim()).join(', ')} } from '${from}';`);
    }
    if (from && typeNames) {
      lines.push(`export type { ${typeNames.split(',').map(s => s.trim()).join(', ')} } from '${from}';`);
    }
  }

  // Inline child definitions
  for (const child of kids(node)) {
    if (child.type === 'export') continue;
    lines.push(...generateCoreNode(child));
    lines.push('');
  }

  return lines;
}

// ── Import ──────────────────────────────────────────────────────────────
// import from="node:fs" names="readFileSync,writeFileSync"
// → import { readFileSync, writeFileSync } from 'node:fs';
//
// import from="./types.js" names="Plan" types=true
// → import type { Plan } from './types.js';
//
// import from="node:path" default=path
// → import path from 'node:path';
//
// import from="node:fs" default=fs names="readFileSync"
// → import fs, { readFileSync } from 'node:fs';

export function generateImport(node: IRNode): string[] {
  const props = p(node);
  const from = props.from as string;
  const names = props.names as string | undefined;
  const defaultImport = props.default as string | undefined;
  const isTypeOnly = props.types === 'true' || props.types === true;

  if (!from) return [];

  const typeKw = isTypeOnly ? 'type ' : '';
  const namedList = names
    ? names.split(',').map(s => s.trim()).join(', ')
    : '';

  if (defaultImport && namedList) {
    return [`import ${typeKw}${defaultImport}, { ${namedList} } from '${from}';`];
  }
  if (defaultImport) {
    return [`import ${typeKw}${defaultImport} from '${from}';`];
  }
  if (namedList) {
    return [`import ${typeKw}{ ${namedList} } from '${from}';`];
  }
  // Side-effect import
  return [`import '${from}';`];
}

// ── Const ───────────────────────────────────────────────────────────────
// const name=AGON_HOME type=string
//   handler <<<
//     join(homedir(), '.agon')
//   >>>
// → export const AGON_HOME: string = join(homedir(), '.agon');
//
// const name=DEFAULT_WEIGHTS type=ScoreWeights value="{ pass: 50 }"
// → export const DEFAULT_WEIGHTS: ScoreWeights = { pass: 50 };

export function generateConst(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const constType = props.type as string | undefined;
  const value = props.value as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${constType}` : '';

  if (code) {
    return [`${exp}const ${name}${typeAnnotation} = ${code.trim()};`];
  }
  if (value) {
    return [`${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [`${exp}const ${name}${typeAnnotation};`];
}

// ── Shared Helpers (exported for @kernlang/react) ────────────────────────────

/** Parse "name:Type,name2:Type2" → "name: Type, name2: Type2" */
export function parseParamList(params: string): string {
  if (!params) return '';
  return params.split(',').map(s => {
    const [pname, ...ptype] = s.split(':').map(t => t.trim());
    return ptype.length > 0 ? `${pname}: ${ptype.join(':')}` : pname;
  }).join(', ');
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Hook ─────────────────────────────────────────────────────────────────
// hook name=useSearch params="initialState:SearchState" returns=UseSearchResult
//   state name=query type=string init="initialState.query"
//   ref name=abortCtrl type=AbortController init="new AbortController()"
//   context name=env type=EnvConfig source=EnvContext
//   handler <<<
//     const { data } = useSWR(cacheKey, fetcher);
//   >>>
//   memo name=cacheKey deps="query,filters"
//     handler <<<
//       return buildCacheKey(query, filters);
//     >>>
//   callback name=handleFilter params="field:string,value:string" deps="query"
//     handler <<<
//       setQuery(prev => updateFilter(prev, field, value));
//     >>>
//   effect deps="query"
//     handler <<<
//       trackSearch(query);
//     >>>
//   returns names="products:data?.products,isLoading,handleFilter,cacheKey"

export function generateHook(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const params = props.params as string || '';
  const returnsType = props.returns as string | undefined;
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const reactImports = new Set<string>();

  // Parse params
  const paramList = parseParamList(params);
  const retClause = returnsType ? `: ${returnsType}` : '';

  lines.push(`${exp}function ${name}(${paramList})${retClause} {`);

  // Emit children in source order — returns is always last
  const children = kids(node);
  const returnsNode = children.find(c => c.type === 'returns');
  const ordered = children.filter(c => c.type !== 'returns');

  for (const child of ordered) {
    const cp = p(child);
    switch (child.type) {
      case 'state': {
        reactImports.add('useState');
        const sname = cp.name as string;
        const stype = cp.type as string || 'unknown';
        const sinit = cp.init as string || 'undefined';
        const setter = `set${capitalize(sname)}`;
        lines.push(`  const [${sname}, ${setter}] = useState<${stype}>(${sinit});`);
        break;
      }
      case 'ref': {
        reactImports.add('useRef');
        const rname = cp.name as string;
        const rtype = cp.type as string || 'unknown';
        const rinit = cp.init as string || 'null';
        lines.push(`  const ${rname} = useRef<${rtype}>(${rinit});`);
        break;
      }
      case 'context': {
        reactImports.add('useContext');
        const cname = cp.name as string;
        const csource = cp.source as string;
        lines.push(`  const ${cname} = useContext(${csource});`);
        break;
      }
      case 'handler': {
        const code = cp.code as string || '';
        const dedented = dedent(code);
        for (const line of dedented.split('\n')) {
          lines.push(`  ${line}`);
        }
        break;
      }
      case 'memo': {
        reactImports.add('useMemo');
        const mname = cp.name as string;
        const mdeps = cp.deps as string || '';
        const mcode = handlerCode(child);
        const depsArr = mdeps ? `[${mdeps}]` : '[]';
        lines.push(`  const ${mname} = useMemo(() => {`);
        if (mcode) {
          for (const line of mcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  }, ${depsArr});`);
        break;
      }
      case 'callback': {
        reactImports.add('useCallback');
        const cbname = cp.name as string;
        const cbparams = cp.params as string || '';
        const cbdeps = cp.deps as string || '';
        const cbcode = handlerCode(child);
        const cbParamList = parseParamList(cbparams);
        const cbDepsArr = cbdeps ? `[${cbdeps}]` : '[]';
        lines.push(`  const ${cbname} = useCallback((${cbParamList}) => {`);
        if (cbcode) {
          for (const line of cbcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  }, ${cbDepsArr});`);
        break;
      }
      case 'effect': {
        reactImports.add('useEffect');
        const edeps = cp.deps as string || '';
        const ecode = handlerCode(child);
        const eDepsArr = edeps ? `[${edeps}]` : '[]';
        lines.push(`  useEffect(() => {`);
        if (ecode) {
          for (const line of ecode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        // Check for cleanup block
        const cleanupNode = firstChild(child, 'cleanup');
        if (cleanupNode) {
          const cleanupCode = p(cleanupNode).code as string || '';
          const cleanupDedented = dedent(cleanupCode);
          lines.push(`    return () => {`);
          for (const line of cleanupDedented.split('\n')) {
            lines.push(`      ${line}`);
          }
          lines.push(`    };`);
        }
        lines.push(`  }, ${eDepsArr});`);
        break;
      }
      // Skip unknown child types silently
    }
  }

  // Returns — always last
  if (returnsNode) {
    const rnames = p(returnsNode).names as string || '';
    const entries = rnames.split(',').map(e => {
      const [key, ...valueParts] = e.split(':');
      const value = valueParts.join(':').trim();
      return value ? `${key.trim()}: ${value}` : key.trim();
    });
    lines.push(`  return { ${entries.join(', ')} };`);
  }

  lines.push('}');

  // Prepend React imports
  if (reactImports.size > 0) {
    const importLine = `import { ${[...reactImports].sort().join(', ')} } from 'react';`;
    lines.unshift('');
    lines.unshift(importLine);
  }

  return lines;
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export const CORE_NODE_TYPES = new Set([
  'type', 'interface', 'field', 'fn',
  'machine', 'transition',
  'error', 'module', 'export',
  'config', 'store',
  'test', 'describe', 'it',
  'event', 'import', 'const',
  'hook',
  'template', 'slot', 'body',
]);

/** Check if a node type is a core language construct. */
export function isCoreNode(type: string): boolean {
  return CORE_NODE_TYPES.has(type);
}

/** Generate TypeScript for any core language node. */
export function generateCoreNode(node: IRNode): string[] {
  switch (node.type) {
    case 'type': return generateType(node);
    case 'interface': return generateInterface(node);
    case 'fn': return generateFunction(node);
    case 'machine': return generateMachine(node);
    case 'error': return generateError(node);
    case 'module': return generateModule(node);
    case 'config': return generateConfig(node);
    case 'store': return generateStore(node);
    case 'test': return generateTest(node);
    case 'event': return generateEvent(node);
    case 'import': return generateImport(node);
    case 'const': return generateConst(node);
    case 'hook': return generateHook(node);
    // Template definitions produce no output
    case 'template': return [];
    case 'slot': return [];
    case 'body': return [];
    default:
      // Check if this is a template instance
      if (isTemplateNode(node.type)) return expandTemplateNode(node);
      return [];
  }
}
