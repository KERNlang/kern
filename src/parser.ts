import type { IRNode, IRSourceLocation } from './types.js';

interface ParsedLine {
  indent: number;
  type: string;
  props: Record<string, unknown>;
  styles: Record<string, string>;
  pseudoStyles: Record<string, Record<string, string>>;
  themeRefs: string[];
  loc: IRSourceLocation;
}

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

  // Parse the remainder: props, style blocks, theme refs
  while (rest.length > 0) {
    rest = rest.replace(/^ +/, '');
    if (rest.length === 0) break;

    // Style block
    if (rest[0] === '{') {
      const close = rest.indexOf('}');
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
      } else {
        const endMatch = rest.match(/^[^\s{$]+/);
        value = endMatch ? endMatch[0] : '';
        rest = rest.slice(value.length);
      }
      props[key] = value;
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

function parseStyleBlock(
  block: string,
  styles: Record<string, string>,
  pseudoStyles: Record<string, Record<string, string>>,
): void {
  // Split on commas, but respect nested values
  const pairs = block.split(',').map(s => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    // Pseudo-selector: :press:bg:#005BB5
    const pseudoMatch = pair.match(/^:([a-z]+):([A-Za-z_][A-Za-z0-9_-]*):(.+)$/);
    if (pseudoMatch) {
      const [, pseudo, key, value] = pseudoMatch;
      if (!pseudoStyles[pseudo]) pseudoStyles[pseudo] = {};
      pseudoStyles[pseudo][key] = value.trim();
      continue;
    }
    // Normal: key:value
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      const value = pair.slice(colonIdx + 1).trim();
      styles[key] = value;
    }
  }
}

export function parse(source: string): IRNode {
  const lines = source.split('\n');
  const parsed: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
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
