import type { FunctionBlock, LineInfo } from '../helpers/lines.js';

// FastAPI BackgroundTasks param names, keyed by function block id.
// Mirror of the tree-sitter `extractBackgroundTasks` extractor — see
// `packages/review-python/src/mapper/extractors/background-tasks.ts` for
// the canonical implementation. The fallback needs the same shape so
// cross-stack rules behave identically regardless of which path was used.
export function collectBackgroundTaskParams(
  lines: readonly LineInfo[],
  blocks: readonly FunctionBlock[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const fnLineMap = new Map<number, FunctionBlock>();
  for (const block of blocks) fnLineMap.set(block.startLine, block);

  for (const block of blocks) {
    // The signature can span multiple lines: collect from `def` until the
    // closing `)` at paren depth 0.
    const sig = readSignatureText(lines, block.startLine);
    const names = paramNamesTypedAsBackgroundTasks(sig);
    if (names.size > 0) result.set(block.id, names);
  }
  return result;
}

function readSignatureText(lines: readonly LineInfo[], startLine: number): string {
  // 1-based line numbers. Append until parens balance.
  let depth = 0;
  let started = false;
  const parts: string[] = [];
  for (let i = startLine - 1; i < lines.length; i++) {
    const text = lines[i].text;
    parts.push(text);
    for (const ch of text) {
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') {
        depth--;
      }
    }
    if (started && depth <= 0) break;
  }
  return parts.join('\n');
}

function paramNamesTypedAsBackgroundTasks(signature: string): Set<string> {
  const names = new Set<string>();
  const open = signature.indexOf('(');
  if (open < 0) return names;
  // Find matching close at depth 0.
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return names;
  const inner = signature.slice(open + 1, close);

  for (const param of splitTopLevelCommas(inner)) {
    // `name: BackgroundTasks` or `name: BackgroundTasks = something`.
    // Default-value half ignored — we just need the type annotation.
    const beforeEq = param.split('=')[0];
    const colon = beforeEq.indexOf(':');
    if (colon < 0) continue;
    const name = beforeEq.slice(0, colon).trim();
    const annotation = beforeEq.slice(colon + 1).trim();
    if (annotation === 'BackgroundTasks' || annotation === 'fastapi.BackgroundTasks') {
      if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
