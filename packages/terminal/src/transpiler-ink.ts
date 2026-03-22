import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig } from '@kernlang/core';
import { countTokens, serializeIR, isCoreNode, generateCoreNode, generateMachineReducer, getProps, getChildren, dedent } from '@kernlang/core';

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
 *   ref     → const xRef = useRef(initial)
 *   stream  → useEffect with async generator iteration (streaming output)
 *   logic   → useEffect with side-effect code
 *   machine → standard output + useReducer hook
 *   conditional → {condition && (<>...</>)}
 *   input-area  → <Box> at bottom of screen (persistent input region)
 *   output-area → <Box flexGrow={1}> scrollable output region
 *   text-input  → <TextInput value={...} onChange={...} />
 *   select-input → <SelectInput items={...} onSelect={...} />
 *   handler → raw JSX injection
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Check if a prop value is a {{ expression }} object from the parser. */
function isExpr(v: unknown): v is { __expr: true; code: string } {
  return typeof v === 'object' && v !== null && '__expr' in v;
}

/** Unwrap a prop value: expressions return their code, strings return as-is. */
function unwrapProp(v: unknown): string {
  if (isExpr(v)) return (v as { code: string }).code;
  return String(v ?? '');
}

/** Split a comma-separated prop string while respecting angle-bracket/paren depth. */
function splitPropsRespectingDepth(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Convert KERN condition to JS expression — handles __expr and shorthand. */
function irConditionToJs(cond: unknown): string {
  if (isExpr(cond)) return (cond as { code: string }).code;
  return String(cond)
    .replace(/&/g, ' && ')
    .replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
}

/** Convert KERN style value to Ink-compatible color prop */
function inkColor(color: unknown): string {
  if (typeof color === 'number') return `{${color}}`;
  if (typeof color === 'string') {
    if (color.startsWith('#')) return `"${color}"`;
    return `"${color}"`;
  }
  return '"white"';
}

/** Ink key name → key object property check */
function keyToCheck(key: string): string {
  switch (key) {
    case 'return': case 'Enter': return 'key.return';
    case 'escape': case 'Escape': return 'key.escape';
    case 'tab': case 'Tab': return 'key.tab';
    case 'up': case 'ArrowUp': return 'key.upArrow';
    case 'down': case 'ArrowDown': return 'key.downArrow';
    case 'left': case 'ArrowLeft': return 'key.leftArrow';
    case 'right': case 'ArrowRight': return 'key.rightArrow';
    case 'backspace': case 'Backspace': return 'key.backspace';
    case 'delete': case 'Delete': return 'key.delete';
    default: return `input === '${key}'`;
  }
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
  const initialProp = props.initial;

  if (name && initialProp !== undefined) {
    imports.addReact('useState');
    const initial = isExpr(initialProp)
      ? (initialProp as { code: string }).code
      : String(initialProp);
    const initVal = isExpr(initialProp) ? initial
      : initial === 'null' ? 'null'
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

// ── Ref block → useRef (Feature #10) ────────────────────────────────────

function generateRefHook(refNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(refNode);
  const name = props.name as string;
  const initialProp = props.initial;

  if (name) {
    imports.addReact('useRef');
    const initVal = initialProp === undefined ? 'null'
      : isExpr(initialProp) ? unwrapProp(initialProp)
      : String(initialProp);
    lines.push(`  const ${name}Ref = useRef(${initVal});`);
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

// ── Logic block → useEffect (Feature #8) ────────────────────────────────

function generateLogicEffect(logicNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(logicNode);
  const code = props.code as string || '';
  const deps = props.deps as string;

  if (code) {
    imports.addReact('useEffect');
    const dedented = dedent(code);
    const depsStr = deps ? `[${deps}]` : '[]';

    lines.push(`  useEffect(() => {`);
    for (const line of dedented.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  }, ${depsStr});`);
  }

  return lines;
}

// ── Callback block → useCallback (Feature #11) ─────────────────────────

function generateCallbackHook(callbackNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const props = getProps(callbackNode);
  const name = props.name as string;
  const params = props.params as string || '';
  const deps = props.deps as string;
  const handlerChild = (callbackNode.children || []).find(c => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';

  if (name && code) {
    imports.addReact('useCallback');
    const dedented = dedent(code);
    const depsStr = deps ? `[${deps}]` : '[]';
    const isAsync = props.async === 'true' || props.async === true;
    const asyncKw = isAsync ? 'async ' : '';

    lines.push(`  const ${name} = useCallback(${asyncKw}(${params}) => {`);
    for (const line of dedented.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  }, ${depsStr});`);
  }

  return lines;
}

// ── Collect nested on-nodes from UI tree for hoisting (Bug #1) ─────────

function collectNestedOnNodes(node: IRNode): IRNode[] {
  const found: IRNode[] = [];
  for (const child of node.children || []) {
    if (child.type === 'on') {
      found.push(child);
    } else if (!['state', 'stream', 'logic', 'callback', 'ref'].includes(child.type) && !isCoreNode(child.type)) {
      found.push(...collectNestedOnNodes(child));
    }
  }
  return found;
}

// ── Generate useInput from an on-node ───────────────────────────────────

function generateOnHook(onNode: IRNode, imports: ImportTracker): string[] {
  const lines: string[] = [];
  const onProps = getProps(onNode);
  const event = (onProps.event || onProps.name) as string;

  if (event === 'key' || event === 'input') {
    imports.addInk('useInput');
    const key = onProps.key as string;
    const handlerChild = (onNode.children || []).find(c => c.type === 'handler');
    const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';

    lines.push(`  useInput((input, key) => {`);
    if (key) {
      lines.push(`    if (!(${keyToCheck(key)})) return;`);
    }
    if (code) {
      const dedented = dedent(code);
      for (const line of dedented.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`  });`);
    lines.push('');
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
      // Bug #2: Handle __expr objects for dynamic text values
      const rawValue = p.value;
      const styles = (p.styles as Record<string, string>) || {};
      const textProps: string[] = [];

      if (styles.fw === 'bold' || styles.bold) textProps.push('bold');
      if (styles.dim) textProps.push('dimColor');
      if (styles.italic) textProps.push('italic');
      if (styles.c || styles.color) textProps.push(`color=${inkColor(styles.c || styles.color)}`);
      if (styles.bg) textProps.push(`backgroundColor=${inkColor(styles.bg)}`);

      const propsStr = textProps.length > 0 ? ' ' + textProps.join(' ') : '';
      if (isExpr(rawValue)) {
        lines.push(`${indent}<Text${propsStr}>{${(rawValue as { code: string }).code}}</Text>`);
      } else {
        const value = String(rawValue ?? '');
        lines.push(`${indent}<Text${propsStr}>{${JSON.stringify(value)}}</Text>`);
      }
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
      const flexGrow = p.flexGrow as string;
      const padding = p.padding as string;
      const paddingX = p.paddingX as string;
      const paddingY = p.paddingY as string;

      const boxProps: string[] = [];
      if (color) boxProps.push(`borderStyle="${borderStyle}"`, `borderColor=${inkColor(color)}`);
      if (flexDirection) boxProps.push(`flexDirection="${flexDirection}"`);
      if (width) boxProps.push(`width={${width}}`);
      if (flexGrow) boxProps.push(`flexGrow={${flexGrow}}`);
      if (padding) boxProps.push(`padding={${padding}}`);
      if (paddingX) boxProps.push(`paddingX={${paddingX}}`);
      if (paddingY) boxProps.push(`paddingY={${paddingY}}`);

      const propsStr = boxProps.length > 0 ? ' ' + boxProps.join(' ') : '';
      lines.push(`${indent}<Box${propsStr}>`);

      for (const child of node.children || []) {
        // Skip nested on-nodes in JSX — they're hoisted to component body
        if (child.type === 'on') continue;
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
      const rawMsg = p.message;
      const color = p.color as string;
      const spinnerColor = color ? ` color=${inkColor(color)}` : '';
      const msgContent = isExpr(rawMsg) ? `{${(rawMsg as { code: string }).code}}` : `{' ${String(rawMsg ?? 'Loading...')}'}`;
      lines.push(`${indent}<Text>`);
      lines.push(`${indent}  <Spinner${spinnerColor} />`);
      lines.push(`${indent}  ${msgContent}`);
      lines.push(`${indent}</Text>`);
      break;
    }

    // Bug #3: Handle dynamic progress values via __expr
    case 'progress': {
      imports.addInk('Box');
      imports.addInk('Text');
      const rawValue = p.value;
      const rawMax = p.max;
      const color = p.color as string || 'green';
      const barWidth = 20;

      if (isExpr(rawValue) || isExpr(rawMax)) {
        // Dynamic progress — compute at runtime
        const valueExpr = isExpr(rawValue) ? (rawValue as { code: string }).code : String(rawValue ?? 0);
        const maxExpr = isExpr(rawMax) ? (rawMax as { code: string }).code : String(rawMax ?? 100);
        lines.push(`${indent}<Box>`);
        lines.push(`${indent}  {(() => {`);
        lines.push(`${indent}    const _pct = Math.min(1, Math.max(0, (${valueExpr}) / (${maxExpr})));`);
        lines.push(`${indent}    const _filled = Math.round(_pct * ${barWidth});`);
        lines.push(`${indent}    const _empty = ${barWidth} - _filled;`);
        lines.push(`${indent}    return (<>`);
        lines.push(`${indent}      <Text color=${inkColor(color)}>${'{'}'▓'.repeat(_filled)${'}'}</Text>`);
        lines.push(`${indent}      <Text>${'{'}'░'.repeat(_empty)${'}'}</Text>`);
        lines.push(`${indent}      <Text>{' ' + Math.round(_pct * 100) + '%'}</Text>`);
        lines.push(`${indent}    </>);`);
        lines.push(`${indent}  })()}`);
        lines.push(`${indent}</Box>`);
      } else {
        // Static progress — compute at compile time
        const value = Number(rawValue) || 0;
        const max = Number(rawMax) || 100;
        const pct = Math.min(1, Math.max(0, value / max));
        const filled = Math.round(pct * barWidth);
        const empty = barWidth - filled;

        lines.push(`${indent}<Box>`);
        lines.push(`${indent}  <Text color=${inkColor(color)}>{'${'▓'.repeat(filled)}'}</Text>`);
        lines.push(`${indent}  <Text>{'${'░'.repeat(empty)}'}</Text>`);
        lines.push(`${indent}  <Text>{' ${Math.round(pct * 100)}%'}</Text>`);
        lines.push(`${indent}</Box>`);
      }
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
        if (child.type === 'on') continue;
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
        if (child.type === 'on') continue;
        lines.push(...renderInkNode(child, indent + '  ', imports));
      }
      lines.push(`${indent}</Box>`);
      break;
    }

    // Bug #4: Wire text-input value/onChange for controlled component
    case 'text-input': {
      imports.needTextInput();
      const placeholder = p.placeholder as string || '';
      const bind = p.bind as string;
      const history = p.history as string;
      const onSubmit = p.onSubmit as string;
      const inputProps: string[] = [];
      if (placeholder) inputProps.push(`placeholder=${JSON.stringify(placeholder)}`);
      if (history) inputProps.push(`history={${history}}`);
      if (bind) {
        inputProps.push(`value={${bind}}`);
        inputProps.push(`onChange={set${capitalize(bind)}}`);
      }
      if (onSubmit) {
        inputProps.push(`onSubmit={${onSubmit}}`);
      }
      lines.push(`${indent}<TextInput ${inputProps.join(' ')} />`);
      break;
    }

    // Bug #5: Wire select-input onSelect handler
    case 'select-input': {
      imports.needSelectInput();
      const rawItems = p.items;
      const items = isExpr(rawItems) ? (rawItems as { code: string }).code : (rawItems as string || '[]');
      const onSelect = p.onSelect as string;
      const selectProps: string[] = [`items={${items}}`];
      if (onSelect) {
        selectProps.push(`onSelect={${onSelect}}`);
      }
      lines.push(`${indent}<SelectInput ${selectProps.join(' ')} />`);
      break;
    }

    // Bug #6: Fix handler indentation — use dedent instead of trim
    case 'handler': {
      const code = p.code as string || '';
      const dedented = dedent(code);
      for (const line of dedented.split('\n')) {
        lines.push(`${indent}${line}`);
      }
      break;
    }

    // Feature: each — JSX list iteration
    // each collection={{items}} item=engine index=i key={{engine.id}}
    //   box ...
    // → {items.map((engine, i) => (<Box key={engine.id}>...</Box>))}
    case 'each': {
      const rawCollection = p.collection;
      const collection = isExpr(rawCollection) ? (rawCollection as { code: string }).code : (rawCollection as string || '[]');
      const item = p.item as string || 'item';
      const index = p.index as string || 'i';
      const rawKey = p.key;
      const key = isExpr(rawKey) ? (rawKey as { code: string }).code : (rawKey as string || index);

      lines.push(`${indent}{${collection}.map((${item}, ${index}) => (`);
      // If there's one child, render it directly with key; otherwise wrap in fragment
      const children = node.children || [];
      if (children.length === 1) {
        const childLines = renderInkNode(children[0], indent + '  ', imports);
        // Inject key prop into the first JSX opening tag
        if (childLines.length > 0) {
          childLines[0] = childLines[0].replace(/^(\s*<\w+)/, `$1 key={${key}}`);
        }
        lines.push(...childLines);
      } else {
        lines.push(`${indent}  <React.Fragment key={${key}}>`);
        for (const child of children) {
          lines.push(...renderInkNode(child, indent + '    ', imports));
        }
        lines.push(`${indent}  </React.Fragment>`);
      }
      lines.push(`${indent}))}`)
      break;
    }

    // Feature #7: Conditional rendering
    case 'conditional': {
      const condition = p.if;
      const jsCondition = irConditionToJs(condition ?? 'true');

      lines.push(`${indent}{${jsCondition} && (`);
      lines.push(`${indent}  <>`);
      for (const child of node.children || []) {
        lines.push(...renderInkNode(child, indent + '    ', imports));
      }
      lines.push(`${indent}  </>`);
      lines.push(`${indent})}`);
      break;
    }

    case 'state':
      // Handled at component level as useState
      break;

    case 'ref':
      // Handled at component level as useRef
      break;

    case 'stream':
      // Handled at component level as useEffect with async generator
      break;

    case 'logic':
      // Handled at component level as useEffect
      break;

    case 'callback':
      // Handled at component level as useCallback
      break;

    // Bug #1: Nested on-nodes are hoisted — skip in JSX, emit comment
    case 'on':
      break;

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

  // Feature #9: Component props from screen attributes
  const propsAttr = rootProps.props as string;
  const propParts = propsAttr ? splitPropsRespectingDepth(propsAttr) : [];
  const propsParam = propParts.length > 0
    ? `{ ${propParts.map(p => p.trim().split(':')[0].trim()).join(', ')} }: { ${propParts.map(p => {
        const trimmed = p.trim();
        if (trimmed.includes(':')) return trimmed;
        return `${trimmed}: any`;
      }).join('; ')} }`
    : '';

  // Separate node categories
  const stateNodes = getChildren(root, 'state');
  const refNodes = getChildren(root, 'ref');
  const onNodes = getChildren(root, 'on');
  const streamNodes = getChildren(root, 'stream');
  const logicNodes = getChildren(root, 'logic');
  const callbackNodes = getChildren(root, 'callback');
  // In Ink context, 'each' is a UI node (.map iteration), not a core node (for...of loop)
  const isInkUiNode = (type: string) => type === 'each' || type === 'conditional' || type === 'select'
    || type === 'model' || type === 'repository' || type === 'dependency' || type === 'cache';
  const coreChildren = (root.children || []).filter(c => isCoreNode(c.type) && c.type !== 'on' && !isInkUiNode(c.type));
  const uiChildren = (root.children || []).filter(c =>
    c.type !== 'state' && c.type !== 'ref' && c.type !== 'on' && c.type !== 'stream'
    && c.type !== 'logic' && c.type !== 'callback' && (!isCoreNode(c.type) || isInkUiNode(c.type))
  );

  // Bug #1: Collect nested on-nodes from UI tree and hoist to component level
  const nestedOnNodes = collectNestedOnNodes(root);
  // Deduplicate — top-level on-nodes are already in onNodes
  const allOnNodes = [...onNodes];
  for (const nested of nestedOnNodes) {
    if (!onNodes.includes(nested)) {
      allOnNodes.push(nested);
    }
  }

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

  // Ref hooks (Feature #10)
  for (const refNode of refNodes) {
    bodyLines.push(...generateRefHook(refNode, imports));
  }
  if (refNodes.length > 0) bodyLines.push('');

  // Callback hooks (Feature #11)
  for (const callbackNode of callbackNodes) {
    bodyLines.push(...generateCallbackHook(callbackNode, imports));
    bodyLines.push('');
  }

  // on event=key → useInput() hooks (Bug #1: now includes hoisted nested on-nodes)
  for (const onNode of allOnNodes) {
    bodyLines.push(...generateOnHook(onNode, imports));
  }

  // Stream effects → useEffect with async generator iteration
  for (const streamNode of streamNodes) {
    bodyLines.push(...generateStreamEffect(streamNode, imports));
    bodyLines.push('');
  }

  // Logic effects → useEffect (Feature #8)
  for (const logicNode of logicNodes) {
    bodyLines.push(...generateLogicEffect(logicNode, imports));
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

  // Component (Feature #9: with props)
  lines.push(`export default function ${screenName}(${propsParam}) {`);
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
