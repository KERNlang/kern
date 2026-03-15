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

const MULTILINE_BLOCK_TYPES = new Set(['logic', 'handler']);

function parseLine(raw: string, lineNum: number): ParsedLine | null {
  if (raw.trim() === '') return null;

  const indent = raw.search(/\S/);
  let rest = raw.slice(indent);
  const col = indent + 1;

  // Extract type
  const typeMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
  if (!typeMatch) return null;
  const type = typeMatch[1];
  rest = rest.slice(type.length);

  const props: Record<string, unknown> = {};
  const styles: Record<string, string> = {};
  const pseudoStyles: Record<string, Record<string, string>> = {};
  const themeRefs: string[] = [];

  // Special: theme nodes have a bare name after the type: "theme bar {h:8}"
  if (type === 'theme') {
    rest = rest.replace(/^ +/, '');
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (nameMatch) {
      props.name = nameMatch[1];
      rest = rest.slice(nameMatch[0].length);
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
        props: { code: codeLines.join('\n').trim() },
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
