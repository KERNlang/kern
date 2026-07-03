import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { getContainerId, isInAsyncDef, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';

// FastAPI BackgroundTasks dispatch.
//
//   from fastapi import BackgroundTasks
//
//   @app.post("/email")
//   async def send_email(background_tasks: BackgroundTasks, body: EmailIn):
//       background_tasks.add_task(send_email_func, body.to)
//                       ^^^^^^^^^ → effect[background-task]
//
// We emit one effect concept per `<param>.add_task(...)` call inside a
// function whose signature declares a `BackgroundTasks` parameter. The
// `target` carries the dispatched function name when it can be read from
// the first positional arg.
export function extractBackgroundTasks(
  root: Parser.SyntaxNode,
  source: string,
  filePath: string,
  nodes: ConceptNode[],
): void {
  walkNodes(root, 'function_definition', (fnDef) => {
    const paramNames = collectBackgroundTasksParams(fnDef, source);
    if (paramNames.size === 0) return;

    const body = fnDef.childForFieldName('body');
    if (!body) return;

    walkNodes(body, 'call', (callNode) => {
      const fnNode = callNode.childForFieldName('function');
      if (fnNode?.type !== 'attribute') return;

      const obj = fnNode.childForFieldName('object');
      const attr = fnNode.childForFieldName('attribute');
      if (!obj || !attr) return;
      if (attr.text !== 'add_task') return;
      if (!paramNames.has(obj.text)) return;

      const target = readTargetName(callNode, source);
      nodes.push({
        id: conceptId(filePath, 'effect', callNode.startIndex),
        kind: 'effect',
        primarySpan: nodeSpan(filePath, callNode),
        evidence: nodeText(source, callNode, 120),
        confidence: 0.95,
        language: 'py',
        containerId: getContainerId(callNode, filePath),
        payload: {
          kind: 'effect',
          subtype: 'background-task',
          async: isInAsyncDef(callNode),
          target,
        },
      });
    });
  });
}

function collectBackgroundTasksParams(fnDef: Parser.SyntaxNode, source: string): Set<string> {
  const names = new Set<string>();
  const params = fnDef.childForFieldName('parameters');
  if (!params) return names;

  for (const child of params.namedChildren) {
    if (child.type !== 'typed_parameter' && child.type !== 'typed_default_parameter') continue;
    const typeNode = child.childForFieldName('type');
    if (!typeNode) continue;
    const typeText = source.substring(typeNode.startIndex, typeNode.endIndex).trim();
    if (typeText !== 'BackgroundTasks' && typeText !== 'fastapi.BackgroundTasks') continue;

    // typed_parameter has the name as its first child identifier;
    // typed_default_parameter exposes it via the `name` field.
    const nameField = child.childForFieldName('name');
    if (nameField) {
      names.add(nameField.text);
      continue;
    }
    const ident = child.namedChildren.find((c) => c.type === 'identifier');
    if (ident) names.add(ident.text);
  }
  return names;
}

function readTargetName(callNode: Parser.SyntaxNode, source: string): string | undefined {
  const args = callNode.childForFieldName('arguments');
  if (!args) return undefined;

  // The scheduled callable can be passed positionally or as `func=...`
  // (BackgroundTasks.add_task signature: `add_task(func, *args, **kwargs)`).
  // Take the first positional arg if present; otherwise look for `func=`.
  let funcKeywordValue: string | undefined;
  for (const child of args.namedChildren) {
    if (child.type === 'keyword_argument') {
      const nameNode = child.childForFieldName('name');
      if (nameNode && nameNode.text === 'func') {
        const valueNode = child.childForFieldName('value');
        if (valueNode) funcKeywordValue = source.substring(valueNode.startIndex, valueNode.endIndex).trim();
      }
      continue;
    }
    return source.substring(child.startIndex, child.endIndex).trim();
  }
  return funcKeywordValue;
}
