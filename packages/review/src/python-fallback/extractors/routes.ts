import type { FunctionBlock, LineInfo } from '../helpers/lines.js';

export function routeMethod(decorator: string): string | undefined {
  const match = decorator.match(/@(app|router|bp)\.(route|get|post|put|delete|patch)\s*\(/);
  if (!match) return undefined;
  const method = match[2].toUpperCase();
  return method === 'ROUTE' ? undefined : method;
}

export function routeName(lines: LineInfo[], decoratorIndex: number): string {
  for (let i = decoratorIndex + 1; i < lines.length; i++) {
    const match = lines[i].text.match(/^\s*(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
    if (match) return match[2];
    if (!lines[i].text.trim().startsWith('@')) break;
  }
  const path = lines[decoratorIndex].text.match(/['"]([^'"]+)['"]/)?.[1];
  return path ?? 'anonymous';
}

export function routePath(decorator: string): string | undefined {
  return decorator.match(/['"]([^'"]+)['"]/)?.[1];
}

export function routeResponseModel(decorator: string): string | undefined {
  const match = decorator.match(/\bresponse_model\s*=\s*([^,)]+)/);
  return match?.[1]?.trim();
}

export function functionBody(lines: LineInfo[], fn: FunctionBlock | undefined): string {
  if (!fn) return '';
  return lines
    .filter((line) => line.line > fn.startLine && line.line <= fn.endLine)
    .map((line) => line.text)
    .join('\n');
}
