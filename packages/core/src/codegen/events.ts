/**
 * Event Generators — event, on, websocket.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { KernCodegenError } from '../errors.js';
import { propsOf } from '../node-props.js';
import type { ExprObject, IRNode } from '../types.js';
import { emitIdentifier, emitTemplateSafe, emitTypeAnnotation } from './emitters.js';
import { capitalize, emitDocComment, exportPrefix, getChildren, getProps, handlerCode } from './helpers.js';

const p = getProps;
const kids = getChildren;

// ── Event ────────────────────────────────────────────────────────────────

export function generateEvent(node: IRNode): string[] {
  const props = propsOf<'event'>(node);
  const name = emitIdentifier(props.name, 'UnknownEvent', node);
  const exp = exportPrefix(node);
  const types = kids(node, 'type');
  const lines: string[] = [...emitDocComment(node)];

  // Event type union — 'type' children don't have a typed interface in NodePropsMap
  lines.push(
    `${exp}type ${name}Type = ${types.map((t) => `'${emitTemplateSafe((p(t).name || p(t).value) as string)}'`).join(' | ')};`,
  );
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
    const tname = emitTemplateSafe((tp.name || tp.value) as string);
    const data = emitTypeAnnotation(tp.data as string, 'Record<string, unknown>', t);
    lines.push(`  '${tname}': ${data};`);
  }
  lines.push('}');
  lines.push('');

  // Callback type
  lines.push(`${exp}type ${name}Callback = (event: ${name}) => void;`);

  return lines;
}

// ── On — generic event handler ────────────────────────────────────────────

export function generateOn(node: IRNode): string[] {
  const props = propsOf<'on'>(node);
  const event = ((props as Record<string, unknown>).event as string) || props.name || '';
  const handlerName = props.handler;
  const key = props.key;
  const code = handlerCode(node);
  const exp = exportPrefix(node);
  const lines: string[] = [...emitDocComment(node)];

  if (handlerName && !code) {
    // Reference to existing handler: on event=click handler=handleClick
    lines.push(`${exp}const on${capitalize(event)} = ${handlerName};`);
    return lines;
  }

  // Determine event parameter type (plain DOM types — target-agnostic)
  const paramType =
    event === 'key' || event === 'keydown' || event === 'keyup'
      ? 'e: KeyboardEvent'
      : event === 'message'
        ? 'event: MessageEvent'
        : event === 'submit'
          ? 'e: SubmitEvent'
          : event === 'click'
            ? 'e: MouseEvent'
            : event === 'change'
              ? 'e: Event'
              : event === 'focus' || event === 'blur'
                ? 'e: FocusEvent'
                : event === 'drag' || event === 'drop'
                  ? 'e: DragEvent'
                  : event === 'scroll'
                    ? 'e: Event'
                    : event === 'resize'
                      ? 'e: UIEvent'
                      : event === 'connect' || event === 'disconnect'
                        ? 'ws: WebSocket'
                        : event === 'error'
                          ? 'error: Error'
                          : `e: Event`;

  const fnName = handlerName || `handle${capitalize(event)}`;
  const isAsync =
    (props as Record<string, unknown>).async === 'true' || (props as Record<string, unknown>).async === true;
  const asyncKw = isAsync ? 'async ' : '';

  // Key filter guard
  const keyGuard = key ? `  if (key !== '${key}') return;\n` : '';

  // Splice declarative `set` children into the callback body in source order,
  // then append the handler block (if any). Lets authors write
  //   on event=click
  //     set name=count to="count + 1"
  // instead of dropping into a handler just to call the setter.
  const bodyLines = buildOnBodyLines(node, code);

  lines.push(`${exp}${asyncKw}function ${fnName}(${paramType}) {`);
  if (keyGuard) lines.push(keyGuard.trimEnd());
  for (const line of bodyLines) lines.push(`  ${line}`);
  lines.push('}');
  return lines;
}

/**
 * Walk the `on` node's children in source order, emitting `setX(expr);` for
 * each `set` child and inlining the `handler` block's code after. The setter
 * name mirrors the React useState convention used by `emitStateDecls` —
 * `set` + capitalized state name — so a sibling `state name=count` + a
 * `set name=count to="..."` always match.
 */
function buildOnBodyLines(node: IRNode, fallbackCode: string): string[] {
  const children = node.children || [];
  const hasSet = children.some((c) => c.type === 'set');

  // Back-compat: no `set` children → keep the old single-handler path verbatim.
  if (!hasSet) {
    return fallbackCode ? fallbackCode.split('\n') : [];
  }

  const out: string[] = [];
  for (const child of children) {
    if (child.type === 'set') {
      out.push(emitSetStatement(child));
    } else if (child.type === 'handler') {
      const code = ((child.props || {}).code as string) || ((child.props || {}).body as string) || '';
      if (code) out.push(...code.split('\n'));
    }
    // Other children (reason, evidence, needs, doc, ...) contribute nothing to the callback body.
  }
  return out;
}

function emitSetStatement(node: IRNode): string {
  const props = propsOf<'set'>(node);
  const name = emitIdentifier(props.name as string, 'state', node);
  const rawTo = props.to;
  const to =
    rawTo && typeof rawTo === 'object' && (rawTo as ExprObject).__expr ? (rawTo as ExprObject).code : (rawTo as string);
  if (to === undefined || to === null || to === '') {
    throw new KernCodegenError("set node requires a 'to' prop", node);
  }
  const setter = `set${capitalize(name)}`;
  return `${setter}(${to});`;
}

// ── WebSocket — bidirectional communication ──────────────────────────────

export function generateWebSocket(node: IRNode): string[] {
  const props = propsOf<'websocket'>(node);
  const path = ((props as Record<string, unknown>).path as string) || '/ws';
  const name = props.name || 'ws';
  const exp = exportPrefix(node);
  const lines: string[] = [...emitDocComment(node)];

  const onNodes = kids(node, 'on');
  const connectHandler = onNodes.find((n) => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'connect' || e === 'connection';
  });
  const messageHandler = onNodes.find((n) => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'message';
  });
  const disconnectHandler = onNodes.find((n) => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'disconnect' || e === 'close';
  });
  const errorHandler = onNodes.find((n) => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'error';
  });

  lines.push(`${exp}function setup${capitalize(name)}(wss: WebSocketServer) {`);
  lines.push(`  wss.on('connection', (ws, req) => {`);
  lines.push(`    const path = req.url || '${path}';`);

  if (connectHandler) {
    const code = handlerCode(connectHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
  }

  lines.push('');
  lines.push(`    ws.on('message', (raw) => {`);
  if (messageHandler) {
    const code = handlerCode(messageHandler);
    lines.push(`      const data = JSON.parse(raw.toString());`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
  }
  lines.push(`    });`);

  if (errorHandler) {
    lines.push('');
    lines.push(`    ws.on('error', (error) => {`);
    const code = handlerCode(errorHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
    lines.push(`    });`);
  }

  lines.push('');
  lines.push(`    ws.on('close', () => {`);
  if (disconnectHandler) {
    const code = handlerCode(disconnectHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
  }
  lines.push(`    });`);
  lines.push(`  });`);
  lines.push('}');

  return lines;
}
