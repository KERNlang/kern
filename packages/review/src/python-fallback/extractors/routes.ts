import {
  extractPythonRoutePath,
  type PythonStringDelimiter,
  scanPythonStructuralLine,
} from '../../python-response-contract.js';
import type { FunctionBlock, LineInfo } from '../helpers/lines.js';

export function routeMethod(decorator: string): string | undefined {
  const match = decorator.match(/@([A-Za-z_]\w*)\.(route|get|post|put|delete|patch)\s*\(/);
  if (!match) return undefined;
  const method = match[2].toUpperCase();
  return method === 'ROUTE' ? undefined : method;
}

export function routeRouterName(decorator: string): string | undefined {
  return decorator.match(/@([A-Za-z_]\w*)\.(?:route|get|post|put|delete|patch)\s*\(/)?.[1];
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
  return extractPythonRoutePath(decorator);
}

export function functionReturnAnnotation(
  lines: readonly LineInfo[],
  fn: FunctionBlock | undefined,
): string | undefined {
  if (!fn) return undefined;
  const signature = collectFunctionSignature(lines, fn.startLine - 1);
  const arrow = findFunctionReturnArrow(signature);
  if (arrow === -1) return undefined;

  let index = arrow + 2;
  while (/\s/.test(signature[index] ?? '')) index++;
  const start = index;
  let depth = 0;
  let quote: PythonStringDelimiter | undefined;
  while (index < signature.length) {
    const char = signature[index];
    if (quote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[' || char === '(' || char === '{') {
      depth++;
    } else if (char === ']' || char === ')' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ':' && depth === 0) {
      break;
    }
    index++;
  }
  const annotation = signature.slice(start, index).trim();
  return annotation || undefined;
}

function findFunctionReturnArrow(signature: string): number {
  const depths = { square: 0, paren: 0, brace: 0 };
  let quote: PythonStringDelimiter | undefined;
  let index = 0;
  while (index < signature.length) {
    if (quote) {
      if (signature[index] === '\\') index += 2;
      else if (signature.startsWith(quote, index)) {
        index += quote.length;
        quote = undefined;
      } else index++;
      continue;
    }

    if (signature[index] === '#') {
      const newline = signature.indexOf('\n', index);
      if (newline === -1) return -1;
      index = newline + 1;
      continue;
    }
    const triple = signature.slice(index, index + 3);
    if (triple === "'''" || triple === '"""') {
      quote = triple;
      index += 3;
    } else if (signature[index] === "'" || signature[index] === '"') {
      quote = signature[index] as "'" | '"';
      index++;
    } else if (signature[index] === '[') {
      depths.square++;
      index++;
    } else if (signature[index] === ']') {
      depths.square = Math.max(0, depths.square - 1);
      index++;
    } else if (signature[index] === '(') {
      depths.paren++;
      index++;
    } else if (signature[index] === ')') {
      depths.paren = Math.max(0, depths.paren - 1);
      index++;
    } else if (signature[index] === '{') {
      depths.brace++;
      index++;
    } else if (signature[index] === '}') {
      depths.brace = Math.max(0, depths.brace - 1);
      index++;
    } else if (signature.startsWith('->', index) && depths.square === 0 && depths.paren === 0 && depths.brace === 0) {
      return index;
    } else index++;
  }
  return -1;
}

export function functionBody(lines: LineInfo[], fn: FunctionBlock | undefined): string {
  if (!fn) return '';
  return lines
    .filter((line) => line.line > fn.startLine && line.line <= fn.endLine)
    .map((line) => line.text)
    .join('\n');
}

function collectFunctionSignature(lines: readonly LineInfo[], startIndex: number): string {
  const parts: string[] = [];
  let depth = 0;
  let started = false;
  let quote: PythonStringDelimiter | undefined;
  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i].text;
    parts.push(rawLine);
    const structural = scanPythonStructuralLine(rawLine, quote);
    quote = structural.quote;
    depth = Math.max(0, depth + structural.parenDelta);
    if (structural.sawOpenParen) started = true;
    if (started && depth === 0 && structural.hasColon) break;
  }
  return parts.join('\n');
}
