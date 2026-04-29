/**
 * Ground Layer generators — Python generation for KERN's ground-truth nodes:
 * derive, transform, action, guard, assume, invariant, each, collect, branch, resolve, expect, recover
 */

import type { IRNode } from '@kernlang/core';
import { handlerCode } from '@kernlang/core';
import {
  buildPythonParamList,
  emitPyLowConfidenceTodo,
  emitPyReasonAnnotations,
  firstChild,
  kids,
  p,
} from '../codegen-helpers.js';
import { mapTsTypeToPython, toSnakeCase } from '../type-map.js';

/**
 * Common preamble extracted from all ground layer generators.
 * Returns { annotations, todo, props, name } ready for use.
 */
function groundPreamble(node: IRNode) {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = toSnakeCase(props.name as string);
  return { annotations, todo, props, name };
}

// ── derive ──────────────────────────────────────────────────────────────

export function generateDerive(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const expr = props.expr as string;
  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  return [...todo, ...annotations, `${name}${typeAnnotation} = ${expr}`];
}

// ── transform ───────────────────────────────────────────────────────────

export function generateTransform(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const target = props.target as string | undefined;
  const via = props.via as string | undefined;
  const constType = props.type as string | undefined;
  const code = handlerCode(node);
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  if (code) {
    const lines: string[] = [...todo, ...annotations];
    lines.push(`def ${name}(state)${typeAnnotation}:`);
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
    return lines;
  }

  if (target && via) {
    return [
      ...todo,
      ...annotations,
      `${name}${typeAnnotation} = ${via.replace(/\(/, `(${target}, `).replace(/, \)/, ')')}`,
    ];
  }
  if (via) {
    return [...todo, ...annotations, `${name}${typeAnnotation} = ${via}`];
  }
  return [...todo, ...annotations, `${name}${typeAnnotation} = None`];
}

// ── action ──────────────────────────────────────────────────────────────

export function generateAction(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const idempotent = props.idempotent === 'true' || props.idempotent === true;
  const reversible = props.reversible === 'true' || props.reversible === true;
  const returns = props.returns as string | undefined;
  const code = handlerCode(node);

  // Slice 3c P2 follow-up: target-neutral helper reads structured `param`
  // children when present, falls back to legacy `params="..."` otherwise.
  const paramList = buildPythonParamList(node);

  const retClause = returns ? ` -> ${mapTsTypeToPython(returns)}` : ' -> None';
  const lines: string[] = [...todo, ...annotations];

  lines.push(`async def ${name}(${paramList})${retClause}:`);

  // Docstring with metadata
  const metaParts: string[] = [];
  if (idempotent) metaParts.push('idempotent=True');
  if (reversible) metaParts.push('reversible=True');
  if (metaParts.length > 0) {
    lines.push(`    """@action ${metaParts.join(' ')}"""`);
  }

  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
  } else {
    lines.push('    pass');
  }
  return lines;
}

// ── guard ───────────────────────────────────────────────────────────────

export function generateGuard(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'guard';
  const expr = props.expr as string;
  const elseCode = props.else as string | undefined;

  if (elseCode && /^\d+$/.test(elseCode)) {
    return [
      ...todo,
      ...annotations,
      `if not (${expr}):\n    raise HTTPException(status_code=${elseCode}, detail="Guard: ${name}")`,
    ];
  } else if (elseCode) {
    return [...todo, ...annotations, `if not (${expr}):\n    ${elseCode}`];
  }
  return [...todo, ...annotations, `if not (${expr}):\n    raise ValueError("Guard failed: ${name}")`];
}

// ── assume ──────────────────────────────────────────────────────────────

export function generateAssume(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const expr = props.expr as string;
  const name = (props.name as string) || 'assumption';
  return [...todo, ...annotations, `assert ${expr}, "Assume failed: ${name}"`];
}

// ── invariant ───────────────────────────────────────────────────────────

export function generateInvariant(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'invariant';
  const expr = props.expr as string;
  return [...todo, ...annotations, `assert ${expr}, "Invariant: ${name}"`];
}

// ── each ────────────────────────────────────────────────────────────────
// Note: generateEach calls generatePythonCoreNode recursively.
// We accept the dispatcher as a parameter to avoid circular imports.

export type CoreNodeDispatcher = (node: IRNode) => string[];

let _dispatcher: CoreNodeDispatcher = () => [];

/** Set the dispatcher function to break the circular dependency. */
export function setDispatcher(fn: CoreNodeDispatcher): void {
  _dispatcher = fn;
}

export function generateEach(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'item';
  const collection = props.in as string;
  const index = props.index as string | undefined;

  const lines: string[] = [...todo, ...annotations];
  if (index) {
    lines.push(`for ${index}, ${name} in enumerate(${collection}):`);
  } else {
    lines.push(`for ${name} in ${collection}:`);
  }

  const children = kids(node);
  if (children.length === 0) {
    lines.push('    pass');
  } else {
    for (const child of children) {
      const childLines = _dispatcher(child);
      for (const line of childLines) {
        lines.push(`    ${line}`);
      }
    }
  }
  return lines;
}

// ── collect ─────────────────────────────────────────────────────────────

export function generateCollect(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const from = props.from as string;
  const where = props.where as string | undefined;
  const limit = props.limit as string | undefined;

  if (where && limit) {
    return [...todo, ...annotations, `${name} = [item for item in ${from} if ${where}][:${limit}]`];
  }
  if (where) {
    return [...todo, ...annotations, `${name} = [item for item in ${from} if ${where}]`];
  }
  if (limit) {
    return [...todo, ...annotations, `${name} = ${from}[:${limit}]`];
  }
  return [...todo, ...annotations, `${name} = list(${from})`];
}

// ── branch / path ───────────────────────────────────────────────────────

export function generateBranch(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'branch';
  const on = props.on as string;
  const paths = kids(node, 'path');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# branch: ${name}`);
  lines.push(`match ${on}:`);

  for (const pathNode of paths) {
    const pp = p(pathNode);
    const value = pp.value as string;
    lines.push(`    case "${value}":`);
    const children = kids(pathNode);
    if (children.length === 0) {
      lines.push('        pass');
    } else {
      for (const child of children) {
        const childLines = _dispatcher(child);
        for (const line of childLines) {
          lines.push(`        ${line}`);
        }
      }
    }
  }
  return lines;
}

// ── resolve ─────────────────────────────────────────────────────────────

export function generateResolve(node: IRNode): string[] {
  const { annotations, todo, name } = groundPreamble(node);
  const candidates = kids(node, 'candidate');
  const discriminator = firstChild(node, 'discriminator');

  if (!discriminator) return [`# resolve: ${name} — missing discriminator`];

  const dp = p(discriminator);
  const method = (dp.method as string) || 'select';
  const metric = (dp.metric as string) || '';

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# resolve: ${name}`);
  lines.push(`_${name}_candidates = [`);
  for (const c of candidates) {
    const cp = p(c);
    const cname = cp.name as string;
    const code = handlerCode(c);
    lines.push(`    {"name": "${cname}", "fn": lambda signal: ${code.trim() || 'None'}},`);
  }
  lines.push(`]`);
  lines.push('');

  const discCode = handlerCode(discriminator);
  lines.push(`async def resolve_${name}(signal):`);
  lines.push(`    candidates = _${name}_candidates`);
  lines.push(`    # discriminator: ${method}(${metric})`);
  if (discCode) {
    for (const line of discCode.split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  lines.push(`    return candidates[winner_idx]["fn"](signal)`);
  return lines;
}

// ── expect ──────────────────────────────────────────────────────────────

export function generateExpect(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = toSnakeCase((props.name as string) || 'expected');
  const expr = props.expr as string;
  const within = props.within as string | undefined;
  const max = props.max as string | undefined;
  const min = props.min as string | undefined;

  if (within) {
    const [lo, hi] = within.split('..');
    return [
      ...todo,
      ...annotations,
      `assert ${lo} <= (${expr}) <= ${hi}, f"Expected ${name} in [${lo}, ${hi}], got {${expr}}"`,
    ];
  }
  if (min && max) {
    return [
      ...todo,
      ...annotations,
      `assert ${min} <= (${expr}) <= ${max}, f"Expected ${name} in [${min}, ${max}], got {${expr}}"`,
    ];
  }
  if (max) {
    return [...todo, ...annotations, `assert (${expr}) <= ${max}, f"Expected ${name} <= ${max}, got {${expr}}"`];
  }
  if (min) {
    return [...todo, ...annotations, `assert (${expr}) >= ${min}, f"Expected ${name} >= ${min}, got {${expr}}"`];
  }
  return [...todo, ...annotations, `assert (${expr}) is not None, "Expected ${name} to be defined"`];
}

// ── recover ─────────────────────────────────────────────────────────────

export function generateRecover(node: IRNode): string[] {
  const { annotations, todo, name } = groundPreamble(node);
  const strategies = kids(node, 'strategy');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# recover: ${name}`);
  lines.push(`async def ${name}_with_recovery(fn):`);

  for (const strategy of strategies) {
    const sp = p(strategy);
    const sname = sp.name as string;
    const code = handlerCode(strategy);

    if (sname === 'retry') {
      const max = Number(sp.max) || 3;
      const delay = Number(sp.delay) || 1000;
      lines.push(`    # strategy: retry (max=${max}, delay=${delay}ms)`);
      lines.push(`    import asyncio`);
      lines.push(`    for _attempt in range(${max}):`);
      lines.push(`        try:`);
      lines.push(`            return await fn()`);
      lines.push(`        except Exception:`);
      lines.push(`            if _attempt < ${max - 1}:`);
      lines.push(`                await asyncio.sleep(${delay / 1000})`);
    } else if (sname === 'fallback') {
      lines.push(`    # strategy: fallback (terminal)`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`    ${line}`);
        }
      } else {
        lines.push(`    raise RuntimeError("All recovery strategies exhausted for ${name}")`);
      }
    } else {
      lines.push(`    # strategy: ${sname}`);
      lines.push(`    try:`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`        ${line}`);
        }
      } else {
        lines.push(`        pass`);
      }
      lines.push(`    except Exception:`);
      lines.push(`        pass`);
    }
  }
  return lines;
}
