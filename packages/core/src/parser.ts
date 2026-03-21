import type { IRNode, IRSourceLocation } from './types.js';
import { KernParseError } from './errors.js';

let _parseWarnings: string[] = [];

interface ParsedLine {
  indent: number;
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, string>;
  pseudoStyles: Record<string, Record<string, string>>;
  themeRefs: string[];
  loc: IRSourceLocation;
}

const MULTILINE_BLOCK_TYPES = new Set(['logic', 'handler', 'cleanup', 'body']);

// ── Evolved Node Parser Hints (v4) ──────────────────────────────────────
// Populated at startup by evolved-node-loader. Tells the parser how to
// handle evolved nodes with special syntax (positional args, bare words, etc.)

interface ParserHintsConfig {
  positionalArgs?: string[];
  bareWord?: string;
  multilineBlock?: string;
}

const _parserHints = new Map<string, ParserHintsConfig>();

/** Register parser hints for an evolved node type. */
export function registerParserHints(keyword: string, hints: ParserHintsConfig): void {
  _parserHints.set(keyword, hints);
  if (hints.multilineBlock) {
    MULTILINE_BLOCK_TYPES.add(keyword);
  }
}

/** Unregister parser hints (for rollback/testing). */
export function unregisterParserHints(keyword: string): void {
  const hints = _parserHints.get(keyword);
  if (hints?.multilineBlock) {
    MULTILINE_BLOCK_TYPES.delete(keyword);
  }
  _parserHints.delete(keyword);
}

/** Clear all parser hints (for test isolation). */
export function clearParserHints(): void {
  // Remove evolved entries from MULTILINE_BLOCK_TYPES, keep core ones
  for (const [keyword, hints] of _parserHints) {
    if (hints.multilineBlock) MULTILINE_BLOCK_TYPES.delete(keyword);
  }
  _parserHints.clear();
}

function parseLine(raw: string, lineNum: number): ParsedLine | null {
  if (raw.trim() === '') return null;

  const indent = raw.search(/\S/);
  let rest = raw.slice(indent);
  const col = indent + 1;

  // Extract type — supports `evolved:keyword` namespace prefix as escape hatch
  const typeMatch = rest.match(/^(?:evolved:)?([A-Za-z_][A-Za-z0-9_-]*)/);
  if (!typeMatch) return null;
  const type = typeMatch[1];
  rest = rest.slice(typeMatch[0].length);

  const props: Record<string, unknown> = {};
  const styles: Record<string, string> = {};
  const pseudoStyles: Record<string, Record<string, string>> = {};
  const themeRefs: string[] = [];

  // ── Evolved node parser hints (v4) ──────────────────────────────────
  // Check if this type has parser hints from graduated evolved nodes.
  // Must run BEFORE core special cases to allow evolved nodes to use
  // positional args, bare words, etc.
  const evolvedHints = _parserHints.get(type);
  if (evolvedHints) {
    // Positional args: "api-route GET /users" → props.method="GET", props.path="/users"
    if (evolvedHints.positionalArgs) {
      for (const argName of evolvedHints.positionalArgs) {
        rest = rest.replace(/^ +/, '');
        const argMatch = rest.match(/^(\S+)/);
        if (argMatch) {
          props[argName] = argMatch[1];
          rest = rest.slice(argMatch[0].length);
        }
      }
    }

    // Bare word: "auth-guard admin" → props.name="admin"
    if (evolvedHints.bareWord) {
      rest = rest.replace(/^ +/, '');
      const bwMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
      if (bwMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_-]*=/)) {
        props[evolvedHints.bareWord] = bwMatch[1];
        rest = rest.slice(bwMatch[0].length);
      }
    }
  }

  // Special: theme nodes have a bare name after the type: "theme bar {h:8}"
  if (type === 'theme') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (nameMatch) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: import nodes support bare words for name and optional "default" flag
  // Syntax: "import [default] <name> from=<path>"
  if (type === 'import') {
    rest = rest.replace(/^ +/, '');
    // Check for "default" keyword
    if (rest.startsWith('default')) {
      const afterDefault = rest.slice(7);
      if (afterDefault.length === 0 || afterDefault[0] === ' ') {
        props.default = true;
        rest = afterDefault.replace(/^ +/, '');
      }
    }
    // Capture the import name (bare word before from=)
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (nameMatch && !rest.startsWith('from=')) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: route v3 positional syntax — "route GET /api/users"
  if (type === 'route') {
    rest = rest.replace(/^ +/, '');
    const verbMatch = rest.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i);
    if (verbMatch) {
      props.method = verbMatch[1].toLowerCase();
      rest = rest.slice(verbMatch[0].length);
      const pathMatch = rest.match(/^(\/\S*)/);
      if (pathMatch) {
        props.path = pathMatch[1];
        rest = rest.slice(pathMatch[0].length);
      }
    }
  }

  // Special: params — "params page:number = 1, limit:number = 20"
  if (type === 'params') {
    rest = rest.replace(/^ +/, '');
    if (rest.length > 0) {
      const items: Array<{ name: string; type: string; default?: string }> = [];
      const parts = rest.split(',').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const m = part.match(/^([A-Za-z_]\w*):([A-Za-z_]\w*(?:\[\])?)(?:\s*=\s*(.+))?$/);
        if (m) {
          const item: { name: string; type: string; default?: string } = { name: m[1], type: m[2] };
          if (m[3] !== undefined) item.default = m[3].trim();
          items.push(item);
        }
      }
      props.items = items;
      rest = '';
    }
  }

  // Special: auth — "auth required" / "auth optional" / "auth bearer"
  if (type === 'auth') {
    rest = rest.replace(/^ +/, '');
    const modeMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (modeMatch) {
      props.mode = modeMatch[1];
      rest = rest.slice(modeMatch[0].length);
    }
  }

  // Special: validate — "validate UserQuerySchema"
  if (type === 'validate') {
    rest = rest.replace(/^ +/, '');
    const schemaMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (schemaMatch) {
      props.schema = schemaMatch[1];
      rest = rest.slice(schemaMatch[0].length);
    }
  }

  // Special: error with numeric status — "error 401 "Unauthorized""
  if (type === 'error') {
    rest = rest.replace(/^ +/, '');
    const statusMatch = rest.match(/^(\d{3})/);
    if (statusMatch) {
      props.status = parseInt(statusMatch[1], 10);
      rest = rest.slice(statusMatch[0].length).replace(/^ +/, '');
      if (rest.startsWith('"')) {
        const endQuote = rest.indexOf('"', 1);
        if (endQuote > 0) {
          props.message = rest.slice(1, endQuote);
          rest = rest.slice(endQuote + 1);
        }
      }
    }
  }

  // Special: derive with bare name — "derive user expr={{...}}"
  if (type === 'derive') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    // Only consume bare name if it's NOT a key=value pair (e.g., "derive name=foo" or "derive from=x")
    if (nameMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_]*=/)) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: guard with bare name — "guard exists expr={{...}} else=404"
  if (type === 'guard') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (nameMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_]*=/)) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: effect with bare name — "effect fetchUsers"
  if (type === 'effect') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (nameMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_]*=/)) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: strategy with bare name — "strategy read-through"
  if (type === 'strategy') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (nameMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_-]*=/)) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
    }
  }

  // Special: trigger with bare type — "trigger db query=..."
  if (type === 'trigger') {
    rest = rest.replace(/^ +/, '');
    const typeMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (typeMatch && !rest.match(/^[A-Za-z_][A-Za-z0-9_]*=/)) {
      props.kind = typeMatch[1];
      rest = rest.slice(typeMatch[0].length);
    }
  }

  // Special: respond with optional status — "respond 200 json=users" / "respond redirect=/login"
  if (type === 'respond') {
    rest = rest.replace(/^ +/, '');
    const statusMatch = rest.match(/^(\d{3})/);
    if (statusMatch) {
      props.status = parseInt(statusMatch[1], 10);
      rest = rest.slice(statusMatch[0].length);
    }
  }

  // Special: middleware bare word list — "middleware rateLimit, cors"
  if (type === 'middleware') {
    rest = rest.replace(/^ +/, '');
    if (rest.length > 0 && !rest.includes('=')) {
      const names = rest.split(',').map(s => s.trim()).filter(Boolean);
      if (names.length > 1) {
        props.names = names;
      } else if (names.length === 1) {
        props.name = names[0];
      }
      rest = '';
    }
  }

  // Parse the remainder: props, style blocks, theme refs
  while (rest.length > 0) {
    rest = rest.replace(/^ +/, '');
    if (rest.length === 0) break;

    // Style block — find matching } respecting quotes
    if (rest[0] === '{') {
      let close = -1;
      let inQuote = false;
      for (let j = 1; j < rest.length; j++) {
        if (rest[j] === '"') inQuote = !inQuote;
        if (!inQuote && rest[j] === '}') { close = j; break; }
      }
      if (close === -1) break;
      const block = rest.slice(1, close);
      parseStyleBlock(block, styles, pseudoStyles);
      rest = rest.slice(close + 1);
      continue;
    }

    // Theme ref
    if (rest[0] === '$') {
      const refMatch = rest.match(/^\$([A-Za-z_][A-Za-z0-9_-]*)/);
      if (refMatch) {
        themeRefs.push(refMatch[1]);
        rest = rest.slice(refMatch[0].length);
        continue;
      }
    }

    // Prop: key={{ expression }}
    const exprPropMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)=\{\{/);
    if (exprPropMatch) {
      const key = exprPropMatch[1];
      rest = rest.slice(exprPropMatch[0].length);
      // Find matching }}
      let depth = 1;
      let j = 0;
      for (; j < rest.length - 1; j++) {
        if (rest[j] === '{' && rest[j + 1] === '{') { depth++; j++; }
        else if (rest[j] === '}' && rest[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
      }
      const expr = rest.slice(0, j - 1).trim();
      rest = rest.slice(j + 1);
      props[key] = { __expr: true, code: expr };
      continue;
    }

    // Prop: key=value or key="quoted value"
    const propMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)=/);
    if (propMatch) {
      const key = propMatch[1];
      rest = rest.slice(propMatch[0].length);
      let value: string;
      if (rest[0] === '"') {
        const endQuote = rest.indexOf('"', 1);
        value = rest.slice(1, endQuote);
        rest = rest.slice(endQuote + 1);
      } else if (rest.startsWith('{{')) {
        // Bare expression without key= prefix (e.g. value={{ x }})
        rest = rest.slice(2);
        let depth = 1;
        let j = 0;
        for (; j < rest.length - 1; j++) {
          if (rest[j] === '{' && rest[j + 1] === '{') { depth++; j++; }
          else if (rest[j] === '}' && rest[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
        }
        const expr = rest.slice(0, j - 1).trim();
        rest = rest.slice(j + 1);
        props[key] = { __expr: true, code: expr };
        continue;
      } else {
        const endMatch = rest.match(/^[^\s{$]+/);
        value = endMatch ? endMatch[0] : '';
        rest = rest.slice(value.length);
      }
      props[key] = value;
      continue;
    }

    // Unknown token — collect as warning, skip to next whitespace
    const skipped = rest.match(/^\S+/);
    if (skipped) {
      const errCol = col + (raw.length - rest.length);
      _parseWarnings.push(`Unexpected token "${skipped[0]}" at line ${lineNum}:${errCol}`);
      rest = rest.slice(skipped[0].length);
      continue;
    }
    break;
  }

  return {
    indent: indent / 2,
    type,
    props,
    styles,
    pseudoStyles,
    themeRefs,
    loc: { line: lineNum, col },
  };
}

function splitStylePairs(block: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && ch === '(') {
      parenDepth++;
      current += ch;
    } else if (!inQuote && ch === ')') {
      parenDepth--;
      current += ch;
    } else if (!inQuote && parenDepth === 0 && ch === ',') {
      if (current.trim()) pairs.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) pairs.push(current.trim());
  return pairs;
}

function parseStyleBlock(
  block: string,
  styles: Record<string, string>,
  pseudoStyles: Record<string, Record<string, string>>,
): void {
  const pairs = splitStylePairs(block);
  for (const pair of pairs) {
    // Pseudo-selector: :press:bg:#005BB5
    const pseudoMatch = pair.match(/^:([a-z]+):([A-Za-z0-9_-]+):(.+)$/);
    if (pseudoMatch) {
      const [, pseudo, key, value] = pseudoMatch;
      if (!pseudoStyles[pseudo]) pseudoStyles[pseudo] = {};
      pseudoStyles[pseudo][key] = value.trim();
      continue;
    }

    // Quoted key: "backdrop-filter":"blur(8px)"
    const quotedKeyMatch = pair.match(/^"([^"]+)"\s*:\s*(.*)/);
    if (quotedKeyMatch) {
      const key = quotedKeyMatch[1];
      let value = quotedKeyMatch[2].trim();
      // Strip surrounding quotes from value if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      styles[key] = value;
      continue;
    }

    // Normal: key:value (value may be quoted)
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      let value = pair.slice(colonIdx + 1).trim();
      // Strip surrounding quotes from value if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      styles[key] = value;
    }
  }
}

function expandMinified(source: string): string {
  // Detect minified S-expression format: node(child1,child2)
  // Convert to indented format for the standard parser
  if (!source.includes('(') || source.split('\n').length > 2) return source;

  const result: string[] = [];
  let depth = 0;
  let current = '';
  let inQuote = false;
  let inBraces = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { inQuote = !inQuote; current += ch; continue; }
    if (inQuote) { current += ch; continue; }
    if (ch === '{') { inBraces++; current += ch; continue; }
    if (ch === '}') { inBraces--; current += ch; continue; }
    if (inBraces > 0) { current += ch; continue; }

    if (ch === '(') {
      result.push('  '.repeat(depth) + current.trim());
      current = '';
      depth++;
    } else if (ch === ')') {
      if (current.trim()) result.push('  '.repeat(depth) + current.trim());
      current = '';
      depth--;
    } else if (ch === ',' && inBraces === 0) {
      if (current.trim()) result.push('  '.repeat(depth) + current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push('  '.repeat(depth) + current.trim());

  return result.join('\n');
}

/** Get warnings from the last parse() call */
export function getParseWarnings(): string[] { return [..._parseWarnings]; }

export function parse(source: string): IRNode {
  _parseWarnings = [];
  // Handle minified S-expression format
  source = expandMinified(source);
  const lines = source.split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const multilineType = [...MULTILINE_BLOCK_TYPES].find(type => trimmed.startsWith(`${type} <<<`));
    if (multilineType) {
      const indent = lines[i].search(/\S/);
      const codeLines: string[] = [];
      const startLine = i + 1;
      const blockOpen = `${multilineType} <<<`;
      // Check if inline close on same line
      const afterOpen = trimmed.slice(blockOpen.length);
      if (afterOpen.includes('>>>')) {
        codeLines.push(afterOpen.split('>>>')[0]);
      } else {
        i++;
        while (i < lines.length && !lines[i].includes('>>>')) {
          codeLines.push(lines[i]);
          i++;
        }
        // Capture text before >>> on closing line
        if (i < lines.length) {
          const closeLine = lines[i];
          const closeIdx = closeLine.indexOf('>>>');
          if (closeIdx > 0) codeLines.push(closeLine.slice(0, closeIdx));
        }
      }
      parsed.push({
        indent: indent / 2,
        type: multilineType,
        props: { code: codeLines.join('\n').replace(/^\n+|\n+$/g, '') },
        styles: {},
        pseudoStyles: {},
        themeRefs: [],
        loc: { line: startLine, col: indent + 1 },
      });
      continue;
    }

    const p = parseLine(lines[i], i + 1);
    if (p) parsed.push(p);
  }

  if (parsed.length === 0) {
    return { type: 'document', children: [], loc: { line: 1, col: 1 } };
  }

  function toNode(p: ParsedLine): IRNode {
    const node: IRNode = {
      type: p.type,
      loc: p.loc,
      props: { ...p.props },
      children: [],
    };
    if (Object.keys(p.styles).length > 0) node.props!.styles = p.styles;
    if (Object.keys(p.pseudoStyles).length > 0) node.props!.pseudoStyles = p.pseudoStyles;
    if (p.themeRefs.length > 0) node.props!.themeRefs = p.themeRefs;
    return node;
  }

  // Build tree using indent levels
  const root = toNode(parsed[0]);
  const stack: { node: IRNode; indent: number }[] = [{ node: root, indent: parsed[0].indent }];

  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i];
    const node = toNode(p);

    // Pop stack until we find a parent at a lower indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= p.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    stack.push({ node, indent: p.indent });
  }

  return root;
}
