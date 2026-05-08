import type Parser from 'tree-sitter';
import { PY_CURSOR_ANCHORS, PY_OFFSET_ANCHORS, PY_PAGE_ANCHORS } from '../signatures.js';

// Iterates the route handler's parameters and classifies each by name (or
// `Query(alias=...)` literal alias when present) against page/offset/cursor
// anchor sets. Returns:
//   - `none` / resolved=true  — handler reads no anchor params (and no opaque
//     paths to query data).
//   - `page` / `offset` / `cursor` / resolved=true — handler reads exactly
//     one family.
//   - `mixed` / resolved=true — handler reads multiple families.
//   - `undefined` / resolved=false — handler has a `Request` parameter,
//     `**kwargs`, or a `Query(alias=<dynamic>)` we can't statically resolve.
export function extractFastApiPaginationStrategy(
  fnDef: Parser.SyntaxNode,
  source: string,
): {
  strategy: 'page' | 'offset' | 'cursor' | 'mixed' | 'none' | undefined;
  resolved: boolean;
} {
  const paramsNode = fnDef.childForFieldName('parameters');
  if (!paramsNode) return { strategy: 'none', resolved: true };

  const families = new Set<'page' | 'offset' | 'cursor'>();
  let sawOpaque = false;

  for (const child of paramsNode.namedChildren) {
    // **kwargs — handler may read any query key dynamically; opaque.
    if (child.type === 'dictionary_splat_pattern') {
      sawOpaque = true;
      continue;
    }
    // *args — positional spread, irrelevant for query keys but rare in
    // FastAPI handlers; keep silent.
    if (child.type === 'list_splat_pattern') continue;

    // Drop typing wrappers to find the param identifier.
    const paramName = extractParamName(child);
    if (!paramName) continue;

    // `request: Request` — handler may call `request.query_params.get(...)`
    // arbitrarily; mark opaque.
    const typeText = extractParamTypeText(child, source);
    if (typeText && /\bRequest\b/.test(typeText)) {
      sawOpaque = true;
      continue;
    }

    // Default-value AND type expression both can carry a `Query(alias="...")`
    // call. Modern FastAPI (≥0.95) puts the call inside the type annotation
    // via `Annotated[int, Query(alias="page")]` (Gemini/OpenCode impl-review).
    // Older / classic syntax puts it in the default: `Query(0, alias="page")`.
    // Check both — default-value form takes precedence when both are present.
    const defaultText = extractParamDefaultText(child, source);
    const aliasFromDefault = extractQueryAlias(defaultText);
    const aliasFromType = aliasFromDefault.alias === undefined ? extractQueryAlias(typeText) : aliasFromDefault;
    let key = paramName;
    if (aliasFromDefault.opaque || aliasFromType.opaque) {
      sawOpaque = true;
      continue;
    }
    if (aliasFromDefault.alias) key = aliasFromDefault.alias;
    else if (aliasFromType.alias) key = aliasFromType.alias;

    const family = classifyPyAnchor(key);
    if (family) families.add(family);
  }

  if (sawOpaque) return { strategy: undefined, resolved: false };
  if (families.size === 0) return { strategy: 'none', resolved: true };
  if (families.size === 1) return { strategy: [...families][0], resolved: true };
  return { strategy: 'mixed', resolved: true };
}

function extractParamName(node: Parser.SyntaxNode): string | undefined {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'typed_parameter' || node.type === 'typed_default_parameter' || node.type === 'default_parameter') {
    const nameChild = node.childForFieldName('name') ?? node.namedChildren.find((c) => c.type === 'identifier');
    if (nameChild) return nameChild.text;
  }
  return undefined;
}

function extractParamTypeText(node: Parser.SyntaxNode, source: string): string | undefined {
  if (node.type !== 'typed_parameter' && node.type !== 'typed_default_parameter') return undefined;
  const typeChild = node.childForFieldName('type');
  if (typeChild) return source.substring(typeChild.startIndex, typeChild.endIndex);
  return undefined;
}

function extractParamDefaultText(node: Parser.SyntaxNode, source: string): string | undefined {
  if (node.type !== 'default_parameter' && node.type !== 'typed_default_parameter') return undefined;
  const valueChild = node.childForFieldName('value');
  if (valueChild) return source.substring(valueChild.startIndex, valueChild.endIndex);
  return undefined;
}

function classifyPyAnchor(key: string): 'page' | 'offset' | 'cursor' | undefined {
  if (PY_PAGE_ANCHORS.has(key)) return 'page';
  if (PY_OFFSET_ANCHORS.has(key)) return 'offset';
  if (PY_CURSOR_ANCHORS.has(key)) return 'cursor';
  return undefined;
}

/** Extract a `Query(..., alias="...")` literal alias from a parameter's
 *  default-value or type-annotation text. Used to support both classic
 *  (`x = Query(0, alias="p")`) and modern (`x: Annotated[int, Query(alias="p")]`)
 *  FastAPI patterns. Returns `{alias?, opaque}` where `opaque=true` indicates
 *  a `Query(alias=<non-literal>)` we cannot statically resolve. */
function extractQueryAlias(text: string | undefined): { alias?: string; opaque: boolean } {
  if (!text) return { opaque: false };
  if (!/\bQuery\s*\(/.test(text)) return { opaque: false };
  const aliasMatch = text.match(/\balias\s*=\s*['"]([^'"]+)['"]/);
  if (aliasMatch) return { alias: aliasMatch[1], opaque: false };
  if (/\balias\s*=/.test(text)) return { opaque: true };
  return { opaque: false };
}
