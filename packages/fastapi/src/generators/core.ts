/**
 * Core generators — Python generation for KERN's base type system nodes:
 * type, interface, fn, machine, error, config, store, test, event, import, const
 */

import type { IRNode } from '@kernlang/core';
import { emitIdentifier, handlerCode } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../codegen-body-python.js';
import { buildPythonParamList, kids, p } from '../codegen-helpers.js';
import { mapTsTypeToPython, toScreamingSnake, toSnakeCase } from '../type-map.js';

/** Slice 1 — native KERN handler bodies for Python target.
 *  Returns the emitted Python body when the fn's handler child opts in via
 *  `lang=kern`, otherwise returns the legacy raw body via `handlerCode`.
 *
 *  Slice 3a — KERN bodies reference parameters in their original camelCase
 *  form (e.g., `userId`), but the Python signature snake-cases them
 *  (`user_id`). We build a `userId → user_id` map from the param list and
 *  hand it to the body emitter so identifier references resolve correctly.
 *
 *  Slice 3b — the body emitter returns a per-handler set of required
 *  imports (`'math'` ⇒ `import math`); we inject them as the first lines
 *  of the function body before the user code. Inline-in-function imports
 *  are valid Python, idempotent (Python caches modules after first import),
 *  and avoid the cross-cutting refactor that module-level emission would
 *  require. */
function fnBodyCodePython(node: IRNode): string {
  const handler = node.children?.find((c) => c.type === 'handler');
  if (handler && handler.props?.lang === 'kern') {
    const symbolMap = buildPythonSymbolMap(node);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler, { symbolMap });
    if (imports.size === 0) return code;
    // Stable ordering for deterministic output / test snapshots.
    const importLines = [...imports].sort().map((mod) => `import ${mod}`);
    return code ? `${importLines.join('\n')}\n${code}` : importLines.join('\n');
  }
  return handlerCode(node);
}

/** Slice 3a — collect KERN-form parameter names paired with their Python
 *  snake_case form. Mirrors the rename rules in `buildPythonParamList` (see
 *  packages/fastapi/src/codegen-helpers.ts) so the body symbol-map and the
 *  Python signature stay in lockstep. Destructured params (children
 *  `binding`/`element`) are skipped — they have no single name to rename;
 *  their decomposed bindings are emitted in the body itself, not the
 *  signature, and remain a slice-4 follow-up.
 *
 *  Returns an entry only when the snake-cased form differs from the KERN
 *  form, so the map stays a tight identity overlay (no work done at the
 *  ident-emit hot path for already-snake_case names like `id` or `count`). */
function buildPythonSymbolMap(node: IRNode): Record<string, string> {
  const map: Record<string, string> = {};
  const paramChildren = (node.children ?? []).filter((c) => c.type === 'param');
  if (paramChildren.length > 0) {
    for (const param of paramChildren) {
      const hasDestructure = (param.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
      if (hasDestructure) continue;
      const rawName = (param.props?.name as string) || '';
      if (!rawName) continue;
      const snake = toSnakeCase(rawName);
      if (snake !== rawName) map[rawName] = snake;
    }
    return map;
  }
  const rawParams = (node.props?.params as string) || '';
  if (!rawParams) return map;
  for (const part of rawParams.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    const eqIdx = trimmed.indexOf('=');
    let nameEnd = trimmed.length;
    if (colonIdx >= 0) nameEnd = Math.min(nameEnd, colonIdx);
    if (eqIdx >= 0) nameEnd = Math.min(nameEnd, eqIdx);
    const rawName = trimmed.slice(0, nameEnd).trim();
    if (!rawName) continue;
    const snake = toSnakeCase(rawName);
    if (snake !== rawName) map[rawName] = snake;
  }
  return map;
}

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running"
// → PlanState = Literal["draft", "approved", "running"]

export function generateType(node: IRNode): string[] {
  const { name, values, alias } = p(node) as Record<string, string>;

  if (values) {
    const members = values
      .split('|')
      .map((v) => `"${v.trim()}"`)
      .join(', ');
    return [`${name} = Literal[${members}]`];
  }
  if (alias) {
    return [`${name} = ${mapTsTypeToPython(alias)}`];
  }
  return [`${name} = Any`];
}

// ── Interface → Pydantic BaseModel ───────────────────────────────────────
// interface name=Track
//   field name=id type=string
//   field name=title type=string
//   field name=duration type=number optional=true
// → class Track(BaseModel):
//       id: str
//       title: str
//       duration: int | None = None

export function generateInterface(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'Model', node);
  const ext = props.extends ? emitIdentifier(props.extends as string, 'BaseModel', node) : 'BaseModel';
  const lines: string[] = [];

  lines.push(`class ${name}(${ext}):`);
  const fields = kids(node, 'field');
  if (fields.length === 0) {
    lines.push('    pass');
    return lines;
  }
  for (const field of fields) {
    const fp = p(field);
    const fname = toSnakeCase(fp.name as string);
    const ftype = mapTsTypeToPython(fp.type as string);
    const isOptional = fp.optional === 'true' || fp.optional === true;
    if (isOptional) {
      lines.push(`    ${fname}: ${ftype} | None = None`);
    } else {
      lines.push(`    ${fname}: ${ftype}`);
    }
  }
  return lines;
}

// ── Function ─────────────────────────────────────────────────────────────
// fn name=createTrack params="title:string,duration:number" returns=Track async=true
// → async def create_track(title: str, duration: int) -> Track:
//       ...

export function generateFunction(node: IRNode): string[] {
  const props = p(node);
  const name = toSnakeCase(props.name as string);
  const returns = props.returns as string;
  const isAsync = props.async === 'true' || props.async === true;
  const lines: string[] = [];

  // Slice 3c P2 follow-up: target-neutral helper reads structured `param`
  // children when present, falls back to legacy `params="..."` otherwise.
  const paramList = buildPythonParamList(node);

  const retClause = returns ? ` -> ${mapTsTypeToPython(returns)}` : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = fnBodyCodePython(node);

  lines.push(`${asyncKw}def ${name}(${paramList})${retClause}:`);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
  } else {
    lines.push('    pass');
  }
  return lines;
}

// ── Error Class ──────────────────────────────────────────────────────────
// error name=NotFoundError
// → class NotFoundError(Exception):
//       def __init__(self, message: str):
//           super().__init__(message)

export function generateError(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const ext = (props.extends as string) || 'Exception';
  const message = props.message as string;
  const fields = kids(node, 'field');
  const lines: string[] = [];

  lines.push(`class ${name}(${ext}):`);

  if (fields.length > 0) {
    const paramParts: string[] = ['self'];
    for (const field of fields) {
      const fp = p(field);
      const fname = toSnakeCase(fp.name as string);
      const ftype = mapTsTypeToPython(fp.type as string);
      paramParts.push(`${fname}: ${ftype}`);
    }
    lines.push(`    def __init__(${paramParts.join(', ')}):`);

    if (message) {
      // Handle array fields that need formatting
      const arrayFields = fields.filter((f) => {
        const ft = p(f).type as string;
        return ft.includes('[]') || ft.includes('string |') || ft.includes('| string');
      });
      for (const f of arrayFields) {
        const fn = toSnakeCase(p(f).name as string);
        lines.push(`        ${fn}_str = " | ".join(${fn}) if isinstance(${fn}, list) else ${fn}`);
      }
      // Convert TS template literal ${var} to Python f-string {var}
      const arrayFieldNames = new Set(arrayFields.map((f) => toSnakeCase(p(f).name as string)));
      const pyMessage = message.replace(/\$\{(\w+)\}/g, (_, v) => {
        const snaked = toSnakeCase(v);
        return arrayFieldNames.has(snaked) ? `{${snaked}_str}` : `{${snaked}}`;
      });
      lines.push(`        super().__init__(f"${pyMessage}")`);
    } else {
      const hasMessageParam = (p(fields[0]).name as string) === 'message';
      if (hasMessageParam) {
        lines.push('        super().__init__(message)');
      } else {
        lines.push('        super().__init__()');
      }
    }

    // Store fields as attributes
    for (const field of fields) {
      const fp = p(field);
      const fname = toSnakeCase(fp.name as string);
      if (fname !== 'message') {
        lines.push(`        self.${fname} = ${fname}`);
      }
    }
  } else {
    lines.push('    def __init__(self, message: str):');
    lines.push('        super().__init__(message)');
  }

  return lines;
}

// ── State Machine ────────────────────────────────────────────────────────
// KERN's killer feature. Generates:
//   - Enum class for states
//   - Error class
//   - Typed transition functions (snake_case)

export function generateMachine(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const lines: string[] = [];

  const states = kids(node, 'state');
  const stateNames = states.map((s) => {
    const sp = p(s);
    return (sp.name || sp.value) as string;
  });

  const stateType = `${name}State`;
  const errorName = `${name}StateError`;
  const snakeName = toSnakeCase(name);

  // State enum
  lines.push(`class ${stateType}(str, Enum):`);
  for (const s of stateNames) {
    lines.push(`    ${s.toUpperCase()} = "${s}"`);
  }
  lines.push('');

  // Error class
  lines.push('');
  lines.push(`class ${errorName}(Exception):`);
  lines.push(`    def __init__(self, expected: str | list[str], actual: str):`);
  lines.push(`        expected_str = " | ".join(expected) if isinstance(expected, list) else expected`);
  lines.push(`        super().__init__(f"Invalid ${snakeName} state: expected {expected_str}, got {actual}")`);
  lines.push(`        self.expected = expected`);
  lines.push(`        self.actual = actual`);
  lines.push('');

  // Transition functions
  const transitions = kids(node, 'transition');
  for (const t of transitions) {
    const tp = p(t);
    const tname = toSnakeCase(tp.name as string);
    const from = tp.from as string;
    const to = tp.to as string;

    const fromStates = from.split('|').map((s) => s.trim());
    const isMultiFrom = fromStates.length > 1;
    const fnName = `${tname}_${snakeName}`;
    const code = handlerCode(t);

    lines.push('');
    lines.push(`def ${fnName}(entity: dict) -> dict:`);
    lines.push(`    """${from} → ${to}"""`);

    if (isMultiFrom) {
      lines.push(`    valid_states = [${fromStates.map((s) => `"${s}"`).join(', ')}]`);
      lines.push(`    if entity["state"] not in valid_states:`);
      lines.push(`        raise ${errorName}(valid_states, entity["state"])`);
    } else {
      lines.push(`    if entity["state"] != "${fromStates[0]}":`);
      lines.push(`        raise ${errorName}("${fromStates[0]}", entity["state"])`);
    }

    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    } else {
      lines.push(`    return {**entity, "state": "${to}"}`);
    }
  }

  return lines;
}

// ── Config → Pydantic BaseSettings ───────────────────────────────────────
// config name=AppConfig
//   field name=timeout type=number default=120
// → class AppConfig(BaseSettings):
//       timeout: int = 120

export function generateConfig(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const fields = kids(node, 'field');
  const lines: string[] = [];

  lines.push(`class ${name}(BaseSettings):`);
  if (fields.length === 0) {
    lines.push('    pass');
    return lines;
  }

  for (const field of fields) {
    const fp = p(field);
    const fname = toSnakeCase(fp.name as string);
    const ftype = mapTsTypeToPython(fp.type as string);
    const def = fp.default as string | undefined;

    if (def !== undefined) {
      // Determine if default needs quoting
      const fOrigType = fp.type as string;
      if (fOrigType === 'string') {
        lines.push(`    ${fname}: ${ftype} = "${def}"`);
      } else {
        lines.push(`    ${fname}: ${ftype} = ${def}`);
      }
    } else {
      lines.push(`    ${fname}: ${ftype}`);
    }
  }

  return lines;
}

// ── Store → pathlib CRUD ─────────────────────────────────────────────────
// store name=Plan path="~/.agon/plans" key=id
// → save_plan(), load_plan(), list_plans(), delete_plan()

export function generateStore(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const storePath = (props.path as string) || '~/.data';
  const key = toSnakeCase((props.key as string) || 'id');
  const _model = (props.model as string) || 'dict';
  const lines: string[] = [];
  const snakeName = toSnakeCase(name);
  const dirConst = `${toScreamingSnake(name)}_DIR`;

  const resolvedPath = storePath.startsWith('~/') ? `Path.home() / "${storePath.slice(2)}"` : `Path("${storePath}")`;

  lines.push('import json');
  lines.push('from pathlib import Path');
  lines.push('');
  lines.push(`${dirConst} = ${resolvedPath}`);
  lines.push('');

  lines.push('');
  lines.push(`def _ensure_${snakeName}_dir() -> None:`);
  lines.push(`    ${dirConst}.mkdir(parents=True, exist_ok=True)`);
  lines.push('');

  lines.push('');
  lines.push(`def _safe_${snakeName}_path(id: str) -> Path:`);
  lines.push(`    import re`);
  lines.push(`    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "", id)`);
  lines.push(`    full = (${dirConst} / f"{sanitized}.json").resolve()`);
  lines.push(`    if not str(full).startswith(str(${dirConst}.resolve())):`);
  lines.push(`        raise ValueError(f"Invalid ID: {id}")`);
  lines.push(`    return full`);
  lines.push('');

  lines.push('');
  lines.push(`def save_${snakeName}(item: dict) -> None:`);
  lines.push(`    _ensure_${snakeName}_dir()`);
  lines.push(`    path = _safe_${snakeName}_path(item["${key}"])`);
  lines.push(`    path.write_text(json.dumps(item, indent=2) + "\\n")`);
  lines.push('');

  lines.push('');
  lines.push(`def load_${snakeName}(id: str) -> dict | None:`);
  lines.push(`    try:`);
  lines.push(`        return json.loads(_safe_${snakeName}_path(id).read_text())`);
  lines.push(`    except (FileNotFoundError, json.JSONDecodeError):`);
  lines.push(`        return None`);
  lines.push('');

  lines.push('');
  lines.push(`def list_${snakeName}s(limit: int = 20) -> list[dict]:`);
  lines.push(`    _ensure_${snakeName}_dir()`);
  lines.push(`    try:`);
  lines.push(`        items = [`);
  lines.push(`            json.loads(f.read_text())`);
  lines.push(`            for f in ${dirConst}.glob("*.json")`);
  lines.push(`        ]`);
  lines.push(`        items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)`);
  lines.push(`        return items[:limit]`);
  lines.push(`    except Exception:`);
  lines.push(`        return []`);
  lines.push('');

  lines.push('');
  lines.push(`def delete_${snakeName}(id: str) -> bool:`);
  lines.push(`    try:`);
  lines.push(`        _safe_${snakeName}_path(id).unlink()`);
  lines.push(`        return True`);
  lines.push(`    except FileNotFoundError:`);
  lines.push(`        return False`);

  return lines;
}

// ── Test → pytest ────────────────────────────────────────────────────────
// test name="Plan Transitions"
//   describe name=approve_plan
//     it name="transitions draft → approved"
//       handler <<<
//         assert approve_plan(make_plan("draft"))["state"] == "approved"
//       >>>

export function generateTest(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const className = name.replace(/[^a-zA-Z0-9]/g, '');
  const lines: string[] = [];

  lines.push('import pytest');
  lines.push('');

  // Top-level setup handler
  const setup = handlerCode(node);
  if (setup) {
    for (const line of setup.split('\n')) lines.push(line);
    lines.push('');
  }

  lines.push(`class Test${className}:`);

  for (const desc of kids(node, 'describe')) {
    const dname = p(desc).name as string;
    const dclass = dname.replace(/[^a-zA-Z0-9]/g, '');

    lines.push(`    class Test${dclass}:`);

    for (const test of kids(desc, 'it')) {
      const tname = p(test).name as string;
      const fname = toSnakeCase(
        tname
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .trim()
          .replace(/\s+/g, '_'),
      );
      const code = handlerCode(test);
      lines.push(`        def test_${fname}(self):`);
      if (code) {
        for (const line of code.split('\n')) lines.push(`            ${line}`);
      } else {
        lines.push('            pass');
      }
      lines.push('');
    }
  }

  // Top-level it blocks
  for (const test of kids(node, 'it')) {
    const tname = p(test).name as string;
    const fname = toSnakeCase(
      tname
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_'),
    );
    const code = handlerCode(test);
    lines.push(`    def test_${fname}(self):`);
    if (code) {
      for (const line of code.split('\n')) lines.push(`        ${line}`);
    } else {
      lines.push('        pass');
    }
    lines.push('');
  }

  return lines;
}

// ── Event → Literal + TypedDict ──────────────────────────────────────────
// event name=TrackEvent
//   type name="track:created" data="{ title: string }"
// → TrackEventType = Literal["track:created", ...]
// → class TrackCreatedData(TypedDict): ...

export function generateEvent(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const types = kids(node, 'type');
  const lines: string[] = [];

  // Event type union
  lines.push(`${name}Type = Literal[${types.map((t) => `"${(p(t).name || p(t).value) as string}"`).join(', ')}]`);
  lines.push('');

  // Event TypedDict
  lines.push(`class ${name}(TypedDict):`);
  lines.push(`    type: ${name}Type`);
  lines.push(`    engine_id: str`);
  lines.push(`    data: dict[str, Any]`);
  lines.push('');

  // Event data classes
  for (const t of types) {
    const tp = p(t);
    const tname = (tp.name || tp.value) as string;
    const data = tp.data as string;
    if (data) {
      const className = `${tname
        .split(':')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')}Data`;
      lines.push(`class ${className}(TypedDict):`);
      // Parse simple {key: type} format
      const inner = data.replace(/^\{|\}$/g, '').trim();
      if (inner) {
        for (const pair of inner.split(',')) {
          const [k, ...vparts] = pair.split(':');
          if (k && vparts.length > 0) {
            lines.push(`    ${toSnakeCase(k.trim())}: ${mapTsTypeToPython(vparts.join(':').trim())}`);
          }
        }
      } else {
        lines.push('    pass');
      }
      lines.push('');
    }
  }

  return lines;
}

// ── Import ───────────────────────────────────────────────────────────────
// import from="pathlib" names="Path"
// → from pathlib import Path

export function generateImport(node: IRNode): string[] {
  const props = p(node);
  const from = props.from as string;
  const names = props.names as string | undefined;
  const defaultImport = props.default as string | undefined;

  if (!from) return [];

  if (defaultImport && names) {
    return [
      `from ${from} import ${defaultImport}, ${names
        .split(',')
        .map((s) => s.trim())
        .join(', ')}`,
    ];
  }
  if (defaultImport) {
    return [`import ${from} as ${defaultImport}`];
  }
  if (names) {
    return [
      `from ${from} import ${names
        .split(',')
        .map((s) => s.trim())
        .join(', ')}`,
    ];
  }
  return [`import ${from}`];
}

// ── Const ────────────────────────────────────────────────────────────────
// const name=MAX_RETRIES type=number value=3
// → MAX_RETRIES: int = 3

export function generateConst(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const constType = props.type as string | undefined;
  const value = props.value as string | undefined;
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  if (code) {
    return [`${name}${typeAnnotation} = ${code.trim()}`];
  }
  if (value) {
    return [`${name}${typeAnnotation} = ${value}`];
  }
  return [`${name}${typeAnnotation} = None`];
}
