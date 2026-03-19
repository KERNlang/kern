import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig } from '@kernlang/core';
import { countTokens, serializeIR, isCoreNode, generateCoreNode, generateMachineReducer } from '@kernlang/core';

/**
 * Ink Transpiler — generates React (Ink) TSX components for terminal UIs
 *
 * Maps KERN terminal nodes to Ink components:
 *   screen  → React function component (export default)
 *   text    → <Text bold color="blue">...</Text>
 *   box     → <Box borderStyle="round" borderColor="blue">...</Box>
 *   separator → <Text dimColor>{'─'.repeat(48)}</Text>
 *   table   → <Box flexDirection="column"> with row components
 *   scoreboard → <Box flexDirection="column"> with metric rows
 *   spinner → <Text><Spinner /> {message}</Text>
 *   progress → <Box><Text>{bar}</Text></Box>
 *   gradient → <Text>{gradientChars}</Text>
 *   state   → const [x, setX] = useState(initial)
 *   stream  → useEffect with async generator iteration (streaming output)
 *   machine → standard output + useReducer hook
 *   input-area  → <Box> at bottom of screen (persistent input region)
 *   output-area → <Box flexGrow={1}> scrollable output region
 *   text-input  → <TextInput value={...} onChange={...} />
 *   select-input → <SelectInput items={...} onSelect={...} />
 *   handler → raw JSX injection
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function getChildren(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(ch => ch.type === type) : c;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert KERN style value to Ink-compatible color prop */
function inkColor(color: unknown): string {
  if (typeof color === 'number') return `"${color}"`;
  if (typeof color === 'string') {
    if (color.startsWith('#')) return `"${color}"`;
    return `"${color}"`;
  }
  return '"white"';
}

// ── Import tracker ──────────────────────────────────────────────────────

class ImportTracker {
  private reactImports = new Set<string>();
  private inkImports = new Set<string>();
  private inkSpinner = false;
  private inkTextInput = false;
  private inkSelectInput = false;

  addReact(name: string): void { this.reactImports.add(name); }
  addInk(name: string): void { this.inkImports.add(name); }
  needSpinner(): void { this.inkSpinner = true; }
  needTextInput(): void { this.inkTextInput = true; }
  needSelectInput(): void { this.inkSelectInput = true; }

  emit(): string[] {
    const lines: string[] = [];
    if (this.reactImports.size > 0) {
      lines.push(`import React, { ${[...this.reactImports].sort().join(', ')} } from 'react';`);
    } else {
      lines.push(`import React from 'react';`);
    }
    if (this.inkImports.size > 0) {
      lines.push(`import { ${[...this.inkImports].sort().join(', ')} } from 'ink';`);
    }
    if (this.inkSpinner) {
      lines.push(`import Spinner from 'ink-spinner';`);
    }
    if (this.inkTextInput) {
      lines.push(`import TextInput from 'ink-text-input';`);
    }
    if (this.inkSelectInput) {
      lines.push(`import SelectInput from 'ink-select-input';`);
    }
    return lines;
  }
}

// ── State block → useState ──────────────────────────────────────────────

function generateStateHook(stateNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(stateNode);
  const name = props.name as string;
  const initial = props.initial as string;

  if (name && initial !== undefined) {
    imports.addReact('useState');
    const initVal = initial === 'null' ? 'null'
      : initial === 'true' ? 'true'
      : initial === 'false' ? 'false'
      : initial.startsWith('[') || initial.startsWith('{') ? initial
      : isNaN(Number(initial)) ? `'${initial}'`
      : String(initial);
    const setter = `set${capitalize(name)}`;
    lines.push(`  const [${name}, ${setter}] = useState(${initVal});`);
  }

  return lines;
}

// ── Stream block → useEffect with async generator ───────────────────────

function generateStreamEffect(streamNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(streamNode);
  const name = props.name as string;
  const source = props.source as string;
  const append = props.append !== 'false'; // default true

  if (name && source) {
    imports.addReact('useEffect');
    const setter = `set${capitalize(name)}`;

    lines.push(`  useEffect(() => {`);
    lines.push(`    let cancelled = false;`);
    lines.push(`    (async () => {`);
    lines.push(`      for await (const chunk of ${source}()) {`);
    lines.push(`        if (cancelled) break;`);
    if (append) {
      lines.push(`        ${setter}(prev => [...prev, chunk]);`);
    } else {
      lines.push(`        ${setter}(chunk);`);
    }
    lines.push(`      }`);
    lines.push(`    })();`);
    lines.push(`    return () => { cancelled = true; };`);
    lines.push(`  }, []);`);
  }

  return lines;
}

// ── Node renderer → JSX ─────────────────────────────────────────────────

function renderInkNode(node: IRNode, indent: string, imports: ImportTracker): string[] {
  const p = getProps(node);
  const lines: string[] = [];

  switch (node.type) {
    case 'text': {
      imports.addInk('Text');
      const value = p.value as string || '';
      const styles = (p.styles as Record<string, string>) || {};
      const textProps: string[] = [];

      if (styles.fw === 'bold' || styles.bold) textProps.push('bold');
      if (styles.dim) textProps.push('dimColor');
      if (styles.italic) textProps.push('italic');
      if (styles.c || styles.color) textProps.push(`color=${inkColor(styles.c || styles.color)}`);
      if (styles.bg) textProps.push(`backgroundColor=${inkColor(styles.bg)}`);

      const propsStr = textProps.length > 0 ? ' ' + textProps.join(' ') : '';
      lines.push(`${indent}<Text${propsStr}>{${JSON.stringify(value)}}</Text>`);
      break;
    }

    case 'separator': {
      imports.addInk('Text');
      const width = Number(p.width) || 48;
      lines.push(`${indent}<Text dimColor>{'${'─'.repeat(width)}'}</Text>`);
      break;
    }

    case 'box': {
      imports.addInk('Box');
      imports.addInk('Text');
      const color = p.color as string;
      const borderStyle = p.borderStyle as string || 'round';
      const flexDirection = p.flexDirection as string;
      const width = p.width as string;

      const boxProps: string[] = [];
      if (color) boxProps.push(`borderStyle="${borderStyle}"`, `borderColor=${inkColor(color)}`);
      if (flexDirection) boxProps.push(`flexDirection="${flexDirection}"`);
      if (width) boxProps.push(`width={${width}}`);

      const propsStr = boxProps.length > 0 ? ' ' + boxProps.join(' ') : '';
      lines.push(`${indent}<Box${propsStr}>`);

      for (const child of node.children || []) {
        lines.push(...renderInkNode(child, indent + '  ', imports));
      }

      lines.push(`${indent}</Box>`);
      break;
    }

    case 'table': {
      imports.addInk('Box');
      imports.addInk('Text');
      const headers = p.headers as string || '[]';
      const rows = getChildren(node, 'row');

      lines.push(`${indent}<Box flexDirection="column">`);
      // Header row
      lines.push(`${indent}  <Box>`);
      lines.push(`${indent}    {(${headers} as string[]).map((h: string, i: number) => (`);
      lines.push(`${indent}      <Box key={i} width={20}><Text bold>{h}</Text></Box>`);
      lines.push(`${indent}    ))}`);
      lines.push(`${indent}  </Box>`);
      // Separator
      lines.push(`${indent}  <Text dimColor>{'${'─'.repeat(60)}'}</Text>`);
      // Data rows
      for (const row of rows) {
        const rowData = getProps(row).data as string || '[]';
        lines.push(`${indent}  <Box>`);
        lines.push(`${indent}    {(${rowData} as string[]).map((cell: string, i: number) => (`);
        lines.push(`${indent}      <Box key={i} width={20}><Text>{cell}</Text></Box>`);
        lines.push(`${indent}    ))}`);
        lines.push(`${indent}  </Box>`);
      }
      lines.push(`${indent}</Box>`);
      break;
    }

    case 'scoreboard': {
      imports.addInk('Box');
      imports.addInk('Text');
      const title = p.title as string || 'Results';
      const winner = p.winner as string || '';
      const metrics = getChildren(node, 'metric');

      lines.push(`${indent}<Box flexDirection="column">`);
      lines.push(`${indent}  <Text bold>{${JSON.stringify(title)}}</Text>`);
      if (winner) {
        lines.push(`${indent}  <Text bold color="green">{'Winner: ${winner}'}</Text>`);
      }
      for (const metric of metrics) {
        const mp = getProps(metric);
        const mname = mp.name as string || '';
        const values = mp.values as string || '[]';
        lines.push(`${indent}  <Box>`);
        lines.push(`${indent}    <Text dimColor>{${JSON.stringify(mname + ':')}}</Text>`);
        lines.push(`${indent}    <Text>{' '}{(${values} as string[]).join(' | ')}</Text>`);
        lines.push(`${indent}  </Box>`);
      }
      lines.push(`${indent}</Box>`);
      break;
    }

    case 'spinner': {
      imports.addInk('Text');
      imports.needSpinner();
      const message = p.message as string || 'Loading...';
      const color = p.color as string;
      const spinnerColor = color ? ` color=${inkColor(color)}` : '';
      lines.push(`${indent}<Text>`);
      lines.push(`${indent}  <Spinner${spinnerColor} />`);
      lines.push(`${indent}  {' ${message}'}`);
      lines.push(`${indent}</Text>`);
      break;
    }

    case 'progress': {
      imports.addInk('Box');
      imports.addInk('Text');
      const value = Number(p.value) || 0;
      const max = Number(p.max) || 100;
      const color = p.color as string || 'green';
      const barWidth = 20;
      const pct = Math.min(1, Math.max(0, value / max));
      const filled = Math.round(pct * barWidth);
      const empty = barWidth - filled;

      lines.push(`${indent}<Box>`);
      lines.push(`${indent}  <Text color=${inkColor(color)}>{'${'▓'.repeat(filled)}'}</Text>`);
      lines.push(`${indent}  <Text>{'${'░'.repeat(empty)}'}</Text>`);
      lines.push(`${indent}  <Text>{' ${Math.round(pct * 100)}%'}</Text>`);
      lines.push(`${indent}</Box>`);
      break;
    }

    case 'gradient': {
      imports.addInk('Text');
      const text = p.text as string || '';
      const colors = p.colors as string || '[]';

      lines.push(`${indent}<Text>`);
      lines.push(`${indent}  {${JSON.stringify(text)}.split('').map((ch: string, i: number) => {`);
      lines.push(`${indent}    const colors = ${colors} as number[];`);
      lines.push(`${indent}    const colorIdx = Math.floor((i / ${text.length}) * colors.length);`);
      lines.push(`${indent}    const color = String(colors[Math.min(colorIdx, colors.length - 1)]);`);
      lines.push(`${indent}    return <Text key={i} color={color}>{ch}</Text>;`);
      lines.push(`${indent}  })}`);
      lines.push(`${indent}</Text>`);
      break;
    }

    case 'input-area': {
      imports.addInk('Box');
      const children = node.children || [];
      lines.push(`${indent}<Box flexDirection="column" borderStyle="single" borderColor="gray">`);
      for (const child of children) {
        lines.push(...renderInkNode(child, indent + '  ', imports));
      }
      lines.push(`${indent}</Box>`);
      break;
    }

    case 'output-area': {
      imports.addInk('Box');
      const children = node.children || [];
      lines.push(`${indent}<Box flexDirection="column" flexGrow={1}>`);
      for (const child of children) {
        lines.push(...renderInkNode(child, indent + '  ', imports));
      }
      lines.push(`${indent}</Box>`);
      break;
    }

    case 'text-input': {
      imports.needTextInput();
      const placeholder = p.placeholder as string || '';
      const history = p.history as string;
      const inputProps: string[] = [];
      if (placeholder) inputProps.push(`placeholder=${JSON.stringify(placeholder)}`);
      if (history) inputProps.push(`history={${history}}`);
      lines.push(`${indent}<TextInput ${inputProps.join(' ')} />`);
      break;
    }

    case 'select-input': {
      imports.needSelectInput();
      const items = p.items as string || '[]';
      lines.push(`${indent}<SelectInput items={${items}} />`);
      break;
    }

    case 'handler': {
      const code = p.code as string || '';
      for (const line of code.split('\n')) {
        lines.push(`${indent}${line.trim()}`);
      }
      break;
    }

    case 'state':
      // Handled at component level as useState
      break;

    case 'stream':
      // Handled at component level as useEffect with async generator
      break;

    case 'on': {
      // Event handler — for Ink, on event=key generates useInput()
      const event = (p.event || p.name) as string;
      const handlerChild = (node.children || []).find(c => c.type === 'handler');
      const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';
      const key = p.key as string;

      if (event === 'key' || event === 'input') {
        imports.addInk('useInput');
        lines.push(`${indent}// on ${event}${key ? ` key=${key}` : ''}`);
        // useInput is stored; will be emitted in component body section
        // (stored as special marker and extracted during main transpile)
      }
      break;
    }

    default: {
      // Core language nodes emit as-is (they're TypeScript, not JSX)
      if (isCoreNode(node.type)) {
        // Machine nodes get useReducer treatment in Ink
        if (node.type === 'machine') {
          lines.push(...generateMachineReducer(node).map(l => l));
        } else {
          lines.push(...generateCoreNode(node));
        }
        break;
      }
      // Recurse into children for unknown nodes
      if (node.children) {
        for (const child of node.children) {
          lines.push(...renderInkNode(child, indent, imports));
        }
      }
    }
  }

  return lines;
}

// ── Main export ──────────────────────────────────────────────────────────

export function transpileInk(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const imports = new ImportTracker();
  const lines: string[] = [];

  const rootProps = getProps(root);
  const screenName = rootProps.name as string || 'App';

  // Separate node categories
  const stateNodes = getChildren(root, 'state');
  const onNodes = getChildren(root, 'on');
  const streamNodes = getChildren(root, 'stream');
  const coreChildren = (root.children || []).filter(c => isCoreNode(c.type) && c.type !== 'on');
  const uiChildren = (root.children || []).filter(c =>
    c.type !== 'state' && c.type !== 'on' && c.type !== 'stream' && !isCoreNode(c.type)
  );

  // ── Core nodes emitted above component (types, interfaces, machines, events) ──
  const coreLines: string[] = [];
  if (coreChildren.length > 0) {
    coreLines.push('// ── Core ───────────────────────────────────────────────');
    for (const child of coreChildren) {
      if (child.type === 'machine') {
        // Machine nodes get useReducer treatment
        imports.addReact('useReducer');
        coreLines.push(...generateMachineReducer(child));
      } else {
        coreLines.push(...generateCoreNode(child));
      }
      coreLines.push('');
    }
  }

  // ── Component body ──
  const bodyLines: string[] = [];

  // State hooks
  for (const stateNode of stateNodes) {
    bodyLines.push(...generateStateHook(stateNode, imports));
  }
  if (stateNodes.length > 0) bodyLines.push('');

  // on event=key → useInput() hooks
  for (const onNode of onNodes) {
    const onProps = getProps(onNode);
    const event = (onProps.event || onProps.name) as string;
    if (event === 'key' || event === 'input') {
      imports.addInk('useInput');
      const key = onProps.key as string;
      const handlerChild = (onNode.children || []).find(c => c.type === 'handler');
      const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';

      bodyLines.push(`  useInput((input, key) => {`);
      if (key) {
        // Filter for specific key
        const keyCheck = key === 'return' || key === 'Enter' ? 'key.return'
          : key === 'escape' || key === 'Escape' ? 'key.escape'
          : key === 'tab' || key === 'Tab' ? 'key.tab'
          : key === 'up' || key === 'ArrowUp' ? 'key.upArrow'
          : key === 'down' || key === 'ArrowDown' ? 'key.downArrow'
          : key === 'left' || key === 'ArrowLeft' ? 'key.leftArrow'
          : key === 'right' || key === 'ArrowRight' ? 'key.rightArrow'
          : key === 'backspace' || key === 'Backspace' ? 'key.backspace'
          : key === 'delete' || key === 'Delete' ? 'key.delete'
          : `input === '${key}'`;
        bodyLines.push(`    if (!(${keyCheck})) return;`);
      }
      if (code) {
        for (const line of code.split('\n')) {
          bodyLines.push(`    ${line}`);
        }
      }
      bodyLines.push(`  });`);
      bodyLines.push('');
    }
  }

  // Stream effects → useEffect with async generator iteration
  for (const streamNode of streamNodes) {
    bodyLines.push(...generateStreamEffect(streamNode, imports));
    bodyLines.push('');
  }

  // JSX return
  imports.addInk('Box');
  bodyLines.push('  return (');
  bodyLines.push('    <Box flexDirection="column">');

  for (const child of uiChildren) {
    bodyLines.push(...renderInkNode(child, '      ', imports));
  }

  bodyLines.push('    </Box>');
  bodyLines.push('  );');

  // ── Assemble ──
  // Imports (computed last since renderInkNode populates the tracker)
  lines.push(...imports.emit());
  lines.push('');

  // Core nodes
  if (coreLines.length > 0) {
    lines.push(...coreLines);
  }

  // Component
  lines.push(`export default function ${screenName}() {`);
  lines.push(...bodyLines);
  lines.push('}');

  // Source map
  sourceMap.push({
    irLine: root.loc?.line || 0,
    irCol: root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  const code = lines.join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(code);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
  };
}
