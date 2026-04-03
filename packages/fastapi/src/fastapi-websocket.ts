/**
 * WebSocket artifact builder for the FastAPI transpiler.
 */

import type { IRNode, SourceMapEntry } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import type { WebSocketArtifactRef } from './fastapi-types.js';
import { slugify, indentHandler } from './fastapi-utils.js';

export function buildWebSocketArtifact(
  wsNode: IRNode,
  wsIndex: number,
  sourceMap: SourceMapEntry[],
): WebSocketArtifactRef {
  const props = getProps(wsNode);
  const wsPath = String(props.path || '/ws');
  const fileBase = slugify(`ws_${wsPath.replace(/[:/]/g, '_')}`) || `ws_${wsIndex}`;
  const funcName = `websocket_${slugify(wsPath.replace(/[:/]/g, '_'))}`;

  const onNodes = getChildren(wsNode, 'on');

  // Extract handler code per event
  let connectCode = '';
  let messageCode = '';
  let disconnectCode = '';

  for (const onNode of onNodes) {
    const onProps = getProps(onNode);
    const event = String(onProps.event || onProps.name || '');
    const handlerNode = getFirstChild(onNode, 'handler');
    const handlerProps = handlerNode ? getProps(handlerNode) : {};
    const code = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

    if (event === 'connect') connectCode = code;
    else if (event === 'message') messageCode = code;
    else if (event === 'disconnect') disconnectCode = code;
  }

  const lines: string[] = [];

  // Imports
  lines.push('import json');
  lines.push('from fastapi import WebSocket');
  lines.push('from starlette.websockets import WebSocketDisconnect');
  lines.push('');

  // WebSocket endpoint function (standalone, will be mounted via app.websocket)
  lines.push(`async def ${funcName}(websocket: WebSocket):`);
  lines.push('    await websocket.accept()');

  // Connect handler
  if (connectCode) {
    lines.push(...indentHandler(connectCode, '    '));
  }

  // Message loop + disconnect
  lines.push('    try:');
  lines.push('        while True:');
  lines.push('            try:');
  lines.push('                data = json.loads(await websocket.receive_text())');
  lines.push('            except json.JSONDecodeError:');
  lines.push('                await websocket.send_json({"error": "Invalid JSON payload"})');
  lines.push('                continue');
  if (messageCode) {
    lines.push(...indentHandler(messageCode, '            '));
  }
  lines.push('    except WebSocketDisconnect:');
  if (disconnectCode) {
    lines.push(...indentHandler(disconnectCode, '        '));
  } else {
    lines.push('        pass');
  }

  sourceMap.push({
    irLine: wsNode.loc?.line || 0,
    irCol: wsNode.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  return {
    funcName,
    fileBase,
    wsPath,
    artifact: {
      path: `ws/${fileBase}.py`,
      content: lines.join('\n'),
      type: 'websocket',
    },
  };
}
