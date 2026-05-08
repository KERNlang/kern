import type { FunctionBlock, LineInfo } from '../helpers/lines.js';
import { FB_CURSOR_ANCHORS, FB_OFFSET_ANCHORS, FB_PAGE_ANCHORS } from '../signatures.js';

// P2-A fallback parity: classify the route handler's parameter signature
// against pagination anchor families. The fallback parses the function-def
// signature line(s) since it has no AST; tree-sitter mapper is preferred
// when available.
export function paginationStrategyFromSignature(
  routeFn: FunctionBlock | undefined,
  lines: readonly LineInfo[],
): {
  strategy: 'page' | 'offset' | 'cursor' | 'mixed' | 'none' | undefined;
  resolved: boolean;
} {
  if (!routeFn) return { strategy: 'none', resolved: true };
  const headerLine = lines.find((line) => line.line === routeFn.startLine)?.text ?? '';
  // Multi-line signatures: collect lines from startLine until we close the
  // outer `(` introducing parameters.
  let sig = headerLine;
  let depth = 0;
  let foundOpen = false;
  for (const ch of headerLine) {
    if (ch === '(') {
      depth++;
      foundOpen = true;
    } else if (ch === ')') {
      depth--;
    }
  }
  if (foundOpen && depth > 0) {
    for (let i = routeFn.startLine; i < lines.length && depth > 0; i++) {
      const text = lines[i]?.text ?? '';
      sig += `\n${text}`;
      for (const ch of text) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth === 0) break;
      }
    }
  }

  const openIdx = sig.indexOf('(');
  if (openIdx === -1) return { strategy: 'none', resolved: true };
  // Find matching close paren.
  let d = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < sig.length; i++) {
    const ch = sig[i];
    if (ch === '(') d++;
    else if (ch === ')') {
      d--;
      if (d === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return { strategy: undefined, resolved: false };

  const paramsText = sig.substring(openIdx + 1, closeIdx);
  // Split by top-level commas, respecting nested parens/brackets.
  const params: string[] = [];
  let bracketDepth = 0;
  let cur = '';
  for (const ch of paramsText) {
    if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
    else if (ch === ')' || ch === ']' || ch === '}') bracketDepth--;
    else if (ch === ',' && bracketDepth === 0) {
      if (cur.trim()) params.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());

  const families = new Set<'page' | 'offset' | 'cursor'>();
  let sawOpaque = false;

  for (const raw of params) {
    if (raw.startsWith('**')) {
      sawOpaque = true;
      continue;
    }
    if (raw.startsWith('*')) continue;

    // Drop default value (after first top-level `=`) and trailing type annotation
    // separators to extract the parameter name.
    let nameAndType = raw;
    let defaultExpr = '';
    let eqDepth = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '(' || ch === '[' || ch === '{') eqDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') eqDepth--;
      else if (ch === '=' && eqDepth === 0) {
        nameAndType = raw.substring(0, i);
        defaultExpr = raw.substring(i + 1);
        break;
      }
    }
    const colonIdx = nameAndType.indexOf(':');
    const namePart = colonIdx === -1 ? nameAndType.trim() : nameAndType.substring(0, colonIdx).trim();
    const typePart = colonIdx === -1 ? '' : nameAndType.substring(colonIdx + 1).trim();
    if (!namePart) continue;
    if (/\bRequest\b/.test(typePart)) {
      sawOpaque = true;
      continue;
    }

    // Modern FastAPI (≥0.95): `x: Annotated[int, Query(alias="page")]` —
    // Query() lives in the type annotation, not the default. Older syntax
    // puts it in the default: `x: int = Query(0, alias="page")`. Both are
    // valid; default-form takes precedence when both are present.
    const aliasFromDefault = extractQueryAliasFb(defaultExpr);
    const aliasFromType = aliasFromDefault.alias === undefined ? extractQueryAliasFb(typePart) : aliasFromDefault;
    if (aliasFromDefault.opaque || aliasFromType.opaque) {
      sawOpaque = true;
      continue;
    }
    let key = namePart;
    if (aliasFromDefault.alias) key = aliasFromDefault.alias;
    else if (aliasFromType.alias) key = aliasFromType.alias;

    const family = classifyAnchorFb(key);
    if (family) families.add(family);
  }

  if (sawOpaque) return { strategy: undefined, resolved: false };
  if (families.size === 0) return { strategy: 'none', resolved: true };
  if (families.size === 1) return { strategy: [...families][0], resolved: true };
  return { strategy: 'mixed', resolved: true };
}

export function classifyAnchorFb(key: string): 'page' | 'offset' | 'cursor' | undefined {
  if (FB_PAGE_ANCHORS.has(key)) return 'page';
  if (FB_OFFSET_ANCHORS.has(key)) return 'offset';
  if (FB_CURSOR_ANCHORS.has(key)) return 'cursor';
  return undefined;
}

export function extractQueryAliasFb(text: string | undefined): { alias?: string; opaque: boolean } {
  if (!text) return { opaque: false };
  if (!/\bQuery\s*\(/.test(text)) return { opaque: false };
  const aliasMatch = text.match(/\balias\s*=\s*['"]([^'"]+)['"]/);
  if (aliasMatch) return { alias: aliasMatch[1], opaque: false };
  if (/\balias\s*=/.test(text)) return { opaque: true };
  return { opaque: false };
}
